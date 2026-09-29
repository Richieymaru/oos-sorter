/**
 * Orders data layer for the Funnels page. Read-only, `read_orders` scope.
 *
 * Two tiers, because order traffic-source data (customerJourneySummary — where a
 * buyer came from, their landing page, days to convert) is *protected customer
 * data*: it needs the protected-data access turned on in the Dev Dashboard, on
 * top of read_orders. So we ask for the full query first and, if Shopify denies
 * it, fall back to the base fields (revenue, channel, products) that read_orders
 * alone allows. If even that is denied, read_orders itself isn't granted yet.
 *
 * The GraphQL below was validated against the store's 2026-07 schema before it
 * shipped (momentsCount is a `Count`, so it needs `{ count }` — the same trap
 * productsCount has). Don't "simplify" those braces away.
 */
import { gql } from './shopify.mjs';

// Safe with read_orders alone.
const BASE_FIELDS = `
  createdAt
  sourceName
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 5) { nodes { title quantity } }`;

// Adds traffic-source / funnel data — needs protected customer data access.
const JOURNEY_FIELDS = `
  customerJourneySummary {
    daysToConversion
    momentsCount { count }
    firstVisit { source referrerUrl landingPage }
  }`;

const ordersQuery = (fields) => `query Orders($n: Int!, $q: String!, $c: String) {
  orders(first: $n, after: $c, sortKey: CREATED_AT, reverse: true, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { ${fields} }
  }
}`;

const isDenied = (err) => /ACCESS_DENIED/i.test(String(err && err.message));

/** Build a created_at search filter from an ISO window (since inclusive, until exclusive). */
function windowFilter(since, until) {
  const parts = [];
  if (since) parts.push(`created_at:>='${since}'`);
  if (until) parts.push(`created_at:<'${until}'`);
  return parts.join(' AND ') || `created_at:>='${new Date(Date.now() - 30 * 86400000).toISOString()}'`;
}

/** Normalise one raw order node into a flat, framework-free shape. */
export function normalizeOrder(n) {
  const money = n.currentTotalPriceSet?.shopMoney || {};
  const j = n.customerJourneySummary || null;
  return {
    createdAt: n.createdAt || null,
    source: n.sourceName || null,
    amount: Number(money.amount || 0),
    currency: money.currencyCode || null,
    items: (n.lineItems?.nodes || []).map((li) => ({ title: li.title || '(untitled)', qty: Number(li.quantity || 0) })),
    journey: j
      ? {
          source: j.firstVisit?.source || null,
          referrer: j.firstVisit?.referrerUrl || null,
          landing: j.firstVisit?.landingPage || null,
          days: j.daysToConversion == null ? null : Number(j.daysToConversion),
          moments: j.momentsCount?.count == null ? null : Number(j.momentsCount.count),
        }
      : null,
  };
}

/**
 * Fetch orders from the last `days` (default 30), newest first, paginating up to
 * `maxPages`. A fixed date window (not "last N orders") so the whole Funnels page
 * has one clear, consistent time frame. Returns
 *   { orders, tier: 'full'|'base'|'none', denied, days, since }
 * - 'full': journey/traffic-source data present (protected data granted)
 * - 'base': read_orders works, but protected data is off (no journey)
 * - 'none': read_orders not granted yet (empty orders)
 */
export async function fetchOrders({ since = null, until = null, pageSize = 250, maxPages = 4 } = {}) {
  const q = windowFilter(since, until);
  async function run(fields) {
    const out = [];
    let cursor = null;
    let pages = 0;
    do {
      const d = await gql(ordersQuery(fields), { n: pageSize, q, c: cursor });
      out.push(...(d.orders?.nodes || []).map(normalizeOrder));
      cursor = d.orders?.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return out;
  }
  try {
    return { orders: await run(BASE_FIELDS + JOURNEY_FIELDS), tier: 'full', denied: false, since, until };
  } catch (e) {
    if (!isDenied(e)) throw e;
    try {
      return { orders: await run(BASE_FIELDS), tier: 'base', denied: true, since, until };
    } catch (e2) {
      if (isDenied(e2)) return { orders: [], tier: 'none', denied: true, since, until };
      throw e2;
    }
  }
}

const ABANDONED_FIELDS = `
  createdAt
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 10) { nodes { title quantity } }`;

/** Normalise an abandoned-checkout node (same flat shape as an order, no journey). */
export function normalizeAbandoned(n) {
  const money = n.totalPriceSet?.shopMoney || {};
  return {
    createdAt: n.createdAt || null,
    amount: Number(money.amount || 0),
    currency: money.currencyCode || null,
    items: (n.lineItems?.nodes || []).map((li) => ({ title: li.title || '(untitled)', qty: Number(li.quantity || 0) })),
  };
}

/**
 * Abandoned checkouts (reached checkout, didn't complete) in the last `days`.
 * read_orders covers this. Returns { abandoned, count, denied, days, since }.
 * `count` is Shopify's exact total for the window; `abandoned` is the fetched
 * sample (up to maxPages) used to see WHICH products get abandoned.
 */
export async function fetchAbandonedCheckouts({ since = null, until = null, pageSize = 250, maxPages = 4 } = {}) {
  const q = windowFilter(since, until);
  const query = `query($n: Int!, $q: String!, $c: String) {
    abandonedCheckoutsCount(query: $q) { count }
    abandonedCheckouts(first: $n, after: $c, sortKey: CREATED_AT, reverse: true, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ABANDONED_FIELDS} }
    }
  }`;
  try {
    const out = [];
    let cursor = null;
    let pages = 0;
    let count = 0;
    do {
      const d = await gql(query, { n: pageSize, q, c: cursor });
      count = d.abandonedCheckoutsCount?.count ?? count;
      out.push(...(d.abandonedCheckouts?.nodes || []).map(normalizeAbandoned));
      cursor = d.abandonedCheckouts?.pageInfo?.hasNextPage ? d.abandonedCheckouts.pageInfo.endCursor : null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return { abandoned: out, count, denied: false, since, until };
  } catch (e) {
    if (isDenied(e)) return { abandoned: [], count: 0, denied: true, since, until };
    throw e;
  }
}

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

// Safe with read_orders alone. product{id} is catalog data (not protected) —
// used to bucket sold products by collection on the Funnels page.
const BASE_FIELDS = `
  createdAt
  sourceName
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  customAttributes { key value }
  lineItems(first: 10) { nodes { title quantity product { id } customAttributes { key value } } }`;

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

/** Value of a { key, value } attribute list entry, or null (tolerant of missing/empty). */
const attr = (list, key) => (Array.isArray(list) ? list.find((a) => a && a.key === key)?.value ?? null : null);

/** Normalise one raw order node into a flat, framework-free shape. */
export function normalizeOrder(n) {
  const money = n.currentTotalPriceSet?.shopMoney || {};
  const j = n.customerJourneySummary || null;
  return {
    createdAt: n.createdAt || null,
    source: n.sourceName || null,
    amount: Number(money.amount || 0),
    currency: money.currencyCode || null,
    origin: attr(n.customAttributes, '_origin'),
    items: (n.lineItems?.nodes || []).map((li) => ({
      title: li.title || '(untitled)',
      qty: Number(li.quantity || 0),
      id: li.product?.id ? String(li.product.id).split('/').pop() : null,
      src: attr(li.customAttributes, '_src'),
    })),
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

// `id` lets the Funnels "Recover" button reference a cart; it needs no extra
// scope. The customer email + recovery URL are fetched on demand by id
// (fetchAbandonedCheckout), never in this list — keeps emails out of page source.
const ABANDONED_FIELDS = `
  id
  createdAt
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 10) { nodes { title quantity } }`;

/** Normalise an abandoned-checkout node (same flat shape as an order, no journey). */
export function normalizeAbandoned(n) {
  const money = n.totalPriceSet?.shopMoney || {};
  return {
    id: n.id ? String(n.id).split('/').pop() : null,
    createdAt: n.createdAt || null,
    amount: Number(money.amount || 0),
    currency: money.currencyCode || null,
    items: (n.lineItems?.nodes || []).map((li) => ({ title: li.title || '(untitled)', qty: Number(li.quantity || 0) })),
  };
}

/**
 * One abandoned checkout by id, for the manual "Recover" action: its recovery
 * URL + items (needs only read_orders) and the customer email (needs
 * read_customers — protected). If the email query is denied (scope not granted
 * yet), falls back to the no-email query so Preview still works. Returns
 * { id, createdAt, recoveryUrl, email, emailDenied, amount, currency, items }.
 * Validated against the 2026-07 schema (shopify-admin skill) before shipping.
 */
export async function fetchAbandonedCheckout(id) {
  const num = String(id || '').replace(/\D/g, '');
  if (!num) return null;
  const gid = `gid://shopify/AbandonedCheckout/${num}`;
  const body = (withEmail) => `query($id: ID!){ node(id: $id){ ... on AbandonedCheckout {
    id createdAt abandonedCheckoutUrl
    ${withEmail ? 'customer { defaultEmailAddress { emailAddress } }' : ''}
    totalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 25) { nodes { title quantity image { url } } }
  } } }`;
  let node;
  let emailDenied = false;
  try {
    const d = await gql(body(true), { id: gid });
    node = d.node;
  } catch (e) {
    if (!isDenied(e)) throw e;
    emailDenied = true;
    const d = await gql(body(false), { id: gid });
    node = d.node;
  }
  if (!node) return null;
  const money = node.totalPriceSet?.shopMoney || {};
  return {
    id: String(node.id).split('/').pop(),
    createdAt: node.createdAt || null,
    recoveryUrl: node.abandonedCheckoutUrl || null,
    email: node.customer?.defaultEmailAddress?.emailAddress || null,
    emailDenied,
    amount: Number(money.amount || 0),
    currency: money.currencyCode || null,
    items: (node.lineItems?.nodes || []).map((li) => ({
      title: li.title || '(untitled)',
      qty: Number(li.quantity || 0),
      image: li.image?.url || null,
    })),
  };
}

/**
 * Orders for waitlist attribution: who bought what, and when. Needs the order's
 * EMAIL (to match a notified shopper) and its line-item product ids. Email is
 * Level-2 protected customer data, so if it comes back redacted (null on every
 * order) we report `emailRedacted` so the caller can skip matching and tell the
 * owner to enable Level 2. Returns { orders, emailRedacted, denied }.
 */
export async function fetchOrdersForAttribution({ since = null, until = null, pageSize = 250, maxPages = 6 } = {}) {
  const q = windowFilter(since, until);
  const query = `query($n: Int!, $q: String!, $c: String) {
    orders(first: $n, after: $c, sortKey: CREATED_AT, reverse: true, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        email
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 25) { nodes { product { id } } }
      }
    }
  }`;
  try {
    const out = [];
    let cursor = null;
    let pages = 0;
    let anyEmail = false;
    do {
      const d = await gql(query, { n: pageSize, q, c: cursor });
      for (const n of (d.orders?.nodes || [])) {
        const money = n.currentTotalPriceSet?.shopMoney || {};
        if (n.email) anyEmail = true;
        out.push({
          id: String(n.id || '').split('/').pop(),
          createdAt: n.createdAt || null,
          email: n.email || null,
          amount: Number(money.amount || 0),
          currency: money.currencyCode || null,
          productIds: (n.lineItems?.nodes || []).map((li) => (li.product?.id ? String(li.product.id).split('/').pop() : null)).filter(Boolean),
        });
      }
      cursor = d.orders?.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return { orders: out, emailRedacted: out.length > 0 && !anyEmail, denied: false };
  } catch (e) {
    if (isDenied(e)) return { orders: [], emailRedacted: false, denied: true };
    throw e;
  }
}

/**
 * Abandoned checkouts WITH the shopper's email + item titles, for the Notified
 * page's "started a cart" engagement signal — we match these to notified
 * shoppers. Email is Level-2 protected (read_customers); if it comes back
 * redacted/denied we report it so the caller skips matching. Returns
 * { carts:[{email, at, amount, currency, items:[title]}], emailRedacted, denied }.
 */
export async function fetchAbandonedForAttribution({ since = null, until = null, pageSize = 250, maxPages = 6 } = {}) {
  const q = windowFilter(since, until);
  const query = `query AbAttr($n: Int!, $q: String!, $c: String) {
    abandonedCheckouts(first: $n, after: $c, sortKey: CREATED_AT, reverse: true, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt
        customer { defaultEmailAddress { emailAddress } }
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 10) { nodes { title quantity } }
      }
    }
  }`;
  try {
    const carts = [];
    let cursor = null, pages = 0, anyEmail = false;
    do {
      const d = await gql(query, { n: pageSize, q, c: cursor });
      for (const n of (d.abandonedCheckouts?.nodes || [])) {
        const email = n.customer?.defaultEmailAddress?.emailAddress || null;
        if (email) anyEmail = true;
        const money = n.totalPriceSet?.shopMoney || {};
        carts.push({
          email,
          at: n.createdAt || null,
          amount: Number(money.amount || 0),
          currency: money.currencyCode || null,
          items: (n.lineItems?.nodes || []).map((li) => li.title || '(untitled)'),
        });
      }
      cursor = d.abandonedCheckouts?.pageInfo?.hasNextPage ? d.abandonedCheckouts.pageInfo.endCursor : null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return { carts, emailRedacted: carts.length > 0 && !anyEmail, denied: false };
  } catch (e) {
    if (isDenied(e)) return { carts: [], emailRedacted: false, denied: true };
    throw e;
  }
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

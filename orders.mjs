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

const ordersQuery = (fields) => `query Orders($n: Int!) {
  orders(first: $n, sortKey: CREATED_AT, reverse: true) {
    nodes { ${fields} }
  }
}`;

const isDenied = (err) => /ACCESS_DENIED/i.test(String(err && err.message));

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
 * Fetch recent orders, newest first. Returns
 *   { orders, tier: 'full' | 'base' | 'none', denied }
 * - 'full': journey/traffic-source data present (protected data granted)
 * - 'base': read_orders works, but protected data is off (no journey)
 * - 'none': read_orders not granted yet (empty orders)
 */
export async function fetchOrders({ limit = 250 } = {}) {
  try {
    const d = await gql(ordersQuery(BASE_FIELDS + JOURNEY_FIELDS), { n: limit });
    return { orders: (d.orders?.nodes || []).map(normalizeOrder), tier: 'full', denied: false };
  } catch (e) {
    if (!isDenied(e)) throw e;
    // Protected customer data likely off — try the base fields read_orders allows.
    try {
      const d = await gql(ordersQuery(BASE_FIELDS), { n: limit });
      return { orders: (d.orders?.nodes || []).map(normalizeOrder), tier: 'base', denied: true };
    } catch (e2) {
      if (isDenied(e2)) return { orders: [], tier: 'none', denied: true };
      throw e2;
    }
  }
}

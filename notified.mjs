/**
 * Back-in-stock NOTIFIED LOG: one row per email we actually sent, kept in the
 * shop metafield `oos_sort.notified` (separate from oos_sort.state). Retaining
 * these rows is what makes "who was notified / which restocked / did they click /
 * resend / nudge" possible — before this, notifying a shopper deleted the record.
 *
 * This file is split like waitlist.mjs: a PURE core (tested offline in
 * notified.test.mjs) and thin metafield I/O below it. All product/variant ids in
 * a row are NUMERIC; every marker normalizes ids, so callers may pass a gid or a
 * numeric short id. Rows are newest-first.
 */

import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';
import { fetchOrdersForAttribution } from './orders.mjs';

const CAP = 1000;           // max rows kept (also trimmed by byte size below)
const LIMIT = 131072;       // Shopify metafield JSON value cap, in bytes
const DAY = 86400000;

// Follow-up nudge cadence: up to 3 nudges to a notified-but-not-converted shopper,
// then STOP. Gaps are measured since the LAST email we sent them — the original
// back-in-stock notification for the 1st nudge, the previous nudge after that.
// gaps[0] is the configurable first delay (settings.nudgeDays); then +2 then +7 days.
export const MAX_NUDGES = 3;
export function nudgeGaps(firstGapDays) {
  return [Number(firstGapDays) || 2, 2, 7];
}
/** How many nudges a row has had (migrates old single-nudge rows: n set => 1). */
export function nudgeStage(row) {
  if (row && row.ns != null) return row.ns;
  return row && row.n ? 1 : 0;
}

const nid = (id) => String(id ?? '').replace(/\D/g, '');
const lc = (e) => String(e ?? '').trim().toLowerCase();

/** Build a log row from a shopper + product. `kind` marks what we sent:
 *  null/undefined = a back-in-stock notification; 'alt' = a manual "a different
 *  option is in stock" offer (so the Notified page can label + count it). */
export function notifiedRow({ email, productId, title, variantId = null, variantTitle = null, ts = null, kind = null }) {
  return {
    e: lc(email),
    p: nid(productId),
    t: String(title ?? ''),
    v: variantId == null || variantId === '' ? null : nid(variantId),
    vt: variantTitle ? String(variantTitle) : null,
    ts: ts || new Date().toISOString(),
    c: null,   // clickedAt
    n: null,   // last-nudge timestamp
    ns: 0,     // nudge stage (how many follow-ups sent, 0..MAX_NUDGES)
    u: false,  // unsubscribed
    o: null,   // orderedAt
    k: kind || null, // 'alt' for an alternative-option offer; null = restock
  };
}

/** Prepend a row (newest-first), dedupe by (e,p,ts), cap oldest-out. */
export function appendNotified(log, row, cap = CAP) {
  const list = Array.isArray(log) ? log : [];
  if (list.some((x) => x.e === row.e && x.p === row.p && x.ts === row.ts)) return list;
  const next = [row, ...list];
  return next.length > cap ? next.slice(0, cap) : next;
}

/** Drop oldest rows (they sit at the end) until the JSON fits `limit` bytes. */
export function trimToFit(log, limit = LIMIT) {
  let list = Array.isArray(log) ? log.slice() : [];
  while (list.length && Buffer.byteLength(JSON.stringify(list)) > limit) {
    list = list.slice(0, list.length - 1);
  }
  return list;
}

function setNewest(log, email, productId, field, value) {
  const e = lc(email), p = nid(productId);
  const list = Array.isArray(log) ? log : [];
  const i = list.findIndex((x) => x.e === e && x.p === p); // newest-first => first match is most recent
  if (i < 0 || list[i][field]) return list;
  const next = list.slice();
  next[i] = { ...next[i], [field]: value };
  return next;
}

export const markClicked = (log, email, productId, whenISO) => setNewest(log, email, productId, 'c', whenISO);

/**
 * Attribute real orders to notified shoppers — the waitlist's ROI. For each order
 * (email + product ids + createdAt + amount), mark every un-ordered notified row
 * whose email + product match and whose notification came BEFORE the order. Sets
 * o = orderedAt, oa = order amount, oc = currency, oid = order id. Pure.
 * `orders`: [{ id, email, createdAt, amount, currency, productIds:[numeric] }].
 */
export function matchOrders(log, orders) {
  const list = Array.isArray(log) ? log.slice() : [];
  let matched = 0;
  for (const ord of (Array.isArray(orders) ? orders : [])) {
    const email = lc(ord.email);
    if (!email || !ord.createdAt) continue;
    const pids = new Set((ord.productIds || []).map(nid));
    const ot = new Date(ord.createdAt).getTime();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.o || r.e !== email || !pids.has(r.p)) continue;
      if (new Date(r.ts).getTime() > ot) continue; // the order must come AFTER we notified them
      list[i] = { ...r, o: ord.createdAt, oa: Number(ord.amount) || 0, oc: ord.currency || null, oid: nid(ord.id) };
      matched += 1;
    }
  }
  return { log: list, matched };
}

/** Advance the nudge stage for ALL rows of (email, product) — records this send
 *  (n = whenISO) and bumps ns to the next stage, so the cadence moves forward and
 *  every row (e.g. two variants) stays in sync. One call per nudge sent. */
export function markNudged(log, email, productId, whenISO) {
  const e = lc(email), p = nid(productId);
  const list = Array.isArray(log) ? log : [];
  const rows = list.filter((x) => x.e === e && x.p === p);
  if (!rows.length) return list;
  const nextStage = Math.max(...rows.map((x) => nudgeStage(x))) + 1;
  return list.map((x) => (x.e === e && x.p === p ? { ...x, n: whenISO, ns: nextStage } : x));
}

/** Flag every row for (email, product) unsubscribed (nudge suppression). */
export function markUnsubscribed(log, email, productId) {
  const e = lc(email), p = nid(productId);
  const list = Array.isArray(log) ? log : [];
  let changed = false;
  const next = list.map((x) => {
    if (x.e === e && x.p === p && !x.u) { changed = true; return { ...x, u: true }; }
    return x;
  });
  return changed ? next : list;
}

/** Rows due for a follow-up nudge, at most ONE per (email, product) — the newest
 *  row per shopper+product is the one that counts (list is newest-first). A row is
 *  due when: never clicked, never ordered, not unsubscribed, still has nudges left
 *  (stage < MAX_NUDGES), the product is in stock, and enough time has passed since
 *  the last email we sent them (gaps[stage] days). `firstGapDays` is the delay
 *  before the FIRST nudge (settings.nudgeDays); later gaps are fixed (+2, +7).
 *  `isInStockByProduct(numericId) -> boolean`. */
export function selectNudges(log, nowISO, firstGapDays, isInStockByProduct) {
  const gaps = nudgeGaps(firstGapDays);
  const now = new Date(nowISO).getTime();
  const list = Array.isArray(log) ? log : [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const key = `${x.e}\u0000${x.p}`;
    if (seen.has(key)) continue;
    seen.add(key); // lock onto the NEWEST row per (email, product)
    if (x.k === 'alt') continue; // alternative-option offers are a manual action, not part of the nudge cadence
    if (!(x.c == null && x.o == null && x.u !== true)) continue; // clicked / ordered / unsubscribed => never
    const stage = nudgeStage(x);
    if (stage >= MAX_NUDGES) continue; // finished the sequence — stop
    const last = stage === 0 ? x.ts : (x.n || x.ts); // since notify for #1, since last nudge after
    if (now - new Date(last).getTime() < gaps[stage] * DAY) continue; // not due yet
    if (isInStockByProduct(x.p) !== true) continue;
    out.push(x);
  }
  return out;
}

/** Dashboard counters over the retained window, incl. attributed revenue. */
export function deriveStats(log) {
  const list = Array.isArray(log) ? log : [];
  const notified = list.length;
  const clicked = list.filter((x) => x.c).length;
  const nudged = list.filter((x) => x.n).length;
  const orderedRows = list.filter((x) => x.o);
  const ordered = orderedRows.length;
  const clickRate = notified ? Math.round((clicked / notified) * 100) : 0;
  // Revenue = sum over DISTINCT orders (one order can match several rows).
  const byOrder = new Map();
  let currency = null;
  for (const x of orderedRows) {
    if (x.oid) byOrder.set(x.oid, Number(x.oa) || 0);
    else byOrder.set('_' + byOrder.size, Number(x.oa) || 0);
    if (!currency && x.oc) currency = x.oc;
  }
  const revenue = Math.round([...byOrder.values()].reduce((a, b) => a + b, 0) * 100) / 100;
  const orders = byOrder.size;
  // Follow-up nudge EMAILS sent = sum of the stage over distinct (email,product)
  // (all rows of a group share the stage, so count the newest once per group).
  const seen = new Set();
  let nudgeSends = 0;
  for (const x of list) {
    const key = `${x.e}\u0000${x.p}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nudgeSends += x.ns != null ? x.ns : (x.n ? 1 : 0);
  }
  // Alternative-option offers (manual "a different option is in stock") vs the
  // back-in-stock notifications, for the Notified-page breakdown.
  const offered = list.filter((x) => x.k === 'alt').length;
  // Total shopper emails sent = one per row + every follow-up nudge.
  const totalSent = notified + nudgeSends;
  return { notified, clicked, nudged, ordered, orders, revenue, currency, clickRate, nudgeSends, offered, totalSent };
}

/** A safe storefront-relative redirect target, or null. Blocks open-redirects. */
export function safeRelPath(to) {
  const s = String(to ?? '');
  if (!s.startsWith('/')) return null;
  if (s.startsWith('//')) return null;
  if (s.includes('\\')) return null;
  if (s.includes('://')) return null;
  return s;
}

/** The numeric variant id from an Add-to-Cart permalink path ("/cart/123:1"),
 *  or null for anything else (a product-page link, a malformed path). Lets the
 *  click redirect tell "add to cart" clicks apart so it can check stock first. */
export function cartVariantId(relPath) {
  const m = /^\/cart\/(\d+):\d+$/.exec(String(relPath || ''));
  return m ? m[1] : null;
}

/* ---- metafield I/O (shop-level oos_sort.notified) ---- */

const NAMESPACE = 'oos_sort';
const KEY = 'notified';

/** Read the notified log (empty array if unset/unparsable). */
export async function loadNotified() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** Persist the log, trimmed to fit the metafield byte cap (oldest dropped). */
export async function saveNotified(log) {
  const shopId = await getShopId();
  const fitted = trimToFit(log, LIMIT - 2048);
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(fitted) }] }
  );
  assertNoUserErrors('metafieldsSet(notified)', d.metafieldsSet);
  return fitted;
}

/** Append one row per email we sent, in a single load+save. */
export async function recordNotified(rows) {
  if (!rows || !rows.length) return;
  let log = await loadNotified();
  for (const r of rows) log = appendNotified(log, r);
  await saveNotified(log);
}

async function applyMark(fn) {
  const log = await loadNotified();
  const next = fn(log);
  if (next !== log) await saveNotified(next);
}

export const applyClicked = (email, productId, whenISO = new Date().toISOString()) =>
  applyMark((log) => markClicked(log, email, productId, whenISO));
export const applyNudged = (email, productId, whenISO = new Date().toISOString()) =>
  applyMark((log) => markNudged(log, email, productId, whenISO));
export const applyUnsubscribed = (email, productId) =>
  applyMark((log) => markUnsubscribed(log, email, productId));

/**
 * Attribute recent orders to notified shoppers and persist. Run on full engine
 * passes. Returns { matched } — or { emailRedacted:true } when the order email is
 * hidden (needs Level-2 protected customer data), or { denied:true } without
 * read_orders. Only fetches/writes when there are un-ordered rows to resolve.
 */
export async function reconcileOrders({ days = 60 } = {}) {
  const log = await loadNotified();
  if (!log.length || !log.some((r) => !r.o)) return { matched: 0 };
  const since = new Date(Date.now() - days * DAY).toISOString();
  const { orders, emailRedacted, denied } = await fetchOrdersForAttribution({ since });
  if (denied) return { matched: 0, denied: true };
  if (emailRedacted) return { matched: 0, emailRedacted: true };
  const { log: next, matched } = matchOrders(log, orders);
  if (matched) await saveNotified(next);
  return { matched };
}

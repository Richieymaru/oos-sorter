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

const CAP = 1000;           // max rows kept (also trimmed by byte size below)
const LIMIT = 131072;       // Shopify metafield JSON value cap, in bytes
const DAY = 86400000;

const nid = (id) => String(id ?? '').replace(/\D/g, '');
const lc = (e) => String(e ?? '').trim().toLowerCase();

/** Build a log row from a shopper + product. */
export function notifiedRow({ email, productId, title, variantId = null, variantTitle = null, ts = null }) {
  return {
    e: lc(email),
    p: nid(productId),
    t: String(title ?? ''),
    v: variantId == null || variantId === '' ? null : nid(variantId),
    vt: variantTitle ? String(variantTitle) : null,
    ts: ts || new Date().toISOString(),
    c: null,   // clickedAt
    n: null,   // nudgedAt (the one manual/auto follow-up)
    u: false,  // unsubscribed
    o: null,   // orderedAt — reserved for Phase 2
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
export const markNudged = (log, email, productId, whenISO) => setNewest(log, email, productId, 'n', whenISO);

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

/** Rows due for the one nudge. `isInStockByProduct(numericId) -> boolean`. */
export function selectNudges(log, nowISO, days, isInStockByProduct) {
  const cutoff = new Date(nowISO).getTime() - days * DAY;
  const list = Array.isArray(log) ? log : [];
  return list.filter((x) =>
    x.c == null && x.o == null && x.n == null && x.u !== true &&
    new Date(x.ts).getTime() <= cutoff &&
    isInStockByProduct(x.p) === true
  );
}

/** Dashboard counters over the retained window. */
export function deriveStats(log) {
  const list = Array.isArray(log) ? log : [];
  const notified = list.length;
  const clicked = list.filter((x) => x.c).length;
  const nudged = list.filter((x) => x.n).length;
  const ordered = list.filter((x) => x.o).length;
  const clickRate = notified ? Math.round((clicked / notified) * 100) : 0;
  return { notified, clicked, nudged, ordered, clickRate };
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

/**
 * Monitor ACTIVITY LOG: a rolling record of the product/collection changes the
 * Product Change Monitor detects, kept in the shop metafield `oos_sort.monitor_log`
 * (separate from `oos_sort.monitor`, which holds the last-known status baseline).
 *
 * The monitor already computes rich info per event (from → to status, stock, who)
 * and sends it to Slack + the Google Sheet — but the in-app dashboard used to read
 * Shopify's bare event log, which only knows the raw verb. Persisting each event
 * here lets the dashboard show the SAME clear info Slack does.
 *
 * Pure core (monitorRow / appendMonitorLog / monitorTag) is offline-tested in
 * monitor-log.test.mjs; the byte-trim is shared with the notified log.
 */

import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';
import { trimToFit } from './notified.mjs';

const CAP = 300;          // rows kept (also trimmed by byte size)
const LIMIT = 131072;     // Shopify metafield JSON value cap, in bytes
const NAMESPACE = 'oos_sort';
const KEY = 'monitor_log';

/* ---- pure ---- */

/** Build a compact activity row from the fields the monitor already has. */
export function monitorRow({ at, type, title, handle, path, fromLabel, toLabel, who, stock }) {
  return {
    ts: at || new Date().toISOString(),
    ty: type || 'Product',            // 'Product' | 'Collection'
    t: String(title || ''),
    h: handle || null,
    p: path || 'products',            // storefront path segment
    f: fromLabel || null,             // from-status label
    to: toLabel || null,              // to-status / action label
    w: who || null,
    s: typeof stock === 'number' ? stock : null,
  };
}

/** Prepend a row (newest-first), cap oldest-out. */
export function appendMonitorLog(log, row, cap = CAP) {
  const list = Array.isArray(log) ? log : [];
  const next = [row, ...list];
  return next.length > cap ? next.slice(0, cap) : next;
}

/** The display tag + tone for a row's from/to labels — matches the Slack read:
 *  "Draft → Active" (pos), "Active → Draft" (warn), "Deleted" (danger), etc.
 *  A placeholder from-label ("—"/"existed") is dropped so a create/delete reads
 *  cleanly. */
export function monitorTag(fromLabel, toLabel) {
  const from = String(fromLabel || '');
  const to = String(toLabel || '');
  const hasFrom = from && from !== '—' && from !== 'existed';
  const label = hasFrom ? `${from} → ${to}` : to;
  const t = to.toLowerCase();
  let tone = 'neutral';
  if (/delete/.test(t)) tone = 'danger';
  else if (/active|added/.test(t)) tone = 'pos';
  else if (/draft|unlist|archiv/.test(t)) tone = 'warn';
  return { label, tone };
}

/* ---- metafield I/O (shop-level oos_sort.monitor_log) ---- */

/** Read the activity log (empty array if unset/unparsable). */
export async function loadMonitorLog() {
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
export async function saveMonitorLog(log) {
  const shopId = await getShopId();
  const fitted = trimToFit(log, LIMIT - 2048);
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(fitted) }] }
  );
  assertNoUserErrors('metafieldsSet(monitor_log)', d.metafieldsSet);
  return fitted;
}

/** Append one detected event to the log. Best-effort — a failure here must never
 *  break the Slack/Sheet notify or the webhook response. */
export async function recordMonitorEvent(input) {
  const log = await loadMonitorLog();
  await saveMonitorLog(appendMonitorLog(log, monitorRow(input)));
}

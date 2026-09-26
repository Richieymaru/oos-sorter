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

/** Pure: turn one Google-Sheet row (as buildSheetRow wrote it: timestamp,
 *  product, url, from, to, who, stock) into a dashboard feed item — the same
 *  shape the metafield log produces, so the feed renders them identically. Type
 *  is inferred from the storefront URL path. */
export function sheetRowToActivity(row) {
  const url = String(row?.url || '');
  const type = /\/collections\//.test(url) ? 'Collection' : 'Product';
  const { label, tone } = monitorTag(row?.from, row?.to);
  let stock = row?.stock;
  if (stock === '' || stock == null) stock = null;
  else if (typeof stock !== 'number') { const n = Number(stock); stock = Number.isFinite(n) ? n : null; }
  return {
    type,
    title: String(row?.product || ''),
    href: url || null,
    who: row?.who || null,
    iso: row?.timestamp || null,
    label,
    tone,
    stock,
  };
}

/* ---- Google Sheet read (the full history, straight from the merchant's log) ---- */

/** Fetch the most recent activity rows from the monitor Google Sheet (via the
 *  Apps Script's doGet). Returns feed items newest-first, or null on any failure
 *  so the caller can fall back to the metafield log / live events. Never throws. */
export async function fetchSheetActivity(sheetUrl, limit = 20) {
  if (!sheetUrl) return null;
  try {
    const u = new URL(sheetUrl);
    u.searchParams.set('limit', String(limit));
    const res = await fetch(u.toString(), { redirect: 'follow' });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data?.rows || []);
    return rows.map(sheetRowToActivity);
  } catch (e) {
    console.error('sheet activity read failed:', e.message);
    return null;
  }
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

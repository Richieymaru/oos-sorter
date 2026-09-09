/**
 * Product Change Monitor — detects when a product's STATUS changes
 * (Draft↔Active↔Archived↔Unlisted) and records WHO did it.
 *
 * Trigger is the `products/update` webhook. That topic fires on ANY product
 * edit (price, tags, title…), so this module's job is to cheaply tell a real
 * status change apart from everything else: it compares the incoming status to
 * the last-known status kept in the `oos_sort.monitor` metafield
 * (see monitor-state.mjs). Only a genuine change is worth an alert.
 *
 * "Who" comes from the product's timeline events (`BasicEvent.author`), which
 * names the staff member for a manual admin edit, the app for an app edit, or
 * "Shopify" for a system change. That is the one field that survives even after
 * the store's activity log is purged.
 *
 * The pure functions (detectStatusChange, codeOf, labelOf, totalStockFromPayload,
 * buildSheetRow) have no I/O and are unit-tested in monitor.test.mjs.
 */

import { gql, longId } from './shopify.mjs';

// Compact single-char codes so the last-known-status map stays tiny in the
// metafield (a store with thousands of products still fits well under the cap).
export const STATUS_CODE = { active: 'a', draft: 'd', archived: 'r', unlisted: 'u' };
const CODE_LABEL = { a: 'Active', d: 'Draft', r: 'Archived', u: 'Unlisted' };

/** Pure: status string (webhook lowercase or GraphQL enum) -> compact code, or '?'. */
export function codeOf(status) {
  return STATUS_CODE[String(status ?? '').toLowerCase()] || '?';
}

/** Pure: compact code -> human label (falls back to the raw value). */
export function labelOf(code) {
  return CODE_LABEL[code] || String(code ?? 'Unknown');
}

/**
 * Pure transition detector.
 * @param {Object} prevMap  last-known { numericId: code }
 * @param {string} numId    the product's numeric id (string)
 * @param {string} newStatus incoming status (any case)
 * @returns {{firstSight:boolean, changed:boolean, fromCode:(string|null), toCode:string}}
 *   firstSight — never seen before: caller records a baseline and does NOT alert.
 *   changed    — status differs from last-known: caller alerts.
 */
export function detectStatusChange(prevMap, numId, newStatus) {
  const toCode = codeOf(newStatus);
  const fromCode = prevMap?.[numId];
  if (fromCode == null) return { firstSight: true, changed: false, fromCode: null, toCode };
  if (fromCode === toCode) return { firstSight: false, changed: false, fromCode, toCode };
  return { firstSight: false, changed: true, fromCode, toCode };
}

/** Pure: total on-hand units across the webhook payload's variants (the quick,
 *  free stock figure shown in the alert; no extra API call). Null if unknown. */
export function totalStockFromPayload(payload) {
  const variants = payload?.variants;
  if (!Array.isArray(variants) || !variants.length) return null;
  let sum = 0;
  let seen = false;
  for (const v of variants) {
    const q = v?.inventory_quantity;
    if (typeof q === 'number') { sum += q; seen = true; }
  }
  return seen ? sum : null;
}

/** Pure: the row object POSTed to the Google Sheet Apps Script. Column order is
 *  fixed so the sheet stays readable; the script appends these left-to-right. */
export function buildSheetRow({ at, title, handle, fromLabel, toLabel, who, stock, shop }) {
  return {
    timestamp: at || new Date().toISOString(),
    product: title || '',
    url: handle && shop ? `https://${shop}/products/${handle}` : '',
    from: fromLabel || '',
    to: toLabel || '',
    who: who || 'unknown',
    stock: stock == null ? '' : stock,
  };
}

/**
 * Look up who changed the product, from its timeline events. The webhook that
 * triggered us fired because of the status change, so the most recent event is
 * that change — we prefer the newest event whose message mentions a status word,
 * and fall back to the newest event. Needs read_products.
 * @returns {Promise<{author:(string|null), message:(string|null), createdAt:(string|null)}>}
 */
export async function whoChangedStatus(numId) {
  let nodes = [];
  try {
    const d = await gql(
      `query($id: ID!) {
         product(id: $id) {
           events(first: 10, sortKey: CREATED_AT, reverse: true) {
             nodes { ... on BasicEvent { message author createdAt attributeToApp appTitle } }
           }
         }
       }`,
      { id: longId(numId) }
    );
    nodes = (d?.product?.events?.nodes || []).filter(Boolean);
  } catch (e) {
    console.error(`  ! whoChangedStatus lookup failed: ${e.message}`);
    return { author: null, message: null, createdAt: null };
  }
  const statusish = nodes.find((n) => /active|draft|archiv|unlist|published|hidden/i.test(n.message || ''));
  const pick = statusish || nodes[0] || null;
  return { author: pick?.author || null, message: pick?.message || null, createdAt: pick?.createdAt || null };
}

/** Fetch every product's CURRENT status as a compact { numericId: code } map.
 *  Used to seed/refresh the monitor baseline so the next status change reads as
 *  a real transition instead of a first-sight. Paginates at 250/page. */
export async function fetchAllStatuses() {
  const statuses = {};
  let cursor = null;
  for (;;) {
    const d = await gql(
      `query($cursor: String) {
         products(first: 250, after: $cursor) {
           pageInfo { hasNextPage endCursor }
           nodes { id status }
         }
       }`,
      { cursor }
    );
    for (const p of d.products.nodes) statuses[String(p.id).split('/').pop()] = codeOf(p.status);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return statuses;
}

/** POST one row to the Google Sheet Apps Script Web App. Never throws. */
export async function appendToSheet(sheetUrl, row) {
  if (!sheetUrl) return { skipped: true };
  try {
    const res = await fetch(sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.error(`  ! Sheet webhook returned HTTP ${res.status}`);
    return { ok: res.ok };
  } catch (e) {
    console.error(`  ! Sheet append failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

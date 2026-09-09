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

import { gql, longId, sleep } from './shopify.mjs';

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
 *  fixed so the sheet stays readable; the script appends these left-to-right.
 *  `path` is the storefront path segment ('products' | 'collections'). */
export function buildSheetRow({ at, title, handle, fromLabel, toLabel, who, stock, shop, path }) {
  return {
    timestamp: at || new Date().toISOString(),
    product: title || '',
    url: handle && shop ? `https://${shop}/${path || 'products'}/${handle}` : '',
    from: fromLabel || '',
    to: toLabel || '',
    who: who || 'unknown',
    stock: stock == null ? '' : stock,
  };
}

/**
 * Look up who last acted on a product, from its timeline events. The webhook
 * that triggered us just fired, so the most recent event is that action — we
 * prefer the newest event whose message matches `prefer` (a regex), and fall
 * back to the newest event. Needs read_products. Used for both status changes
 * and creations.
 * @returns {Promise<{author:(string|null), message:(string|null), createdAt:(string|null)}>}
 */
export async function whoFromProductEvents(numId, prefer = /active|draft|archiv|unlist|publish|creat|hidden/i) {
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
    console.error(`  ! whoFromProductEvents lookup failed: ${e.message}`);
    return { author: null, message: null, createdAt: null };
  }
  const preferred = nodes.find((n) => prefer.test(n.message || ''));
  const pick = preferred || nodes[0] || null;
  return { author: pick?.author || null, message: pick?.message || null, createdAt: pick?.createdAt || null };
}

/** Look up who created/last-acted on a COLLECTION, from its timeline events.
 *  Collections have a timeline in 2026-07 (creations carry an author). Needs
 *  read_products. Returns {author, message} — author is null if unavailable. */
export async function whoFromCollectionEvents(numId) {
  try {
    const d = await gql(
      `query($id: ID!) {
         collection(id: $id) {
           events(first: 10, sortKey: CREATED_AT, reverse: true) {
             nodes { ... on BasicEvent { message author createdAt } }
           }
         }
       }`,
      { id: `gid://shopify/Collection/${numId}` }
    );
    const nodes = (d?.collection?.events?.nodes || []).filter(Boolean);
    const pick = nodes.find((n) => /creat|add|publish/i.test(n.message || '')) || nodes[0] || null;
    return { author: pick?.author || null, message: pick?.message || null };
  } catch (e) {
    console.error(`  ! whoFromCollectionEvents lookup failed: ${e.message}`);
    return { author: null, message: null };
  }
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

/** Pure: the SHOP-LEVEL events filter that pinpoints one resource's destroy
 *  event. `subjectType` is 'PRODUCT' | 'COLLECTION'. */
export function deletionEventQuery(numId, subjectType) {
  return `subject_id:${numId} AND action:destroy AND subject_type:${subjectType}`;
}

/**
 * Who deleted a resource. The per-resource timeline dies with the resource, but
 * the SHOP-LEVEL event log retains the `destroy` event WITH its author — so we
 * look it up there, matched by subject_id. Retries briefly because the event can
 * lag the delete webhook by a moment. Needs read_products.
 * @returns {Promise<{author:(string|null), createdAt:(string|null)}>}
 */
export async function whoDeleted(numId, subjectType, { attempts = 3, delayMs = 700 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const d = await gql(
        `query($q: String!) {
           events(first: 5, sortKey: CREATED_AT, reverse: true, query: $q) {
             nodes { ... on BasicEvent { action author createdAt } }
           }
         }`,
        { q: deletionEventQuery(numId, subjectType) }
      );
      const ev = (d.events?.nodes || []).find((n) => n.action === 'destroy');
      if (ev) return { author: ev.author || null, createdAt: ev.createdAt || null };
    } catch (e) {
      console.error(`  ! whoDeleted lookup failed (attempt ${i}): ${e.message}`);
    }
    if (i < attempts) await sleep(delayMs);
  }
  return { author: null, createdAt: null };
}

/**
 * Recent product/collection activity for the in-app dashboard feed, straight
 * from Shopify's shop-level event log (always accurate, no storage). Returns a
 * normalized, newest-first list. `titlesCache` (from monitor-state) names items
 * that have since been deleted (their `subject` is null). Never throws.
 * @returns {Promise<Array<{type,action,who,iso,title,href}>>}
 */
export async function recentActivity(limit = 20, titlesCache = {}) {
  let nodes = [];
  try {
    const d = await gql(
      `query($q: String!, $n: Int!) {
         events(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) {
           nodes { ... on BasicEvent {
             action author createdAt subjectType subjectId
             subject { __typename ... on Product { title handle } ... on Collection { title handle } }
           } }
         }
       }`,
      { q: 'subject_type:PRODUCT OR subject_type:COLLECTION', n: limit }
    );
    nodes = (d.events?.nodes || []).filter(Boolean);
  } catch (e) {
    console.error(`  ! recentActivity failed: ${e.message}`);
    return [];
  }
  const shop = process.env.SHOP_DOMAIN;
  return nodes.map((n) => {
    const type = n.subjectType === 'COLLECTION' ? 'Collection' : 'Product';
    const numId = String(n.subjectId || '').split('/').pop();
    const path = type === 'Collection' ? 'collections' : 'products';
    const cacheKey = (type === 'Collection' ? 'c' : 'p') + numId;
    const title = n.subject?.title || titlesCache[cacheKey] || `${type} #${numId}`;
    const handle = n.subject?.handle;
    const href = handle && shop ? `https://${shop}/${path}/${handle}` : null; // live items only
    return { type, action: n.action, who: n.author, iso: n.createdAt, title, href };
  });
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

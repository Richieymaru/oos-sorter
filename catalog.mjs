/**
 * Product + collection reads, with per-variant ONLINE availability computed.
 *
 * "Sold out" must match what a customer sees on the storefront. A product can
 * have inventory at a third-party / warehouse location that the online store
 * doesn't sell from (e.g. Shopify's "3p Fulfilled" demo product) — the
 * storefront shows it sold out, but totalInventory across all locations is > 0.
 *
 * So instead of totalInventory, we sum each variant's available quantity ONLY
 * at locations where `fulfillsOnlineOrders = true`, and attach it as
 * `variant.onlineAvailable`. isInStock() (stock.mjs) reads that. Requires the
 * read_locations scope.
 */

import { gql, longId, shortId } from './shopify.mjs';

/* ---- online-fulfilling locations (cached per process) ---- */

let onlineLocsCache = null;
export async function getOnlineLocationIds() {
  if (onlineLocsCache) return onlineLocsCache;
  // Real stores have a handful of locations; 250 is far beyond any of them.
  const d = await gql(`{ locations(first: 250) { nodes { id fulfillsOnlineOrders } } }`);
  onlineLocsCache = d.locations.nodes.filter((n) => n.fulfillsOnlineOrders).map((n) => n.id);
  return onlineLocsCache;
}

/** GraphQL for a variant: policy, tracked, and available at each online location (aliased). */
function variantFields(onlineLocIds) {
  const levels = onlineLocIds
    .map((id, i) => `l${i}: inventoryLevel(locationId: "${id}") { quantities(names: ["available"]) { name quantity } }`)
    .join('\n            ');
  return `
    id
    inventoryQuantity
    inventoryPolicy
    inventoryItem { tracked ${levels} }`;
}

/** Sum available across the online-location aliases on a fetched variant. */
function sumOnlineAvailable(variant, count) {
  const item = variant.inventoryItem || {};
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const q = item[`l${i}`]?.quantities?.find((x) => x.name === 'available')?.quantity;
    if (typeof q === 'number') sum += q;
  }
  return sum;
}

/** Attach variant.onlineAvailable to every variant of every product (mutates + returns). */
function normalize(products, onlineLocIds) {
  for (const p of products) {
    for (const v of p.variants.nodes) v.onlineAvailable = sumOnlineAvailable(v, onlineLocIds.length);
  }
  return products;
}

const NAMESPACE = 'oos_sort';

/** Lightweight list of every collection (metadata only) for the Collections page. */
export async function fetchAllCollections() {
  const out = [];
  let cursor = null;
  do {
    const d = await gql(
      `query($c: String){ collections(first: 250, after: $c){
         pageInfo { hasNextPage endCursor }
         nodes { handle title sortOrder productsCount { count } }
       } }`,
      { c: cursor }
    );
    out.push(...d.collections.nodes);
    cursor = d.collections.pageInfo.hasNextPage ? d.collections.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

export async function findCollection(handle) {
  const d = await gql(
    `query Col($q: String!) {
       collections(first: 1, query: $q) {
         nodes {
           id handle title sortOrder
           productsCount { count }
           metafield(namespace: "${NAMESPACE}", key: "base_order") { value }
         }
       }
     }`,
    { q: `handle:'${handle}'` }
  );
  return d.collections.nodes[0] ?? null;
}

/** All products in a collection, each variant carrying `onlineAvailable`. */
export async function fetchCollectionProducts(collectionId) {
  const onlineLocIds = await getOnlineLocationIds();
  const query = `
    query Prods($id: ID!, $cursor: String) {
      collection(id: $id) {
        products(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title status tags tracksInventory totalInventory
            variants(first: 100) { nodes { ${variantFields(onlineLocIds)} } }
          }
        }
      }
    }`;
  const all = [];
  let cursor = null;
  do {
    const data = await gql(query, { id: collectionId, cursor });
    const conn = data.collection.products;
    all.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return normalize(all, onlineLocIds);
}

/**
 * Given an inventory item id (short or gid), return the handles of every
 * collection its product(s) belong to. Used by the webhook receiver to re-sort
 * ONLY the collections affected by an inventory change, not the whole store.
 * @param {string} inventoryItemId short numeric id or a gid
 * @returns {Promise<string[]>} unique collection handles
 */
export async function collectionsForInventoryItem(inventoryItemId) {
  const gid = String(inventoryItemId).startsWith('gid://')
    ? String(inventoryItemId)
    : `gid://shopify/InventoryItem/${inventoryItemId}`;
  const d = await gql(
    `query Inv($id: ID!) {
       inventoryItem(id: $id) {
         variants(first: 25) {
           nodes { product { collections(first: 250) { nodes { handle } } } }
         }
       }
     }`,
    { id: gid }
  );
  const handles = new Set();
  for (const v of d.inventoryItem?.variants?.nodes ?? []) {
    for (const c of v.product?.collections?.nodes ?? []) handles.add(c.handle);
  }
  return [...handles];
}

/** Fetch specific products by short id, each variant carrying `onlineAvailable`. */
export async function fetchProductsByIds(ids) {
  const onlineLocIds = await getOnlineLocationIds();
  const out = [];
  const CHUNK = 100; // keep query cost well under the ceiling
  for (let i = 0; i < ids.length; i += CHUNK) {
    const gids = ids.slice(i, i + CHUNK).map(longId);
    const data = await gql(
      `query Byid($ids: [ID!]!) {
         nodes(ids: $ids) {
           ... on Product {
             id title handle status tracksInventory totalInventory
             featuredImage { url }
             variants(first: 100) { nodes { ${variantFields(onlineLocIds)} } }
           }
         }
       }`,
      { ids: gids }
    );
    for (const n of data.nodes) if (n) out.push(n);
  }
  return normalize(out, onlineLocIds);
}

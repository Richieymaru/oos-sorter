/**
 * Draft feature: hide sold-out products by setting them to Draft, and restore
 * them to Active when they restock.
 *
 * Draft is a *store-wide* product status change — a drafted product disappears
 * from the whole storefront, not just one collection. The app only ever drafts
 * products that are currently ACTIVE, and only ever un-drafts products it
 * drafted itself (tracked in oos_sort.state.drafted), never one the merchant
 * archived or drafted by hand.
 *
 * Restock detection re-reads the drafted ids DIRECTLY by product id, so it works
 * regardless of whether draft-status products still show up in collection reads.
 *
 * Mutation shape verified against the store's 2026-07 schema:
 *   productUpdate(product: ProductUpdateInput)   // arg is `product`, not `input`
 *   ProductUpdateInput.status: ProductStatus     // ACTIVE | DRAFT | ARCHIVED | UNLISTED
 */

import { gql, shortId, longId, assertNoUserErrors } from './shopify.mjs';
import { isInStock } from './stock.mjs';
import { planRestores } from './features.mjs';

const M_STATUS = `
  mutation SetStatus($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`;

async function setStatus(id, status) {
  const d = await gql(M_STATUS, { product: { id: longId(id), status } });
  assertNoUserErrors('productUpdate', d.productUpdate);
  return d.productUpdate.product;
}

/**
 * Fetch stock + status for a set of product ids directly (not via a collection).
 * Used to detect which drafted products have restocked.
 * @param {string[]} ids short product ids
 * @returns {Promise<Map<string, {status, inStock}>>}
 */
export async function fetchProductsById(ids) {
  const out = new Map();
  const CHUNK = 100; // keep query cost well under the 1000 ceiling
  for (let i = 0; i < ids.length; i += CHUNK) {
    const gids = ids.slice(i, i + CHUNK).map(longId);
    const d = await gql(
      `query Byid($ids: [ID!]!) {
         nodes(ids: $ids) {
           ... on Product {
             id status tracksInventory totalInventory
             variants(first: 100) { nodes { inventoryQuantity inventoryPolicy inventoryItem { tracked } } }
           }
         }
       }`,
      { ids: gids }
    );
    for (const n of d.nodes) {
      if (!n) continue;
      out.set(shortId(n.id), { status: n.status, inStock: isInStock(n) });
    }
  }
  return out;
}

/**
 * Restore any app-drafted product that is back in stock. Mutates `draftedSet`
 * (a Set of short ids) by removing the restored ones.
 * @returns {Promise<{restored: string[]}>}
 */
export async function restoreRestocked(draftedSet, { dryRun } = {}) {
  const ids = [...draftedSet];
  if (!ids.length) return { restored: [] };

  const info = await fetchProductsById(ids);
  const restored = planRestores(ids, (id) => info.get(id)?.inStock === true);

  for (const id of restored) {
    if (!dryRun) await setStatus(id, 'ACTIVE');
    draftedSet.delete(id);
  }
  return { restored };
}

/**
 * Set the given product ids to Draft and add them to `draftedSet`.
 * @param {string[]} ids short ids that should be drafted
 * @returns {Promise<{drafted: string[]}>}
 */
export async function applyDrafts(ids, draftedSet, { dryRun } = {}) {
  for (const id of ids) {
    if (!dryRun) await setStatus(id, 'DRAFT');
    draftedSet.add(id);
  }
  return { drafted: ids };
}

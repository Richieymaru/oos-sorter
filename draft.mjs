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
import { fetchProductsByIds } from './catalog.mjs';
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
 * Fetch status + online-stock for a set of product ids directly (not via a
 * collection). Used to detect which drafted products have restocked. Uses the
 * shared catalog fetch so "in stock" is online-availability based.
 * @param {string[]} ids short product ids
 * @returns {Promise<Map<string, {status, inStock}>>}
 */
export async function fetchProductsById(ids) {
  const products = await fetchProductsByIds(ids);
  const out = new Map();
  for (const p of products) out.set(shortId(p.id), { status: p.status, inStock: isInStock(p) });
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

/**
 * Stock logic — the ONLY place that decides whether a product counts as in
 * stock. In its own module so the engine, report, and draft feature share it
 * without a circular import.
 *
 * "In stock" must match what a customer can actually buy on the storefront, so
 * it is based on inventory available at ONLINE-FULFILLING locations, not total
 * inventory across every location. `variant.onlineAvailable` is computed by
 * catalog.mjs (sum of available at locations where fulfillsOnlineOrders=true).
 * A product counts as in stock if any of these hold:
 *  - inventory isn't tracked at all
 *  - any variant oversells (inventoryPolicy CONTINUE) or is untracked
 *  - the online-available quantity across its variants is above zero
 *
 * Products fetched WITHOUT catalog.mjs won't have `onlineAvailable`; treat a
 * missing value as 0 so such a product is only "in stock" via the untracked /
 * oversell rules — always fetch via catalog.mjs when the answer matters.
 */
export function isInStock(product) {
  if (product.tracksInventory === false) return true;
  if (
    product.variants.nodes.some(
      (v) => v.inventoryPolicy === 'CONTINUE' || v.inventoryItem?.tracked === false
    )
  ) {
    return true;
  }
  const online = product.variants.nodes.reduce((sum, v) => sum + (v.onlineAvailable ?? 0), 0);
  return online > 0;
}

/**
 * The same question for a single variant — used by the back-in-stock waitlist so
 * a shopper waiting on "Black" isn't emailed when only "Tan" restocks.
 *
 * Same three rules as isInStock, applied to one variant instead of any variant.
 * Falls back to the product-level answer when the variant isn't found, which is
 * what a waitlist entry with no recorded variant means.
 *
 * @param {object} product - fetched via catalog.mjs (needs `onlineAvailable`)
 * @param {string|null} variantShortId - numeric variant id, or null for "any variant"
 */
export function isVariantInStock(product, variantShortId) {
  if (product.tracksInventory === false) return true;
  if (variantShortId == null || variantShortId === '') return isInStock(product);

  const want = String(variantShortId).replace(/\D/g, '');
  const variant = product.variants.nodes.find((v) => String(v.id).replace(/\D/g, '') === want);
  if (!variant) return isInStock(product); // variant deleted or renumbered — don't strand them

  if (variant.inventoryPolicy === 'CONTINUE' || variant.inventoryItem?.tracked === false) return true;
  return (variant.onlineAvailable ?? 0) > 0;
}

/**
 * Stock logic — the ONLY place that decides whether a product counts as in
 * stock. Multi-location or Markets rules go here and nowhere else.
 *
 * In its own module so both the sort engine and the draft feature can share it
 * without a circular import.
 *
 * A product counts as in stock if any of these hold:
 *  - inventory isn't tracked at all
 *  - total inventory across locations is above zero
 *  - any variant oversells (inventoryPolicy CONTINUE) or is untracked
 */
export function isInStock(product) {
  if (product.tracksInventory === false) return true;
  if ((product.totalInventory ?? 0) > 0) return true;
  return product.variants.nodes.some(
    (v) => v.inventoryPolicy === 'CONTINUE' || v.inventoryItem?.tracked === false
  );
}

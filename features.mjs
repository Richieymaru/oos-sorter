/**
 * Pure decision logic for the Notify and Draft features.
 *
 * Everything here is a pure function of its inputs — no store, no network, no
 * clock, no env. That is deliberate: this is the part with the fiddly rules
 * (who is *newly* sold out, who to draft, who to restore, how a drafted product
 * keeps its slot), and pure functions can be property-tested offline. See
 * features.test.mjs. This is the same discipline that caught two bugs in the
 * sort engine.
 */

/**
 * True when COLLECTION_HANDLES means "every collection" — i.e. it's empty, or
 * it's the single keyword "all". Otherwise the merchant gave an explicit list.
 * @param {string[]} explicit  handles parsed from COLLECTION_HANDLES
 */
export function isAllHandles(explicit) {
  return explicit.length === 0 || (explicit.length === 1 && explicit[0].toLowerCase() === 'all');
}

/**
 * IDs that are sold out now but were not sold out on the previous run.
 * @param {Iterable<string>} prevSoldOut  ids sold out as of last run
 * @param {Iterable<string>} nowSoldOut   ids sold out this run
 * @returns {string[]} newly sold-out ids, in the order they appear in nowSoldOut
 */
export function diffNewlySoldOut(prevSoldOut, nowSoldOut) {
  const prev = new Set(prevSoldOut);
  const seen = new Set();
  const out = [];
  for (const id of nowSoldOut) {
    if (!prev.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Merge freshly-detected sold-out products into the pending digest, deduped by
 * id. If a product is already pending, its collection list is unioned (it may
 * have shown up in a second managed collection since) but it is not duplicated.
 *
 * @param {Array<{id,title,collections}>} pending  current pending digest entries
 * @param {Array<{id,title,collections}>} fresh    newly sold-out this run
 * @returns {Array<{id,title,collections}>} updated pending list
 */
export function mergePending(pending, fresh) {
  const byId = new Map(pending.map((e) => [e.id, { ...e, collections: [...e.collections] }]));
  for (const e of fresh) {
    const existing = byId.get(e.id);
    if (existing) {
      for (const c of e.collections) if (!existing.collections.includes(c)) existing.collections.push(c);
      if (!existing.title && e.title) existing.title = e.title;
    } else {
      byId.set(e.id, { id: e.id, title: e.title, collections: [...e.collections] });
    }
  }
  return [...byId.values()];
}

/**
 * Decide which products to set to Draft this run.
 *
 * A product should be drafted when it is sold out AND currently ACTIVE. We do
 * not draft products already in a non-active status (the merchant may have
 * archived/drafted them deliberately) and we do not re-draft what we already
 * drafted.
 *
 * @param {Iterable<string>} soldOutNow      ids sold out this run
 * @param {Map<string,string>} statusById    id -> product status (ACTIVE/DRAFT/…)
 * @param {Iterable<string>} alreadyDrafted   ids the app has already drafted
 * @returns {string[]} ids to set to DRAFT
 */
export function planDrafts(soldOutNow, statusById, alreadyDrafted) {
  const drafted = new Set(alreadyDrafted);
  const out = [];
  for (const id of soldOutNow) {
    if (drafted.has(id)) continue;
    if (statusById.get(id) === 'ACTIVE') out.push(id);
  }
  return out;
}

/**
 * Decide which of the app's drafted products to restore to ACTIVE.
 *
 * Only products the app itself drafted are eligible — never one the merchant
 * drafted by hand. A drafted product is restored when it is back in stock.
 *
 * @param {Iterable<string>} appDrafted            ids the app drafted
 * @param {(id:string)=>boolean} isBackInStock      true if that id is in stock now
 * @returns {string[]} ids to set back to ACTIVE
 */
export function planRestores(appDrafted, isBackInStock) {
  const out = [];
  for (const id of appDrafted) if (isBackInStock(id)) out.push(id);
  return out;
}

/**
 * Base order that survives drafting.
 *
 * base_order is normally filtered to the ids currently present in the collection
 * read. But a drafted product may drop out of that read while it is hidden — if
 * we let it fall out of base_order it would come back as a "new" product at the
 * end and lose its original slot. So we keep any stored id that is present now
 * OR is currently one of the app's drafted products; genuinely new present ids
 * are appended (existing behaviour).
 *
 * @param {string[]} storedBase   base order from the metafield
 * @param {Iterable<string>} presentIds  ids in the current collection read
 * @param {Iterable<string>} draftedIds  ids the app currently has drafted
 * @returns {string[]} base order to use and persist
 */
export function retainBaseOrder(storedBase, presentIds, draftedIds) {
  const present = new Set(presentIds);
  const drafted = new Set(draftedIds);
  const kept = storedBase.filter((id) => present.has(id) || drafted.has(id));
  const known = new Set(kept);
  for (const id of present) if (!known.has(id)) kept.push(id); // genuinely new products
  return kept;
}

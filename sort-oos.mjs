#!/usr/bin/env node
/**
 * Out-of-stock handling for Shopify collections. Three independent, switchable
 * features:
 *
 *   FEATURE_SORT   push sold-out products to the end of each collection
 *   FEATURE_NOTIFY email a daily digest of products that newly sold out
 *   FEATURE_DRAFT  set sold-out products to Draft (hidden), restore on restock
 *
 * Sort keeps a "base order" snapshot per collection (oos_sort.base_order) and
 * reorders so in-stock products come first (in base order) and sold-out ones sit
 * at the end. Notify/Draft state lives in a shop metafield (oos_sort.state).
 * No database.
 *
 * Runs anywhere Node 20.6+ runs: GitHub Actions cron, a VPS crontab, etc.
 *
 * Required env:
 *   SHOP_DOMAIN        e.g. your-store.myshopify.com
 *   CLIENT_ID          Dev Dashboard app credentials; auth.mjs exchanges these
 *   CLIENT_SECRET      for a 24h shpca_ token via the client credentials grant
 *   COLLECTION_HANDLES comma-separated handles, e.g. "all,new-arrivals,sale"
 *
 * Optional env:
 *   FEATURE_SORT         default "true"   — push sold-out to bottom
 *   FEATURE_NOTIFY       default "false"  — daily sold-out email digest
 *   FEATURE_DRAFT        default "false"  — draft sold-out products
 *   SEND_DIGEST          "true" on the daily 4pm run to send the digest
 *   ADMIN_TOKEN          static token, if you have one — takes priority
 *   SHOPIFY_API_VERSION  default 2026-07
 *   PIN_TAG              default "pin-top"    — kept at the front, never drafted
 *   IGNORE_TAG           default "oos-ignore" — never pushed down or drafted
 *   DRY_RUN              "true" to log the plan without writing anything
 *   Email (when FEATURE_NOTIFY): GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL
 */

import { pathToFileURL } from 'node:url';
import {
  SHOP,
  API_VERSION,
  gql,
  shortId,
  longId,
  sleep,
  assertNoUserErrors,
} from './shopify.mjs';
import {
  isAllHandles,
  resolveFlag,
  diffNewlySoldOut,
  mergePending,
  planDrafts,
  retainBaseOrder,
} from './features.mjs';
import { isInStock } from './stock.mjs';
import { loadState, saveState } from './state.mjs';
import { loadSettings } from './settings.mjs';
import { restoreRestocked, applyDrafts } from './draft.mjs';
import { sendDigest } from './notify.mjs';

/** True only when this file is the process entry point, not an import. */
const IS_MAIN =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const HANDLES = (process.env.COLLECTION_HANDLES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PIN_TAG = (process.env.PIN_TAG || 'pin-top').toLowerCase();
const IGNORE_TAG = (process.env.IGNORE_TAG || 'oos-ignore').toLowerCase();
const DRY_RUN = process.env.DRY_RUN === 'true';

// Resolved in main() from the settings metafield; env overrides for local testing.
let FEATURE_SORT = false;
let FEATURE_NOTIFY = false;
let FEATURE_DRAFT = false;
const SEND_DIGEST = process.env.SEND_DIGEST === 'true';

const NAMESPACE = 'oos_sort';
const KEY = 'base_order';
const MAX_MOVES = 250; // hard limit per collectionReorderProducts call

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* Queries / mutations                                                 */
/* ------------------------------------------------------------------ */

const Q_COLLECTION = `
  query Col($q: String!) {
    collections(first: 1, query: $q) {
      nodes {
        id handle title sortOrder
        productsCount { count }
        metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value }
      }
    }
  }
`;

const Q_PRODUCTS = `
  query Prods($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title status tags tracksInventory totalInventory
          variants(first: 100) {
            nodes { inventoryQuantity inventoryPolicy inventoryItem { tracked } }
          }
        }
      }
    }
  }
`;

// NB: the argument is `collection: CollectionUpdateInput`, not `input: CollectionInput`.
// Verified by introspecting the store's own schema — do not "restore" the old shape.
const M_SORT_MANUAL = `
  mutation SetManual($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection { id sortOrder }
      userErrors { field message }
    }
  }
`;

const M_REORDER = `
  mutation Reorder($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job { id done }
      userErrors { field message }
    }
  }
`;

const Q_JOB = `query J($id: ID!) { job(id: $id) { id done } }`;

const M_METAFIELD = `
  mutation Save($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

// isInStock lives in stock.mjs (imported above) and is re-exported here so
// existing importers (inspect-collection.mjs, tests) keep working.
export { isInStock };

/* ------------------------------------------------------------------ */
/* Minimal move calculation                                            */
/* ------------------------------------------------------------------ */

/**
 * Simulates Shopify's move semantics (remove, then re-insert at newPosition)
 * and emits a move only when the item isn't already in the right place.
 *
 * Ascending pass locks in a correct prefix; descending pass locks in a correct
 * suffix. Both are correct by construction, but they cost wildly different
 * numbers of moves depending on the shape of the change. So we compute both and
 * keep the smaller one.
 */
export function greedyMoves(current, desired, direction) {
  const sim = [...current];
  const moves = [];
  const order =
    direction === 'asc' ? [...desired.keys()] : [...desired.keys()].reverse();

  for (const k of order) {
    if (sim[k] === desired[k]) continue;
    const i = sim.indexOf(desired[k]);
    sim.splice(i, 1);
    sim.splice(k, 0, desired[k]);
    moves.push({ id: longId(desired[k]), newPosition: String(k) });
  }
  return moves;
}

/** Smallest correct set of moves that turns `current` into `desired`. */
export function computeMoves(current, desired) {
  const asc = greedyMoves(current, desired, 'asc');
  const desc = greedyMoves(current, desired, 'desc');
  return asc.length <= desc.length ? asc : desc;
}

/**
 * Constrain a desired order to the ids actually present, appending anything
 * present but unaccounted for. computeMoves assumes both arrays hold the same
 * set; feeding it a desired order containing ids that aren't in the collection
 * makes indexOf return -1 and corrupts the simulation silently.
 */
function alignDesired(desired, liveIds) {
  const live = new Set(liveIds);
  const kept = desired.filter((id) => live.has(id));
  const known = new Set(kept);
  for (const id of liveIds) if (!known.has(id)) kept.push(id);
  return kept;
}

/* ------------------------------------------------------------------ */
/* Collection reads (shared with report.mjs)                           */
/* ------------------------------------------------------------------ */

export async function findCollection(handle) {
  const found = await gql(Q_COLLECTION, { q: `handle:'${handle}'` });
  return found.collections.nodes[0] ?? null;
}

/** Every collection handle in the store (paginated). */
export async function fetchAllCollectionHandles() {
  const handles = [];
  let cursor = null;
  do {
    const d = await gql(
      `query All($cursor: String) {
         collections(first: 250, after: $cursor) {
           pageInfo { hasNextPage endCursor }
           nodes { handle }
         }
       }`,
      { cursor }
    );
    const conn = d.collections;
    handles.push(...conn.nodes.map((n) => n.handle));
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return handles;
}

/**
 * The collections to process: COLLECTION_HANDLES if set, otherwise every
 * collection in the store (auto-discovery). Empty or "all" => all.
 */
export async function resolveHandles() {
  return isAllHandles(HANDLES) ? await fetchAllCollectionHandles() : HANDLES;
}

export async function fetchProducts(collectionId) {
  const all = [];
  let cursor = null;
  do {
    const data = await gql(Q_PRODUCTS, { id: collectionId, cursor });
    const conn = data.collection.products;
    all.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return all;
}

async function waitForJob(jobId, timeoutMs = 120000) {
  const started = Date.now();
  let delay = 500;
  while (Date.now() - started < timeoutMs) {
    const data = await gql(Q_JOB, { id: jobId });
    if (data.job?.done) return true;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
  console.warn(`  ! job ${jobId} still running after ${timeoutMs}ms — continuing`);
  return false;
}

/* ------------------------------------------------------------------ */
/* Per-collection processing                                           */
/* ------------------------------------------------------------------ */

/**
 * Read one collection, record sold-out products into the run context, and (when
 * enabled) apply the Sort and Draft features to it.
 */
async function processCollection(handle, ctx) {
  console.log(`\n=== ${handle} ===`);

  const col = await findCollection(handle);
  if (!col) {
    console.warn(`  ! collection not found, skipping`);
    return;
  }

  const products = await fetchProducts(col.id);
  if (!products.length) {
    console.log('  empty collection, nothing to do');
    return;
  }

  const currentIds = products.map((p) => shortId(p.id));
  const byId = new Map(products.map((p) => [shortId(p.id), p]));
  const tagsOf = (id) => (byId.get(id)?.tags ?? []).map((t) => t.toLowerCase());

  // Record every genuinely sold-out product for Notify / transition tracking.
  const soldOutHere = currentIds.filter((id) => !isInStock(byId.get(id)));
  for (const id of soldOutHere) {
    ctx.soldOutNow.add(id);
    const info = ctx.soldOutInfo.get(id) ?? { id, title: byId.get(id)?.title, collections: [] };
    if (!info.collections.includes(handle)) info.collections.push(handle);
    ctx.soldOutInfo.set(id, info);
  }

  const inStockCount = products.length - soldOutHere.length;
  console.log(
    `  ${products.length} products | ${inStockCount} in stock | ${soldOutHere.length} sold out`
  );

  // --- Sort feature ---
  if (FEATURE_SORT) {
    await sortCollection(col, { products, currentIds, byId, tagsOf }, ctx);
  }

  // --- Draft feature: hide sold-out ACTIVE products (respecting pin/ignore) ---
  if (FEATURE_DRAFT) {
    const candidates = soldOutHere.filter(
      (id) => !tagsOf(id).includes(PIN_TAG) && !tagsOf(id).includes(IGNORE_TAG)
    );
    const statusById = new Map(candidates.map((id) => [id, byId.get(id)?.status]));
    const toDraft = planDrafts(candidates, statusById, ctx.draftedSet);
    if (toDraft.length) {
      await applyDrafts(toDraft, ctx.draftedSet, { dryRun: DRY_RUN });
      console.log(`  ${DRY_RUN ? '[dry run] would draft' : 'drafted'} ${toDraft.length} product(s)`);
      toDraft.forEach((id) => console.log(`      - ${byId.get(id)?.title ?? id}`));
    }
  }
}

/** The push-sold-out-to-bottom reorder for one collection. */
async function sortCollection(col, { products, currentIds, byId, tagsOf }, ctx) {
  // base order: the merchant's intended sort. Keep drafted products' slots even
  // if they drop out of the read (retainBaseOrder), so a restored product lands
  // back where it started.
  let base;
  if (col.metafield?.value) {
    base = retainBaseOrder(JSON.parse(col.metafield.value), currentIds, ctx.draftedSet);
  } else {
    base = currentIds.slice();
    console.log(`  first run — capturing base order from current "${col.sortOrder}" sort`);
  }

  const pinned = base.filter((id) => tagsOf(id).includes(PIN_TAG));
  const rest = base.filter((id) => !tagsOf(id).includes(PIN_TAG));
  const stays = (id) => tagsOf(id).includes(IGNORE_TAG) || isInStock(byId.get(id));
  const inStock = rest.filter(stays);
  const outStock = rest.filter((id) => !stays(id));
  const desired = [...pinned, ...inStock, ...outStock];

  if (DRY_RUN) {
    const moves = computeMoves(currentIds, desired);
    console.log(`  [dry run] sort would apply ${moves.length} move(s)`);
    if (col.sortOrder !== 'MANUAL') {
      console.log(`    note: sortOrder is ${col.sortOrder}; switching to MANUAL exposes Shopify's`);
      console.log(`    separate manual position list, so this plan is indicative only.`);
    }
    moves.slice(0, 10).forEach((m) => {
      const p = byId.get(shortId(m.id));
      console.log(`    -> ${m.newPosition.padStart(4)}  ${p?.title ?? m.id}`);
    });
    if (moves.length > 10) console.log(`    ... and ${moves.length - 10} more`);
    return;
  }

  // persist base order before mutating anything
  await gql(M_METAFIELD, {
    metafields: [
      { ownerId: col.id, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(base) },
    ],
  }).then((d) => assertNoUserErrors('metafieldsSet', d.metafieldsSet));

  // collection must be MANUAL to accept reorders
  let liveIds = currentIds;
  if (col.sortOrder !== 'MANUAL') {
    const d = await gql(M_SORT_MANUAL, { collection: { id: col.id, sortOrder: 'MANUAL' } });
    assertNoUserErrors('collectionUpdate', d.collectionUpdate);
    console.log(`  sortOrder ${col.sortOrder} -> MANUAL`);

    // Flipping to MANUAL swaps the live order over to Shopify's separately-stored
    // manual position list — NOT the order read above. Re-read, or moves computed
    // against the old order strand any product that needed no move. Verified live.
    liveIds = (await fetchProducts(col.id)).map((p) => shortId(p.id));
    console.log(`  re-read order after MANUAL switch`);
  }

  // Membership can drift between reads (automated rules re-evaluate). Keep the
  // target aligned with what is actually present now.
  const target = alignDesired(desired, liveIds);
  const moves = computeMoves(liveIds, target);
  if (!moves.length) {
    console.log('  already correctly ordered');
    return;
  }

  for (let i = 0; i < moves.length; i += MAX_MOVES) {
    const batch = moves.slice(i, i + MAX_MOVES);
    const d = await gql(M_REORDER, { id: col.id, moves: batch });
    assertNoUserErrors('collectionReorderProducts', d.collectionReorderProducts);
    const jobId = d.collectionReorderProducts.job?.id;
    console.log(`  applied ${batch.length} move(s), job ${jobId ?? 'n/a'}`);
    if (jobId) await waitForJob(jobId);
  }
  console.log('  sorted');
}

/* ------------------------------------------------------------------ */
/* Main routine                                                        */
/* ------------------------------------------------------------------ */

async function main() {
  requireEnv('SHOP_DOMAIN');

  const settings = await loadSettings();
  FEATURE_SORT = resolveFlag(process.env.FEATURE_SORT, settings.sort);
  FEATURE_NOTIFY = resolveFlag(process.env.FEATURE_NOTIFY, settings.notify);
  FEATURE_DRAFT = resolveFlag(process.env.FEATURE_DRAFT, settings.draft);

  // COLLECTION_HANDLES empty or "all" => auto-discover every collection.
  const handles = await resolveHandles();
  if (!handles.length) {
    console.error('No collections found to process.');
    process.exit(1);
  }

  const on = [FEATURE_SORT && 'sort', FEATURE_NOTIFY && 'notify', FEATURE_DRAFT && 'draft']
    .filter(Boolean)
    .join('+') || 'nothing';
  const scope = isAllHandles(HANDLES) ? `all ${handles.length} collections` : `${handles.length} collection(s)`;
  console.log(
    `Shop: ${SHOP} | API ${API_VERSION} | features: ${on} | ${scope}${DRY_RUN ? ' | DRY RUN' : ''}`
  );

  // Always keep state so the settings page has a fresh status line, even when
  // only sort is on or all features are off.
  const state = await loadState();
  const draftedSet = new Set(state?.drafted ?? []);

  // Phase 1: restore any app-drafted product that has restocked.
  if (FEATURE_DRAFT) {
    const { restored } = await restoreRestocked(draftedSet, { dryRun: DRY_RUN });
    if (restored.length) {
      console.log(`\n${DRY_RUN ? '[dry run] would restore' : 'restored'} ${restored.length} drafted product(s) back to Active`);
    }
  }

  // Phase 2: per collection — record sold-out, sort, draft.
  const ctx = { draftedSet, soldOutNow: new Set(), soldOutInfo: new Map() };
  let failures = 0;
  for (const handle of handles) {
    try {
      await processCollection(handle, ctx);
    } catch (err) {
      failures++;
      console.error(`  ! ${handle} failed: ${err.message}`);
    }
  }

  // Phase 3: notify — accumulate the day's newly-sold-out, send the digest at
  // the daily slot only.
  if (FEATURE_NOTIFY) {
    const newly = diffNewlySoldOut(state.soldOut, [...ctx.soldOutNow]);
    const freshInfos = newly.map((id) => ctx.soldOutInfo.get(id)).filter(Boolean);
    state.pending = mergePending(state.pending, freshInfos);
    console.log(
      `\nNotify: ${newly.length} newly sold out this run | ${state.pending.length} pending for digest`
    );

    const today = new Date().toISOString().slice(0, 10);
    if (SEND_DIGEST && state.pending.length && state.lastDigest !== today) {
      await sendDigest(state.pending, { dryRun: DRY_RUN });
      if (!DRY_RUN) {
        state.pending = [];
        state.lastDigest = today;
      }
    } else if (SEND_DIGEST) {
      console.log(
        state.pending.length
          ? `  digest already sent today (${state.lastDigest}) — skipping`
          : `  nothing pending — no digest`
      );
    }
  }

  // Phase 4: persist state (always — records lastRun + current sold-out count).
  state.soldOut = [...ctx.soldOutNow];
  state.drafted = [...draftedSet];
  state.lastRun = new Date().toISOString();
  if (DRY_RUN) {
    console.log('\n[dry run] would save state:', JSON.stringify(state));
  } else {
    await saveState(state);
  }

  console.log(`\nFinished. ${handles.length - failures}/${handles.length} collections OK.`);
  if (failures) process.exit(1);
}

if (IS_MAIN) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

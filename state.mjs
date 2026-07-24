/**
 * Shop-level state for the Notify and Draft features, stored in a single JSON
 * metafield (oos_sort.state) on the shop. No database — same philosophy as the
 * per-collection base_order metafield.
 *
 * Shape:
 *   {
 *     soldOut:    string[]   // ids sold out as of last run (transition detection)
 *     drafted:    string[]   // ids the app itself set to Draft (safe restore)
 *     pending:    { id, title, collections }[]  // accumulated for the next digest
 *     lastDigest: string|null // YYYY-MM-DD the last digest email went out
 *   }
 */

import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'state';

const EMPTY = () => ({ soldOut: [], drafted: [], pending: [], lastDigest: null, lastRun: null });

export async function loadState() {
  const d = await gql(
    `{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`
  );
  const raw = d.shop?.metafield?.value;
  if (!raw) return EMPTY();
  try {
    const parsed = JSON.parse(raw);
    return { ...EMPTY(), ...parsed };
  } catch {
    console.warn('  ! oos_sort.state metafield was unparseable — starting fresh');
    return EMPTY();
  }
}

export async function saveState(state) {
  const shopId = await getShopId();
  const value = JSON.stringify({
    soldOut: state.soldOut ?? [],
    drafted: state.drafted ?? [],
    pending: state.pending ?? [],
    lastDigest: state.lastDigest ?? null,
    lastRun: state.lastRun ?? null,
  });
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $m) { userErrors { field message } }
     }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value }] }
  );
  assertNoUserErrors('metafieldsSet(state)', d.metafieldsSet);
}

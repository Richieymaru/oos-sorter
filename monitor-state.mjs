/**
 * Monitor memory in its OWN shop metafield `oos_sort.monitor` — separate from
 * `oos_sort.state` (sort/notify/draft) so the two features never clobber each
 * other's writes. Shape:
 *   {
 *     statuses: { "<productId>": "a"|"d"|"r"|"u" }  // last-known status, for diffing
 *     titles:   { "p<productId>"|"c<collectionId>": "<title>" }  // to NAME a deleted item
 *   }
 *
 * `titles` is a best-effort cache filled opportunistically when a webhook carries
 * a title (product create / status change, collection create). It's only needed
 * to name deletes (whose payload is id-only); a miss falls back to the id. The
 * metafield JSON is capped at 128KB, so on a big catalog we trim `titles` first
 * (nice-to-have) and only then `statuses` (needed for status diffs).
 */
import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'monitor';
const METAFIELD_LIMIT = 131072;

export async function loadMonitorState() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return { statuses: {}, titles: {} };
  try {
    const p = JSON.parse(raw);
    return {
      statuses: p.statuses && typeof p.statuses === 'object' ? p.statuses : {},
      titles: p.titles && typeof p.titles === 'object' ? p.titles : {},
    };
  } catch {
    console.warn('  ! oos_sort.monitor metafield was unparseable — starting fresh');
    return { statuses: {}, titles: {} };
  }
}

export async function saveMonitorState(state) {
  const shopId = await getShopId();
  const s = { statuses: { ...(state.statuses || {}) }, titles: { ...(state.titles || {}) } };
  let value = JSON.stringify(s);
  // Trim titles first (nice-to-have), then statuses (needed), leaving a margin.
  if (value.length > METAFIELD_LIMIT - 2048) {
    const tk = Object.keys(s.titles);
    while (value.length > METAFIELD_LIMIT - 2048 && tk.length) {
      delete s.titles[tk.shift()];
      value = JSON.stringify(s);
    }
  }
  if (value.length > METAFIELD_LIMIT - 2048) {
    const sk = Object.keys(s.statuses);
    while (value.length > METAFIELD_LIMIT - 2048 && sk.length) {
      delete s.statuses[sk.shift()];
      value = JSON.stringify(s);
    }
  }
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $m) { userErrors { field message } }
     }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value }] }
  );
  assertNoUserErrors('metafieldsSet(monitor)', d.metafieldsSet);
}

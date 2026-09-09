/**
 * Last-known product statuses for the Product Change Monitor, in their OWN shop
 * metafield `oos_sort.monitor` — deliberately separate from `oos_sort.state`
 * (sort/notify/draft memory) so the two features never clobber each other's
 * writes. Shape: { statuses: { "<numericProductId>": "a"|"d"|"r"|"u" } }.
 *
 * Codes are the compact ones from monitor.mjs so the map stays small; the
 * metafield JSON value is capped at 128KB and we trim the oldest keys if a very
 * large catalog ever approaches it.
 */
import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'monitor';
const METAFIELD_LIMIT = 131072;

export async function loadMonitorState() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return { statuses: {} };
  try {
    const p = JSON.parse(raw);
    return { statuses: p.statuses && typeof p.statuses === 'object' ? p.statuses : {} };
  } catch {
    console.warn('  ! oos_sort.monitor metafield was unparseable — starting fresh');
    return { statuses: {} };
  }
}

export async function saveMonitorState(state) {
  const shopId = await getShopId();
  const s = { statuses: { ...(state.statuses || {}) } };
  let value = JSON.stringify(s);
  // Trim oldest entries (insertion order) until it fits, leaving a safety margin.
  if (value.length > METAFIELD_LIMIT - 2048) {
    const keys = Object.keys(s.statuses);
    while (value.length > METAFIELD_LIMIT - 2048 && keys.length) {
      delete s.statuses[keys.shift()];
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

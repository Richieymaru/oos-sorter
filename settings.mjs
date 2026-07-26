/**
 * The three feature toggles, stored in shop metafield oos_sort.settings.
 * Written by the settings page, read by the engine. Absent => all off.
 */
import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'settings';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Pure: parse recipients (array, or a string split on comma/space/semicolon/
 *  newline) into clean, lowercased, valid, deduped emails (max 20). */
export function normalizeEmails(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const v = String(p).trim().toLowerCase();
    if (v && EMAIL_RE.test(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      if (out.length >= 20) break;
    }
  }
  return out;
}

/** Pure: coerce an arbitrary object to strict toggles (default false) + the
 *  extra digest/report recipients list. */
export function normalizeSettings(obj) {
  const o = obj || {};
  return {
    sort: o.sort === true,
    notify: o.notify === true,
    draft: o.draft === true,
    notifyEmails: normalizeEmails(o.notifyEmails),
  };
}

export async function loadSettings() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return normalizeSettings({});
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings({});
  }
}

export async function saveSettings(settings) {
  const shopId = await getShopId();
  const value = JSON.stringify(normalizeSettings(settings));
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $m) { userErrors { field message } }
     }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value }] }
  );
  assertNoUserErrors('metafieldsSet(settings)', d.metafieldsSet);
}

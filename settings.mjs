/**
 * The three feature toggles, stored in shop metafield oos_sort.settings.
 * Written by the settings page, read by the engine. Absent => all off.
 */
import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'settings';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Pure: coerce to an integer within [min,max], falling back to `def`. */
export function clampInt(v, def, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

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

/** Pure: accept a Slack Incoming Webhook URL, else ''. Guards against pasting
 *  a random string — only real Slack hook URLs are stored. */
export function normalizeSlackWebhook(input) {
  const v = String(input ?? '').trim();
  return /^https:\/\/hooks\.slack\.com\/services\//.test(v) ? v : '';
}

/** Pure: accept a Google Apps Script Web App URL (the product-change log sink),
 *  else ''. Only real script.google.com deploy URLs are stored. */
export function normalizeSheetWebhook(input) {
  const v = String(input ?? '').trim();
  return /^https:\/\/script\.google\.com\/macros\//.test(v) ? v : '';
}

/** Pure: parse a short free-text list (array, or a string split on
 *  newline/comma/semicolon) into clean, deduped items (max `max`, each `maxLen`). */
export function normalizeStrList(input, max = 10, maxLen = 80) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\n,;]+/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const v = String(p).trim().slice(0, maxLen);
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); out.push(v); if (out.length >= max) break; }
  }
  return out;
}

/** Pure: coerce an arbitrary object to strict toggles (default false) + the
 *  extra digest/report recipients list + the Slack + Google Sheet webhook URLs +
 *  the nudge delay and the Buy-nothing "free gift" nudge offer. */
export function normalizeSettings(obj) {
  const o = obj || {};
  const freeGiftProducts = normalizeStrList(o.freeGiftProducts);
  return {
    sort: o.sort === true,
    notify: o.notify === true,
    draft: o.draft === true,
    waitlist: o.waitlist === true,
    monitor: o.monitor === true,
    notifyEmails: normalizeEmails(o.notifyEmails),
    slackWebhook: normalizeSlackWebhook(o.slackWebhook),
    monitorSlackWebhook: normalizeSlackWebhook(o.monitorSlackWebhook),
    sheetWebhook: normalizeSheetWebhook(o.sheetWebhook),
    nudgeDays: clampInt(o.nudgeDays, 2, 1, 14),
    // 2-day nudge free-gift offer. OFF by default so no "free product" promise goes
    // out until the owner sets up fulfilment and turns it on. Defaults to "Free gels".
    freeGiftEnabled: o.freeGiftEnabled === true,
    freeGiftProducts: freeGiftProducts.length ? freeGiftProducts : ['Free gels'],
    freeGiftCode: String(o.freeGiftCode ?? '').trim().slice(0, 40),
    // Cross-variant offer. OFF by default: when a waitlisted shopper's variant is
    // still sold out but another variant of the same product is back, email them
    // the available option (once each). Only safe facts (real stock), no promise.
    offerAltVariant: o.offerAltVariant === true,
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

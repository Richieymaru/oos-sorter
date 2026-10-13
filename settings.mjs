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
    // Price-tiered order perks shown in the restock emails, by the product's price
    // (in the store's own currency). OFF by default — it only writes the offer into
    // the email; the merchant must set up the real free-shipping rule + gift fulfilment.
    incentivesEnabled: o.incentivesEnabled === true,
    incentiveTier1: clampInt(o.incentiveTier1, 200, 0, 1000000),   // free shipping
    incentiveTier2: clampInt(o.incentiveTier2, 500, 0, 1000000),   // + minor gift
    incentiveTier3: clampInt(o.incentiveTier3, 1000, 0, 1000000),  // + major gift
    // The actual product(s) offered as the minor/major gift — one or many, like the
    // nudge free-gift list. Empty is fine (the email then just says "a free gift").
    incentiveMinorGiftProducts: normalizeStrList(o.incentiveMinorGiftProducts),
    incentiveMajorGiftProducts: normalizeStrList(o.incentiveMajorGiftProducts),
  };
}

/** Pure: the order perks a product at `price` (store currency) qualifies for,
 *  or null. Tiers are evaluated highest-first so out-of-order config still behaves.
 *  Returns { freeShipping:true, gift:string[]|null } — gift is the tier's gift
 *  product(s) (minor/major) or null when the tier is free-shipping-only. */
export function incentiveFor(price, settings) {
  const s = settings || {};
  if (!s.incentivesEnabled) return null;
  const p = Number(price);
  if (!Number.isFinite(p)) return null;
  const major = (s.incentiveMajorGiftProducts || []).length ? s.incentiveMajorGiftProducts : ['a premium free gift'];
  const minor = (s.incentiveMinorGiftProducts || []).length ? s.incentiveMinorGiftProducts : ['a free gift'];
  const tiers = [
    { min: Number(s.incentiveTier3), gift: major },
    { min: Number(s.incentiveTier2), gift: minor },
    { min: Number(s.incentiveTier1), gift: null },
  ]
    .filter((t) => Number.isFinite(t.min))
    .sort((a, b) => b.min - a.min);
  for (const t of tiers) {
    if (p >= t.min) return { freeShipping: true, gift: t.gift };
  }
  return null;
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

/**
 * Back-in-stock waitlist, stored per product in the `oos_sort.waitlist` metafield
 * (a JSON array of { email, ts, variantId?, variantTitle? }). No database — same
 * no-hosting philosophy as the rest of OOS Sorter.
 *
 * The list is per PRODUCT but each entry records the VARIANT the shopper was
 * looking at, because a shopper waiting on "Black" shouldn't be emailed when
 * "Tan" restocks. Entries written before variants were recorded have no
 * variantId; those are treated as "any variant", which is exactly what they
 * meant when they signed up, so nobody already on a list is affected.
 *
 * The pure list helpers (addEmail/removeEmail) and the unsubscribe signature
 * (signUnsub/verifyUnsub) are unit-tested offline (waitlist.test.mjs); readWaitlist/
 * subscribe/unsubscribe/clearWaitlist do the metafield I/O.
 */
import crypto from 'node:crypto';
import { gql, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'waitlist';
const MAX = 500; // per-product cap (guards the metafield size limit)
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ---- pure ---- */

/** Normalised variant id, or '' when the entry isn't variant-specific. */
const variantKey = (entry) => String(entry?.variantId ?? '');

/**
 * Add an email (validated, lowercased, deduped, capped). Returns a new list.
 *
 * Dedupe is per email AND variant: the same shopper may legitimately wait on two
 * different variants of one product, and each is a separate promise to email them.
 *
 * @param {Array} list
 * @param {string} email
 * @param {string} ts
 * @param {{variantId?: string|null, variantTitle?: string|null, max?: number}} [opts]
 */
export function addEmail(list, email, ts, opts = {}) {
  const { variantId = null, variantTitle = null, max = MAX } = opts;
  const e = String(email ?? '').trim().toLowerCase();
  const v = variantId == null ? '' : String(variantId);

  if (!EMAIL_RE.test(e)) return { list, added: false, reason: 'invalid' };
  if (list.some((x) => x.email === e && variantKey(x) === v)) return { list, added: false, reason: 'exists' };
  if (list.length >= max) return { list, added: false, reason: 'full' };

  const entry = { email: e, ts };
  // Only write the variant keys when we actually know the variant, so a
  // product-level signup stays the same shape it has always been.
  if (v) {
    entry.variantId = v;
    if (variantTitle) entry.variantTitle = String(variantTitle);
  }

  return { list: [...list, entry], added: true, reason: 'ok' };
}

/**
 * Remove an email. Returns a new list.
 *
 * Drops every entry for that address across all variants — this backs the
 * unsubscribe link, and "unsubscribe" means stop emailing me about this product,
 * not just about one of its variants.
 */
export function removeEmail(list, email) {
  const e = String(email ?? '').trim().toLowerCase();
  return list.filter((x) => x.email !== e);
}

/**
 * Split a list into the subscribers to email now and the ones still waiting.
 *
 * @param {Array} list
 * @param {(variantId: string|null) => boolean} isBack - is this variant purchasable now?
 *   Called with null for legacy entries, which is the product-level question.
 */
export function partitionByStock(list, isBack) {
  const notify = [];
  const waiting = [];

  for (const sub of list || []) {
    const v = variantKey(sub);
    if (isBack(v || null)) notify.push(sub);
    else waiting.push(sub);
  }

  return { notify, waiting };
}

/** Deterministic unsubscribe token: HMAC(product:email) — unforgeable, no state. */
export function signUnsub(productId, email, secret) {
  return crypto
    .createHmac('sha256', secret || '')
    .update(`${productId}:${String(email ?? '').trim().toLowerCase()}`)
    .digest('hex');
}

export function verifyUnsub(productId, email, sig, secret) {
  const want = signUnsub(productId, email, secret);
  const got = Buffer.from(String(sig ?? ''));
  const exp = Buffer.from(want);
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

/** Secret used to sign unsubscribe links — any stable app secret works. */
export function unsubSecret() {
  return process.env.CLIENT_SECRET || process.env.WEBHOOK_TOKEN || process.env.RUN_TOKEN || '';
}

/** A signed one-click unsubscribe URL for a product (short id) + email. */
export function unsubUrl(base, productShortId, email) {
  const root = base || process.env.PUBLIC_URL || 'https://oos-sorter.vercel.app';
  const u = new URL('/api/unsubscribe', root);
  u.searchParams.set('product', String(productShortId));
  u.searchParams.set('email', email);
  u.searchParams.set('sig', signUnsub(productShortId, email, unsubSecret()));
  return u.toString();
}

/* ---- metafield I/O ---- */

/** Read a product's waitlist (empty array if unset/unparsable). */
export async function readWaitlist(productGid) {
  const d = await gql(
    `query($id: ID!) { product(id: $id) { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`,
    { id: productGid }
  );
  try {
    return JSON.parse(d.product?.metafield?.value || '[]');
  } catch {
    return [];
  }
}

async function writeWaitlist(productGid, list) {
  const d = await gql(
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: productGid, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(list) }] }
  );
  assertNoUserErrors('metafieldsSet(waitlist)', d.metafieldsSet);
  return list;
}

/**
 * Add a subscriber. Returns { added, reason, count }.
 * @param {{variantId?: string|null, variantTitle?: string|null}} [variant]
 */
export async function subscribe(productGid, email, ts, variant = {}) {
  const list = await readWaitlist(productGid);
  const r = addEmail(list, email, ts, variant);
  if (r.added) await writeWaitlist(productGid, r.list);
  return { added: r.added, reason: r.reason, count: r.list.length };
}

/** Remove a subscriber. Returns the remaining count. */
export async function unsubscribe(productGid, email) {
  const list = await readWaitlist(productGid);
  const next = removeEmail(list, email);
  if (next.length !== list.length) await writeWaitlist(productGid, next);
  return next.length;
}

/** Empty a product's waitlist (after everyone's been notified). */
export async function clearWaitlist(productGid) {
  await writeWaitlist(productGid, []);
}

/** Replace a product's waitlist with exactly `list` — e.g. keep only the
 *  subscribers whose back-in-stock email failed, so they retry next run. */
export async function setWaitlist(productGid, list) {
  await writeWaitlist(productGid, list);
}

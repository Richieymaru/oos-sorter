/**
 * Back-in-stock waitlist, stored per product in the `oos_sort.waitlist` metafield
 * (a JSON array of { email, ts }). No database — same no-hosting philosophy as the
 * rest of OOS Sorter.
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

/** Add an email (validated, lowercased, deduped, capped). Returns a new list. */
export function addEmail(list, email, ts, max = MAX) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { list, added: false, reason: 'invalid' };
  if (list.some((x) => x.email === e)) return { list, added: false, reason: 'exists' };
  if (list.length >= max) return { list, added: false, reason: 'full' };
  return { list: [...list, { email: e, ts }], added: true, reason: 'ok' };
}

/** Remove an email. Returns a new list. */
export function removeEmail(list, email) {
  const e = String(email ?? '').trim().toLowerCase();
  return list.filter((x) => x.email !== e);
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

/** Add a subscriber. Returns { added, reason, count }. */
export async function subscribe(productGid, email, ts) {
  const list = await readWaitlist(productGid);
  const r = addEmail(list, email, ts);
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

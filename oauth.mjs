/**
 * Classic OAuth (authorization code grant) for CLIENT stores that aren't in your
 * Dev Dashboard organisation — where client_credentials returns
 * `shop_not_permitted`. The owner approves once; we exchange the code for a
 * NON-EXPIRING offline token that goes in ADMIN_TOKEN and runs headless forever.
 *
 * Requires the app's "Use legacy install flow" enabled and the redirect URL
 * registered in the Dev Dashboard.
 *
 * Pure helpers here are unit-tested (oauth.test.mjs); the network exchange is
 * verified live on the dev store.
 */
import crypto from 'node:crypto';

/** Scopes the app requests. Override with SCOPES env if ever needed. */
export const SCOPES =
  process.env.SCOPES || 'read_products,write_products,read_inventory,read_locations';

const isShop = (s) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(String(s || ''));

/** The Shopify consent URL the merchant is sent to. Throws on a bad shop. */
export function authorizeUrl({ shop, clientId, scopes = SCOPES, redirectUri, state }) {
  if (!isShop(shop)) throw new Error(`invalid shop: ${shop}`);
  const p = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

/** A tamper-proof state value (CSRF) bound to the shop, no server storage needed. */
export function signState(shop, secret) {
  const sig = crypto.createHmac('sha256', secret).update(shop).digest('base64url');
  return `${Buffer.from(shop).toString('base64url')}.${sig}`;
}

/** Verify a state value; returns the shop if valid, else null. */
export function verifyState(state, secret) {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [b64, sig] = state.split('.');
  let shop;
  try {
    shop = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', secret).update(shop).digest('base64url');
  return timingEq(sig, expected) ? shop : null;
}

/** Verify Shopify's HMAC on the OAuth callback query params. */
export function verifyCallbackHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return timingEq(digest, hmac);
}

function timingEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Exchange the authorization code for an offline access token.
 * @returns {Promise<{ token: string, scope: string }>}
 */
export async function exchangeToken({ shop, clientId, clientSecret, code }) {
  if (!isShop(shop)) throw new Error(`invalid shop: ${shop}`);
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `HTTP ${res.status}`);
  }
  return { token: body.access_token, scope: body.scope || '' };
}

export { isShop };

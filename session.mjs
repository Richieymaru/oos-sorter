/**
 * Verify a Shopify App Bridge session token (an "id token").
 *
 * The embedded front-end calls `shopify.idToken()` and sends the result as
 * `Authorization: Bearer <jwt>`. The token is a JWT signed with HS256 using the
 * app's client secret, so we can verify it locally — no network call. This
 * replaces the old shared panel password: auth is now "are you an authenticated
 * admin user of this shop?", proven by a token Shopify itself issued.
 *
 * Pure and offline-testable (session.test.mjs). See:
 *   https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens
 */
import crypto from 'node:crypto';

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/**
 * Verify the `Authorization` header value. Returns the decoded payload if the
 * token is a valid, unexpired session token for this app + shop, else null.
 * @param {string} authHeader e.g. "Bearer eyJ..."
 * @param {{clientId:string, clientSecret:string, shop?:string, now?:number}} opts
 */
export function verifySessionToken(authHeader, { clientId, clientSecret, shop, now } = {}) {
  if (!authHeader || typeof authHeader !== 'string' || !clientSecret) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // Signature: HS256 over `<header>.<payload>` keyed by the app secret.
  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  const got = Buffer.from(sigB64);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;

  let p;
  try {
    p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const t = typeof now === 'number' ? now : Math.floor(Date.now() / 1000);
  if (typeof p.exp !== 'number' || p.exp <= t) return null; // expired
  if (typeof p.nbf === 'number' && p.nbf > t) return null; // not yet valid
  if (p.aud !== clientId) return null; // token minted for a different app
  if (shop && hostOf(p.dest) !== shop) return null; // issued for a different shop

  return p;
}

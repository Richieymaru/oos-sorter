/**
 * Token acquisition for Dev Dashboard apps.
 *
 * Dev Dashboard apps don't expose a static token in the admin. You exchange
 * your client ID + secret for one via the client credentials grant. Those
 * tokens live 24 hours, which is irrelevant for a script that runs in seconds
 * — we just fetch a fresh one per process.
 *
 * Falls back to a static ADMIN_TOKEN if you have one (legacy custom apps, or
 * an offline token obtained via authorization code grant).
 */

let cached = null;

export async function getAccessToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const shop = process.env.SHOP_DOMAIN;
  const id = process.env.CLIENT_ID;
  const secret = process.env.CLIENT_SECRET;

  if (!shop || !id || !secret) {
    throw new Error(
      'Set SHOP_DOMAIN + CLIENT_ID + CLIENT_SECRET (or a static ADMIN_TOKEN) in .env'
    );
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      grant_type: 'client_credentials',
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.access_token) {
    const err = body.error_description || body.error || `HTTP ${res.status}`;

    if (String(err).includes('shop_not_permitted')) {
      throw new Error(
        `${err}\n\n` +
          '  Client credentials only works when the app AND the store are in the\n' +
          '  same Dev Dashboard organization. Owning the store or having the app\n' +
          '  installed is not enough. Check: Dev Dashboard > Stores — is this store\n' +
          '  listed there? If not, you need the authorization code grant instead.'
      );
    }
    throw new Error(`Token request failed: ${err}`);
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 86400) * 1000,
  };
  return cached.token;
}

/**
 * Exchange an App Bridge session token for a non-expiring OFFLINE access token
 * (Shopify managed-installation flow). Used for custom-distribution installs on
 * stores outside the app's org, where the classic authorization-code grant is
 * rejected. Verified request shape against shopify.dev token-exchange docs.
 * @param {string} shop  e.g. "gel-ball-undercover.myshopify.com"
 * @param {string} sessionToken  the id_token JWT from shopify.idToken()
 * @returns {Promise<string>} the offline access token (shpat_/shpua_)
 */
export async function tokenExchange(shop, sessionToken) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`token exchange failed: ${body.error_description || body.error || 'HTTP ' + res.status}`);
  }
  return body.access_token;
}

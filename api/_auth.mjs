import { isAuthorized } from '../panel.mjs';
import { verifySessionToken } from '../session.mjs';

/**
 * Guard for actions (save, report, notify-waitlist). Two ways in:
 *   1. Embedded in the Shopify admin — the page sends a Shopify App Bridge
 *      session token as `Authorization: Bearer <jwt>`, verified locally. No
 *      password needed (auth is "you're an admin of this shop").
 *   2. Opened at the raw URL — falls back to the panel password
 *      (`x-panel-password` header, or HTTP Basic).
 * Returns true if authorized; otherwise writes a plain 401 and returns false.
 */
export function requireAuth(req, res) {
  // 1. Session token (embedded admin) — no password.
  const payload = verifySessionToken(req.headers?.['authorization'], {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    shop: process.env.SHOP_DOMAIN,
  });
  if (payload) return true;

  // 2. Panel password fallback (raw URL).
  const pw = process.env.PANEL_PASSWORD;
  if (pw && req.headers?.['x-panel-password'] === pw) return true;
  if (isAuthorized(req.headers?.['authorization'], pw)) return true;

  res.statusCode = 401;
  res.end('unauthorized');
  return false;
}

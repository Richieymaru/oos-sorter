import { isAuthorized } from '../panel.mjs';

/**
 * Guard for actions (save, report). The page itself is viewable without a
 * password so it can render inside the Shopify admin frame; only the actions
 * that change the store or send email require it. The page sends the panel
 * password as an `x-panel-password` header; HTTP Basic is still accepted.
 * Returns true if authorized; otherwise writes a plain 401 and returns false.
 */
export function requireAuth(req, res) {
  const pw = process.env.PANEL_PASSWORD;
  if (pw && req.headers?.['x-panel-password'] === pw) return true;
  if (isAuthorized(req.headers?.['authorization'], pw)) return true;
  res.statusCode = 401;
  res.end('unauthorized');
  return false;
}

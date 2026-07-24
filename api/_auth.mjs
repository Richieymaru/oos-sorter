import { isAuthorized } from '../panel.mjs';

/** Returns true if authorized; otherwise writes a 401 challenge and returns false. */
export function requireAuth(req, res) {
  if (isAuthorized(req.headers['authorization'], process.env.PANEL_PASSWORD)) return true;
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="OOS Sorter"');
  res.end('Authentication required');
  return false;
}

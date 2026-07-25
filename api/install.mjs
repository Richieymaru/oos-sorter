/**
 * Start of the one-time install. The store owner opens this (with ?shop=…), we
 * send them to Shopify's approval screen. After they approve, Shopify calls
 * /api/oauth-callback which captures the offline token.
 *
 *   https://<app>.vercel.app/api/install?shop=their-store.myshopify.com
 */
import { authorizeUrl, signState, isShop } from '../oauth.mjs';

const APP_NAME = process.env.APP_NAME || 'OOS Sorter';

function param(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try {
    return new URL(req.url, 'http://x').searchParams.get(name);
  } catch {
    return null;
  }
}

const FORM = (msg = '') => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect ${APP_NAME}</title>
<style>body{font:16px system-ui,sans-serif;max-width:26rem;margin:12vh auto;padding:0 1.2rem;color:#161b22}
h1{font-size:1.3rem} .m{color:#5f6875;font-size:14px;margin:.4rem 0 1.4rem}
input{width:100%;font:15px monospace;padding:11px 12px;border:1px solid #e4e8ef;border-radius:10px;margin-bottom:12px}
button{font:15px system-ui;font-weight:600;background:#0e9c6b;color:#fff;border:0;border-radius:10px;padding:11px 18px;cursor:pointer}
.err{color:#d1495b;font-size:13px;margin-bottom:10px}</style>
<h1>Connect ${APP_NAME}</h1>
<p class="m">Enter your store to authorize ${APP_NAME}. You'll approve the permissions on Shopify's screen.</p>
${msg ? `<div class="err">${msg}</div>` : ''}
<form method="GET" action="/api/install">
  <input name="shop" placeholder="your-store.myshopify.com" autocomplete="off" autofocus>
  <button type="submit">Continue to Shopify</button>
</form>`;

export default function handler(req, res) {
  const clientId = process.env.CLIENT_ID;
  const secret = process.env.CLIENT_SECRET;
  if (!clientId || !secret) {
    res.statusCode = 500;
    res.end('CLIENT_ID / CLIENT_SECRET not set on this deployment.');
    return;
  }
  const shop = (param(req, 'shop') || '').trim().toLowerCase();
  if (!shop) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(FORM());
    return;
  }
  if (!isShop(shop)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(FORM('That doesn’t look like a myshopify.com domain.'));
    return;
  }
  const url = authorizeUrl({
    shop,
    clientId,
    redirectUri: `https://${req.headers.host}/api/oauth-callback`,
    state: signState(shop, secret),
  });
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}

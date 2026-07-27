/**
 * OAuth callback (the app's registered redirect URL). Shopify sends the owner
 * here after they approve. We verify it's genuinely from Shopify, exchange the
 * code for a permanent offline token, and EMAIL the token to NOTIFY_EMAIL so the
 * developer can drop it into that store's ADMIN_TOKEN. The owner just sees a
 * "connected" page — they never handle the token.
 */
import { verifyState, verifyCallbackHmac, exchangeToken } from '../oauth.mjs';
import { sendPlain } from '../notify.mjs';
import { verifySessionToken } from '../session.mjs';
import { tokenExchange } from '../auth.mjs';

const APP_NAME = process.env.APP_NAME || 'OOS Sorter';

function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  } catch {
    return {};
  }
}

const page = (title, body) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:14vh auto;padding:0 1.2rem;color:#161b22;text-align:center}
.mk{width:44px;height:44px;border-radius:11px;border:1px solid #e4e8ef;margin:0 auto 18px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:11px 9px}
.mk i{display:block;height:4px;border-radius:2px;background:#0e9c6b}.mk i:nth-child(2){width:70%;opacity:.6;margin:0 auto 0 0}.mk i:nth-child(3){width:44%;opacity:.3}
h1{font-size:1.35rem;margin:0 0 .4rem} p{color:#5f6875;line-height:1.5}</style>
<div class="mk"><i></i><i></i><i></i></div>${body}`;

export default async function handler(req, res) {
  const secret = process.env.CLIENT_SECRET;
  const clientId = process.env.CLIENT_ID;

  // POST = Shopify managed-installation completion. The embedded app sends its
  // App Bridge session token; we exchange it for an offline token and email it
  // (dev drops it into ADMIN_TOKEN). Used for custom-distribution installs where
  // the classic authorization-code grant (the GET branch below) is unavailable.
  if (req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const payload = verifySessionToken(req.headers['authorization'], { clientId, clientSecret: secret });
    if (!payload) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, error: 'Invalid session token.' })); return; }
    let shop = null;
    try { shop = new URL(payload.dest).host; } catch {}
    if (!shop) { res.end(JSON.stringify({ ok: false, error: 'No shop in session token.' })); return; }
    try {
      const sessionToken = String(req.headers['authorization']).replace(/^Bearer\s+/i, '');
      const token = await tokenExchange(shop, sessionToken);
      await sendPlain(
        `${APP_NAME}: access token for ${shop}`,
        `Offline access token for ${shop} (managed install / token exchange)\n` +
          `Put it in ADMIN_TOKEN for that store's deployment:\n\n${token}\n`
      ).catch((e) => console.error('token email failed:', e.message));
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  const q = query(req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const shop = verifyState(q.state, secret || '');
  if (!shop || shop !== q.shop) {
    res.statusCode = 403;
    res.end(page('Error', '<h1>Couldn’t verify the request</h1><p>The install link expired or was tampered with. Start again from /api/install.</p>'));
    return;
  }
  if (!verifyCallbackHmac(q, secret || '')) {
    res.statusCode = 403;
    res.end(page('Error', '<h1>Signature check failed</h1><p>This request didn’t come from Shopify.</p>'));
    return;
  }

  try {
    const { token, scope } = await exchangeToken({ shop, clientId, clientSecret: secret, code: q.code });
    await sendPlain(
      `${APP_NAME}: access token for ${shop}`,
      `Offline access token for ${shop}\n(non-expiring — put it in ADMIN_TOKEN for that store's deployment):\n\n${token}\n\nGranted scopes: ${scope}\n`
    ).catch((e) => console.error('token email failed:', e.message));
    res.statusCode = 200;
    res.end(page('Connected', `<h1>${APP_NAME} is connected ✓</h1><p><b>${shop}</b> is authorized. You can close this tab — nothing else to do.</p>`));
  } catch (err) {
    res.statusCode = 500;
    res.end(page('Error', `<h1>Couldn’t finish connecting</h1><p>${err.message}</p>`));
  }
}

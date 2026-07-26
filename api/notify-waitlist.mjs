/** Admin "Send now" — manually email + clear one product's waitlist. Password-gated. */
import { requireAuth } from './_auth.mjs';
import { notifyOneProduct } from '../restock.mjs';
import { longId } from '../shopify.mjs';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
  res.setHeader('Content-Type', 'application/json');
  try {
    const { productId } = await readJson(req);
    const s = String(productId || '');
    const num = s.replace(/\D/g, '');
    const gid = s.startsWith('gid://') ? s : (num ? longId(num) : null);
    if (!gid) { res.end(JSON.stringify({ ok: false, error: 'Missing product.' })); return; }
    const r = await notifyOneProduct(gid, {});
    res.end(JSON.stringify({ ok: true, sent: r.sent }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

/**
 * Public "Notify When Available" endpoint. The storefront theme app extension
 * POSTs { email, productId, consent, hp } here when a shopper joins a sold-out
 * product's waitlist. No auth (it's public) — protected by email validation, a
 * per-product cap, a honeypot field, and required consent.
 */
import { subscribe } from '../waitlist.mjs';
import { longId, gql } from '../shopify.mjs';
import { notifySlackSignup } from '../slack.mjs';
import { loadSettings } from '../settings.mjs';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

/** Accept a numeric id or a gid; return the Product gid. */
function toProductGid(productId) {
  const s = String(productId || '');
  if (s.startsWith('gid://')) return s;
  const num = s.replace(/\D/g, '');
  return num ? longId(num) : null;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
  res.setHeader('Content-Type', 'application/json');

  try {
    const { email, productId, consent, hp } = await readJson(req);
    if (hp) { res.end(JSON.stringify({ ok: true })); return; } // honeypot filled -> silently drop a bot
    if (consent !== true) { res.end(JSON.stringify({ ok: false, error: 'Please agree to be notified.' })); return; }
    const gid = toProductGid(productId);
    if (!gid) { res.end(JSON.stringify({ ok: false, error: 'Missing product.' })); return; }

    const r = await subscribe(gid, email, new Date().toISOString());
    if (r.reason === 'invalid') { res.end(JSON.stringify({ ok: false, error: 'Enter a valid email.' })); return; }
    if (r.reason === 'full') { res.end(JSON.stringify({ ok: false, error: 'This waitlist is full right now.' })); return; }

    // Slack ping on a genuinely new signup. The webhook comes from Settings
    // (overrides the SLACK_WEBHOOK_URL env default). Never blocks/breaks the reply.
    if (r.added) {
      try {
        let webhookUrl = process.env.SLACK_WEBHOOK_URL || '';
        try { const s = await loadSettings(); if (s.slackWebhook) webhookUrl = s.slackWebhook; } catch {}
        if (webhookUrl) {
          const d = await gql(`query($id: ID!) { product(id: $id) { title handle } }`, { id: gid });
          await notifySlackSignup({ email, title: d.product?.title, handle: d.product?.handle, count: r.count, webhookUrl });
        }
      } catch (e) {
        console.error(`  ! Slack signup notify skipped: ${e.message}`);
      }
    }

    res.end(JSON.stringify({ ok: true, already: r.reason === 'exists', count: r.count }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

/**
 * Public "Notify When Available" endpoint. The storefront theme app extension
 * POSTs { email, productId, variantId, consent, hp } here when a shopper joins a
 * sold-out product's waitlist. No auth (it's public) — protected by email
 * validation, a per-product cap, a honeypot field, and required consent.
 *
 * variantId is optional and never trusted as sent: it's resolved against Shopify
 * and dropped unless it really belongs to the posted product. The title is read
 * from Shopify too, so the admin list can't be seeded with attacker-chosen text.
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

/**
 * Resolve the posted variant against Shopify. Returns { variantId, variantTitle }
 * with nulls whenever the variant is missing, unknown, or belongs to a different
 * product — a bad variant must never cost the shopper their signup, so every
 * failure here degrades to a plain product-level entry.
 */
async function resolveVariant(variantId, productGid) {
  const num = String(variantId || '').replace(/\D/g, '');
  if (!num) return { variantId: null, variantTitle: null };

  try {
    const d = await gql(
      `query($id: ID!) { productVariant(id: $id) { id title product { id } } }`,
      { id: `gid://shopify/ProductVariant/${num}` }
    );
    const v = d.productVariant;
    if (!v || v.product?.id !== productGid) return { variantId: null, variantTitle: null };
    return { variantId: num, variantTitle: v.title || null };
  } catch (e) {
    console.error(`  ! variant lookup failed for ${num}: ${e.message}`);
    return { variantId: null, variantTitle: null };
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
  res.setHeader('Content-Type', 'application/json');

  try {
    const { email, productId, variantId, consent, hp } = await readJson(req);
    if (hp) { res.end(JSON.stringify({ ok: true })); return; } // honeypot filled -> silently drop a bot
    if (consent !== true) { res.end(JSON.stringify({ ok: false, error: 'Please agree to be notified.' })); return; }
    const gid = toProductGid(productId);
    if (!gid) { res.end(JSON.stringify({ ok: false, error: 'Missing product.' })); return; }

    const variant = await resolveVariant(variantId, gid);
    const r = await subscribe(gid, email, new Date().toISOString(), variant);
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
          await notifySlackSignup({
            email,
            title: d.product?.title,
            handle: d.product?.handle,
            variantTitle: variant.variantTitle,
            count: r.count,
            webhookUrl,
          });
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

/**
 * One-click Product Change Monitor setup, run from the Settings page. Using the
 * app's OWN credentials (already in this Vercel project's env), it:
 *   1. registers the `products/update` webhook -> /api/product-webhook (idempotent), and
 *   2. seeds the last-known-status baseline for every product,
 * so the next status change is caught as a real transition, not a first-sight.
 *
 * Auth: same guard as Save (session token when embedded, else panel password).
 * Nothing sensitive leaves Vercel — the merchant just clicks the button.
 */
import { requireAuth } from './_auth.mjs';
import { ensureWebhook } from '../webhooks.mjs';
import { fetchAllStatuses } from '../monitor.mjs';
import { saveMonitorState } from '../monitor-state.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'POST only' })); return;
  }
  try {
    const token = process.env.WEBHOOK_TOKEN;
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: 'WEBHOOK_TOKEN is not set in this app’s environment' }));
      return;
    }
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    const base = `https://${host}`;
    const hook = await ensureWebhook({ base, topic: 'PRODUCTS_UPDATE', path: '/api/product-webhook', token });
    const statuses = await fetchAllStatuses();
    await saveMonitorState({ statuses });
    res.end(JSON.stringify({ ok: true, webhook: hook.status, seeded: Object.keys(statuses).length }));
  } catch (e) {
    console.error('monitor-setup error:', e.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e.message) }));
  }
}

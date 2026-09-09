import { loadSettings, saveSettings, normalizeSettings } from '../settings.mjs';
import { shell, setPageHeaders, notConnectedBody, shopOf } from '../ui.mjs';
import { settingsBody } from '../panel.mjs';
import { requireAuth } from './_auth.mjs';
import { ensureMonitorWebhooks } from '../webhooks.mjs';
import { fetchAllStatuses } from '../monitor.mjs';
import { loadMonitorState, saveMonitorState } from '../monitor-state.mjs';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

/**
 * One-click Product Change Monitor setup, folded into this endpoint (Vercel's
 * Hobby plan caps a deployment at 12 serverless functions, so the monitor setup
 * lives here rather than in its own file). Using the app's OWN credentials, it
 * registers the products/update webhook (idempotent) and seeds the last-known
 * status baseline for every product. Nothing sensitive leaves Vercel.
 */
async function setupMonitor(req, res) {
  const token = process.env.WEBHOOK_TOKEN;
  if (!token) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'WEBHOOK_TOKEN is not set in this app’s environment' }));
    return;
  }
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const hooks = await ensureMonitorWebhooks({ base: `https://${host}`, token });
  // Seed the status baseline but PRESERVE any existing title cache.
  const prev = await loadMonitorState().catch(() => ({ titles: {} }));
  const statuses = await fetchAllStatuses();
  await saveMonitorState({ statuses, titles: prev.titles || {} });
  const created = hooks.filter((h) => h.status === 'created').length;
  res.end(JSON.stringify({ ok: true, webhook: created ? 'created' : 'ready', webhooks: hooks.length, seeded: Object.keys(statuses).length }));
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // POST = save the toggles/recipients, OR run the monitor setup action
  // (password / session-token gated).
  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await readJson(req);
      if (body.action === 'setup-monitor') { await setupMonitor(req, res); return; }
      const settings = normalizeSettings(body);
      await saveSettings(settings);
      res.end(JSON.stringify({ ok: true, settings }));
    } catch (e) {
      console.error('settings POST error:', e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e.message) }));
    }
    return;
  }

  // GET = the page.
  let settings;
  try {
    settings = await loadSettings();
  } catch (e) {
    console.error('settings: not connected —', e.message);
    setPageHeaders(res);
    res.end(shell({ title: 'Settings', active: 'settings', body: notConnectedBody(shopOf(req)) }));
    return;
  }
  const body =
    `<div class="pagehead"><h1>Settings</h1><p>Choose what happens when a product sells out.</p></div>` +
    settingsBody(settings);
  setPageHeaders(res);
  res.end(shell({ title: 'Settings', active: 'settings', body }));
}

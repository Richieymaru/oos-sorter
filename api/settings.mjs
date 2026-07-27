import { loadSettings, saveSettings, normalizeSettings } from '../settings.mjs';
import { shell, setPageHeaders, notConnectedBody, shopOf } from '../ui.mjs';
import { settingsBody } from '../panel.mjs';
import { requireAuth } from './_auth.mjs';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  // POST = save the toggles/recipients (password / session-token gated).
  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const settings = normalizeSettings(await readJson(req));
    await saveSettings(settings);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, settings }));
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

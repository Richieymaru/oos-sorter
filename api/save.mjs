import { requireAuth } from './_auth.mjs';
import { saveSettings, normalizeSettings } from '../settings.mjs';

/** Read a JSON body whether or not the platform pre-parsed it. */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('POST only');
    return;
  }
  const settings = normalizeSettings(await readJson(req));
  await saveSettings(settings);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, settings }));
}

import { requireAuth } from './_auth.mjs';
import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { renderPage } from '../panel.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const [settings, state] = await Promise.all([loadSettings(), loadState()]);
  const status = { soldOutCount: (state.soldOut || []).length, lastRun: state.lastRun ?? null };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(renderPage({ settings, status }));
}

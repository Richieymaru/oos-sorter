import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { renderPage } from '../panel.mjs';

export default async function handler(req, res) {
  const [settings, state] = await Promise.all([loadSettings(), loadState()]);
  const status = { soldOutCount: (state.soldOut || []).length, lastRun: state.lastRun ?? null };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Allow the page to load inside the Shopify admin iframe (and standalone).
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://admin.shopify.com https://*.myshopify.com"
  );
  res.end(renderPage({ settings, status }));
}

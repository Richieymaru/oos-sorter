import { loadSettings, saveSettings, normalizeSettings, incentiveFor } from '../settings.mjs';
import { shell, setPageHeaders, notConnectedBody, shopOf, esc } from '../ui.mjs';
import { settingsBody } from '../panel.mjs';
import { requireAuth } from './_auth.mjs';
import { ensureMonitorWebhooks } from '../webhooks.mjs';
import { fetchAllStatuses } from '../monitor.mjs';
import { loadMonitorState, saveMonitorState } from '../monitor-state.mjs';
import { buildBackInStock, buildNudge, buildAltVariant, formatMoney } from '../notify.mjs';
import { getShopContext } from '../shopify.mjs';

/** Build the "what shoppers actually receive" samples from the CURRENT settings,
 *  so the preview reflects the free-gift, perks and alt-variant toggles live. */
function previewSamples(settings, ctx) {
  const host = ctx.host || process.env.SHOP_DOMAIN || 'your-store.myshopify.com';
  const cur = ctx.currency || 'AUD';
  const price = (n) => formatMoney(String(n), cur);
  const unsub = '#';
  const base = { handle: 'sample-product', image: null, storeHost: host };
  const freeGift = settings.freeGiftEnabled && settings.freeGiftProduct
    ? { products: [settings.freeGiftProduct] }
    : null;
  const incAt = (n) => incentiveFor(n, settings);

  const s1 = buildBackInStock(
    { ...base, title: 'Hydro Gel Balls — 10,000pcs', variantId: '501', variantTitle: 'Blue', priceText: price(149.99), incentives: incAt(149.99) },
    unsub
  );
  const s2 = buildBackInStock(
    { ...base, title: 'Elite Gel Blaster Bundle', variantId: '777', variantTitle: 'Complete Kit', priceText: price(1299), incentives: incAt(1299) },
    unsub
  );
  const s3 = buildNudge(
    { ...base, title: 'Hydro Gel Balls — 10,000pcs', variantId: '501', variantTitle: 'Blue', priceText: price(149.99), incentives: incAt(149.99), clickCartUrl: `https://${host}/cart/501:1` },
    unsub,
    { freeGift, altVariants: [{ title: 'Green', priceText: price(149.99), url: `https://${host}/cart/502:1` }] }
  );
  const s4 = buildAltVariant(
    { ...base, title: 'Hydro Gel Balls — 10,000pcs', variantId: '502', variantTitle: 'Green', priceText: price(149.99), incentives: incAt(149.99), clickCartUrl: `https://${host}/cart/502:1` },
    unsub,
    { altVariants: [{ title: 'Orange', priceText: price(149.99), url: `https://${host}/cart/503:1` }] }
  );
  // Manual "Resend" (and the 2-day nudge) re-use the back-in-stock layout but also
  // carry the free-gift offer — so shoppers who didn't convert get the sweetener.
  const s5 = buildBackInStock(
    { ...base, title: 'Hydro Gel Balls — 10,000pcs', variantId: '501', variantTitle: 'Blue', priceText: price(149.99), incentives: incAt(149.99), freeGift },
    unsub
  );

  return [
    { label: 'Back in stock', note: 'Sent automatically when a shopper’s exact option returns (also the manual “Send now”).', html: s1.html, subject: s1.subject },
    { label: 'Back in stock — with order perks', note: settings.incentivesEnabled ? 'A higher-priced product shows the perks box, based on your thresholds.' : 'Turn on “Order perks by price” in Settings to show the free-shipping / gift box here.', html: s2.html, subject: s2.subject },
    { label: `Follow-up nudge (after ${settings.nudgeDays || 2} days)`, note: freeGift ? 'Includes your free-gift offer plus any in-stock alternatives.' : 'Turn on the free-gift offer to add a gift box. It also lists in-stock alternatives when available.', html: s3.html, subject: s3.subject },
    { label: 'A different option is in stock', note: settings.offerAltVariant ? 'Sent automatically — and available as the manual “Offer” buttons on Waitlists.' : 'Enable “Offer a different variant…” to send this automatically; the manual Offer buttons on Waitlists work regardless.', html: s4.html, subject: s4.subject },
    { label: 'Manual “Resend” (re-engagement)', note: freeGift ? 'What the “Resend” button on Notified sends — includes your free-gift offer to win back shoppers who didn’t convert.' : 'What the “Resend” button on Notified sends. Turn on the free-gift offer to add a gift box here.', html: s5.html, subject: s5.subject },
  ];
}

/** The /preview page body: each sample email rendered isolated in its own iframe. */
function previewBody(samples) {
  const cards = samples
    .map(
      (s) => `<div class="card pad" style="margin-bottom:16px">
      <div class="cname" style="font-size:15px">${esc(s.label)}</div>
      <div class="faint" style="font-size:12.5px;margin:3px 0 2px">Subject: <strong>${esc(s.subject)}</strong></div>
      <div class="faint" style="font-size:12.5px;margin-bottom:10px">${s.note}</div>
      <iframe srcdoc="${esc(s.html)}" title="${esc(s.label)}" loading="lazy" style="width:100%;max-width:620px;height:760px;border:1px solid var(--line);border-radius:12px;background:#fff;display:block"></iframe>
    </div>`
    )
    .join('');
  return `<div class="pagehead"><h1>Email preview</h1><p>Exactly what shoppers receive, rendered from your current settings. Product, price and images are samples — the real emails use each live product. <a href="/settings" style="color:var(--accent-ink);font-weight:600">&larr; back to settings</a></p></div>
  ${cards}`;
}

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
  const { statuses, titles } = await fetchAllStatuses();
  await saveMonitorState({ statuses, titles: { ...(prev.titles || {}), ...titles } });
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

  // GET = the page. ?view=preview renders the sample emails instead.
  const previewView = /[?&]view=preview\b/.test(req.url || '');
  let settings;
  try {
    settings = await loadSettings();
  } catch (e) {
    console.error('settings: not connected —', e.message);
    setPageHeaders(res);
    res.end(shell({ title: previewView ? 'Email preview' : 'Settings', active: previewView ? 'preview' : 'settings', body: notConnectedBody(shopOf(req)) }));
    return;
  }

  if (previewView) {
    let ctx = {};
    try { ctx = await getShopContext(); } catch { /* preview with defaults if context unavailable */ }
    setPageHeaders(res);
    res.end(shell({ title: 'Email preview', active: 'preview', body: previewBody(previewSamples(settings, ctx)) }));
    return;
  }

  const body =
    `<div class="pagehead"><h1>Settings</h1><p>Choose what happens when a product sells out. <a href="/preview" style="color:var(--accent-ink);font-weight:600">Preview the emails &rarr;</a></p></div>` +
    settingsBody(settings);
  setPageHeaders(res);
  res.end(shell({ title: 'Settings', active: 'settings', body }));
}

import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { loadMonitorState } from '../monitor-state.mjs';
import { recentActivity } from '../monitor.mjs';
import { loadMonitorLog, monitorTag, fetchSheetActivity } from '../monitor-log.mjs';
import { loadNotified, deriveStats } from '../notified.mjs';
import { fetchAllCollectionHandles } from '../sort-oos.mjs';
import {
  shell, setPageHeaders, statCard, badge, activityFeed, funnelsBody, areaChart,
  relTime, esc, notConnectedBody, shopOf, APP_NAME, saleReminderBanner,
} from '../ui.mjs';
import { activeSaleReminder } from '../sales-calendar.mjs';
import { requireAuth } from './_auth.mjs';
import { assistantReply } from '../assistant.mjs';
import { fetchOrders, fetchAbandonedCheckouts, fetchAbandonedCheckout } from '../orders.mjs';
import { buildRecoveryEmail, sendRecovery } from '../notify.mjs';
import { getShopContext } from '../shopify.mjs';
import { analyzeFunnels, analyzeCheckout, checkoutInsights, resolveRange, topProductsByCategory } from '../funnels.mjs';
import { fetchCollectionProductIds, fetchProductImages } from '../catalog.mjs';
import { ttlMemo } from '../cache.mjs';

export const config = { maxDuration: 30 };

// Per-instance caches so navigating between pages / reopening is near-instant.
// The collection handle list changes rarely (5 min); orders a little more often
// (2 min). Cold starts miss and fetch fresh — correctness never depends on these.
const cachedHandles = ttlMemo(fetchAllCollectionHandles, 300000);
const cachedOrders = ttlMemo(fetchOrders, 120000);
const cachedAbandoned = ttlMemo(fetchAbandonedCheckouts, 120000);
const cachedCollectionIds = ttlMemo(fetchCollectionProductIds, 600000);
const cachedProductImages = ttlMemo(fetchProductImages, 600000);

// Funnels "top products by category" — collection membership per category.
// Store-specific (GBU); move to settings if this ever ships to another store.
const PRODUCT_CATEGORIES = [
  { label: 'Rifles', handle: 'gel-blaster-rifles' },
  { label: 'Pistols', handle: 'gel-blaster-pistols' },
  { label: 'Accessories', handle: 'accessories' },
  { label: 'Parts', handle: 'all-gel-blaster-parts' },
];

const ICON_BOX = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 2.5 3.5 6v8l6.5 3.5L16.5 14V6L10 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_LAYERS = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 3 3 6.5 10 10l7-3.5L10 3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3.5 10 10 13.3 16.5 10" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_PULSE = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M2 10h3l2-5 3 10 2.5-7L17 10h1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

/**
 * The recent-activity items for the monitor feed. Prefers the Google Sheet (the
 * FULL rich history the merchant also sees in the Sheet/Slack), falls back to
 * the in-app metafield log, then to Shopify's bare live event log. `limit`
 * bounds every source. Returns [] when the monitor is off.
 */
async function loadActivityItems(settings, monitorTitles, limit) {
  if (!settings || !settings.monitor) return [];
  let items = settings.sheetWebhook
    ? await fetchSheetActivity(settings.sheetWebhook, limit).catch(() => null)
    : null;
  if (!items || !items.length) {
    const logged = await loadMonitorLog().catch(() => []);
    if (logged.length) {
      const shop = process.env.SHOP_DOMAIN;
      items = logged.slice(0, limit).map((r) => {
        const { label, tone } = monitorTag(r.f, r.to);
        return {
          type: r.ty,
          title: r.t,
          href: r.h && shop ? `https://${shop}/${r.p || 'products'}/${r.h}` : null,
          who: r.w,
          iso: r.ts,
          label,
          tone,
          stock: r.s,
        };
      });
    } else {
      items = await recentActivity(limit, monitorTitles || {}).catch(() => []);
    }
  }
  return items;
}

const isToday = (iso) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

function param(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try { return new URL(req.url, 'http://x').searchParams.get(name); } catch { return null; }
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let d = ''; for await (const c of req) d += c;
  try { return JSON.parse(d || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  // --- Assistant chat (POST /assistant, folded here to stay under the 12-fn cap) ---
  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await readJson(req);

      // --- Abandoned-cart recovery (MANUAL, owner-triggered from Funnels) ---
      // No cron, no automation — only runs on an explicit Recover/Preview click.
      if (body.action === 'previewRecover' || body.action === 'recoverCart') {
        const cart = await fetchAbandonedCheckout(String(body.id || '')).catch((e) => { console.error('recover: fetch —', e.message); return null; });
        if (!cart) { res.end(JSON.stringify({ ok: false, error: 'Could not load that cart.' })); return; }
        let brandLogo = null;
        try { brandLogo = (await getShopContext()).brandLogo || null; } catch { /* logo optional */ }
        if (body.action === 'previewRecover') {
          const { html } = buildRecoveryEmail(cart, { freeShipping: true, brandLogo });
          res.end(JSON.stringify({ ok: true, html, recoverable: !!cart.email, emailDenied: !!cart.emailDenied }));
          return;
        }
        // recoverCart — the actual manual send; needs the customer email.
        if (!cart.email) {
          res.end(JSON.stringify({ ok: false, redacted: true, error: cart.emailDenied
            ? 'Customer email needs the read_customers scope — add it and reinstall the app.'
            : 'This cart has no customer email on file.' }));
          return;
        }
        await sendRecovery(cart.email, cart, { freeShipping: true, brandLogo });
        res.end(JSON.stringify({ ok: true, sent: true }));
        return;
      }

      const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
      const reply = await assistantReply(messages);
      res.end(JSON.stringify({ ok: true, reply }));
    } catch (e) {
      if (e.message === 'NO_KEY') {
        res.end(JSON.stringify({ ok: false, setup: true, error: 'The assistant isn’t set up yet. Add a free Gemini API key (GEMINI_API_KEY) in the app’s Vercel environment, then redeploy.' }));
      } else {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e.message || 'Assistant error') }));
      }
    }
    return;
  }

  // --- Old /assistant route: the assistant is now the floating chat widget on
  //     every page, so send any bookmark to the dashboard (where it lives). ---
  if (param(req, 'view') === 'assistant') {
    const q = param(req, 'q');
    res.statusCode = 302;
    res.setHeader('Location', q ? `/?chat=${encodeURIComponent(q)}` : '/');
    res.end();
    return;
  }

  // --- Funnels page (GET /funnels) — reads recent orders (read_orders) and
  //     shows channels, traffic sources, best sellers, and where to focus.
  //     Degrades gracefully when order access isn't granted yet. ---
  if (param(req, 'view') === 'funnels') {
    let body;
    try {
      const win = resolveRange(param(req, 'range') || '30d');
      const [ordRes, abRes, notifiedLog, settings, ...catIdSets] = await Promise.all([
        cachedOrders({ since: win.since, until: win.until }),
        cachedAbandoned({ since: win.since, until: win.until }).catch(() => ({ abandoned: [], count: 0 })),
        loadNotified().catch(() => []),
        loadSettings().catch(() => ({})),
        ...PRODUCT_CATEGORIES.map((c) => cachedCollectionIds(c.handle).catch(() => [])),
      ]);
      const analysis = analyzeFunnels(ordRes.orders, { tier: ordRes.tier, since: win.since, until: win.until });
      const checkout = analyzeCheckout(ordRes.orders, abRes.abandoned, abRes.count, { currency: analysis.currency });
      checkout.insights = checkoutInsights(checkout);
      // Back-in-stock revenue card — the app's own value, from the notified log.
      const waitlist = settings.waitlist ? deriveStats(notifiedLog) : null;
      const saleReminder = activeSaleReminder();
      // Top 5 products per category, by collection membership.
      const categoryDefs = PRODUCT_CATEGORIES.map((c, i) => ({ label: c.label, ids: new Set(catIdSets[i] || []) }));
      const categories = topProductsByCategory(ordRes.orders, categoryDefs, 5);
      // Attach a featured image to each shown product (for the category thumbnails).
      const shownIds = [...new Set(categories.flatMap((c) => c.products.map((p) => p.id)))];
      const imgs = shownIds.length ? await cachedProductImages(shownIds).catch(() => ({})) : {};
      for (const c of categories) for (const p of c.products) p.img = imgs[p.id] || null;
      body = funnelsBody({ analysis, checkout, window: win, waitlist, categories, saleReminder });
    } catch (e) {
      console.error('funnels: fetch failed —', e.message);
      body = funnelsBody({ error: 'Order data is temporarily unavailable. If this persists, check that read_orders is granted on the store.' });
    }
    setPageHeaders(res);
    res.end(shell({ title: 'Funnels', active: 'funnels', body }));
    return;
  }

  // --- Activity page (GET /activity) — the full change history, so the dashboard
  //     can show just the latest few and link here for the rest. ---
  if (param(req, 'view') === 'activity') {
    let settings, monitor;
    try {
      [settings, monitor] = await Promise.all([loadSettings(), loadMonitorState().catch(() => ({ titles: {} }))]);
    } catch (e) {
      setPageHeaders(res);
      res.end(shell({ title: 'Activity', active: 'activity', body: notConnectedBody(shopOf(req)) }));
      return;
    }
    const items = await loadActivityItems(settings, monitor.titles, 100);
    const body = `<div class="pagehead rise"><h1>Activity</h1><p>Every product and collection change ${esc(APP_NAME)} has tracked — who changed what, and when.</p></div>
      <div class="card rise" style="--d:80ms">
        <div class="card-h"><h2>All activity</h2><span class="faint">${items.length ? `${items.length} most recent` : ''}</span></div>
        ${settings.monitor
          ? activityFeed(items)
          : `<div class="empty">The change monitor is off.<div class="faint" style="margin-top:6px">Turn it on in Settings to track who changes, adds, or deletes products and collections.</div></div>`}
      </div>`;
    setPageHeaders(res);
    res.end(shell({ title: 'Activity', active: 'activity', body }));
    return;
  }

  let settings, state, handles, monitor, notified, activity;
  try {
    [settings, state, handles, monitor, notified] = await Promise.all([
      loadSettings(),
      loadState(),
      cachedHandles().catch(() => []),
      loadMonitorState().catch(() => ({ titles: {} })),
      loadNotified().catch(() => []),
    ]);
    // Load more than we display so "Changes today" is counted accurately; the
    // feed card itself shows only the latest 10 and links to /activity.
    activity = await loadActivityItems(settings, monitor.titles, 50);
  } catch (e) {
    console.error('index: not connected —', e.message);
    setPageHeaders(res);
    res.end(shell({ title: 'Dashboard', active: 'home', body: notConnectedBody(shopOf(req)) }));
    return;
  }

  const soldOut = (state.soldOut || []).length;
  const changesToday = activity.filter((a) => isToday(a.iso)).length;
  const wl = deriveStats(notified);
  const ICON_BELL = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 3a4 4 0 0 0-4 4c0 4-1.4 5-1.4 5h10.8S14 11 14 7a4 4 0 0 0-4-4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8.4 15a1.6 1.6 0 0 0 3.2 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

  // --- stat cards (numbers count up on load) ---
  const count = (n) => `<span class="count" data-to="${Number(n) || 0}">0</span>`;
  const stats = `<div class="grid c4 rise" style="--d:60ms">
    ${statCard({ value: count(soldOut), label: 'Sold out now', sub: 'kept at the bottom', tone: soldOut ? 'warn' : '', icon: ICON_BOX })}
    ${statCard({ value: handles.length ? count(handles.length) : '—', label: 'Collections', sub: settings.sort ? 'auto-sorted' : 'sorting off', icon: ICON_LAYERS })}
    ${statCard({ value: settings.waitlist ? count(wl.notified) : '—', label: 'Waitlist notified', sub: settings.waitlist ? `${wl.clickRate}% clicked through` : 'waitlist off', tone: settings.waitlist && wl.clicked ? 'pos' : '', icon: ICON_BELL })}
    ${statCard({ value: settings.monitor ? count(changesToday) : '—', label: 'Changes today', sub: settings.monitor ? 'tracked by the monitor' : 'monitor off', tone: settings.monitor && changesToday ? 'pos' : '', icon: ICON_PULSE })}
  </div>`;

  // --- sold-out trend (real 30-day history from state; builds up over days) ---
  const history = Array.isArray(state.soldOutHistory) ? state.soldOutHistory : [];
  const trendCard = history.length >= 2
    ? `<div class="card hero rise" style="--d:150ms">
        <div class="card-h"><h2>Sold-out trend</h2><span class="faint">last ${history.length} day${history.length === 1 ? '' : 's'}</span></div>
        <div class="pad" style="padding-top:16px">
          <div class="trend-top">
            <div><div class="trend-big">${count(soldOut)}</div><div class="trend-lab">sold out right now</div></div>
            <div class="trend-note">${soldOut ? 'The sorter keeps these off the front pages.' : 'Nothing is sold out — in-stock products stay up front.'}</div>
          </div>
          ${areaChart(history)}
        </div></div>`
    : `<div class="card rise" style="--d:150ms">
        <div class="card-h"><h2>Sold-out trend</h2><span class="faint">building</span></div>
        <div class="pad"><p class="muted" style="margin:0;font-size:13.5px">Your daily sold-out trend appears here once there are a couple of days of data — one point is recorded on each full run.</p></div></div>`;

  // --- waitlist conversion ring (real: notified → clicked → ordered) ---
  const CIRC = 326.7; // 2πr, r=52
  const arc = `${(Math.min(100, Math.max(0, wl.clickRate)) / 100 * CIRC).toFixed(1)} ${CIRC}`;
  const orderedLabel = wl.ordered
    ? (wl.revenue ? `${wl.currency ? wl.currency + ' ' : ''}${wl.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : `${wl.orders} order${wl.orders === 1 ? '' : 's'}`)
    : '—';
  const ringCard = `<div class="card">
    <div class="card-h"><h2>Waitlist</h2>${badge(settings.waitlist ? 'On' : 'Off', settings.waitlist ? 'ok' : 'idle')}</div>
    <div class="pad" style="padding-top:18px">
      ${settings.waitlist
        ? `<div class="ring-wrap">
            <div class="ring" style="width:132px;height:132px">
              <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
                <circle cx="66" cy="66" r="52" fill="none" stroke="var(--line)" stroke-width="13"/>
                <circle class="rarc" cx="66" cy="66" r="52" fill="none" stroke="var(--accent)" stroke-width="13" stroke-linecap="round" transform="rotate(-90 66 66)" style="--arc:${arc}"/>
              </svg>
              <div class="cx"><b class="tnum">${wl.clickRate}%</b><span>clicked</span></div>
            </div>
            <div class="legend">
              <div class="leg"><span class="sw" style="background:var(--accent)"></span>Notified <b class="tnum">${wl.notified}</b><span class="ll">people</span></div>
              <div class="leg"><span class="sw" style="background:var(--accent-300)"></span>Clicked <b class="tnum">${wl.clicked}</b><span class="ll">${wl.clickRate}%</span></div>
              <div class="leg"><span class="sw" style="background:var(--line)"></span>Ordered <b class="tnum">${wl.ordered}</b><span class="ll">${esc(orderedLabel)}</span></div>
            </div>
          </div>
          <a href="/waitlists" style="text-decoration:none"><button class="ghost" style="margin-top:18px">View waitlists</button></a>`
        : `<p class="muted" style="margin:0 0 12px;font-size:13px">Let shoppers get an email when a sold-out product returns — with click-through tracking and auto-nudges.</p>
           <a href="/settings" style="text-decoration:none"><button class="ghost">Turn on in Settings</button></a>`}
    </div></div>`;

  // The AI assistant is reachable any time from the floating chat button (added
  // by shell() on every page), so the dashboard no longer needs a hero card.

  // --- automations rail ---
  const feat = [
    { on: settings.sort, label: 'Sort sold-out to bottom' },
    { on: settings.notify, label: 'Sold-out email alerts' },
    { on: settings.waitlist, label: 'Back-in-stock waitlist' },
    { on: settings.monitor, label: 'Product change monitor' },
    { on: settings.draft, label: 'Draft sold-out products' },
  ];
  const featSub = {
    'Sort sold-out to bottom': 'Keeps in-stock up front',
    'Sold-out email alerts': 'Tells you when stock hits zero',
    'Back-in-stock waitlist': 'Auto-emails shoppers on restock',
    'Product change monitor': 'Logs who changed what',
    'Draft sold-out products': 'Hide them from the storefront',
  };
  const onCount = feat.filter((f) => f.on).length;
  const featRows = feat.map((f) =>
    `<div class="arow"><span class="atog ${f.on ? 'on' : ''}" aria-hidden="true"></span>
      <span class="amain"><span class="aname">${esc(f.label)}</span><span class="asub">${esc(featSub[f.label] || '')}</span></span>
      <span class="astat ${f.on ? '' : 'off'}"><span class="d"></span>${f.on ? 'On' : 'Off'}</span></div>`
  ).join('');

  const monitorSinks = [];
  if (settings.monitor) {
    monitorSinks.push(settings.monitorSlackWebhook ? 'Slack' : null, settings.sheetWebhook ? 'Google Sheet' : null);
  }
  const sinks = monitorSinks.filter(Boolean);
  const monitorCard = `<div class="card">
    <div class="card-h"><h2>Change monitor</h2>${badge(settings.monitor ? 'Active' : 'Off', settings.monitor ? 'ok' : 'idle')}</div>
    <div class="pad" style="padding-top:16px">
      <p class="muted" style="margin:0 0 12px;font-size:13px">
        ${settings.monitor
          ? `Logging who changes a product’s status, and who adds or deletes products and collections${sinks.length ? ` — to ${esc(sinks.join(' and '))}.` : '. Add a Slack or Google Sheet in Settings to get notified.'}`
          : 'Turn this on in Settings to see who changes, adds, or deletes products and collections.'}
      </p>
      <a href="/settings" style="text-decoration:none"><button class="ghost">Open settings</button></a>
    </div>
  </div>`;

  const rail = `
    <div class="card">
      <div class="card-h"><h2>Automations</h2><span class="faint">${onCount} of ${feat.length} on</span></div>
      <div class="auto">${featRows}</div>
    </div>
    ${ringCard}
    ${monitorCard}`;

  const onboarding = settings.sort ? '' : `<div class="callout" style="margin-bottom:18px"><div class="ct">
    <b>Turn on sorting to get started.</b> Sold-out products will sink to the bottom of every collection automatically. <a href="/settings" style="color:var(--accent-ink);font-weight:600">Go to Settings →</a>
  </div></div>`;

  const feedMeta = settings.monitor
    ? (activity.length ? `<a href="/activity" style="text-decoration:none;color:var(--accent-ink);font-weight:600">View all &rarr;</a>` : '')
    : `<a href="/settings" style="text-decoration:none;color:var(--accent-ink);font-weight:600">Turn on monitoring</a>`;

  const activityCard = `<div class="card">
    <div class="card-h">${'<h2>Recent activity</h2>'}<span class="faint">${feedMeta}</span></div>
    ${settings.monitor
      ? activityFeed(activity.slice(0, 10))
      : `<div class="empty">The change monitor is off.<div class="faint" style="margin-top:6px">Turn it on in Settings to see who changes, adds, or deletes products and collections — right here.</div></div>`}
  </div>`;

  const enginePill = `<span class="livechip"><span class="d"></span><span class="t">Engine running &middot; last run <b>${esc(relTime(state.lastRun))}</b></span></span>`;

  const body = `
  <div class="pagehead rise">
    <h1>Dashboard</h1>
    <p>Everything ${esc(APP_NAME)} is doing for your store — sorting, back-in-stock, the change monitor, and your AI assistant.</p>
    ${enginePill}
  </div>
  ${saleReminderBanner(activeSaleReminder())}
  ${onboarding}
  ${stats}
  <div class="layout">
    <div class="grid rise" style="gap:18px;--d:230ms">${trendCard}${activityCard}</div>
    <div class="grid rise" style="gap:18px;--d:300ms">${rail}</div>
  </div>

  <style>
    .auto{display:flex;flex-direction:column;margin:-4px 0}
    .arow{display:flex;align-items:center;gap:13px;padding:14px 26px}
    .arow+.arow{border-top:1px solid var(--line-2)}
    .atog{width:36px;height:21px;border-radius:999px;flex:none;position:relative;background:var(--line);transition:background .2s}
    .atog::after{content:"";position:absolute;top:3px;left:3px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .25s cubic-bezier(.2,.7,.2,1)}
    .atog.on{background:var(--accent)} .atog.on::after{transform:translateX(15px)}
    .amain{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
    .arow .aname{font-size:13.5px;font-weight:550}
    .arow .asub{font-size:11.5px;color:var(--faint)}
    .astat{margin-left:auto;font-size:11px;font-weight:650;color:var(--accent-ink);display:inline-flex;align-items:center;gap:5px}
    .astat.off{color:var(--faint)}
    .astat .d{width:6px;height:6px;border-radius:50%;background:var(--accent)}
    .astat.off .d{background:var(--faint)}
  </style>`;

  setPageHeaders(res);
  res.end(shell({ title: 'Dashboard', active: 'home', body }));
}

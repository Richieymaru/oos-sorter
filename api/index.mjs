import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { loadMonitorState } from '../monitor-state.mjs';
import { recentActivity } from '../monitor.mjs';
import { loadMonitorLog, monitorTag, fetchSheetActivity } from '../monitor-log.mjs';
import { loadNotified, deriveStats } from '../notified.mjs';
import { fetchAllCollectionHandles } from '../sort-oos.mjs';
import {
  shell, setPageHeaders, statCard, badge, activityFeed, funnelsBody, areaChart,
  relTime, esc, notConnectedBody, shopOf, APP_NAME,
} from '../ui.mjs';
import { requireAuth } from './_auth.mjs';
import { assistantReply } from '../assistant.mjs';
import { fetchOrders, fetchAbandonedCheckouts } from '../orders.mjs';
import { analyzeFunnels, analyzeCheckout, checkoutInsights, resolveRange } from '../funnels.mjs';

export const config = { maxDuration: 30 };

const ICON_BOX = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 2.5 3.5 6v8l6.5 3.5L16.5 14V6L10 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_LAYERS = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 3 3 6.5 10 10l7-3.5L10 3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3.5 10 10 13.3 16.5 10" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_PULSE = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M2 10h3l2-5 3 10 2.5-7L17 10h1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

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
      const [ordRes, abRes] = await Promise.all([
        fetchOrders({ since: win.since, until: win.until }),
        fetchAbandonedCheckouts({ since: win.since, until: win.until }).catch(() => ({ abandoned: [], count: 0 })),
      ]);
      const analysis = analyzeFunnels(ordRes.orders, { tier: ordRes.tier, since: win.since, until: win.until });
      const checkout = analyzeCheckout(ordRes.orders, abRes.abandoned, abRes.count, { currency: analysis.currency });
      checkout.insights = checkoutInsights(checkout);
      body = funnelsBody({ analysis, checkout, window: win });
    } catch (e) {
      console.error('funnels: fetch failed —', e.message);
      body = funnelsBody({ error: 'Order data is temporarily unavailable. If this persists, check that read_orders is granted on the store.' });
    }
    setPageHeaders(res);
    res.end(shell({ title: 'Funnels', active: 'funnels', body }));
    return;
  }

  let settings, state, handles, monitor, notified, activity;
  try {
    [settings, state, handles, monitor, notified] = await Promise.all([
      loadSettings(),
      loadState(),
      fetchAllCollectionHandles().catch(() => []),
      loadMonitorState().catch(() => ({ titles: {} })),
      loadNotified().catch(() => []),
    ]);
    if (settings.monitor) {
      // Prefer the Google Sheet — it holds the FULL rich history (old AND new),
      // the same data the merchant sees in the Sheet/Slack. Fall back to the
      // in-app metafield log, then to Shopify's bare live event log.
      let items = settings.sheetWebhook
        ? await fetchSheetActivity(settings.sheetWebhook, 18).catch(() => null)
        : null;
      if (!items || !items.length) {
        const logged = await loadMonitorLog().catch(() => []);
        if (logged.length) {
          const shop = process.env.SHOP_DOMAIN;
          items = logged.slice(0, 18).map((r) => {
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
          items = await recentActivity(18, monitor.titles || {}).catch(() => []);
        }
      }
      activity = items;
    } else {
      activity = [];
    }
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

  // --- Assistant hero (the new AI feature) — opens the floating chat widget. ---
  const heroChip = (q) => `<button type="button" class="ahero-chip" onclick="window.oosChat&&window.oosChat.ask(${JSON.stringify(q)})">${esc(q)}</button>`;
  const assistantHero = `<div class="ahero">
    <div class="ahero-txt">
      <div class="ahero-eyebrow">✨ New · AI Assistant</div>
      <h2>Ask your store anything</h2>
      <p>It knows the app and sees your live data — sold-out, waitlists, and who changed what. Ask it what to focus on — the chat button is always in the corner.</p>
      <div class="ahero-chips">
        ${heroChip('How many products are sold out?')}
        ${heroChip('Who changed product statuses recently?')}
        ${heroChip('What should I focus on this week?')}
      </div>
    </div>
    <button type="button" class="ahero-cta primary" onclick="window.oosChat&&window.oosChat.open()">Open Assistant →</button>
  </div>`;

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
    ? `${activity.length ? 'live from your store' : ''}`
    : `<a href="/settings" style="text-decoration:none;color:var(--accent-ink);font-weight:600">Turn on monitoring</a>`;

  const activityCard = `<div class="card">
    <div class="card-h">${'<h2>Recent activity</h2>'}<span class="faint">${feedMeta}</span></div>
    ${settings.monitor
      ? activityFeed(activity)
      : `<div class="empty">The change monitor is off.<div class="faint" style="margin-top:6px">Turn it on in Settings to see who changes, adds, or deletes products and collections — right here.</div></div>`}
  </div>`;

  const enginePill = `<span class="livechip"><span class="d"></span><span class="t">Engine running &middot; last run <b>${esc(relTime(state.lastRun))}</b></span></span>`;

  const body = `
  <div class="pagehead rise">
    <h1>Dashboard</h1>
    <p>Everything ${esc(APP_NAME)} is doing for your store — sorting, back-in-stock, the change monitor, and your AI assistant.</p>
    ${enginePill}
  </div>
  ${onboarding}
  <div class="rise">${assistantHero}</div>
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
    .ahero{display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:linear-gradient(120deg,var(--accent-wash),var(--surface) 72%);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin-bottom:18px;box-shadow:var(--shadow-sm)}
    .ahero-eyebrow{font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--accent-ink);text-transform:uppercase;margin-bottom:7px}
    .ahero-txt{min-width:250px;flex:1}
    .ahero-txt h2{font-family:var(--display);margin:0 0 5px;font-size:20px;font-weight:700;letter-spacing:-.02em}
    .ahero-txt p{margin:0 0 12px;color:var(--muted);font-size:13.5px;max-width:58ch}
    .ahero-chips{display:flex;flex-wrap:wrap;gap:8px}
    .ahero-chip{font:inherit;font-size:12.5px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);text-decoration:none;cursor:pointer;transition:background .15s,color .15s}
    .ahero-chip:hover{background:var(--hover);color:var(--ink)}
    .ahero-cta{flex:none;text-decoration:none;cursor:pointer}
  </style>`;

  setPageHeaders(res);
  res.end(shell({ title: 'Dashboard', active: 'home', body }));
}

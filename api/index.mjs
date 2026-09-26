import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { loadMonitorState } from '../monitor-state.mjs';
import { recentActivity } from '../monitor.mjs';
import { loadMonitorLog, monitorTag, fetchSheetActivity } from '../monitor-log.mjs';
import { loadNotified, deriveStats } from '../notified.mjs';
import { fetchAllCollectionHandles } from '../sort-oos.mjs';
import {
  shell, setPageHeaders, statCard, badge, activityFeed, assistantBody,
  relTime, esc, notConnectedBody, shopOf, APP_NAME,
} from '../ui.mjs';
import { requireAuth } from './_auth.mjs';
import { assistantReply } from '../assistant.mjs';

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

  // --- Assistant page (GET /assistant) ---
  if (param(req, 'view') === 'assistant') {
    setPageHeaders(res);
    res.end(shell({ title: 'Assistant', active: 'assistant', body: assistantBody() }));
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

  // --- stat cards ---
  const stats = `<div class="grid c4">
    ${statCard({ value: soldOut, label: 'Sold out now', sub: 'kept at the bottom', tone: soldOut ? 'warn' : '', icon: ICON_BOX })}
    ${statCard({ value: handles.length || '—', label: 'Collections', sub: settings.sort ? 'auto-sorted' : 'sorting off', icon: ICON_LAYERS })}
    ${statCard({ value: settings.waitlist ? wl.notified : '—', label: 'Waitlist notified', sub: settings.waitlist ? `${wl.clickRate}% clicked through` : 'waitlist off', tone: settings.waitlist && wl.clicked ? 'pos' : '', icon: ICON_BELL })}
    ${statCard({ value: settings.monitor ? changesToday : '—', label: 'Changes today', sub: settings.monitor ? 'tracked by the monitor' : 'monitor off', tone: settings.monitor && changesToday ? 'pos' : '', icon: ICON_PULSE })}
  </div>`;

  // --- Assistant hero (the new AI feature) ---
  const heroChip = (q) => `<a class="ahero-chip" href="/assistant?q=${encodeURIComponent(q)}">${esc(q)}</a>`;
  const assistantHero = `<div class="ahero">
    <div class="ahero-txt">
      <div class="ahero-eyebrow">✨ New · AI Assistant</div>
      <h2>Ask your store anything</h2>
      <p>It knows the app and sees your live data — sold-out, waitlists, and who changed what. Ask it what to focus on.</p>
      <div class="ahero-chips">
        ${heroChip('How many products are sold out?')}
        ${heroChip('Who changed product statuses recently?')}
        ${heroChip('What should I focus on this week?')}
      </div>
    </div>
    <a href="/assistant" class="ahero-cta"><button class="primary">Open Assistant →</button></a>
  </div>`;

  // --- automations rail ---
  const feat = [
    { on: settings.sort, label: 'Sort sold-out to bottom' },
    { on: settings.notify, label: 'Sold-out email alerts' },
    { on: settings.waitlist, label: 'Back-in-stock waitlist' },
    { on: settings.monitor, label: 'Product change monitor' },
    { on: settings.draft, label: 'Draft sold-out products' },
  ];
  const featRows = feat.map((f) =>
    `<div class="autorow"><span class="autodot ${f.on ? 'on' : ''}"></span>
      <span class="autoname">${esc(f.label)}</span>
      ${badge(f.on ? 'On' : 'Off', f.on ? 'ok' : 'idle')}</div>`
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

  const waitlistCard = `<div class="card">
    <div class="card-h"><h2>Waitlist</h2>${badge(settings.waitlist ? 'On' : 'Off', settings.waitlist ? 'ok' : 'idle')}</div>
    <div class="pad" style="padding-top:16px">
      ${settings.waitlist
        ? `<p class="muted" style="margin:0 0 12px;font-size:13px"><b style="color:var(--ink)">${wl.notified}</b> notified recently · <b style="color:var(--ink)">${wl.clicked}</b> clicked (${wl.clickRate}%) · <b style="color:var(--ink)">${wl.nudged}</b> nudged.</p>
           <a href="/waitlists" style="text-decoration:none"><button class="ghost">View waitlists</button></a>`
        : `<p class="muted" style="margin:0 0 12px;font-size:13px">Let shoppers get an email when a sold-out product returns — with click-through tracking and auto-nudges.</p>
           <a href="/settings" style="text-decoration:none"><button class="ghost">Turn on in Settings</button></a>`}
    </div>
  </div>`;

  const rail = `
    <div class="card">
      <div class="card-h"><h2>Automations</h2><a href="/settings" class="faint" style="text-decoration:none">Manage</a></div>
      <div class="pad" style="padding-top:8px;padding-bottom:8px">${featRows}</div>
    </div>
    ${waitlistCard}
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

  const enginePill = `<span class="engine-pill"><span class="d"></span> Engine running · last run ${esc(relTime(state.lastRun))}</span>`;

  const body = `
  <div class="pagehead">
    <h1>Dashboard</h1>
    <p>Everything ${esc(APP_NAME)} is doing for your store — sorting, back-in-stock, the change monitor, and your AI assistant.</p>
    ${enginePill}
  </div>
  ${onboarding}
  ${assistantHero}
  ${stats}
  <div class="layout">
    <div>${activityCard}</div>
    <div class="grid" style="gap:16px">${rail}</div>
  </div>

  <style>
    .autorow{display:flex;align-items:center;gap:10px;padding:9px 0}
    .autorow+.autorow{border-top:1px solid var(--line-2)}
    .autoname{font-size:13.5px;font-weight:500;flex:1}
    .autodot{width:8px;height:8px;border-radius:50%;background:var(--line);flex:none}
    .autodot.on{background:var(--accent)}
    .engine-pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);margin-top:9px}
    .engine-pill .d{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-wash)}
    .ahero{display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:linear-gradient(120deg,var(--accent-wash),var(--surface) 72%);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin-bottom:18px;box-shadow:var(--shadow-sm)}
    .ahero-eyebrow{font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--accent-ink);text-transform:uppercase;margin-bottom:7px}
    .ahero-txt{min-width:250px;flex:1}
    .ahero-txt h2{margin:0 0 5px;font-size:19px;letter-spacing:-.02em}
    .ahero-txt p{margin:0 0 12px;color:var(--muted);font-size:13.5px;max-width:58ch}
    .ahero-chips{display:flex;flex-wrap:wrap;gap:8px}
    .ahero-chip{font-size:12.5px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);text-decoration:none;transition:background .15s,color .15s}
    .ahero-chip:hover{background:var(--hover);color:var(--ink)}
    .ahero-cta{flex:none;text-decoration:none}
  </style>`;

  setPageHeaders(res);
  res.end(shell({ title: 'Dashboard', active: 'home', body }));
}

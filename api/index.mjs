import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { loadMonitorState } from '../monitor-state.mjs';
import { recentActivity } from '../monitor.mjs';
import { fetchAllCollectionHandles } from '../sort-oos.mjs';
import {
  shell, setPageHeaders, statCard, badge, activityFeed,
  relTime, esc, notConnectedBody, shopOf, APP_NAME,
} from '../ui.mjs';

export const config = { maxDuration: 30 };

const ICON_BOX = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 2.5 3.5 6v8l6.5 3.5L16.5 14V6L10 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_LAYERS = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 3 3 6.5 10 10l7-3.5L10 3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3.5 10 10 13.3 16.5 10" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_PULSE = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M2 10h3l2-5 3 10 2.5-7L17 10h1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

const isToday = (iso) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

export default async function handler(req, res) {
  let settings, state, handles, monitor, activity;
  try {
    [settings, state, handles, monitor] = await Promise.all([
      loadSettings(),
      loadState(),
      fetchAllCollectionHandles().catch(() => []),
      loadMonitorState().catch(() => ({ titles: {} })),
    ]);
    activity = settings.monitor ? await recentActivity(18, monitor.titles || {}).catch(() => []) : [];
  } catch (e) {
    console.error('index: not connected —', e.message);
    setPageHeaders(res);
    res.end(shell({ title: 'Dashboard', active: 'home', body: notConnectedBody(shopOf(req)) }));
    return;
  }

  const soldOut = (state.soldOut || []).length;
  const changesToday = activity.filter((a) => isToday(a.iso)).length;

  // --- stat cards ---
  const engineCard = `<div class="card stat">
    <span class="stat-ico">${ICON_PULSE}</span>
    <div class="statval" style="font-size:19px;display:flex;align-items:center;height:34px">
      ${badge('Running', 'ok').replace('badge ok">', 'badge ok"><span class="d"></span>')}
    </div>
    <div class="statlabel">Engine status</div>
    <div class="statsub">last run ${esc(relTime(state.lastRun))}</div>
  </div>`;

  const stats = `<div class="grid c4">
    ${statCard({ value: soldOut, label: 'Sold out now', sub: 'kept at the bottom', tone: soldOut ? 'warn' : '', icon: ICON_BOX })}
    ${statCard({ value: handles.length || '—', label: 'Collections', sub: settings.sort ? 'auto-sorted' : 'sorting off', icon: ICON_LAYERS })}
    ${statCard({ value: settings.monitor ? changesToday : '—', label: 'Changes today', sub: settings.monitor ? 'tracked by the monitor' : 'monitor off', tone: settings.monitor && changesToday ? 'pos' : '' })}
    ${engineCard}
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

  const rail = `
    <div class="card">
      <div class="card-h"><h2>Automations</h2><a href="/settings" class="faint" style="text-decoration:none">Manage</a></div>
      <div class="pad" style="padding-top:8px;padding-bottom:8px">${featRows}</div>
    </div>
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

  const body = `
  <div class="pagehead">
    <h1>Dashboard</h1>
    <p>Everything ${esc(APP_NAME)} is doing for your store — sorting, alerts, and who’s changing what.</p>
  </div>
  ${onboarding}
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
  </style>`;

  setPageHeaders(res);
  res.end(shell({ title: 'Dashboard', active: 'home', body }));
}

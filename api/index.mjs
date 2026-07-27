import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { fetchAllCollectionHandles } from '../sort-oos.mjs';
import { shell, setPageHeaders, statCard, badge, relTime, esc, notConnectedBody, shopOf } from '../ui.mjs';

export default async function handler(req, res) {
  let settings, state, handles;
  try {
    [settings, state, handles] = await Promise.all([
      loadSettings(),
      loadState(),
      fetchAllCollectionHandles().catch(() => []),
    ]);
  } catch (e) {
    // No valid token yet (app not installed / not authorized on this shop).
    console.error('index: not connected —', e.message);
    setPageHeaders(res);
    res.end(shell({ title: 'Dashboard', active: 'home', body: notConnectedBody(shopOf(req)) }));
    return;
  }
  const soldOut = (state.soldOut || []).length;
  const feat = [
    { on: settings.sort, label: 'Sort to bottom' },
    { on: settings.notify, label: 'Daily digest' },
    { on: settings.draft, label: 'Draft sold-out' },
  ];
  const featBadges = feat
    .map((f) => badge(`${f.on ? '' : 'Off · '}${f.label}`, f.on ? 'ok' : 'idle'))
    .join(' ');

  const onboarding = settings.sort
    ? ''
    : `<div class="card pad" style="margin-bottom:16px">
        <b>Turn on sorting to get started.</b>
        <p class="muted" style="margin:6px 0 12px">Sold-out products will sink to the bottom of every collection, automatically.</p>
        <a href="/settings"><button class="primary">Go to Settings</button></a>
      </div>`;

  const body = `
  <div class="pagehead">
    <h1>Dashboard</h1>
    <p>Keeps sold-out products at the bottom of your collections — automatically.</p>
  </div>
  ${onboarding}
  <div class="grid c3">
    ${statCard({ value: soldOut, label: 'Sold out now', sub: 'pushed to the bottom' })}
    ${statCard({ value: handles.length || '—', label: 'Collections', sub: settings.sort ? 'auto-sorted' : 'sorting off' })}
    <div class="card stat">
      <div class="statval" style="font-size:20px">${badge('Running', 'ok').replace('<span class="badge ok">', '<span class="badge ok"><span class="d"></span>')}</div>
      <div class="statlabel">Engine status</div>
      <div class="statsub">last run ${esc(relTime(state.lastRun))}</div>
    </div>
  </div>

  <p class="eyebrow">Automations</p>
  <div class="card pad" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="display:flex;gap:8px;flex-wrap:wrap">${featBadges}</div>
    <a href="/settings" style="margin-left:auto;text-decoration:none"><button class="ghost">Manage</button></a>
  </div>

  <p class="eyebrow">Why it's different</p>
  <div class="callout"><div class="ct">
    <b>Sorted by what your store can actually sell.</b> A product stocked only at a warehouse your online store doesn't ship from counts as sold out — just like the storefront shows it. And it reacts <b>within seconds</b> of a stock change, not on a slow timer.
  </div></div>`;

  setPageHeaders(res);
  res.end(shell({ title: 'Dashboard', active: 'home', body }));
}

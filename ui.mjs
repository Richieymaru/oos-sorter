/**
 * Shared UI shell + design system for the GBU Store Ops control panel.
 *
 * Clean, modern SaaS admin that sits comfortably embedded in the Shopify admin,
 * with a full auto dark mode (prefers-color-scheme). Pure string rendering — no
 * framework, no build step. Class names are kept stable so the Collections,
 * Waitlists and Settings pages restyle for free.
 */

/** Brand name shown across the UI + emails. Per-store: set APP_NAME in the env. */
export const APP_NAME = process.env.APP_NAME || 'Orderly';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The brand mark — the "restock cycle": a loop around a live core (sold-out
 *  drops out, back-in-stock pulls shoppers back). Dark tactical neon app-icon,
 *  self-contained (own gradients), crisp on both themes. */
export const mark = `<svg class="mark" width="28" height="28" viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <defs>
    <radialGradient id="mkTile" cx="50%" cy="34%" r="80%"><stop offset="0" stop-color="#113a2b"/><stop offset=".52" stop-color="#0b2019"/><stop offset="1" stop-color="#05100c"/></radialGradient>
    <linearGradient id="mkRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3dffbd" stop-opacity=".8"/><stop offset="1" stop-color="#0a9a68" stop-opacity=".15"/></linearGradient>
    <linearGradient id="mkNeon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eafff5"/><stop offset=".55" stop-color="#27f5a8"/><stop offset="1" stop-color="#0cae77"/></linearGradient>
    <radialGradient id="mkCore" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#f1fff8"/><stop offset=".38" stop-color="#2cffac"/><stop offset="1" stop-color="#07a56e"/></radialGradient>
  </defs>
  <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#mkTile)"/>
  <rect x="2.9" y="2.9" width="42.2" height="42.2" rx="11" fill="none" stroke="url(#mkRim)" stroke-width="1.1"/>
  <g fill="none" stroke="url(#mkNeon)" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.5 19.5 A11 11 0 0 1 32 15.5"/>
    <polyline points="31.5,10.5 33,16 27.5,16.4"/>
    <path d="M33.5 28.5 A11 11 0 0 1 16 32.5"/>
    <polyline points="16.5,37.5 15,32 20.5,31.6"/>
  </g>
  <circle cx="24" cy="24" r="4.4" fill="url(#mkCore)"/>
</svg>`;

/**
 * The sale-event reminder banner: nudges the owner to recover abandoned carts
 * around a big AU sale day. `ev` comes from activeSaleReminder() (or null →
 * nothing). Dismissible per event+year (localStorage). Links to the Funnels
 * abandoned-carts section where the Recover buttons live.
 */
export function saleReminderBanner(ev) {
  if (!ev) return '';
  const timing = ev.daysUntil > 1 ? `in ${ev.daysUntil} days`
    : ev.daysUntil === 1 ? 'tomorrow'
      : ev.daysUntil === 0 ? 'today' : 'on now';
  const approx = ev.approx ? ' <span class="sb-approx">(approx — confirm the date)</span>' : '';
  const tag = `${ev.key}-${new Date(ev.date).getUTCFullYear()}`;
  return `<div class="sale-banner" id="saleBanner" data-ev="${esc(tag)}">
    <span class="sb-ico" aria-hidden="true">🔥</span>
    <div class="sb-txt"><b>${esc(ev.label)} is ${timing}.</b>${approx} A great time to win back abandoned carts — resend recovery emails from Funnels.</div>
    <a href="/funnels" class="sb-cta">Recover abandoned carts</a>
    <button class="sb-x" id="saleBannerX" aria-label="Dismiss reminder">&times;</button>
  </div>
  <style>
    .sale-banner{display:flex;align-items:center;gap:14px;margin:0 0 18px;padding:14px 16px;border-radius:var(--radius);
      background:linear-gradient(120deg,var(--warn-wash),var(--surface) 78%);border:1px solid color-mix(in srgb,var(--warn) 32%,var(--line));box-shadow:var(--shadow-sm)}
    .sb-ico{font-size:20px;flex:none;line-height:1}
    .sb-txt{flex:1;min-width:0;font-size:13.5px;line-height:1.5;color:var(--ink)}
    .sb-txt b{font-weight:650}
    .sb-approx{color:var(--muted);font-weight:500;font-size:12px}
    .sb-cta{flex:none;text-decoration:none;font-weight:600;font-size:13px;padding:9px 15px;border-radius:var(--radius-sm);
      background:var(--warn,#b5761b);color:#fff;white-space:nowrap}
    .sb-cta:hover{filter:brightness(1.06)}
    .sb-x{flex:none;background:none;border:none;font-size:22px;line-height:1;color:var(--faint);cursor:pointer;padding:0 2px}
    .sb-x:hover{color:var(--ink)}
    @media (max-width:560px){.sale-banner{flex-wrap:wrap}.sb-cta{order:3}.sb-txt{flex-basis:100%}}
  </style>
  <script>(function(){ try{ var b=document.getElementById('saleBanner'); if(!b) return; var k='oos_sale_'+b.dataset.ev;
    if(localStorage.getItem(k)==='1'){ b.style.display='none'; return; }
    var x=document.getElementById('saleBannerX'); if(x) x.addEventListener('click', function(){ b.style.display='none'; try{ localStorage.setItem(k,'1'); }catch(e){} });
  }catch(e){} })();</script>`;
}

/**
 * A client-side "show N, then Show more" pager for a list already in the DOM.
 * `containerId` holds the items; `itemSel` selects them within it (e.g. 'tr',
 * '.feed-item', ':scope > .card'). Shows `pageSize` first, revealing +pageSize
 * per click. Pure markup + a scoped script; keeps everything in the DOM (fast).
 */
export function paginator(containerId, pageSize, itemSel) {
  const id = JSON.stringify(containerId);
  const sel = JSON.stringify(itemSel);
  return `<div class="pager" id="pg_${esc(containerId)}" style="display:none;align-items:center;justify-content:space-between;gap:12px;padding:14px 4px 2px;border-top:1px solid var(--line-2);margin-top:8px">
    <span class="faint" id="pgc_${esc(containerId)}" style="font-size:12.5px"></span>
    <button class="ghost" type="button" id="pgm_${esc(containerId)}">Show more</button>
  </div>
  <script>(function(){
    var c=document.getElementById(${id}); if(!c) return;
    var items=[].slice.call(c.querySelectorAll(${sel}));
    var ps=${Number(pageSize) || 10}, shown=ps;
    var pager=document.getElementById('pg_'+${id}), cnt=document.getElementById('pgc_'+${id}), more=document.getElementById('pgm_'+${id});
    function render(){ for(var i=0;i<items.length;i++){ items[i].style.display = i<shown ? '' : 'none'; } var sh=Math.min(shown,items.length); if(cnt) cnt.textContent='Showing '+sh+' of '+items.length; if(more) more.style.display= sh<items.length?'':'none'; if(pager) pager.style.display= items.length>ps?'flex':'none'; }
    if(more) more.addEventListener('click', function(){ shown+=ps; render(); });
    render();
  })();</script>`;
}

/** A status badge. tone: 'ok' | 'warn' | 'idle' | 'info' | 'danger'. */
export function badge(label, tone = 'ok') {
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

/** A stat card: big value + label + optional sub, with an optional accent tone. */
export function statCard({ value, label, sub = '', tone = '', icon = '' }) {
  return `<div class="card stat${tone ? ' t-' + tone : ''}">
    ${icon ? `<span class="stat-ico">${icon}</span>` : ''}
    <div class="statval">${value}</div>
    <div class="statlabel">${esc(label)}</div>
    ${sub ? `<div class="statsub">${sub}</div>` : ''}
  </div>`;
}

/**
 * A server-rendered SVG area chart with a draw-in animation. `series` is
 * [{ d: 'YYYY-MM-DD', n: number }]. Returns '' for fewer than 2 points so the
 * caller can show a "collecting data" state instead. Real data only — no fill.
 */
export function areaChart(series, { w = 600, h = 176, pad = 20 } = {}) {
  const pts = (series || []).filter((p) => p && p.d != null && Number.isFinite(Number(p.n)));
  if (pts.length < 2) return '';
  const n = pts.length;
  const max = Math.max(...pts.map((p) => Number(p.n)), 1);
  const base = h - 36, top = 20;
  const x = (i) => pad + (i * (w - 2 * pad)) / (n - 1);
  const y = (v) => base - (Number(v) / max) * (base - top);
  const coords = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.n).toFixed(1)}`);
  const line = 'M' + coords.join(' L');
  const area = `${line} L${x(n - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
  const last = pts[n - 1];
  // Axis labels: format ISO dates nicely; pass through any other label as-is
  // (the Funnels trend already labels its buckets, e.g. "Oct 5" or "Oct").
  const fmtD = (s) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `<svg class="area" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Sold-out products per day over time.">
    <defs><linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity=".26"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    <line x1="${pad}" y1="${base}" x2="${w - pad}" y2="${base}" stroke="var(--line)" stroke-width="1"/>
    <path class="afill" d="${area}" fill="url(#areafill)"/>
    <path class="aline" d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="aend" cx="${x(n - 1).toFixed(1)}" cy="${y(last.n).toFixed(1)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    <text class="axis" x="${pad}" y="${h - 6}">${esc(fmtD(pts[0].d))}</text>
    <text class="axis" x="${w - pad}" y="${h - 6}" text-anchor="end">${esc(fmtD(last.d))}</text>
  </svg>`;
}

/**
 * A conversion donut: a single accent arc over a faint track, with a big centre
 * label and a small caption. Animates (draw-in) via the global load script.
 * `percent` 0–100. Reusable across Dashboard + Funnels.
 */
export function ring(percent, centerBig, centerSmall, { size = 128 } = {}) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  const CIRC = 326.7; // 2πr, r=52
  const arc = `${(p / 100 * CIRC).toFixed(1)} ${CIRC}`;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 132 132" aria-hidden="true">
      <circle cx="66" cy="66" r="52" fill="none" stroke="var(--line)" stroke-width="13"/>
      <circle class="rarc" cx="66" cy="66" r="52" fill="none" stroke="var(--accent)" stroke-width="13" stroke-linecap="round" transform="rotate(-90 66 66)" style="--arc:${arc}"/>
    </svg>
    <div class="cx"><b class="tnum">${esc(centerBig)}</b><span>${esc(centerSmall)}</span></div>
  </div>`;
}

/** A section header: a title with optional right-aligned meta/action. */
export function sectionHead(title, meta = '') {
  return `<div class="sechead"><h2>${esc(title)}</h2>${meta ? `<div class="sechead-meta">${meta}</div>` : ''}</div>`;
}

// ---- Activity feed -------------------------------------------------------
const ACTION_META = {
  create: { label: 'Added', tone: 'pos' },
  destroy: { label: 'Deleted', tone: 'danger' },
  published: { label: 'Published', tone: 'pos' },
  unpublished: { label: 'Unpublished', tone: 'warn' },
  update: { label: 'Updated', tone: 'neutral' },
};
const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');
const ICON_PRODUCT = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none"><path d="M10 2.6 3.5 6v8l6.5 3.4 6.5-3.4V6L10 2.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.6 6.1 10 9.4l6.4-3.3M10 9.4v7.8" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const ICON_COLLECTION = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none"><rect x="3" y="4" width="14" height="4" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="11" width="14" height="4" rx="1.4" stroke="currentColor" stroke-width="1.4"/></svg>`;

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// stable-ish hue from the name so each actor gets a consistent avatar colour
function hueOf(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Render the recent-activity feed from monitor.recentActivity() items. */
export function activityFeed(items) {
  if (!items || !items.length) {
    return `<div class="empty">No product or collection changes yet.
      <div class="faint" style="margin-top:6px">Status changes, new items and deletions will appear here as they happen.</div></div>`;
  }
  return `<ul class="feed">` + items.map((it) => {
    // A rich row (from the persisted monitor log) carries its own label/tone —
    // e.g. "Draft → Active" — matching the Slack read; otherwise fall back to the
    // raw Shopify event action.
    const m = it.label ? { label: it.label, tone: it.tone || 'neutral' } : (ACTION_META[it.action] || { label: cap(it.action), tone: 'neutral' });
    const ico = it.type === 'Collection' ? ICON_COLLECTION : ICON_PRODUCT;
    const title = it.href
      ? `<a href="${esc(it.href)}" target="_top" class="feed-link">${esc(it.title)}</a>`
      : esc(it.title);
    const who = it.who ? esc(it.who) : 'unknown';
    const stockChip = it.stock != null && it.stock !== ''
      ? `<span class="mstock" style="color:var(--muted)">stock ${esc(it.stock)}</span>`
      : '';
    return `<li class="feed-item">
      <span class="feed-ico t-${m.tone}" aria-hidden="true">${ico}</span>
      <span class="feed-main">
        <span class="feed-title">${title} <span class="tag t-${m.tone}">${esc(m.label)}</span></span>
        <span class="feed-meta"><span>${esc(it.type)}</span><span class="mwho">${who}</span>${stockChip}</span>
      </span>
      <span class="feed-side">
        <span class="feed-time">${esc(relTime(it.iso))}</span>
        <span class="avatar" style="--h:${hueOf(it.who)}" title="${who}">${esc(initialsOf(it.who))}</span>
      </span>
    </li>`;
  }).join('') + `</ul>`;
}

const CSS = `
  :root{
    --bg:#f4f6f8; --surface:#ffffff; --surface-2:#fafbfc; --ink:#0e141c; --muted:#5b6572; --faint:#8d97a3;
    --line:#eceff3; --line-2:#f1f4f7; --hover:#f3f5f8;
    --accent-50:#e7f9ef; --accent-100:#c2f0d9; --accent-300:#45d49b;
    --accent:#08b56a; --accent-2:#12c879; --accent-ink:#07764c; --accent-wash:var(--accent-50);
    --pos:#08b56a; --pos-wash:var(--accent-50); --warn:#b5761b; --warn-wash:#fbf1e0;
    --danger:#c5384b; --danger-wash:#fbe9ec; --info:#3667e0; --info-wash:#e9f0fe;
    --neutral:#5a6672; --neutral-wash:#eef1f4;
    --radius:18px; --radius-sm:12px;
    --shadow:0 1px 2px rgba(15,21,32,.04), 0 10px 28px -10px rgba(15,21,32,.12);
    --shadow-sm:0 1px 2px rgba(15,21,32,.05), 0 2px 10px -6px rgba(15,21,32,.07);
    --shadow-lg:0 2px 6px rgba(15,21,32,.06), 0 24px 50px -16px rgba(15,21,32,.16);
    --ring:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent);
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
    --sans:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --display:"Bricolage Grotesque","Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0d1014; --surface:#161b22; --surface-2:#1a2029; --ink:#e8edf3; --muted:#9aa4b1; --faint:#6b7684;
    --line:#232a34; --line-2:#1e252e; --hover:#1c232c;
    --accent-50:#122a20; --accent-100:#19402f; --accent-300:#2ba877;
    --accent:#2ccb8c; --accent-2:#39d89a; --accent-ink:#7fe7bd; --accent-wash:var(--accent-50);
    --pos:#2ccb8c; --pos-wash:var(--accent-50); --warn:#e0b978; --warn-wash:#2a2213;
    --danger:#f08a97; --danger-wash:#331a1f; --info:#8fb0ff; --info-wash:#152139;
    --neutral:#9aa4b1; --neutral-wash:#1e252e;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 12px 30px -10px rgba(0,0,0,.5);
    --shadow-sm:0 1px 2px rgba(0,0,0,.35), 0 2px 10px -6px rgba(0,0,0,.4);
    --shadow-lg:0 2px 6px rgba(0,0,0,.4), 0 26px 52px -16px rgba(0,0,0,.6);
    --ring:0 0 0 3px color-mix(in srgb,var(--accent) 24%,transparent);
  }}
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);background-image:radial-gradient(1200px 560px at 50% -220px, color-mix(in srgb,var(--accent) 14%,transparent), transparent 70%);background-attachment:fixed;color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;line-height:1.5;font-size:14px;letter-spacing:-.005em}
  a{color:inherit}
  .mono{font-family:var(--mono)}
  .muted{color:var(--muted)} .faint{color:var(--faint)}
  /* top bar */
  .topbar{background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid var(--line);box-shadow:0 1px 0 color-mix(in srgb,var(--accent) 9%,transparent);position:sticky;top:0;z-index:5}
  .topinner{max-width:1460px;margin:0 auto;padding:0 28px;display:flex;align-items:center;gap:18px;height:60px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.02em;font-size:15.5px}
  .brand .mark{display:block;border-radius:7px}
  nav.tabs{display:flex;gap:2px;margin-left:auto}
  nav.tabs a{padding:8px 14px;border-radius:9px;color:var(--muted);text-decoration:none;font-weight:500;font-size:13.5px;transition:background .15s,color .15s}
  nav.tabs a:hover{background:var(--hover);color:var(--ink)}
  nav.tabs a.on{background:var(--accent-wash);color:var(--accent-ink);font-weight:600}
  /* page */
  main{max-width:1460px;margin:0 auto;padding:40px 28px 88px}
  .pagehead{margin:0 0 26px}
  .pagehead h1{font-family:var(--display);font-size:30px;font-weight:700;letter-spacing:-.03em;margin:0}
  .pagehead p{margin:7px 0 0;color:var(--muted);font-size:14.5px;max-width:60ch}
  /* grids */
  .grid{display:grid;gap:18px}
  .grid.c3{grid-template-columns:repeat(3,1fr)}
  .grid.c4{grid-template-columns:repeat(4,1fr)}
  .layout{display:grid;grid-template-columns:1.7fr 1fr;gap:16px;margin-top:22px;align-items:start}
  @media (max-width:900px){.grid.c4{grid-template-columns:repeat(2,1fr)}.grid.c3{grid-template-columns:1fr}.layout{grid-template-columns:1fr}}
  @media (max-width:520px){.grid.c4{grid-template-columns:1fr}}
  /* cards — borderless; whitespace + soft shadow do the separating */
  .card{background:var(--surface);border:1px solid transparent;border-radius:var(--radius);box-shadow:var(--shadow-sm)}
  .pad{padding:26px}
  .card-h{display:flex;align-items:center;gap:10px;padding:20px 26px;border-bottom:1px solid var(--line-2)}
  .card-h h2{font-family:var(--display);font-size:16px;font-weight:600;margin:0;letter-spacing:-.01em}
  .card-h .faint{margin-left:auto;font-size:12.5px}
  /* stat cards */
  .stat{padding:26px;position:relative;overflow:hidden;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
  .stat:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
  .stat-ico{position:absolute;top:20px;right:20px;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--accent-50);color:var(--accent-ink);opacity:1}
  .statval{font-family:var(--display);font-size:44px;font-weight:700;letter-spacing:-.045em;line-height:1;font-variant-numeric:tabular-nums}
  .statlabel{color:var(--muted);font-size:13.5px;margin-top:9px;font-weight:540}
  .statsub{color:var(--faint);font-size:12px;margin-top:9px}
  .stat.t-pos{border-color:color-mix(in srgb,var(--accent) 30%,var(--line))}
  .stat.t-pos::before,.stat.t-danger::before,.stat.t-warn::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px}
  .stat.t-pos::before{background:var(--accent)} .stat.t-danger::before{background:var(--danger)} .stat.t-warn::before{background:var(--warn)}
  /* section header (in-page) */
  .sechead{display:flex;align-items:baseline;gap:12px;margin:0 2px 12px}
  .sechead h2{font-size:15px;font-weight:650;margin:0;letter-spacing:-.01em}
  .sechead-meta{margin-left:auto;color:var(--faint);font-size:12.5px}
  .eyebrow{font-size:13px;font-weight:600;color:var(--ink);margin:26px 2px 12px;letter-spacing:-.01em}
  /* badges */
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
  .badge.ok{background:var(--pos-wash);color:var(--accent-ink)}
  .badge.warn{background:var(--warn-wash);color:var(--warn)}
  .badge.idle{background:var(--neutral-wash);color:var(--neutral)}
  .badge.info{background:var(--info-wash);color:var(--info)}
  .badge.danger{background:var(--danger-wash);color:var(--danger)}
  .badge .d{width:6px;height:6px;border-radius:50%;background:currentColor}
  @media (prefers-reduced-motion:no-preference){.badge.ok .d{animation:pulse 2.4s ease-out infinite}}
  @keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
  /* callout */
  .callout{display:flex;gap:12px;padding:16px 18px;border-radius:var(--radius);background:var(--accent-wash);border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent-ink)}
  .callout b{color:var(--accent-ink)} .callout .ct{font-size:13.5px;line-height:1.55}
  /* activity feed */
  .feed{list-style:none;margin:0;padding:4px 0}
  .feed-item{display:flex;align-items:center;gap:13px;padding:12px 20px}
  .feed-item+.feed-item{border-top:1px solid var(--line-2)}
  .feed-ico{flex:none;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:var(--neutral-wash);color:var(--neutral)}
  .feed-ico.t-pos{background:var(--pos-wash);color:var(--accent-ink)}
  .feed-ico.t-danger{background:var(--danger-wash);color:var(--danger)}
  .feed-ico.t-warn{background:var(--warn-wash);color:var(--warn)}
  .feed-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
  .feed-title{font-size:13.5px;font-weight:550;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .feed-link{text-decoration:none;color:var(--ink)} .feed-link:hover{color:var(--accent-ink);text-decoration:underline}
  .feed-meta{font-size:12px;color:var(--faint);display:flex;align-items:center}
  .feed-meta .mwho{margin-left:8px;padding-left:8px;border-left:1px solid var(--line);color:var(--muted)}
  .feed-meta .mstock{margin-left:8px;padding-left:8px;border-left:1px solid var(--line)}
  .tag{font-size:10.5px;font-weight:650;padding:2px 7px;border-radius:6px;letter-spacing:.01em;background:var(--neutral-wash);color:var(--neutral)}
  .tag.t-pos{background:var(--pos-wash);color:var(--accent-ink)} .tag.t-danger{background:var(--danger-wash);color:var(--danger)} .tag.t-warn{background:var(--warn-wash);color:var(--warn)}
  .feed-side{flex:none;display:flex;align-items:center;gap:10px}
  .feed-time{font-size:12px;color:var(--faint);white-space:nowrap;font-variant-numeric:tabular-nums}
  .avatar{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#fff;background:hsl(var(--h,210) 42% 46%)}
  @media (max-width:520px){.feed-side .feed-time{display:none}}
  /* table */
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  thead th{text-align:left;color:var(--faint);font-weight:600;font-size:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
  tbody td{padding:13px 16px;border-bottom:1px solid var(--line-2);vertical-align:middle}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:hover td{background:var(--hover)}
  td.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
  .cname{font-weight:550}
  .toolbar{display:flex;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
  .toolbar input{flex:1;font-size:13.5px;padding:9px 12px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
  .toolbar input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
  .empty{padding:44px 20px;text-align:center;color:var(--muted)}
  /* settings controls */
  .row{display:flex;align-items:flex-start;gap:14px;cursor:pointer;margin:0}
  .rows .row{padding:16px 20px}
  .rows .row+.row{border-top:1px solid var(--line-2)}
  .sw{position:absolute;opacity:0;width:0;height:0}
  .track{flex:none;margin-top:2px;width:40px;height:24px;border-radius:999px;background:var(--line);position:relative;transition:background .18s ease}
  .thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.35);transition:transform .18s ease}
  .sw:checked~.track{background:var(--accent)}.sw:checked~.track .thumb{transform:translateX(16px)}
  .sw:focus-visible~.track{outline:2px solid var(--accent);outline-offset:2px}
  .rowtext{display:flex;flex-direction:column;gap:2px}
  .rowtitle{font-size:14.5px;font-weight:560}.rowdesc{font-size:12.5px;color:var(--muted)}
  .actions{margin-top:18px;display:flex;flex-wrap:wrap;align-items:center;gap:12px}
  button{font-family:var(--sans);font-size:14px;font-weight:580;border-radius:var(--radius-sm);cursor:pointer;padding:10px 17px;border:1px solid transparent;transition:filter .15s,background .15s,border-color .15s,box-shadow .15s,transform .08s}
  .primary{background:var(--accent);color:#fff;box-shadow:0 1px 2px rgba(15,21,32,.12),0 5px 14px -8px color-mix(in srgb,var(--accent) 50%,transparent)}
  .primary:hover{filter:brightness(1.05);box-shadow:0 2px 5px rgba(15,21,32,.14),0 10px 22px -8px color-mix(in srgb,var(--accent) 58%,transparent)}
  .primary:active{transform:translateY(1px)}
  .ghost{background:var(--surface);color:var(--ink);border-color:var(--line);box-shadow:var(--shadow-sm)}.ghost:hover{background:var(--hover);border-color:color-mix(in srgb,var(--accent) 28%,var(--line))}
  button:disabled{opacity:.6;cursor:default}
  #msg{font-size:12.5px;color:var(--accent-ink)} #msg.err{color:var(--danger)}
  .pw{margin-top:16px;display:flex;align-items:center;gap:10px}
  .pw input{font-family:var(--mono);font-size:13px;padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);width:190px;max-width:60%}
  .pw label{font-size:12px;color:var(--faint)}
  a:focus-visible,button:focus-visible,.feed-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
  input:focus-visible,textarea:focus-visible,select:focus-visible{outline:none;border-color:var(--accent)!important;box-shadow:var(--ring)}
  .tnum{font-variant-numeric:tabular-nums}
  /* a prominent card for the hero viz */
  .card.hero{box-shadow:var(--shadow-lg)}
  /* ---- orchestrated page-load reveal (one sequence, reduced-motion safe) ---- */
  .rise{opacity:0;transform:translateY(14px)}
  body.go .rise{opacity:1;transform:none;transition:opacity .6s cubic-bezier(.2,.7,.2,1),transform .6s cubic-bezier(.2,.7,.2,1);transition-delay:var(--d,0ms)}
  /* ---- sold-out trend (server-rendered SVG area) ---- */
  svg.area{display:block;width:100%;height:auto}
  .axis{font-family:var(--mono);font-size:9.5px;fill:var(--faint)}
  .aline{stroke-dasharray:var(--len,1);stroke-dashoffset:var(--len,1)}
  body.go .aline{stroke-dashoffset:0;transition:stroke-dashoffset 1.3s cubic-bezier(.3,.7,.2,1) .25s}
  .afill{opacity:0} body.go .afill{opacity:1;transition:opacity .8s ease .9s}
  .aend{opacity:0} body.go .aend{opacity:1;transition:opacity .4s ease 1.4s}
  .trend-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:6px}
  .trend-big{font-family:var(--display);font-weight:700;font-size:38px;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}
  .trend-lab{color:var(--muted);font-size:12.5px;margin-top:4px}
  .trend-note{text-align:right;font-size:12px;color:var(--faint);max-width:46%}
  /* ---- conversion ring (donut) ---- */
  .ring-wrap{display:flex;align-items:center;gap:22px}
  .ring{position:relative;flex:none}
  .ring .cx{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
  .ring .cx b{font-family:var(--display);font-weight:700;font-size:28px;letter-spacing:-.02em;display:block;line-height:1}
  .ring .cx span{color:var(--muted);font-size:11px}
  .rarc{stroke-dasharray:0 999}
  body.go .rarc{stroke-dasharray:var(--arc,0 999);transition:stroke-dasharray 1.1s cubic-bezier(.3,.7,.2,1) .5s}
  .legend{display:flex;flex-direction:column;gap:12px;min-width:0;flex:1}
  .leg{display:flex;align-items:center;gap:9px;font-size:13px}
  .leg .sw{width:9px;height:9px;border-radius:3px;flex:none}
  .leg b{font-weight:650;font-family:var(--display);letter-spacing:-.01em;margin-left:2px}
  .leg .ll{color:var(--muted);margin-left:auto;padding-left:14px;font-size:12px}
  /* ---- live status chip ---- */
  .livechip{display:inline-flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 14px 8px 12px;box-shadow:var(--shadow-sm);font-size:12.5px;font-weight:600;color:var(--ink);margin-top:12px}
  .livechip .d{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}
  .livechip .t{color:var(--muted);font-weight:500}.livechip .t b{color:var(--ink);font-weight:600}
  @media (prefers-reduced-motion:no-preference){.livechip .d{animation:pulse 2.6s ease-out infinite}}
  @media (max-width:560px){.ring-wrap{flex-direction:column;align-items:flex-start}}
  @media (prefers-reduced-motion:reduce){
    .rise{opacity:1!important;transform:none!important;transition:none!important}
    .aline{stroke-dashoffset:0!important}.afill,.aend{opacity:1!important}
    .rarc{stroke-dasharray:var(--arc,0 999)!important}
  }
`;

/** App Bridge tags so pages opened inside the Shopify admin can fetch a session
 *  token (shopify.idToken) — used for password-free auth on the actions. */
export function appBridgeHead() {
  const key = process.env.CLIENT_ID || '';
  return `<meta name="shopify-api-key" content="${esc(key)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`;
}

/** Fonts: Hanken Grotesk (body) + Bricolage Grotesque (display — headings, big
 *  numbers). System fallback degrades cleanly if the CDN is blocked. */
function fontHead() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">`;
}

/** Full HTML document with the shared shell. `active` = 'home'|'collections'|'waitlists'|'settings'. */
export function shell({ title, active = 'home', body }) {
  const tab = (href, key, label) =>
    `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${appBridgeHead()}
${fontHead()}
<title>${esc(title)} · ${esc(APP_NAME)}</title>
<style>${CSS}</style></head><body>
<ui-nav-menu>
  <a href="/" rel="home">Dashboard</a>
  <a href="/collections">Collections</a>
  <a href="/waitlists">Waitlists</a>
  <a href="/notified">Notified</a>
  <a href="/activity">Activity</a>
  <a href="/funnels">Funnels</a>
  <a href="/settings">Settings</a>
  <a href="/preview">Email preview</a>
</ui-nav-menu>
<header class="topbar"><div class="topinner">
  <span class="brand">${mark} ${esc(APP_NAME)}</span>
  <nav class="tabs">
    ${tab('/', 'home', 'Dashboard')}
    ${tab('/collections', 'collections', 'Collections')}
    ${tab('/waitlists', 'waitlists', 'Waitlists')}
    ${tab('/notified', 'notified', 'Notified')}
    ${tab('/activity', 'activity', 'Activity')}
    ${tab('/funnels', 'funnels', 'Funnels')}
    ${tab('/settings', 'settings', 'Settings')}
    ${tab('/preview', 'preview', 'Email preview')}
  </nav>
</div></header>
<main>${body}</main>
${chatWidget()}
<script>
  // Inside the Shopify admin, the nav lives in Shopify's own sidebar (ui-nav-menu
  // above), so hide our in-app top bar to avoid a duplicate. Standalone (direct
  // URL / password) keeps the top bar as the only nav.
  try{ if(typeof shopify!=='undefined' && shopify.idToken){ var t=document.querySelector('.topbar'); if(t) t.style.display='none'; } }catch(e){}
</script>
<script>
  // One orchestrated load sequence: reveal .rise blocks, count up .count numbers,
  // and draw in any .aline chart. Respects prefers-reduced-motion.
  (function(){
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try{ document.querySelectorAll('.aline').forEach(function(l){ l.style.setProperty('--len', l.getTotalLength()); }); }catch(e){}
    function fmt(v, dec){ return dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'); }
    function counts(){
      document.querySelectorAll('.count').forEach(function(el){
        var to = parseFloat(el.getAttribute('data-to')) || 0;
        var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
        if(reduce || !to){ el.textContent = fmt(to, dec); return; }
        var start = performance.now(), dur = 1000;
        function step(now){
          var p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3);
          el.textContent = fmt(to * e, dec);
          if(p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ document.body.classList.add('go'); counts(); }); });
  })();
</script>
</body></html>`;
}

/** The Assistant chat page. Talks to POST /assistant (folded into /api/index). */
export function assistantBody() {
  return `
  <div class="pagehead"><h1>Assistant</h1><p>Ask about your store, the app, or what to focus on. It can see your live data — sold-out products, waitlists, and who changed what.</p></div>
  <div class="card pad">
    <div id="chat" class="chat">
      <div class="msg bot"><div class="bubble">Hi! I'm your store assistant. I can see your live data. Ask me things like <b>“how many products are sold out?”</b> or <b>“what should I focus on this week?”</b></div></div>
    </div>
    <div class="chips" id="suggest">
      <button class="chip" data-q="How many products are sold out right now?">Sold-out count</button>
      <button class="chip" data-q="How is the back-in-stock waitlist doing?">Waitlist status</button>
      <button class="chip" data-q="Who changed product statuses recently, and to what?">Recent changes</button>
      <button class="chip" data-q="Based on my current data, what are the top 3 things I should focus on?">What to focus on</button>
    </div>
    <form id="chatForm" class="chatbar">
      <input id="msg" type="text" placeholder="Ask anything about your store…" autocomplete="off">
      <button class="primary" id="send" type="submit">Send</button>
    </form>
    <div class="pw" style="margin-top:12px">
      <label for="pw">Panel password</label>
      <input type="password" id="pw" placeholder="to chat" autocomplete="current-password">
      <span id="err" class="faint" style="margin-left:6px"></span>
    </div>
  </div>
  <style>
    .chat{display:flex;flex-direction:column;gap:12px;min-height:220px;max-height:52vh;overflow-y:auto;padding:6px 2px 12px}
    .msg{display:flex}.msg.me{justify-content:flex-end}
    .bubble{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
    .msg.bot .bubble{background:var(--hover);color:var(--ink);border-bottom-left-radius:5px}
    .msg.me .bubble{background:var(--accent);color:#fff;border-bottom-right-radius:5px}
    .bubble b{font-weight:600}
    .chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}
    .chip{font-size:12.5px;padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);cursor:pointer}
    .chip:hover{background:var(--hover);color:var(--ink)}
    .chatbar{display:flex;gap:8px}
    .chatbar input{flex:1;padding:11px 13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:14px var(--sans)}
    .typing{color:var(--faint);font-size:13px;padding:2px 4px}
  </style>
  <script>
    var chat=document.getElementById('chat'), form=document.getElementById('chatForm'), input=document.getElementById('msg'),
        send=document.getElementById('send'), pw=document.getElementById('pw'), err=document.getElementById('err');
    var embedded=(typeof shopify!=='undefined' && !!shopify.idToken);
    if(embedded){ var pwd=document.querySelector('.pw'); if(pwd) pwd.style.display='none'; }
    else { try{ pw.value=localStorage.getItem('oos_pw')||''; }catch(e){} }
    var history=[];
    try{ var _q=new URLSearchParams(location.search).get('q'); if(_q){ input.value=_q; setTimeout(function(){ input.focus(); },60); } }catch(e){}
    function esc(s){ var d=document.createElement('div'); d.textContent=String(s==null?'':s); return d.innerHTML; }
    function bubble(role, text){
      var wrap=document.createElement('div'); wrap.className='msg '+(role==='me'?'me':'bot');
      var b=document.createElement('div'); b.className='bubble'; b.textContent=text; wrap.appendChild(b);
      chat.appendChild(wrap); chat.scrollTop=chat.scrollHeight; return b;
    }
    async function authH(){ var h={'Content-Type':'application/json'}; if(embedded){ try{ var t=await shopify.idToken(); if(t){ h['Authorization']='Bearer '+t; return h; } }catch(e){} } h['x-panel-password']=(pw.value||'').trim(); return h; }
    async function ask(q){
      q=(q||'').trim(); if(!q) return;
      if(!embedded && !(pw.value||'').trim()){ err.textContent='Enter the panel password below'; pw.focus(); return; }
      err.textContent=''; input.value=''; send.disabled=true;
      bubble('me', q); history.push({role:'user', text:q});
      var t=document.createElement('div'); t.className='typing'; t.textContent='Thinking…'; chat.appendChild(t); chat.scrollTop=chat.scrollHeight;
      try{
        var r=await fetch('/assistant',{method:'POST',headers:await authH(),body:JSON.stringify({messages:history})});
        var j=await r.json().catch(function(){return{};});
        t.remove();
        if(r.ok && j.ok){
          if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} }
          bubble('bot', j.reply); history.push({role:'assistant', text:j.reply});
        } else if(j.setup){
          bubble('bot', j.error || 'The assistant isn\\u2019t set up yet. Add a free Gemini API key (GEMINI_API_KEY) in the app\\u2019s Vercel environment, then redeploy.');
        } else {
          err.textContent = (r.status===401 ? (embedded?'Not authorized':'Wrong password') : (j.error||'Something went wrong'));
        }
      }catch(e){ t.remove(); err.textContent='Network error'; }
      send.disabled=false; input.focus();
    }
    form.addEventListener('submit', function(e){ e.preventDefault(); ask(input.value); });
    document.querySelectorAll('.chip').forEach(function(c){ c.addEventListener('click', function(){ ask(c.dataset.q); }); });
  </script>`;
}

/**
 * The floating chat widget — a circle button pinned bottom-right on EVERY page
 * (injected by shell()), opening a slide-up chat panel. Same brain as the
 * Assistant page (POST /api/index → assistantReply), but reachable anywhere.
 *
 * Auth, done right this time: "embedded" means we are ACTUALLY inside the
 * Shopify admin iframe (window.top !== window.self) AND App Bridge is present —
 * not merely that its script loaded. On the standalone Vercel URL we are the top
 * window, so we use the panel password. And shopify.idToken() is raced against a
 * 2.5s timeout so it can never hang the send (the old bug: it hung forever on
 * the standalone URL, so the fetch never fired and no reply ever came back).
 */
export function chatWidget() {
  return `
  <button id="cwFab" class="cw-fab" aria-label="Open store assistant" title="Ask the store assistant">
    <svg class="cw-ico-chat" viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 3.5V16H5.5A1.5 1.5 0 0 1 4 14.5v-9Z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><circle cx="9" cy="10" r="1" fill="#fff"/><circle cx="12.5" cy="10" r="1" fill="#fff"/><circle cx="16" cy="10" r="1" fill="#fff"/></svg>
    <svg class="cw-ico-close" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
  </button>
  <div id="cwPanel" class="cw-panel" role="dialog" aria-label="Store assistant" aria-hidden="true">
    <div class="cw-head">
      <span class="cw-title"><span class="cw-dot"></span> Store Assistant</span>
      <button id="cwMin" class="cw-x" aria-label="Close">&times;</button>
    </div>
    <div id="cwChat" class="cw-chat">
      <div class="cw-msg bot"><div class="cw-bubble">Hi! I can see your live store data — sold-out products, waitlists, and who changed what. Ask me anything.</div></div>
    </div>
    <div class="cw-chips" id="cwChips">
      <button class="cw-chip" data-q="How many products are sold out right now?">Sold-out count</button>
      <button class="cw-chip" data-q="How is the back-in-stock waitlist doing?">Waitlist</button>
      <button class="cw-chip" data-q="Who changed product statuses recently, and to what?">Recent changes</button>
      <button class="cw-chip" data-q="Based on my current data, what are the top 3 things I should focus on?">What to focus on</button>
    </div>
    <form id="cwForm" class="cw-bar">
      <input id="cwInput" type="text" placeholder="Ask about your store…" autocomplete="off">
      <button class="cw-send" id="cwSend" type="submit" aria-label="Send">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 12l16-8-6 16-3-6-7-2Z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>
      </button>
    </form>
    <div class="cw-pw" id="cwPwWrap">
      <input type="password" id="cwPw" placeholder="Panel password" autocomplete="current-password">
      <span id="cwErr" class="cw-err"></span>
    </div>
  </div>
  <style>
    .cw-fab{position:fixed;right:22px;bottom:22px;z-index:9998;width:58px;height:58px;border-radius:50%;
      background:var(--accent);border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.14);
      display:flex;align-items:center;justify-content:center;transition:transform .18s ease,filter .15s}
    .cw-fab:hover{filter:brightness(1.07);transform:translateY(-2px)}
    .cw-fab .cw-ico-close{display:none}
    body.cw-open .cw-fab .cw-ico-chat{display:none}
    body.cw-open .cw-fab .cw-ico-close{display:block}
    .cw-panel{position:fixed;right:22px;bottom:92px;z-index:9999;width:380px;max-width:calc(100vw - 32px);
      height:560px;max-height:calc(100vh - 120px);background:var(--surface);border:1px solid var(--line);
      border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;
      opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .18s ease}
    body.cw-open .cw-panel{opacity:1;transform:none;pointer-events:auto}
    .cw-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;
      background:linear-gradient(120deg,var(--accent-wash),var(--surface) 90%);border-bottom:1px solid var(--line-2)}
    .cw-title{display:flex;align-items:center;gap:8px;font-weight:650;font-size:14.5px;color:var(--ink)}
    .cw-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-wash)}
    .cw-x{background:none;border:none;font-size:22px;line-height:1;color:var(--faint);cursor:pointer;padding:0 4px}
    .cw-x:hover{color:var(--ink)}
    .cw-chat{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
    .cw-msg{display:flex}.cw-msg.me{justify-content:flex-end}
    .cw-bubble{max-width:85%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
    .cw-msg.bot .cw-bubble{background:var(--hover);color:var(--ink);border-bottom-left-radius:4px}
    .cw-msg.me .cw-bubble{background:var(--accent);color:#fff;border-bottom-right-radius:4px}
    .cw-bubble b{font-weight:600}
    .cw-typing{color:var(--faint);font-size:12.5px;padding:2px 6px}
    .cw-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px}
    .cw-chip{font-size:11.5px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);cursor:pointer}
    .cw-chip:hover{background:var(--hover);color:var(--ink)}
    .cw-bar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line-2)}
    .cw-bar input{flex:1;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:13.5px var(--sans)}
    .cw-send{flex:none;width:40px;border:none;border-radius:11px;background:var(--accent);cursor:pointer;display:flex;align-items:center;justify-content:center}
    .cw-send:hover{filter:brightness(1.07)}.cw-send:disabled{opacity:.6;cursor:default}
    .cw-pw{display:flex;align-items:center;gap:8px;padding:0 12px 12px}
    .cw-pw input{width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font:12.5px var(--mono)}
    .cw-err{font-size:11.5px;color:var(--danger)}
    @media (max-width:520px){ .cw-panel{right:10px;left:10px;width:auto;bottom:84px;height:calc(100vh - 104px)} .cw-fab{right:16px;bottom:16px} }
    @media (prefers-reduced-motion:reduce){ .cw-fab,.cw-panel{transition:none} }
  </style>
  <script>
  (function(){
    var fab=document.getElementById('cwFab'), panel=document.getElementById('cwPanel'),
        chat=document.getElementById('cwChat'), form=document.getElementById('cwForm'),
        input=document.getElementById('cwInput'), send=document.getElementById('cwSend'),
        pwWrap=document.getElementById('cwPwWrap'), pw=document.getElementById('cwPw'), err=document.getElementById('cwErr');
    if(!fab||!panel) return;
    var inIframe=true; try{ inIframe = window.top !== window.self; }catch(e){ inIframe=true; }
    var embedded = inIframe && (typeof shopify!=='undefined') && !!(shopify && shopify.idToken);
    if(embedded){ pwWrap.style.display='none'; } else { try{ pw.value=localStorage.getItem('oos_pw')||''; }catch(e){} }
    var history=[];

    function openPanel(prefill){
      document.body.classList.add('cw-open'); panel.setAttribute('aria-hidden','false');
      if(prefill){ input.value=prefill; }
      setTimeout(function(){ input.focus(); chat.scrollTop=chat.scrollHeight; }, 60);
    }
    function closePanel(){ document.body.classList.remove('cw-open'); panel.setAttribute('aria-hidden','true'); }
    function toggle(){ document.body.classList.contains('cw-open') ? closePanel() : openPanel(); }
    fab.addEventListener('click', function(){ toggle(); });
    document.getElementById('cwMin').addEventListener('click', closePanel);
    document.addEventListener('keydown', function(e){ if(e.key==='Escape' && document.body.classList.contains('cw-open')) closePanel(); });
    // Global hook so any page element (e.g. the dashboard hero) can open the chat with a question.
    window.oosChat = { open: openPanel, close: closePanel, ask: function(q){ openPanel(); ask(q); } };

    function bubble(role, text){
      var wrap=document.createElement('div'); wrap.className='cw-msg '+(role==='me'?'me':'bot');
      var b=document.createElement('div'); b.className='cw-bubble'; b.textContent=text; wrap.appendChild(b);
      chat.appendChild(wrap); chat.scrollTop=chat.scrollHeight; return b;
    }
    // Race idToken against a timeout so a non-responding App Bridge can never hang the send.
    function idToken(){
      if(!embedded) return Promise.resolve(null);
      return Promise.race([
        Promise.resolve().then(function(){ return shopify.idToken(); }),
        new Promise(function(res){ setTimeout(function(){ res(null); }, 2500); })
      ]).catch(function(){ return null; });
    }
    async function authH(){
      var h={'Content-Type':'application/json'};
      var t=await idToken();
      if(t){ h['Authorization']='Bearer '+t; } else { h['x-panel-password']=(pw.value||'').trim(); }
      return h;
    }
    async function ask(q){
      q=(q||'').trim(); if(!q) return;
      if(!embedded && !(pw.value||'').trim()){ err.textContent='Enter the panel password'; pw.focus(); return; }
      err.textContent=''; input.value=''; send.disabled=true;
      bubble('me', q); history.push({role:'user', text:q});
      var t=document.createElement('div'); t.className='cw-typing'; t.textContent='Thinking…'; chat.appendChild(t); chat.scrollTop=chat.scrollHeight;
      try{
        var r=await fetch('/api/index',{method:'POST',headers:await authH(),body:JSON.stringify({messages:history})});
        var j=await r.json().catch(function(){return{};});
        t.remove();
        if(r.ok && j.ok){
          if(!embedded){ try{ localStorage.setItem('oos_pw',(pw.value||'').trim()); }catch(e){} }
          bubble('bot', j.reply); history.push({role:'assistant', text:j.reply});
        } else if(j.setup){
          bubble('bot', j.error || 'The assistant isn\\u2019t set up yet. Add a free Gemini API key (GEMINI_API_KEY) in Vercel, then redeploy.');
        } else {
          err.textContent = (r.status===401 ? (embedded?'Not authorized':'Wrong password') : (j.error||'Something went wrong'));
        }
      }catch(e){ t.remove(); err.textContent='Network error'; }
      send.disabled=false; input.focus();
    }
    form.addEventListener('submit', function(e){ e.preventDefault(); ask(input.value); });
    document.querySelectorAll('#cwChips .cw-chip').forEach(function(c){ c.addEventListener('click', function(){ ask(c.dataset.q); }); });
    // Deep-link: /?chat=<question> (e.g. from an old /assistant?q= bookmark) opens the chat pre-filled.
    try{ var _q=new URLSearchParams(location.search).get('chat'); if(_q){ setTimeout(function(){ openPanel(_q); }, 120); } }catch(e){}
  })();
  </script>`;
}

/** Money as "AUD 1,234.50". */
function money(currency, amount) {
  const n = Number(amount || 0);
  return `${currency ? currency + ' ' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A horizontal bar breakdown: rows of {label, revenue, orders, share}. */
function barRows(rows, currency, { max = 6 } = {}) {
  if (!rows || !rows.length) return `<div class="empty">No data yet.</div>`;
  const top = rows.slice(0, max);
  const peak = Math.max(...top.map((r) => r.revenue), 1);
  return `<div class="fn-bars">${top.map((r) => `
    <div class="fn-bar">
      <div class="fn-bar-top"><span class="fn-bar-label">${esc(r.label)}</span><span class="fn-bar-val">${esc(money(currency, r.revenue))} · ${r.orders} order${r.orders === 1 ? '' : 's'}</span></div>
      <div class="fn-bar-track"><span class="fn-bar-fill" style="width:${Math.max(3, Math.round((r.revenue / peak) * 100))}%"></span></div>
    </div>`).join('')}</div>`;
}

/** A tiny inline bar sparkline for the order trend (day/week/month buckets). */
function trendSpark(trend) {
  if (!trend || !trend.length) return '';
  const peak = Math.max(...trend.map((d) => d.orders), 1);
  return `<div class="fn-spark" role="img" aria-label="Orders over time">${trend.map((d) => `
    <span class="fn-spark-col" title="${esc(d.label)}: ${d.orders} order${d.orders === 1 ? '' : 's'}">
      <span class="fn-spark-bar" style="height:${Math.max(4, Math.round((d.orders / peak) * 100))}%"></span>
    </span>`).join('')}</div>`;
}

/**
 * The Funnels page. `view` = { analysis, error }.
 * analysis.tier drives what's shown: 'none' (no order access yet), 'base'
 * (revenue/channels/products), 'full' (+ traffic sources & funnel insights).
 */
const FUNNEL_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '14d', label: '14 days' },
  { key: '30d', label: '30 days' },
  { key: '3mo', label: '3 months' },
  { key: '6mo', label: '6 months' },
  { key: '1y', label: '1 year' },
];

function rangeLabel(win) {
  if (!win) return '';
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const since = win.since ? new Date(win.since) : null;
  const until = win.until ? new Date(win.until) : new Date();
  return since ? `${win.label} · ${fmt(since)} – ${fmt(until)}` : (win.label || '');
}

/** Segmented date-range picker — each option links to /funnels?range=KEY. */
function rangePicker(activeKey) {
  return `<div class="fn-ranges" role="tablist" aria-label="Date range">${FUNNEL_RANGES.map((r) =>
    `<a href="/funnels?range=${r.key}" class="fn-range-opt${r.key === activeKey ? ' on' : ''}" role="tab" aria-selected="${r.key === activeKey}">${esc(r.label)}</a>`
  ).join('')}</div>`;
}

// A small product thumbnail (Shopify CDN at 72px) with a neutral placeholder.
const PROD_PH = `<span class="fn-thumb ph" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.5" stroke="currentColor" stroke-width="1.6"/><path d="m5 17 4.5-4.5L13 16l2.5-2.5L20 18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`;
function prodThumb(url) {
  if (!url) return PROD_PH;
  const src = url + (url.includes('?') ? '&' : '?') + 'width=72';
  return `<img class="fn-thumb" src="${esc(src)}" alt="" width="32" height="32" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

export function funnelsBody(view) {
  const { analysis: a, checkout, window: win, error } = view || {};
  const range = rangeLabel(win);
  const picker = rangePicker((win && win.key) || '30d');
  const head = `<div class="pagehead"><h1>Funnels</h1><p>Where your sales come from and where shoppers drop off — channels, traffic sources, best sellers, checkout completion, and where to focus.</p>${range ? `<div class="fn-range">📅 ${esc(range)}</div>` : ''}${picker}</div>${saleReminderBanner((view && view.saleReminder) || null)}`;

  if (error) {
    return head + `<div class="card pad"><b>Couldn't load orders.</b><p class="muted" style="margin-top:6px">${esc(error)}</p></div>` + '';
  }
  if (!a || a.tier === 'none') {
    return head + `<div class="callout"><div class="ct">
      <b>Order access is being set up.</b> Funnels reads your recent orders to show what's working. The <code>read_orders</code> permission was deployed (version gbu-store-ops-10); it just needs the store to grant it.
      <div style="margin-top:10px;font-size:13px" class="muted">
        1. Open <b>GBU Store Ops</b> from your Shopify admin and approve the orders permission if prompted.<br>
        2. In the Dev Dashboard, turn on <b>protected customer data</b> (Level 1) so traffic-source data is included.
      </div>
      <a href="/settings" style="color:var(--accent-ink);font-weight:600;display:inline-block;margin-top:10px">Back to Settings →</a>
    </div></div>`;
  }

  const cur = a.currency;
  const days = (win && win.days) || 30;
  const rangeText = win ? win.label.toLowerCase() : `last ${days} days`;
  const cards = `<div class="grid c4 rise">
    ${statCard({ value: money(cur, a.totalRevenue), label: 'Revenue', sub: `${a.totalOrders} orders · ${rangeText}`, tone: a.totalRevenue ? 'pos' : '' })}
    ${statCard({ value: `<span class="count" data-to="${a.totalOrders}">0</span>`, label: 'Orders', sub: 'completed & paid' })}
    ${statCard({ value: money(cur, a.aov), label: 'Avg order value', sub: 'per order' })}
    ${checkout && checkout.reached
      ? statCard({ value: `<span class="count" data-to="${checkout.completionRate}">0</span>%`, label: 'Checkout completion', sub: `${checkout.abandoned} abandoned`, tone: checkout.completionRate >= 60 ? 'pos' : 'warn' })
      : statCard({ value: a.avgDaysToConvert == null ? '—' : a.avgDaysToConvert, label: 'Days to convert', sub: a.tier === 'full' ? 'first visit → purchase' : 'needs customer-data access' })}
  </div>`;

  // "Where to focus" — checkout leaks first (biggest lever), then order insights.
  // Each insight carries its own `fix` (concrete next steps) rendered as a list.
  const focusList = [...((checkout && checkout.insights) || []), ...(a.insights || [])];
  const insights = focusList.length ? `<div class="card">
    <div class="card-h"><h2>Where to focus</h2><span class="faint">problem &rarr; how to fix it</span></div>
    <div class="pad" style="padding-top:14px;display:flex;flex-direction:column;gap:16px">
      ${focusList.map((i) => `<div class="fn-insight t-${esc(i.tone)}">
        <span class="fn-dot"></span>
        <div class="fn-itext">
          <div class="fn-iline">${esc(i.text)}</div>
          ${i.fix && i.fix.length ? `<ul class="fn-fix">${i.fix.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>`).join('')}
    </div></div>` : '';

  // Checkout drop-off funnel: reached checkout -> completed, with the abandoned gap.
  const checkoutCard = checkout && checkout.reached ? `<div class="card">
    <div class="card-h"><h2>Checkout funnel</h2><span class="faint">reached checkout → completed</span></div>
    <div class="pad" style="padding-top:16px">
      <div class="fn-conv">
        ${ring(checkout.completionRate, checkout.completionRate + '%', 'completed', { size: 116 })}
        <div class="fn-funnel">
          <div class="fn-stage"><div class="fn-stage-top"><span>Reached checkout</span><b>${checkout.reached}</b></div><div class="fn-stage-bar"><span style="width:100%"></span></div></div>
          <div class="fn-stage"><div class="fn-stage-top"><span>Completed the purchase</span><b>${checkout.completed} · ${checkout.completionRate}%</b></div><div class="fn-stage-bar"><span class="done" style="width:${Math.max(3, checkout.completionRate)}%"></span></div></div>
        </div>
      </div>
      <div class="fn-leak">
        <div><div class="fn-leak-n danger">${checkout.abandoned}</div><div class="fn-leak-l">abandoned (${checkout.abandonRate}%)</div></div>
        <div><div class="fn-leak-n danger">${esc(money(checkout.currency, checkout.valueLost))}</div><div class="fn-leak-l">left in carts${checkout.sampled < checkout.abandoned ? ' (sampled)' : ''}</div></div>
      </div>
      ${checkout.topAbandoned && checkout.topAbandoned.length
        ? `<div class="fn-aband-h">Most-abandoned items</div>` + checkout.topAbandoned.map((p) => `<div class="fn-prow"><span class="fn-pname">${esc(p.title)}</span><span class="fn-punits">${p.checkouts} checkout${p.checkouts === 1 ? '' : 's'}</span></div>`).join('')
        : ''}
    </div></div>` : '';

  // Per-cart abandoned list — each shopper's abandoned cart on its own.
  const cartsList = checkout && checkout.carts && checkout.carts.length ? `<div class="card">
    <div class="card-h"><h2>Abandoned carts</h2><span class="faint">each shopper's cart</span></div>
    <div class="pad" style="padding-top:8px">
      ${checkout.carts.slice(0, 15).map((k) => {
        const when = k.at ? new Date(k.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        const items = (k.items || []).map((li) => `${esc(li.title)}${li.qty > 1 ? ' ×' + li.qty : ''}`).join(', ');
        return `<div class="fn-cart"><div class="fn-cart-top"><span class="fn-cart-when">${esc(when)}</span><span class="fn-cart-val">${esc(money(k.currency, k.amount))}</span></div>
          <div class="fn-cart-items">${items || '<span class="faint">no items</span>'}</div>
          ${k.id ? `<div class="fn-cart-act"><button type="button" class="ghost rc-prev" data-id="${esc(k.id)}">Preview</button><button type="button" class="primary rc-send" data-id="${esc(k.id)}">Recover</button></div>` : ''}
        </div>`;
      }).join('')}
      ${checkout.carts.length > 15 ? `<div class="faint" style="padding:11px 0 2px;font-size:12px">Showing the 15 most recent of ${checkout.abandoned} abandoned carts.</div>` : ''}
    </div></div>` : '';

  // Order trend — a labelled area chart with a clear headline, so it reads at a
  // glance (the bare bars didn't say what they meant).
  const trendPts = (a.trend || []).map((d) => ({ d: d.label, n: d.orders }));
  const peak = (a.trend || []).reduce((m, d) => (d.orders > m.orders ? d : m), { orders: -1, label: '' });
  const unit = a.trendUnit || 'day';
  const trendCard = `<div class="card hero">
    <div class="card-h"><h2>Order trend</h2><span class="faint">orders per ${esc(unit)}</span></div>
    <div class="pad" style="padding-top:16px">
      <div class="trend-top">
        <div><div class="trend-big"><span class="count" data-to="${a.totalOrders}">0</span></div><div class="trend-lab">orders · ${esc(rangeText)}</div></div>
        ${peak.orders > 0 ? `<div class="trend-note">Busiest ${esc(unit)}: <b style="color:var(--ink)">${esc(peak.label)}</b> — ${peak.orders} order${peak.orders === 1 ? '' : 's'}</div>` : ''}
      </div>
      ${areaChart(trendPts) || trendSpark(a.trend)}
    </div></div>`;

  const channelsCard = `<div class="card">
    <div class="card-h"><h2>Sales channels</h2><span class="faint">by revenue</span></div>
    <div class="pad" style="padding-top:16px">${barRows(a.channels, cur)}</div></div>`;

  const productsCard = `<div class="card">
    <div class="card-h"><h2>Top products</h2><span class="faint">units sold</span></div>
    <div class="pad" style="padding-top:8px">
      ${a.products && a.products.length ? a.products.map((p, i) => `
        <div class="fn-prow"><span class="fn-rank">${i + 1}</span>${prodThumb(p.img)}<span class="fn-pname">${esc(p.title)}</span><span class="fn-punits">${p.units} unit${p.units === 1 ? '' : 's'}</span></div>`).join('') : '<div class="empty">No line items yet.</div>'}
    </div></div>`;

  // Full-tier only: traffic sources, referrers, landing pages.
  const trafficCard = a.tier === 'full' ? `<div class="card">
    <div class="card-h"><h2>Traffic sources</h2><span class="faint">where buyers came from</span></div>
    <div class="pad" style="padding-top:16px">${barRows(a.trafficSources, cur)}</div></div>` : '';

  const referrersCard = a.tier === 'full' && a.referrers.length ? `<div class="card">
    <div class="card-h"><h2>Top referrers</h2><span class="faint">external sites</span></div>
    <div class="pad" style="padding-top:16px">${barRows(a.referrers, cur)}</div></div>` : '';

  const landingCard = a.tier === 'full' && a.landings.length ? `<div class="card">
    <div class="card-h"><h2>Landing pages</h2><span class="faint">first page that converted</span></div>
    <div class="pad" style="padding-top:16px">${barRows(a.landings, cur)}</div></div>` : '';

  const baseNote = a.tier === 'base' ? `<div class="callout" style="margin-bottom:18px"><div class="ct">
    <b>Traffic-source insights are off.</b> Revenue, channels and products work with <code>read_orders</code>. To see <i>where buyers come from</i> (Facebook, Instagram, search, direct) and days-to-convert, turn on <b>protected customer data</b> (Level 1) in the Dev Dashboard.
  </div></div>` : '';

  // Back-in-stock revenue — what the waitlist emails earned (the app's own
  // value, not generic analytics). From the notified log's order attribution.
  const w = view && view.waitlist;
  const waitlistCard = w && w.notified ? (() => {
    const pctOrdered = w.notified ? Math.round((w.ordered / w.notified) * 100) : 0;
    const wcur = w.currency || cur;
    return `<div class="card">
      <div class="card-h"><h2>Back-in-stock revenue</h2><span class="faint">from waitlist emails</span></div>
      <div class="pad" style="padding-top:16px">
        <div class="fn-conv">
          ${ring(w.clickRate, w.clickRate + '%', 'clicked', { size: 116 })}
          <div class="fn-conv-body">
            <div class="fn-leak-n" style="color:var(--accent-ink);font-size:26px">${w.revenue ? esc(money(wcur, w.revenue)) : '—'}</div>
            <div class="fn-leak-l" style="margin-bottom:14px">from ${w.orders || 0} order${w.orders === 1 ? '' : 's'} by notified shoppers</div>
            <div class="fn-funnel">
              <div class="fn-stage"><div class="fn-stage-top"><span>Notified</span><b>${w.notified}</b></div><div class="fn-stage-bar"><span style="width:100%"></span></div></div>
              <div class="fn-stage"><div class="fn-stage-top"><span>Clicked through</span><b>${w.clicked} · ${w.clickRate}%</b></div><div class="fn-stage-bar"><span style="width:${Math.max(3, w.clickRate)}%"></span></div></div>
              <div class="fn-stage"><div class="fn-stage-top"><span>Ordered</span><b>${w.ordered} · ${pctOrdered}%</b></div><div class="fn-stage-bar"><span class="done" style="width:${Math.max(3, pctOrdered)}%"></span></div></div>
            </div>
          </div>
        </div>
      </div></div>`;
  })() : '';

  // Top 5 products per category (collection membership) — four mini-lists.
  const cats = (view && view.categories) || [];
  const catSection = cats.some((c) => c.products && c.products.length) ? `<div class="card rise" style="margin-top:18px">
    <div class="card-h"><h2>Top products by category</h2><span class="faint">units sold · ${esc(rangeText)}</span></div>
    <div class="pad fn-cats">
      ${cats.map((c) => `<div class="fn-cat">
        <div class="fn-cat-h">${esc(c.label)}</div>
        ${c.products && c.products.length
          ? c.products.map((p, i) => `<div class="fn-prow"><span class="fn-rank">${i + 1}</span>${prodThumb(p.img)}<span class="fn-pname">${esc(p.title)}</span><span class="fn-punits">${p.units}</span></div>`).join('')
          : '<div class="faint" style="font-size:12.5px;padding:10px 0">No sales in this category yet.</div>'}
      </div>`).join('')}
    </div></div>` : '';

  // Manual abandoned-cart recovery UI (preview modal + send), only when there
  // are carts. Owner-triggered; posts to /api/index previewRecover / recoverCart.
  const hasCarts = !!(checkout && checkout.carts && checkout.carts.length);
  const recoverUI = hasCarts ? `
    <div class="pw" id="rcPwWrap" style="margin-top:6px"><label for="rcPw">Panel password</label><input type="password" id="rcPw" placeholder="to send recovery emails" autocomplete="current-password"><span id="rcMsg" class="faint" style="margin-left:6px"></span></div>
    <div id="rcModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,41,.55);z-index:1000;padding:18px;box-sizing:border-box">
      <div style="max-width:660px;height:100%;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--muted);text-transform:uppercase">Recovery email preview</span>
          <span style="flex:1"></span>
          <button type="button" class="ghost" id="rcClose">Close</button>
        </div>
        <iframe id="rcFrame" title="Recovery email preview" style="flex:1;width:100%;border:0;background:#eef1f6"></iframe>
      </div>
    </div>
    <script>(function(){
      var embedded=(typeof shopify!=='undefined' && !!shopify.idToken);
      var pwWrap=document.getElementById('rcPwWrap'), pw=document.getElementById('rcPw'), msg=document.getElementById('rcMsg');
      if(embedded){ if(pwWrap) pwWrap.style.display='none'; } else { try{ if(pw) pw.value=localStorage.getItem('oos_pw')||''; }catch(e){} }
      function authH(){ var h={'Content-Type':'application/json'}; if(embedded){ return Promise.resolve().then(function(){ return shopify.idToken(); }).then(function(t){ if(t) h['Authorization']='Bearer '+t; return h; }).catch(function(){ return h; }); } h['x-panel-password']=((pw&&pw.value)||'').trim(); return Promise.resolve(h); }
      function post(b){ return authH().then(function(h){ return fetch('/api/index',{method:'POST',headers:h,body:JSON.stringify(b)}); }).then(function(r){ return r.json().catch(function(){return{};}).then(function(j){ return {s:r.status,j:j}; }); }); }
      var modal=document.getElementById('rcModal'), frame=document.getElementById('rcFrame');
      function openModal(html){ try{ frame.srcdoc=html; }catch(e){ try{ frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close(); }catch(e2){} } modal.style.display='block'; }
      var cl=document.getElementById('rcClose'); if(cl) cl.addEventListener('click', function(){ modal.style.display='none'; });
      // Event delegation on document so clicks work regardless of DOM order
      // (the cart buttons are rendered after this script).
      document.addEventListener('click', function(e){
        var b = (e.target && e.target.closest) ? (e.target.closest('.rc-prev') || e.target.closest('.rc-send')) : null;
        if(!b) return;
        if(b.classList.contains('rc-prev')){
          if(msg) msg.textContent='Loading preview\\u2026';
          post({action:'previewRecover', id:b.dataset.id}).then(function(res){ var j=res.j;
            if(res.s===200 && j.ok){ openModal(j.html); if(msg) msg.textContent = j.recoverable ? '' : (j.emailDenied?'Preview only \\u2014 add read_customers + reinstall to send.':'This cart has no customer email.'); }
            else { if(msg) msg.textContent = (res.s===401 ? (embedded?'Not authorized':'Wrong password') : (j.error||'Could not load preview')); }
          }).catch(function(){ if(msg) msg.textContent='Network error'; });
        } else {
          if(!embedded && !((pw&&pw.value)||'').trim()){ if(msg) msg.textContent='Enter the panel password'; if(pw) pw.focus(); return; }
          var old=b.textContent; b.disabled=true; b.textContent='Sending\\u2026'; if(msg) msg.textContent='';
          post({action:'recoverCart', id:b.dataset.id}).then(function(res){ var j=res.j;
            if(res.s===200 && j.ok && j.sent){ b.textContent='Sent \\u2713'; if(!embedded){ try{ localStorage.setItem('oos_pw',((pw&&pw.value)||'').trim()); }catch(e){} } }
            else { b.disabled=false; b.textContent=old; if(msg) msg.textContent = j.redacted ? (j.error||'Needs read_customers') : (res.s===401 ? (embedded?'Not authorized':'Wrong password') : (j.error||'Could not send')); }
          }).catch(function(){ b.disabled=false; b.textContent=old; if(msg) msg.textContent='Network error'; });
        }
      });
    })();</script>` : '';

  return head + baseNote + cards + catSection + recoverUI + `
    <div class="layout" style="margin-top:18px">
      <div class="grid rise" style="gap:16px">${insights}${checkoutCard}${cartsList}${trafficCard}${referrersCard}${landingCard}${channelsCard}</div>
      <div class="grid rise" style="gap:16px;--d:120ms">${waitlistCard}${trendCard}${productsCard}</div>
    </div>
    <style>
      .fn-range{display:inline-block;margin-top:10px;font-size:12.5px;font-weight:600;color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:5px 11px;border-radius:999px}
      .fn-ranges{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
      .fn-range-opt{font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted);text-decoration:none;transition:background .15s,color .15s,border-color .15s}
      .fn-range-opt:hover{background:var(--hover);color:var(--ink)}
      .fn-range-opt.on{background:var(--accent);color:#fff;border-color:var(--accent)}
      .fn-cart{padding:11px 0;border-top:1px solid var(--line-2)}
      .fn-cart:first-child{border-top:0}
      .fn-cart-top{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;margin-bottom:3px}
      .fn-cart-when{color:var(--muted)}.fn-cart-val{font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
      .fn-cart-items{font-size:13px;color:var(--ink);line-height:1.45}
      .fn-cart-act{display:flex;gap:8px;margin-top:10px}
      .fn-cart-act button{font-size:12.5px;padding:7px 14px;border-radius:9px}
      .fn-funnel{display:flex;flex-direction:column;gap:12px}
      .fn-stage-top{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:5px}
      .fn-stage-top b{font-variant-numeric:tabular-nums;color:var(--ink)}
      .fn-stage-bar{height:26px;border-radius:8px;background:var(--line-2);overflow:hidden}
      .fn-stage-bar span{display:block;height:100%;border-radius:8px;background:var(--accent-wash)}
      .fn-stage-bar span.done{background:var(--accent)}
      .fn-leak{display:flex;gap:28px;margin:18px 0 2px;padding:14px 16px;border-radius:12px;background:var(--hover);border:1px solid var(--line)}
      .fn-leak-n{font-size:21px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
      .fn-leak-n.danger{color:var(--danger)}
      .fn-leak-l{font-size:12px;color:var(--muted);margin-top:2px}
      .fn-aband-h{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:18px 0 2px}
      .fn-bars{display:flex;flex-direction:column;gap:13px}
      .fn-bar-top{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;margin-bottom:5px}
      .fn-bar-label{font-weight:560;color:var(--ink)}.fn-bar-val{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
      .fn-bar-track{height:8px;border-radius:6px;background:var(--line-2);overflow:hidden}
      .fn-bar-fill{display:block;height:100%;border-radius:6px;background:var(--accent)}
      .fn-spark{display:flex;align-items:flex-end;gap:3px;height:80px}
      .fn-spark-col{flex:1;display:flex;align-items:flex-end;justify-content:center;height:100%}
      .fn-spark-bar{display:block;width:100%;max-width:16px;border-radius:3px 3px 0 0;background:var(--accent);opacity:.85}
      .fn-insight{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.5;color:var(--ink)}
      .fn-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:6px;background:var(--muted)}
      .fn-insight.t-pos .fn-dot{background:var(--accent)}.fn-insight.t-warn .fn-dot{background:var(--warn,#c2851b)}.fn-insight.t-danger .fn-dot{background:var(--danger)}
      .fn-itext{min-width:0;flex:1}
      .fn-iline{font-size:13.5px;line-height:1.5;color:var(--ink)}
      .fn-fix{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
      .fn-fix li{position:relative;padding-left:22px;font-size:12.5px;color:var(--muted);line-height:1.45}
      .fn-fix li::before{content:"";position:absolute;left:4px;top:3px;width:5px;height:9px;border:solid var(--accent-ink);border-width:0 2px 2px 0;transform:rotate(45deg)}
      .fn-conv{display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin-bottom:6px}
      .fn-conv .fn-funnel{flex:1;min-width:190px}
      .fn-conv-body{flex:1;min-width:190px}
      .fn-cats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px 26px;padding-top:14px}
      .fn-cat-h{font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:-.01em;color:var(--ink);padding-bottom:7px;margin-bottom:4px;border-bottom:1px solid var(--line)}
      .fn-cat .fn-prow{padding:8px 0;font-size:12.5px;gap:10px}
      .fn-cat .fn-pname{font-weight:450}
      .fn-thumb{width:32px;height:32px;border-radius:7px;object-fit:cover;flex:none;border:1px solid var(--line);background:var(--surface-2)}
      .fn-thumb.ph{display:grid;place-items:center;color:var(--faint)}
      @media (max-width:900px){.fn-cats{grid-template-columns:repeat(2,1fr)}}
      @media (max-width:520px){.fn-cats{grid-template-columns:1fr}}
      .fn-prow{display:flex;align-items:center;gap:12px;padding:9px 0;font-size:13.5px}
      .fn-prow+.fn-prow{border-top:1px solid var(--line-2)}
      .fn-rank{flex:none;width:20px;height:20px;border-radius:6px;background:var(--hover);color:var(--muted);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
      .fn-pname{flex:1;font-weight:500}.fn-punits{color:var(--muted);font-variant-numeric:tabular-nums}
      code{font-family:var(--mono);font-size:.9em;background:var(--hover);padding:1px 5px;border-radius:5px}
    </style>`;
}

/** Standard CSP + content-type headers so pages embed in the Shopify admin. */
export function setPageHeaders(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://admin.shopify.com https://*.myshopify.com"
  );
}

/**
 * Body for the "app isn't connected to this store yet" state. Shown instead of
 * crashing when a token can't be obtained (no ADMIN_TOKEN + client-credentials
 * can't authenticate — e.g. the app isn't installed on the shop yet).
 */
export function notConnectedBody(shop) {
  const install = shop ? `/api/install?shop=${encodeURIComponent(shop)}` : '/api/install';
  return `<div class="pagehead"><h1>Finishing setup for ${esc(APP_NAME)}</h1>
    <p>If you're opening this inside your Shopify admin, it connects automatically.</p></div>
  <div class="card pad">
    <b id="cxstatus">Connecting…</b>
    <p class="muted" id="cxdetail" style="margin:6px 0 14px">Authorizing ${esc(APP_NAME)} for your store.</p>
    <a href="${install}" target="_top" style="text-decoration:none"><button class="primary" id="cxinstall" style="display:none">Install / reconnect</button></a>
  </div>
  <script>
  (async function(){
    var s=document.getElementById('cxstatus'), d=document.getElementById('cxdetail'), b=document.getElementById('cxinstall');
    if (typeof shopify==='undefined' || !shopify.idToken){
      s.textContent='Connect ${esc(APP_NAME)}';
      d.textContent='Open this app from your Shopify admin to finish setup.';
      if(b) b.style.display='';
      return;
    }
    try{
      var token=await shopify.idToken();
      var r=await fetch('/api/oauth-callback',{method:'POST',headers:{'Authorization':'Bearer '+token}});
      var j=await r.json().catch(function(){return {};});
      if(r.ok && j.ok){ s.textContent='Connected \\u2713'; d.textContent='${esc(APP_NAME)} is authorized for your store. You can close this tab.'; }
      else { s.textContent='Couldn\\u2019t finish connecting'; d.textContent=(j.error||('Error '+r.status))+' — try reopening the app.'; if(b) b.style.display=''; }
    }catch(e){ s.textContent='Couldn\\u2019t finish connecting'; d.textContent=String(e&&e.message||e); if(b) b.style.display=''; }
  })();
  </script>`;
}

/** The shop domain for the current request, from the embedded query string. */
export const shopOf = (req) => (req && req.query && req.query.shop) || '';

/** Friendly relative time from an ISO string, server-side. */
export function relTime(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

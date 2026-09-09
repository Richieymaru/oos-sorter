/**
 * Shared UI shell + design system for the GBU Store Ops control panel.
 *
 * Clean, modern SaaS admin that sits comfortably embedded in the Shopify admin,
 * with a full auto dark mode (prefers-color-scheme). Pure string rendering — no
 * framework, no build step. Class names are kept stable so the Collections,
 * Waitlists and Settings pages restyle for free.
 */

/** Brand name shown across the UI + emails. Per-store: set APP_NAME in the env. */
export const APP_NAME = process.env.APP_NAME || 'OOS Sorter';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The brand mark — an SVG "stack settling to the bottom" (the sort heritage),
 *  crisp at any size, with a live-pulse dot. Emerald fill works on both themes. */
export const mark = `<svg class="mark" width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
  <rect width="26" height="26" rx="7" fill="var(--accent)"/>
  <rect x="6" y="7" width="14" height="2.6" rx="1.3" fill="#fff"/>
  <rect x="6" y="11.7" width="10" height="2.6" rx="1.3" fill="#fff" opacity=".7"/>
  <rect x="6" y="16.4" width="6" height="2.6" rx="1.3" fill="#fff" opacity=".45"/>
  <circle cx="19" cy="17.7" r="2.1" fill="#fff"/>
</svg>`;

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
    const m = ACTION_META[it.action] || { label: cap(it.action), tone: 'neutral' };
    const ico = it.type === 'Collection' ? ICON_COLLECTION : ICON_PRODUCT;
    const title = it.href
      ? `<a href="${esc(it.href)}" target="_top" class="feed-link">${esc(it.title)}</a>`
      : esc(it.title);
    const who = it.who ? esc(it.who) : 'unknown';
    return `<li class="feed-item">
      <span class="feed-ico t-${m.tone}" aria-hidden="true">${ico}</span>
      <span class="feed-main">
        <span class="feed-title">${title} <span class="tag t-${m.tone}">${esc(m.label)}</span></span>
        <span class="feed-meta"><span>${esc(it.type)}</span><span class="mwho">${who}</span></span>
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
    --bg:#f5f6f8; --surface:#ffffff; --surface-2:#fafbfc; --ink:#0f1520; --muted:#59636f; --faint:#8b95a1;
    --line:#e6e9ee; --line-2:#eef1f4; --hover:#f3f5f7;
    --accent:#10a171; --accent-ink:#0b6b4c; --accent-wash:#e6f5ee;
    --pos:#10a171; --pos-wash:#e6f5ee; --warn:#b5761b; --warn-wash:#fbf1e0;
    --danger:#c5384b; --danger-wash:#fbe9ec; --info:#3667e0; --info-wash:#e9f0fe;
    --neutral:#5a6672; --neutral-wash:#eef1f4;
    --radius:14px; --radius-sm:10px;
    --shadow:0 1px 2px rgba(15,21,32,.04), 0 4px 16px rgba(15,21,32,.05);
    --shadow-sm:0 1px 2px rgba(15,21,32,.05);
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
    --sans:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0d1014; --surface:#161b22; --surface-2:#1a2029; --ink:#e8edf3; --muted:#9aa4b1; --faint:#6b7684;
    --line:#232a34; --line-2:#1e252e; --hover:#1c232c;
    --accent:#2ccb8c; --accent-ink:#7fe7bd; --accent-wash:#123024;
    --pos:#2ccb8c; --pos-wash:#123024; --warn:#e0b978; --warn-wash:#2a2213;
    --danger:#f08a97; --danger-wash:#331a1f; --info:#8fb0ff; --info-wash:#152139;
    --neutral:#9aa4b1; --neutral-wash:#1e252e;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 26px rgba(0,0,0,.4);
    --shadow-sm:0 1px 2px rgba(0,0,0,.35);
  }}
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;line-height:1.5;font-size:14px;letter-spacing:-.005em}
  a{color:inherit}
  .mono{font-family:var(--mono)}
  .muted{color:var(--muted)} .faint{color:var(--faint)}
  /* top bar */
  .topbar{background:color-mix(in srgb,var(--surface) 86%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
  .topinner{max-width:1080px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:18px;height:60px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.02em;font-size:15.5px}
  .brand .mark{display:block;border-radius:7px}
  nav.tabs{display:flex;gap:2px;margin-left:auto}
  nav.tabs a{padding:8px 14px;border-radius:9px;color:var(--muted);text-decoration:none;font-weight:500;font-size:13.5px;transition:background .15s,color .15s}
  nav.tabs a:hover{background:var(--hover);color:var(--ink)}
  nav.tabs a.on{background:var(--accent-wash);color:var(--accent-ink);font-weight:600}
  /* page */
  main{max-width:1080px;margin:0 auto;padding:30px 24px 72px}
  .pagehead{margin:0 0 22px}
  .pagehead h1{font-size:25px;font-weight:700;letter-spacing:-.03em;margin:0}
  .pagehead p{margin:5px 0 0;color:var(--muted);font-size:14.5px;max-width:60ch}
  /* grids */
  .grid{display:grid;gap:14px}
  .grid.c3{grid-template-columns:repeat(3,1fr)}
  .grid.c4{grid-template-columns:repeat(4,1fr)}
  .layout{display:grid;grid-template-columns:1.7fr 1fr;gap:16px;margin-top:22px;align-items:start}
  @media (max-width:900px){.grid.c4{grid-template-columns:repeat(2,1fr)}.grid.c3{grid-template-columns:1fr}.layout{grid-template-columns:1fr}}
  @media (max-width:520px){.grid.c4{grid-template-columns:1fr}}
  /* cards */
  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
  .pad{padding:20px 22px}
  .card-h{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line-2)}
  .card-h h2{font-size:14.5px;font-weight:650;margin:0;letter-spacing:-.01em}
  .card-h .faint{margin-left:auto;font-size:12.5px}
  /* stat cards */
  .stat{padding:18px 20px;position:relative;overflow:hidden}
  .stat-ico{position:absolute;top:16px;right:16px;color:var(--faint);opacity:.8}
  .statval{font-size:32px;font-weight:700;letter-spacing:-.035em;line-height:1.05;font-variant-numeric:tabular-nums}
  .statlabel{color:var(--muted);font-size:13px;margin-top:6px;font-weight:500}
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
  .rows .row{display:flex;align-items:flex-start;gap:14px;padding:16px 20px;cursor:pointer;margin:0}
  .rows .row+.row{border-top:1px solid var(--line-2)}
  .sw{position:absolute;opacity:0;width:0;height:0}
  .track{flex:none;margin-top:2px;width:40px;height:24px;border-radius:999px;background:var(--line);position:relative;transition:background .18s ease}
  .thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.35);transition:transform .18s ease}
  .sw:checked~.track{background:var(--accent)}.sw:checked~.track .thumb{transform:translateX(16px)}
  .sw:focus-visible~.track{outline:2px solid var(--accent);outline-offset:2px}
  .rowtext{display:flex;flex-direction:column;gap:2px}
  .rowtitle{font-size:14.5px;font-weight:560}.rowdesc{font-size:12.5px;color:var(--muted)}
  .actions{margin-top:18px;display:flex;flex-wrap:wrap;align-items:center;gap:12px}
  button{font-family:var(--sans);font-size:14px;font-weight:560;border-radius:var(--radius-sm);cursor:pointer;padding:10px 16px;border:1px solid transparent;transition:filter .15s,background .15s,border-color .15s}
  .primary{background:var(--accent);color:#fff}.primary:hover{filter:brightness(1.06)}
  .ghost{background:var(--surface);color:var(--ink);border-color:var(--line)}.ghost:hover{background:var(--hover)}
  button:disabled{opacity:.6;cursor:default}
  #msg{font-size:12.5px;color:var(--accent-ink)} #msg.err{color:var(--danger)}
  .pw{margin-top:16px;display:flex;align-items:center;gap:10px}
  .pw input{font-family:var(--mono);font-size:13px;padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);width:190px;max-width:60%}
  .pw label{font-size:12px;color:var(--faint)}
  a:focus-visible,button:focus-visible,.feed-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
`;

/** App Bridge tags so pages opened inside the Shopify admin can fetch a session
 *  token (shopify.idToken) — used for password-free auth on the actions. */
export function appBridgeHead() {
  const key = process.env.CLIENT_ID || '';
  return `<meta name="shopify-api-key" content="${esc(key)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`;
}

/** Fonts: Hanken Grotesk with a system fallback (degrades cleanly if blocked). */
function fontHead() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">`;
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
<header class="topbar"><div class="topinner">
  <span class="brand">${mark} ${esc(APP_NAME)}</span>
  <nav class="tabs">
    ${tab('/', 'home', 'Dashboard')}
    ${tab('/collections', 'collections', 'Collections')}
    ${tab('/waitlists', 'waitlists', 'Waitlists')}
    ${tab('/settings', 'settings', 'Settings')}
  </nav>
</div></header>
<main>${body}</main>
</body></html>`;
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

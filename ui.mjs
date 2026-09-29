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
    ${tab('/funnels', 'funnels', 'Funnels')}
    ${tab('/settings', 'settings', 'Settings')}
  </nav>
</div></header>
<main>${body}</main>
${chatWidget()}
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

/** A tiny inline bar sparkline for the daily order trend. */
function trendSpark(trend) {
  if (!trend || !trend.length) return '';
  const peak = Math.max(...trend.map((d) => d.orders), 1);
  return `<div class="fn-spark" role="img" aria-label="Orders per day, last ${trend.length} days">${trend.map((d) => `
    <span class="fn-spark-col" title="${esc(d.day)}: ${d.orders} order${d.orders === 1 ? '' : 's'}">
      <span class="fn-spark-bar" style="height:${Math.max(4, Math.round((d.orders / peak) * 100))}%"></span>
    </span>`).join('')}</div>`;
}

/**
 * The Funnels page. `view` = { analysis, error }.
 * analysis.tier drives what's shown: 'none' (no order access yet), 'base'
 * (revenue/channels/products), 'full' (+ traffic sources & funnel insights).
 */
function rangeLabel(win) {
  if (!win) return '';
  const days = win.days || 30;
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const since = win.since ? new Date(win.since) : null;
  return since ? `Last ${days} days · ${fmt(since)} – ${fmt(new Date())}` : `Last ${days} days`;
}

export function funnelsBody(view) {
  const { analysis: a, checkout, window: win, error } = view || {};
  const range = rangeLabel(win);
  const head = `<div class="pagehead"><h1>Funnels</h1><p>Where your sales come from and where shoppers drop off — channels, traffic sources, best sellers, checkout completion, and where to focus.</p>${range ? `<div class="fn-range">📅 ${esc(range)}</div>` : ''}</div>`;

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
  const cards = `<div class="grid c4">
    ${statCard({ value: money(cur, a.totalRevenue), label: 'Revenue', sub: `${a.totalOrders} orders · last ${days} days`, tone: a.totalRevenue ? 'pos' : '' })}
    ${statCard({ value: a.totalOrders, label: 'Orders', sub: 'completed & paid' })}
    ${statCard({ value: money(cur, a.aov), label: 'Avg order value', sub: 'per order' })}
    ${checkout && checkout.reached
      ? statCard({ value: `${checkout.completionRate}%`, label: 'Checkout completion', sub: `${checkout.abandoned} abandoned`, tone: checkout.completionRate >= 60 ? 'pos' : 'warn' })
      : statCard({ value: a.avgDaysToConvert == null ? '—' : a.avgDaysToConvert, label: 'Days to convert', sub: a.tier === 'full' ? 'first visit → purchase' : 'needs customer-data access' })}
  </div>`;

  // "Where to focus" — checkout leaks first (biggest lever), then order insights.
  const focusList = [...((checkout && checkout.insights) || []), ...(a.insights || [])];
  const insights = focusList.length ? `<div class="card">
    <div class="card-h"><h2>Where to focus</h2><span class="faint">last ${days} days</span></div>
    <div class="pad" style="padding-top:12px;display:flex;flex-direction:column;gap:10px">
      ${focusList.map((i) => `<div class="fn-insight t-${esc(i.tone)}"><span class="fn-dot"></span><span>${esc(i.text)}</span></div>`).join('')}
    </div></div>` : '';

  // Checkout drop-off funnel: reached checkout -> completed, with the abandoned gap.
  const checkoutCard = checkout && checkout.reached ? `<div class="card">
    <div class="card-h"><h2>Checkout funnel</h2><span class="faint">reached checkout → completed</span></div>
    <div class="pad" style="padding-top:16px">
      <div class="fn-funnel">
        <div class="fn-stage"><div class="fn-stage-top"><span>Reached checkout</span><b>${checkout.reached}</b></div><div class="fn-stage-bar"><span style="width:100%"></span></div></div>
        <div class="fn-stage"><div class="fn-stage-top"><span>Completed the purchase</span><b>${checkout.completed} · ${checkout.completionRate}%</b></div><div class="fn-stage-bar"><span class="done" style="width:${Math.max(3, checkout.completionRate)}%"></span></div></div>
      </div>
      <div class="fn-leak">
        <div><div class="fn-leak-n danger">${checkout.abandoned}</div><div class="fn-leak-l">abandoned (${checkout.abandonRate}%)</div></div>
        <div><div class="fn-leak-n danger">${esc(money(checkout.currency, checkout.valueLost))}</div><div class="fn-leak-l">left in carts${checkout.sampled < checkout.abandoned ? ' (sampled)' : ''}</div></div>
      </div>
      ${checkout.topAbandoned && checkout.topAbandoned.length
        ? `<div class="fn-aband-h">Most-abandoned items</div>` + checkout.topAbandoned.map((p) => `<div class="fn-prow"><span class="fn-pname">${esc(p.title)}</span><span class="fn-punits">${p.checkouts} checkout${p.checkouts === 1 ? '' : 's'}</span></div>`).join('')
        : ''}
    </div></div>` : '';

  const trendCard = `<div class="card">
    <div class="card-h"><h2>Order trend</h2><span class="faint">orders / day</span></div>
    <div class="pad" style="padding-top:16px">${trendSpark(a.trend)}</div></div>`;

  const channelsCard = `<div class="card">
    <div class="card-h"><h2>Sales channels</h2><span class="faint">by revenue</span></div>
    <div class="pad" style="padding-top:16px">${barRows(a.channels, cur)}</div></div>`;

  const productsCard = `<div class="card">
    <div class="card-h"><h2>Top products</h2><span class="faint">units sold</span></div>
    <div class="pad" style="padding-top:8px">
      ${a.products && a.products.length ? a.products.map((p, i) => `
        <div class="fn-prow"><span class="fn-rank">${i + 1}</span><span class="fn-pname">${esc(p.title)}</span><span class="fn-punits">${p.units} unit${p.units === 1 ? '' : 's'}</span></div>`).join('') : '<div class="empty">No line items yet.</div>'}
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

  return head + baseNote + cards + `
    <div class="layout" style="margin-top:18px">
      <div class="grid" style="gap:16px">${insights}${checkoutCard}${trafficCard}${referrersCard}${landingCard}${channelsCard}</div>
      <div class="grid" style="gap:16px">${trendCard}${productsCard}</div>
    </div>
    <style>
      .fn-range{display:inline-block;margin-top:10px;font-size:12.5px;font-weight:600;color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:5px 11px;border-radius:999px}
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

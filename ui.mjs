/**
 * Shared UI shell + design system for the multi-page control panel.
 *
 * Native Shopify-admin feel (so it sits comfortably embedded) with our own
 * emerald / monospace-telemetry accent so it's distinctive, not a generic
 * Polaris clone. Pure string rendering — no framework, no build step.
 */

/** Brand name shown across the UI + emails. Per-store: set APP_NAME in the env. */
export const APP_NAME = process.env.APP_NAME || 'OOS Sorter';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The stacked-bars brand mark (sold-out settling to the bottom). */
export const mark = `<span class="mark"><i></i><i></i><i></i></span>`;

/** A status badge. tone: 'ok' | 'warn' | 'idle'. */
export function badge(label, tone = 'ok') {
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

/** A telemetry stat card: big value + label + optional sub. */
export function statCard({ value, label, sub = '', mono = true }) {
  return `<div class="card stat">
    <div class="statval${mono ? ' mono' : ''}">${value}</div>
    <div class="statlabel">${esc(label)}</div>
    ${sub ? `<div class="statsub">${sub}</div>` : ''}
  </div>`;
}

const CSS = `
  :root{
    --bg:#f1f2f4; --surface:#fff; --ink:#1f2429; --muted:#5c6670; --faint:#8a929c;
    --line:#e3e6ea; --hover:#f6f7f9; --accent:#0e9c6b; --accent-ink:#0a6b4a; --accent-wash:#e7f6ef;
    --amber-wash:#fdf3e4; --amber-ink:#9a6a1a; --idle-wash:#eef0f2; --idle-ink:#6a727b;
    --radius:12px; --shadow:0 1px 2px rgba(16,24,40,.04),0 6px 20px rgba(16,24,40,.05);
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0e1116; --surface:#161c24; --ink:#e7edf4; --muted:#9aa4b2; --faint:#6b7482;
    --line:#232b36; --hover:#1c232c; --accent:#2cc98a; --accent-ink:#7fe3bc; --accent-wash:#12241d;
    --amber-wash:#2a2213; --amber-ink:#e0b978; --idle-wash:#1c232c; --idle-ink:#9aa4b2;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 26px rgba(0,0,0,.35);
  }}
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;line-height:1.5;font-size:14px}
  a{color:inherit}
  .mono{font-family:var(--mono)}
  /* top bar */
  .topbar{background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
  .topinner{max-width:960px;margin:0 auto;padding:0 22px;display:flex;align-items:center;gap:20px;height:58px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:15px}
  .mark{width:26px;height:26px;border-radius:7px;background:var(--bg);border:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;gap:2.5px;padding:6px 5px}
  .mark i{display:block;height:2.5px;border-radius:2px;background:var(--accent)}
  .mark i:nth-child(1){width:100%}.mark i:nth-child(2){width:70%;opacity:.6}.mark i:nth-child(3){width:44%;opacity:.3}
  nav.tabs{display:flex;gap:2px;margin-left:auto}
  nav.tabs a{padding:8px 13px;border-radius:8px;color:var(--muted);text-decoration:none;font-weight:550;font-size:13.5px}
  nav.tabs a:hover{background:var(--hover);color:var(--ink)}
  nav.tabs a.on{background:var(--accent-wash);color:var(--accent-ink)}
  /* page */
  main{max-width:960px;margin:0 auto;padding:28px 22px 60px}
  .pagehead{margin:0 0 20px}
  .pagehead h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0}
  .pagehead p{margin:4px 0 0;color:var(--muted);font-size:14px}
  .grid{display:grid;gap:16px}
  .grid.c3{grid-template-columns:repeat(3,1fr)}
  @media (max-width:720px){.grid.c3{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
  .pad{padding:18px 20px}
  .stat{padding:18px 20px}
  .statval{font-size:30px;font-weight:600;letter-spacing:-.03em;line-height:1.1}
  .statlabel{color:var(--muted);font-size:13px;margin-top:5px}
  .statsub{color:var(--faint);font-size:12px;margin-top:8px;font-family:var(--mono)}
  .eyebrow{font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);margin:26px 4px 10px}
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
  .badge.ok{background:var(--accent-wash);color:var(--accent-ink)}
  .badge.warn{background:var(--amber-wash);color:var(--amber-ink)}
  .badge.idle{background:var(--idle-wash);color:var(--idle-ink)}
  .badge .d{width:6px;height:6px;border-radius:50%;background:currentColor}
  @media (prefers-reduced-motion:no-preference){.badge.ok .d{animation:pulse 2.4s ease-out infinite}}
  @keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
  /* callout */
  .callout{display:flex;gap:12px;padding:16px 18px;border-radius:var(--radius);background:var(--accent-wash);border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent-ink)}
  .callout b{color:var(--accent-ink)}
  .callout .ct{font-size:13.5px;line-height:1.5}
  /* table */
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  thead th{text-align:left;color:var(--faint);font-weight:600;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;padding:12px 16px;border-bottom:1px solid var(--line)}
  tbody td{padding:13px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:hover td{background:var(--hover)}
  td.num{text-align:right;font-family:var(--mono);color:var(--muted)}
  .cname{font-weight:550}
  .toolbar{display:flex;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
  .toolbar input{flex:1;font-size:13.5px;padding:8px 12px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
  .toolbar input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
  .muted{color:var(--muted)} .faint{color:var(--faint)}
  .empty{padding:40px 20px;text-align:center;color:var(--muted)}
  /* controls (settings) */
  .rows .row{display:flex;align-items:flex-start;gap:14px;padding:16px 20px;cursor:pointer;margin:0}
  .rows .row+.row{border-top:1px solid var(--line)}
  .sw{position:absolute;opacity:0;width:0;height:0}
  .track{flex:none;margin-top:2px;width:40px;height:24px;border-radius:999px;background:var(--line);position:relative;transition:background .18s ease}
  .thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.35);transition:transform .18s ease}
  .sw:checked~.track{background:var(--accent)}.sw:checked~.track .thumb{transform:translateX(16px)}
  .sw:focus-visible~.track{outline:2px solid var(--accent);outline-offset:2px}
  .rowtext{display:flex;flex-direction:column;gap:2px}
  .rowtitle{font-size:14.5px;font-weight:560}.rowdesc{font-size:12.5px;color:var(--muted)}
  .actions{margin-top:18px;display:flex;flex-wrap:wrap;align-items:center;gap:12px}
  button{font-family:var(--sans);font-size:14px;font-weight:560;border-radius:10px;cursor:pointer;padding:10px 16px;border:1px solid transparent;transition:filter .15s,background .15s}
  .primary{background:var(--accent);color:#fff}.primary:hover{filter:brightness(1.05)}
  .ghost{background:var(--surface);color:var(--ink);border-color:var(--line)}.ghost:hover{background:var(--hover)}
  button:disabled{opacity:.6;cursor:default}
  #msg{font-family:var(--mono);font-size:12px;color:var(--accent-ink)} #msg.err{color:#d1495b}
  .pw{margin-top:16px;display:flex;align-items:center;gap:10px}
  .pw input{font-family:var(--mono);font-size:13px;padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);width:190px;max-width:60%}
  .pw label{font-size:12px;color:var(--faint)}
`;

/** App Bridge tags so pages opened inside the Shopify admin can fetch a session
 *  token (shopify.idToken) — used for password-free auth on the actions. */
export function appBridgeHead() {
  const key = process.env.CLIENT_ID || '';
  return `<meta name="shopify-api-key" content="${esc(key)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`;
}

/** Full HTML document with the shared shell. `active` = 'home'|'collections'|'waitlists'|'settings'. */
export function shell({ title, active = 'home', body }) {
  const tab = (href, key, label) =>
    `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${appBridgeHead()}
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
  return `<div class="pagehead"><h1>Finish connecting ${esc(APP_NAME)}</h1>
    <p>This store isn't authorized yet, so there's nothing to show. One approval and you're set.</p></div>
  <div class="card pad">
    <b>Authorize ${esc(APP_NAME)} on your store</b>
    <p class="muted" style="margin:6px 0 14px">It needs permission to read your products and reorder collections. Nothing runs until you approve it.</p>
    <a href="${install}" target="_top" style="text-decoration:none"><button class="primary">Install / reconnect</button></a>
    <p class="faint" style="margin:14px 0 0;font-size:12px">If this keeps appearing right after installing, the store may not be in the same Dev Dashboard organization as the app — that path needs the authorization-code install, which yields an offline token to set as <span class="mono">ADMIN_TOKEN</span>.</p>
  </div>`;
}

/** The shop domain for the current request, from the embedded query string. */
export const shopOf = (req) => (req && req.query && req.query.shop) || '';

/** Friendly relative time from an ISO string, server-side (dashboard/collections). */
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

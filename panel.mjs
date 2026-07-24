/**
 * Pure rendering + auth logic for the settings page. No I/O, no env reads —
 * unit-tested offline in panel.test.mjs.
 */

/** HTTP Basic Auth: true only when the password segment matches. */
export function isAuthorized(authHeader, password) {
  if (!password) return false;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  const pass = i === -1 ? decoded : decoded.slice(i + 1);
  return pass === password;
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Server-rendered settings page — an "engine telemetry" control panel.
 * `status = { soldOutCount, lastRun }` (lastRun is an ISO string or null).
 * The page is viewable without a password (so it can load inside the Shopify
 * admin frame); Save and the report send require the panel password, entered
 * on the page and sent as an x-panel-password header.
 */
export function renderPage({ settings, status }) {
  const ck = (b) => (b ? ' checked' : '');
  const rows = [
    {
      id: 'sort',
      on: settings.sort,
      title: 'Push sold-out products to the bottom',
      desc: 'In-stock products stay up top; anything sold out sinks to the last page.',
    },
    {
      id: 'notify',
      on: settings.notify,
      title: 'Email me a daily digest',
      desc: 'One summary a day of everything that newly sold out.',
    },
    {
      id: 'draft',
      on: settings.draft,
      title: 'Draft sold-out products',
      desc: 'Hide them from the storefront until they’re back in stock.',
    },
  ];
  const toggles = rows
    .map(
      (r) => `
      <label class="row" for="${r.id}">
        <input type="checkbox" id="${r.id}"${ck(r.on)} class="sw">
        <span class="track" aria-hidden="true"><span class="thumb"></span></span>
        <span class="rowtext">
          <span class="rowtitle">${r.title}</span>
          <span class="rowdesc">${r.desc}</span>
        </span>
      </label>`
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OOS Sorter</title>
<style>
  :root{
    --bg:#eef1f6; --surface:#ffffff; --ink:#161b22; --muted:#5f6875; --faint:#8b95a3;
    --line:#e4e8ef; --accent:#0e9c6b; --accent-ink:#0a6b4a; --accent-wash:#e6f6ef;
    --shadow:0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.06);
    --radius:16px; --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0d1117; --surface:#161c24; --ink:#e7edf4; --muted:#9aa4b2; --faint:#6b7482;
    --line:#232b36; --accent:#2cc98a; --accent-ink:#7fe3bc; --accent-wash:#12241d;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35);
  }}
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:var(--bg); color:var(--ink); font-family:var(--sans);
    -webkit-font-smoothing:antialiased; line-height:1.5;
    padding:32px 20px; display:flex; justify-content:center;
  }
  .wrap{width:100%; max-width:520px}
  /* header */
  .head{display:flex; align-items:center; gap:12px; margin:4px 0 22px}
  .mark{width:34px; height:34px; border-radius:9px; background:var(--surface);
    border:1px solid var(--line); box-shadow:var(--shadow);
    display:flex; flex-direction:column; justify-content:center; gap:3px; padding:8px 7px}
  .mark i{display:block; height:3px; border-radius:2px; background:var(--accent)}
  .mark i:nth-child(1){width:100%}
  .mark i:nth-child(2){width:72%; opacity:.6}
  .mark i:nth-child(3){width:44%; opacity:.3}
  .htext{flex:1; min-width:0}
  .htext h1{font-size:19px; font-weight:750; letter-spacing:-.02em; margin:0}
  .htext p{margin:1px 0 0; color:var(--muted); font-size:13px}
  .pill{font-family:var(--mono); font-size:11px; letter-spacing:.02em; color:var(--accent-ink);
    background:var(--accent-wash); border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);
    padding:5px 9px 5px 8px; border-radius:999px; display:inline-flex; align-items:center; gap:6px; white-space:nowrap}
  .dot{width:7px; height:7px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 50%,transparent)}
  @media (prefers-reduced-motion:no-preference){.dot{animation:pulse 2.4s ease-out infinite}}
  @keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
  /* cards */
  .card{background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow)}
  .status{padding:20px 22px; display:flex; align-items:baseline; gap:16px; margin-bottom:22px}
  .stat{display:flex; align-items:baseline; gap:9px}
  .stat b{font-family:var(--mono); font-size:34px; font-weight:600; letter-spacing:-.03em; line-height:1}
  .stat span{color:var(--muted); font-size:13px}
  .lastrun{margin-left:auto; font-family:var(--mono); font-size:12px; color:var(--faint); white-space:nowrap}
  .eyebrow{font-size:11px; font-weight:650; letter-spacing:.09em; text-transform:uppercase;
    color:var(--faint); margin:0 0 10px 4px}
  /* toggle rows */
  .rows .row{display:flex; align-items:flex-start; gap:14px; padding:16px 20px; cursor:pointer; margin:0}
  .rows .row + .row{border-top:1px solid var(--line)}
  .sw{position:absolute; opacity:0; width:0; height:0}
  .track{flex:none; margin-top:2px; width:40px; height:24px; border-radius:999px; background:var(--line);
    position:relative; transition:background .18s ease}
  .thumb{position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%;
    background:#fff; box-shadow:0 1px 2px rgba(16,24,40,.35); transition:transform .18s ease}
  .sw:checked ~ .track{background:var(--accent)}
  .sw:checked ~ .track .thumb{transform:translateX(16px)}
  .sw:focus-visible ~ .track{outline:2px solid var(--accent); outline-offset:2px}
  .rowtext{display:flex; flex-direction:column; gap:2px}
  .rowtitle{font-size:14.5px; font-weight:560}
  .rowdesc{font-size:12.5px; color:var(--muted); line-height:1.45}
  /* actions */
  .actions{margin-top:18px; display:flex; flex-wrap:wrap; align-items:center; gap:12px}
  button{font-family:var(--sans); font-size:14px; font-weight:560; border-radius:10px; cursor:pointer;
    padding:10px 16px; border:1px solid transparent; transition:filter .15s ease, background .15s ease}
  .primary{background:var(--accent); color:#fff}
  .primary:hover{filter:brightness(1.05)}
  .ghost{background:var(--surface); color:var(--ink); border-color:var(--line)}
  .ghost:hover{background:var(--bg)}
  button:disabled{opacity:.6; cursor:default}
  #msg{font-family:var(--mono); font-size:12px; color:var(--accent-ink)}
  #msg.err{color:#d1495b}
  .pw{margin-top:16px; display:flex; align-items:center; gap:10px}
  .pw input{font-family:var(--mono); font-size:13px; padding:9px 11px; border-radius:10px;
    border:1px solid var(--line); background:var(--surface); color:var(--ink); width:190px; max-width:60%}
  .pw input:focus{outline:2px solid var(--accent); outline-offset:1px; border-color:transparent}
  .pw label{font-size:12px; color:var(--faint)}
  .foot{margin:22px 4px 0; color:var(--faint); font-size:11.5px; line-height:1.5}
</style></head>
<body>
<div class="wrap">
  <header class="head">
    <div class="mark"><i></i><i></i><i></i></div>
    <div class="htext">
      <h1>OOS Sorter</h1>
      <p>Keeps sold-out products at the bottom of your collections.</p>
    </div>
    <span class="pill"><span class="dot"></span> running</span>
  </header>

  <section class="card status">
    <div class="stat"><b>${Number(status.soldOutCount) || 0}</b><span>sold out</span></div>
    <div class="lastrun" data-lastrun="${status.lastRun ? esc(status.lastRun) : ''}">last run —</div>
  </section>

  <p class="eyebrow">Automations</p>
  <form id="f" class="card rows">${toggles}</form>

  <div class="actions">
    <button type="submit" form="f" class="primary" id="save">Save changes</button>
    <button type="button" class="ghost" id="report">Email me the sold-out list</button>
    <span id="msg"></span>
  </div>

  <div class="pw">
    <label for="pw">Panel password</label>
    <input type="password" id="pw" placeholder="to save or send" autocomplete="current-password">
  </div>

  <p class="foot">Changes take effect on the next run. Sold-out is judged by what your online store can actually sell.</p>
</div>

<script>
  var pw = document.getElementById('pw'), msg = document.getElementById('msg');
  try { pw.value = localStorage.getItem('oos_pw') || ''; } catch (e) {}

  function flash(t, err){ msg.textContent = t; msg.className = err ? 'err' : ''; if(!err) setTimeout(function(){ if(msg.textContent===t) msg.textContent=''; }, 2500); }

  function rel(iso){
    if(!iso) return 'last run —';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime())/1000);
    if (s < 60) return 'last run just now';
    var m = Math.floor(s/60); if (m < 60) return 'last run ' + m + ' min ago';
    var h = Math.floor(m/60); if (h < 24) return 'last run ' + h + ' hr ago';
    return 'last run ' + Math.floor(h/24) + ' d ago';
  }
  var lr = document.querySelector('.lastrun');
  function tick(){ lr.textContent = rel(lr.dataset.lastrun); }
  tick(); setInterval(tick, 30000);

  function needPw(){ var v = (pw.value||'').trim(); if(!v){ flash('Enter the panel password', true); pw.focus(); } return v; }

  document.getElementById('f').addEventListener('submit', async function(e){
    e.preventDefault();
    var p = needPw(); if(!p) return;
    var body = { sort: sort.checked, notify: notify.checked, draft: draft.checked };
    var r = await fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json','x-panel-password':p}, body: JSON.stringify(body) });
    if (r.ok){ try{ localStorage.setItem('oos_pw', p); }catch(e){} flash('Saved \\u2713'); }
    else flash(r.status===401 ? 'Wrong password' : 'Couldn\\u2019t save', true);
  });

  document.getElementById('report').addEventListener('click', async function(){
    var p = needPw(); if(!p) return;
    var b = document.getElementById('report'); b.disabled = true; var old = b.textContent; b.textContent = 'Sending\\u2026';
    var r = await fetch('/api/report', { method:'POST', headers:{'x-panel-password':p} });
    var j = await r.json().catch(function(){ return {}; });
    if (r.ok){ try{ localStorage.setItem('oos_pw', p); }catch(e){} flash('Sent to your email (' + (j.count!=null?j.count:'?') + ') \\u2713'); }
    else flash(r.status===401 ? 'Wrong password' : 'Couldn\\u2019t send', true);
    b.disabled = false; b.textContent = old;
  });
</script>
</body></html>`;
}

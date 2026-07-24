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

/** Server-rendered settings page. `status = { soldOutCount, lastRun }`. */
export function renderPage({ settings, status }) {
  const ck = (b) => (b ? ' checked' : '');
  const last = status.lastRun ? new Date(status.lastRun).toLocaleString() : 'never';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OOS Sorter</title>
<style>
  body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.4rem} .row{display:flex;align-items:center;gap:.6rem;margin:1rem 0}
  .status{color:#555;font-size:.9rem;margin:1.5rem 0} button{font-size:1rem;padding:.5rem 1rem;cursor:pointer}
  #msg{margin-left:.5rem;color:#0a7d29}
</style></head><body>
<h1>OOS Sorter</h1>
<form id="f">
  <div class="row"><input type="checkbox" id="sort"${ck(settings.sort)}><label for="sort">Push sold-out products to the bottom</label></div>
  <div class="row"><input type="checkbox" id="notify"${ck(settings.notify)}><label for="notify">Email me a daily sold-out digest</label></div>
  <div class="row"><input type="checkbox" id="draft"${ck(settings.draft)}><label for="draft">Draft (hide) sold-out products</label></div>
  <button type="submit">Save</button><span id="msg"></span>
</form>
<div class="status">Currently sold out: <b>${status.soldOutCount}</b> &middot; last run: ${last}</div>
<button id="report">Email me the sold-out list now</button>
<script>
  const msg = document.getElementById('msg');
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { sort: sort.checked, notify: notify.checked, draft: draft.checked };
    const r = await fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    msg.textContent = r.ok ? 'Saved ✓' : 'Error';
    setTimeout(() => msg.textContent = '', 2000);
  });
  document.getElementById('report').addEventListener('click', async () => {
    const b = document.getElementById('report'); b.disabled = true; b.textContent = 'Sending…';
    const r = await fetch('/api/report', { method:'POST' });
    const j = await r.json().catch(() => ({}));
    b.textContent = r.ok ? ('Sent to your email (' + (j.count ?? '?') + ') ✓') : 'Error';
    setTimeout(() => { b.disabled = false; b.textContent = 'Email me the sold-out list now'; }, 3000);
  });
</script>
</body></html>`;
}

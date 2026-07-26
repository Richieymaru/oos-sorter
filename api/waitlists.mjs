import { requireAuth } from './_auth.mjs';
import { shell, setPageHeaders, esc } from '../ui.mjs';
import { productsWithWaitlist, notifyOneProduct } from '../restock.mjs';
import { shortId, longId } from '../shopify.mjs';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

function statCard(value, label) {
  return `<div class="card stat"><div class="statval mono">${value}</div><div class="statlabel">${esc(label)}</div></div>`;
}

export default async function handler(req, res) {
  // POST = "Send now" for one product (password / session-token gated).
  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    res.setHeader('Content-Type', 'application/json');
    try {
      const { productId } = await readJson(req);
      const s = String(productId || '');
      const num = s.replace(/\D/g, '');
      const gid = s.startsWith('gid://') ? s : (num ? longId(num) : null);
      if (!gid) { res.end(JSON.stringify({ ok: false, error: 'Missing product.' })); return; }
      const r = await notifyOneProduct(gid, {});
      res.end(JSON.stringify({ ok: true, sent: r.sent }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET = the page.
  const items = await productsWithWaitlist().catch(() => []);
  const total = items.reduce((n, w) => n + w.list.length, 0);
  const rows = items.length
    ? items
        .map(
          (w) => `<tr>
          <td class="cname">${esc(w.title)}</td>
          <td class="num">${w.list.length}</td>
          <td style="text-align:right"><button class="ghost send" data-id="${esc(shortId(w.id))}" data-title="${esc(w.title)}">Send now</button></td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" class="empty">No waitlists yet. Shoppers join from the "Notify When Available" button on sold-out product pages.</td></tr>`;

  const body = `
  <div class="pagehead"><h1>Waitlists</h1><p>Shoppers waiting for a sold-out product to return. They're emailed automatically on restock &mdash; or send now.</p></div>
  <div class="grid c3" style="margin-bottom:16px">
    ${statCard(items.length, 'Products with a waitlist')}
    ${statCard(total, 'Shoppers waiting')}
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Product</th><th class="num">Waiting</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="pw" style="margin-top:16px">
    <label for="pw">Panel password</label>
    <input type="password" id="pw" placeholder="to send" autocomplete="current-password">
    <span id="msg" class="faint" style="margin-left:6px"></span>
  </div>
  <script>
    var pw=document.getElementById('pw'), msg=document.getElementById('msg');
    var embedded=(typeof shopify!=='undefined' && !!shopify.idToken);
    if(embedded){ var pwd=document.querySelector('.pw'); if(pwd) pwd.style.display='none'; }
    else { try{ pw.value=localStorage.getItem('oos_pw')||''; }catch(e){} }
    async function authH(){ var h={'Content-Type':'application/json'}; if(embedded){ try{ var t=await shopify.idToken(); if(t){ h['Authorization']='Bearer '+t; return h; } }catch(e){} } h['x-panel-password']=(pw.value||'').trim(); return h; }
    document.querySelectorAll('.send').forEach(function(b){
      b.addEventListener('click', async function(){
        if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msg.textContent='Enter the panel password'; pw.focus(); return; } }
        if(!confirm('Email everyone waiting for "'+b.dataset.title+'" and clear the list?')) return;
        b.disabled=true; var old=b.textContent; b.textContent='Sending...';
        var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify({productId:b.dataset.id})});
        var j=await r.json().catch(function(){return{};});
        if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } msg.textContent='Sent to '+(j.sent||0)+' \\u2713'; var row=b.closest('tr'); if(row) row.remove(); }
        else { msg.textContent=r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not send'); b.disabled=false; b.textContent=old; }
      });
    });
  </script>`;
  setPageHeaders(res);
  res.end(shell({ title: 'Waitlists', active: 'waitlists', body }));
}

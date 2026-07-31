import { requireAuth } from './_auth.mjs';
import { shell, setPageHeaders, esc } from '../ui.mjs';
import { productsWithWaitlist, notifyOneProduct } from '../restock.mjs';
import { fetchProductsByIds } from '../catalog.mjs';
import { isVariantInStock } from '../stock.mjs';
import { shortId, longId } from '../shopify.mjs';

/**
 * A display-only variant name for entries that recorded no variant (they signed
 * up before variants were tracked). Uses the product's own variants: if exactly
 * one real-named variant is sold out, that's almost certainly the one they want;
 * for a single-option product it's simply that option. Ambiguous cases (several
 * sold-out options) stay a dash — we don't guess which the shopper meant.
 */
function fallbackVariantName(product) {
  if (!product) return null;
  const named = product.variants.nodes.filter((v) => v.title && v.title !== 'Default Title');
  if (!named.length) return null;
  const soldOut = named.filter((v) => !isVariantInStock(product, String(v.id).replace(/\D/g, '')));
  const candidates = soldOut.length ? soldOut : named;
  return candidates.length === 1 ? candidates[0].title : null;
}

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
      const { productId, variantId } = await readJson(req);
      const s = String(productId || '');
      const num = s.replace(/\D/g, '');
      const gid = s.startsWith('gid://') ? s : (num ? longId(num) : null);
      if (!gid) { res.end(JSON.stringify({ ok: false, error: 'Missing product.' })); return; }
      // No variantId = email the whole product list, as before.
      const r = await notifyOneProduct(gid, { variantId: variantId || null });
      res.end(JSON.stringify({ ok: true, sent: r.sent }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET = the page.
  const items = await productsWithWaitlist().catch(() => []);
  const total = items.reduce((n, w) => n + w.list.length, 0);

  // For any product with an entry that recorded no variant, pull the product's
  // variants so we can show a real option name instead of a dash. Only fetch the
  // ones that actually need it, keeping the query small on a big store.
  const needIds = items
    .filter((w) => w.list.some((s) => !(s.variantTitle && s.variantTitle !== 'Default Title')))
    .map((w) => shortId(w.id));
  let prodById = new Map();
  if (needIds.length) {
    try {
      const prods = await fetchProductsByIds(needIds);
      prodById = new Map(prods.map((p) => [p.id, p]));
    } catch { /* leave dashes if the lookup fails — display only, never blocks the page */ }
  }
  const fmt = (ts) => esc(String(ts || '').replace('T', ' ').slice(0, 16));
  const thumb = (u) =>
    u
      ? `<img src="${esc(u + (u.includes('?') ? '&' : '?') + 'width=96')}" alt="" width="46" height="46" style="width:46px;height:46px;border-radius:9px;object-fit:cover;border:1px solid var(--line);flex:none">`
      : `<div style="width:46px;height:46px;border-radius:9px;background:var(--hover);border:1px solid var(--line);flex:none"></div>`;
  // "Default Title" is Shopify's name for the only variant of a single-variant
  // product — it means nothing to a merchant. When an entry recorded no variant,
  // fall back to the product's own sold-out variant name (`prod`); only if that's
  // ambiguous too do we show a dash.
  const variantLabel = (s, prod) => {
    if (s.variantTitle && s.variantTitle !== 'Default Title') return esc(s.variantTitle);
    // an id was captured but no title — resolve it against the product's variants
    if (s.variantId && prod) {
      const want = String(s.variantId).replace(/\D/g, '');
      const v = prod.variants.nodes.find((x) => String(x.id).replace(/\D/g, '') === want);
      if (v && v.title && v.title !== 'Default Title') return esc(v.title);
    }
    if (s.variantId) return `<span class="faint">#${esc(s.variantId)}</span>`;
    const fb = fallbackVariantName(prod);
    return fb ? esc(fb) : '&mdash;';
  };

  /** Group a product's subscribers by variant, so each option can be sent on its own. */
  const byVariant = (list) => {
    const groups = new Map();
    for (const s of list) {
      const key = s.variantId ? String(s.variantId) : '';
      if (!groups.has(key)) groups.set(key, { variantId: key, title: s.variantTitle || '', subs: [] });
      groups.get(key).subs.push(s);
    }
    return [...groups.values()];
  };

  const sendButton = (w, variantId, label, count) =>
    `<button class="ghost send" data-id="${esc(shortId(w.id))}" data-variant="${esc(variantId || '')}" data-title="${esc(label)}" data-count="${count}">Send now</button>`;

  const cards = items.length
    ? items
        .map((w) => {
          const groups = byVariant(w.list);
          // One button per variant once a product has more than one waiting option —
          // sending product-wide would clear shoppers whose variant is still sold out.
          const perVariant = groups.length > 1;

          const prod = prodById.get(w.id) || null;
          const rows = w.list
            .map(
              (s) =>
                `<tr><td class="mono">${esc(s.email)}</td><td>${variantLabel(s, prod)}</td><td class="num">${fmt(s.ts)}</td></tr>`
            )
            .join('');

          const groupSenders = perVariant
            ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                 <span class="faint" style="font-size:12.5px">Send by option:</span>
                 ${groups
                   .map((g) => {
                     const name =
                       g.title && g.title !== 'Default Title' ? g.title : g.variantId ? `#${g.variantId}` : 'No option recorded';
                     return `${sendButton(w, g.variantId, `${w.title} — ${name}`, g.subs.length)}
                       <span class="faint" style="font-size:12.5px;margin:0 6px 0 -4px">${esc(name)} (${g.subs.length})</span>`;
                   })
                   .join('')}
               </div>`
            : '';

          return `<div class="card pad" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${thumb(w.image)}
          <div style="flex:1;min-width:180px">
            <div class="cname" style="font-size:15px">${esc(w.title)}</div>
            <div class="faint" style="font-size:12.5px">${w.list.length} shopper(s) waiting${
            perVariant ? ` across ${groups.length} options` : ''
          }</div>
          </div>
          ${sendButton(w, '', w.title, w.list.length)}
        </div>
        ${groupSenders}
        <table style="margin-top:12px">
          <thead><tr><th>Email</th><th>Variant</th><th class="num">Joined</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
        })
        .join('')
    : `<div class="card empty">No waitlists yet. Shoppers join from the "Notify me when available" button on sold-out product pages.</div>`;

  const body = `
  <div class="pagehead"><h1>Waitlists</h1><p>Shoppers waiting for a sold-out product to return. They're emailed automatically on restock &mdash; or send now.</p></div>
  <div class="grid c3" style="margin-bottom:16px">
    ${statCard(items.length, 'Products with a waitlist')}
    ${statCard(total, 'Shoppers waiting')}
  </div>
  ${cards}
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
        var n=b.dataset.count||'0';
        if(!confirm('Email the '+n+' shopper(s) waiting for "'+b.dataset.title+'" and remove them from the list?')) return;
        b.disabled=true; var old=b.textContent; b.textContent='Sending...';
        var body={productId:b.dataset.id};
        if(b.dataset.variant) body.variantId=b.dataset.variant;
        var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify(body)});
        var j=await r.json().catch(function(){return{};});
        if(r.ok&&j.ok){
          if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} }
          msg.textContent='Sent to '+(j.sent||0)+' \\u2713';
          // A per-variant send leaves the other options on the list, so re-read the
          // page rather than guessing which rows survived.
          setTimeout(function(){ location.reload(); }, 700);
        }
        else { msg.textContent=r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not send'); b.disabled=false; b.textContent=old; }
      });
    });
  </script>`;
  setPageHeaders(res);
  res.end(shell({ title: 'Waitlists', active: 'waitlists', body }));
}

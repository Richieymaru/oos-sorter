/**
 * Auth check + the Settings form body. Rendering is string-based and unit-tested
 * (panel.test.mjs); the page shell/CSS lives in ui.mjs.
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

/**
 * Inner HTML for the Settings page (wrapped by ui.shell). The page is viewable
 * without a password; Save and the report send require the panel password,
 * entered here and sent as an x-panel-password header.
 */
export function settingsBody(settings) {
  const ck = (b) => (b ? ' checked' : '');
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const recips = (settings.notifyEmails || []).join('\n');
  const slack = settings.slackWebhook || '';
  const monitorSlack = settings.monitorSlackWebhook || '';
  const sheet = settings.sheetWebhook || '';
  const nudgeDays = Number.isFinite(settings.nudgeDays) ? settings.nudgeDays : 2;
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
      title: 'Email me when a product sells out',
      desc: 'Alerts your notification recipients the moment a product goes out of stock.',
    },
    {
      id: 'draft',
      on: settings.draft,
      title: 'Draft sold-out products',
      desc: 'Hide them from the storefront until they’re back in stock.',
    },
    {
      id: 'waitlist',
      on: settings.waitlist,
      title: 'Back-in-stock waitlist',
      desc: 'Let shoppers get an email when a sold-out product returns; auto-notify them on restock.',
    },
    {
      id: 'monitor',
      on: settings.monitor,
      title: 'Product change monitor',
      desc: 'Logs who changes a product’s status (Draft ↔ Active ↔ Archived) to Slack and your Google Sheet — even after the store activity log is purged.',
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

  return `
  <p class="eyebrow">Automations</p>
  <form id="f" class="card rows">${toggles}</form>
  <div class="card pad" style="margin-top:14px">
    <label class="rowtitle" for="recips">Notification recipients</label>
    <p class="rowdesc" style="margin:3px 0 9px">Extra emails that also get the daily digest and the "email me" report. One per line.</p>
    <textarea id="recips" rows="3" placeholder="teammate@example.com" style="width:100%;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">${esc(recips)}</textarea>
  </div>
  <div class="card pad" style="margin-top:14px">
    <label class="rowtitle" for="slack">Slack — back-in-stock waitlist</label>
    <p class="rowdesc" style="margin:3px 0 9px">Paste a Slack Incoming Webhook URL to get a message whenever a shopper joins a back-in-stock waitlist. This channel is only for waitlist signups — product status changes have their own Slack field below. Leave blank to turn waitlist Slack off.</p>
    <input id="slack" type="url" placeholder="https://hooks.slack.com/services/…" value="${esc(slack)}" style="width:100%;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
  </div>
  <div class="card pad" style="margin-top:14px">
    <label class="rowtitle" for="nudgeDays">Back-in-stock nudge delay</label>
    <p class="rowdesc" style="margin:3px 0 9px">Days to wait for the <strong>first</strong> automatic follow-up after someone is notified (if they haven’t clicked or ordered and the product is still in stock). After that, a second follow-up goes out <strong>+2 days</strong> later and a third <strong>+7 days</strong> later — up to 3 total, then it stops. Anyone who orders or clicks is dropped. Range 1–14 days.</p>
    <input id="nudgeDays" type="number" min="1" max="14" value="${nudgeDays}" style="width:90px;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
  </div>
  <div class="card pad" style="margin-top:14px">
    <label class="rowtitle" for="logoFile">Email logo (optional)</label>
    <p class="rowdesc" style="margin:3px 0 9px">Shown at the top of the shopper emails instead of your store name. <strong>Upload an image</strong> (PNG/JPG/SVG, under ~90 KB — an SVG or trimmed logo is ideal) or paste a hosted image URL. Leave blank to use your store’s brand logo if set, otherwise the store name.</p>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <input type="file" id="logoFile" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" style="font:12px var(--mono);max-width:100%">
      <button type="button" class="ghost" id="logoUpload">Upload</button>
      <span id="logoMsg" class="faint" style="font-size:12px"></span>
    </div>
    <div style="height:10px"></div>
    <label class="rowtitle" for="emailLogoUrl" style="font-size:12.5px">Logo URL</label>
    <input id="emailLogoUrl" type="url" placeholder="https://…/logo.png" value="${esc(settings.emailLogoUrl || '')}" style="width:100%;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);margin-top:4px">
    <div id="logoPrev" style="margin-top:10px;display:none"></div>
  </div>
  <div class="card pad" style="margin-top:14px">
    <label class="row" for="freeGiftEnabled" style="margin-bottom:6px">
      <input type="checkbox" id="freeGiftEnabled"${ck(settings.freeGiftEnabled)} class="sw">
      <span class="track" aria-hidden="true"><span class="thumb"></span></span>
      <span class="rowtext">
        <span class="rowtitle">Offer a free gift in the follow-up nudge</span>
        <span class="rowdesc">When a notified shopper still hasn’t clicked after the nudge delay, the follow-up email (and any Resend) offers this product free. ⚠️ Set up the actual free-gift fulfilment in Shopify first (a free Buy-X-Get-Y automatic discount or a free-gift app) — this only writes the offer into the email. Off by default.</span>
      </span>
    </label>
    <div style="height:10px"></div>
    <label class="rowtitle" for="freeGiftProduct">Free product to offer</label>
    <p class="rowdesc" style="margin:3px 0 9px">One product only. Choose it from your store, or type the name. Default is “Free gels”.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="freeGiftProduct" type="text" placeholder="Free gels" value="${esc(settings.freeGiftProduct || '')}" style="flex:1;min-width:0;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
      <button type="button" class="ghost pickgift" data-target="freeGiftProduct" style="display:none;white-space:nowrap">Choose product</button>
    </div>
    <input type="hidden" id="freeGiftImage" value="${esc(settings.freeGiftImage || '')}">
    <input type="hidden" id="freeGiftVariantId" value="${esc(settings.freeGiftVariantId || '')}">
    <div class="giftprev" id="prev_freeGiftProduct" style="display:none;gap:8px;align-items:center;margin-top:9px;font-size:12.5px"></div>
  </div>
  <div class="card pad" style="margin-top:14px">
    <div class="rowtitle">Offer a different variant (manual)</div>
    <p class="rowdesc" style="margin:4px 0 0">When a shopper’s option is still sold out but a <strong>different</strong> option of the same product is in stock, you can email them the available one. On the <a href="/waitlists" style="color:var(--accent-ink);font-weight:600">Waitlists</a> page each product shows its in-stock options as buttons — click one to send. This is <strong>manual only</strong>: nothing goes out automatically.</p>
  </div>
  <div class="card pad" style="margin-top:14px">
    <label class="row" for="incentivesEnabled" style="margin-bottom:6px">
      <input type="checkbox" id="incentivesEnabled"${ck(settings.incentivesEnabled)} class="sw">
      <span class="track" aria-hidden="true"><span class="thumb"></span></span>
      <span class="rowtext">
        <span class="rowtitle">Order perks by price (free shipping + gifts)</span>
        <span class="rowdesc">Show tiered perks in the restock emails based on the product’s price, in your store’s currency. ⚠️ This only writes the offer into the email — set up the real free-shipping rule and gift fulfilment in Shopify first. Off by default.</span>
      </span>
    </label>
    <div style="height:10px"></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <label class="rowtitle" for="incentiveTier1">Free shipping from</label>
        <div><input id="incentiveTier1" type="number" min="0" value="${Number(settings.incentiveTier1) || 0}" style="width:120px;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)"></div>
      </div>
      <div>
        <label class="rowtitle" for="incentiveTier2">+ minor gift from</label>
        <div><input id="incentiveTier2" type="number" min="0" value="${Number(settings.incentiveTier2) || 0}" style="width:120px;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)"></div>
      </div>
      <div>
        <label class="rowtitle" for="incentiveTier3">+ major gift from</label>
        <div><input id="incentiveTier3" type="number" min="0" value="${Number(settings.incentiveTier3) || 0}" style="width:120px;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)"></div>
      </div>
    </div>
    <div style="height:12px"></div>
    <label class="rowtitle" for="incentiveMinorGift">Minor gift product</label>
    <p class="rowdesc" style="margin:3px 0 9px">One product only, given at the “+ minor gift” tier. Choose it from your store or type the name. Leave blank to just say “a free gift”.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="incentiveMinorGift" type="text" placeholder="e.g. Free gels (10,000pcs)" value="${esc(settings.incentiveMinorGift || '')}" style="flex:1;min-width:0;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
      <button type="button" class="ghost pickgift" data-target="incentiveMinorGift" style="display:none;white-space:nowrap">Choose product</button>
    </div>
    <input type="hidden" id="incentiveMinorGiftImage" value="${esc(settings.incentiveMinorGiftImage || '')}">
    <input type="hidden" id="incentiveMinorGiftVariantId" value="${esc(settings.incentiveMinorGiftVariantId || '')}">
    <div class="giftprev" id="prev_incentiveMinorGift" style="display:none;gap:8px;align-items:center;margin-top:9px;font-size:12.5px"></div>
    <div style="height:12px"></div>
    <label class="rowtitle" for="incentiveMajorGift">Major gift product</label>
    <p class="rowdesc" style="margin:3px 0 9px">One product only, given at the “+ major gift” tier. Choose it from your store or type the name. Leave blank to just say “a premium free gift”.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="incentiveMajorGift" type="text" placeholder="e.g. Gel blaster bundle" value="${esc(settings.incentiveMajorGift || '')}" style="flex:1;min-width:0;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
      <button type="button" class="ghost pickgift" data-target="incentiveMajorGift" style="display:none;white-space:nowrap">Choose product</button>
    </div>
    <input type="hidden" id="incentiveMajorGiftImage" value="${esc(settings.incentiveMajorGiftImage || '')}">
    <input type="hidden" id="incentiveMajorGiftVariantId" value="${esc(settings.incentiveMajorGiftVariantId || '')}">
    <div class="giftprev" id="prev_incentiveMajorGift" style="display:none;gap:8px;align-items:center;margin-top:9px;font-size:12.5px"></div>
    <div style="height:14px"></div>
    <label class="row" for="addGiftsToCart" style="margin-bottom:0">
      <input type="checkbox" id="addGiftsToCart"${ck(settings.addGiftsToCart)} class="sw">
      <span class="track" aria-hidden="true"><span class="thumb"></span></span>
      <span class="rowtext">
        <span class="rowtitle">Add the gift(s) to the cart on “Add to cart”</span>
        <span class="rowdesc">When a shopper clicks <strong>Add to cart</strong>, also put the free gift(s) in their cart so a Shopify <strong>Buy-X-Get-Y automatic discount</strong> can make them free. ⚠️ Set up that discount first (buy the product → free gift) — otherwise shoppers get CHARGED for the “free” item. Only works for gifts you <strong>picked from your store</strong> (so they have a variant). Off by default.</span>
      </span>
    </label>
    <p class="rowdesc" style="margin:10px 2px 0">Perks apply when a product’s price is <strong>at or above</strong> a tier (e.g. “Free shipping from 200” = A$200 and up).</p>
  </div>
  <div class="card pad" style="margin-top:14px">
    <label class="rowtitle" for="monitorSlack">Slack — product changes</label>
    <p class="rowdesc" style="margin:3px 0 9px">Paste a Slack Incoming Webhook URL to get a message whenever a product’s status changes. Separate from the waitlist Slack above — point it at your product-changes channel. Leave blank to skip Slack for product changes (the Google Sheet still logs them).</p>
    <input id="monitorSlack" type="url" placeholder="https://hooks.slack.com/services/…" value="${esc(monitorSlack)}" style="width:100%;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
    <div style="height:14px"></div>
    <label class="rowtitle" for="sheet">Product-change log (Google Sheet)</label>
    <p class="rowdesc" style="margin:3px 0 9px">Paste the Google Apps Script Web App URL to append a row every time a product’s status changes (product, old → new, stock, who, time). Used by the Product change monitor above. Leave blank to skip the sheet.</p>
    <input id="sheet" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(sheet)}" style="width:100%;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap">
      <button type="button" class="ghost" id="setupMon">Set up monitor on this store</button>
      <span id="setupMsg" class="faint" style="font-size:12px"></span>
    </div>
    <p class="faint" style="margin:8px 2px 0;font-size:11.5px">Run once (and after any URL change): subscribes the product-change webhook and records every product’s current status as the baseline. Safe to click again — it just refreshes.</p>
  </div>
  <div class="actions">
    <button type="submit" form="f" class="primary" id="save">Save changes</button>
    <button type="button" class="ghost" id="report">Email me the sold-out list</button>
    <span id="msg"></span>
  </div>
  <div class="pw">
    <label for="pw">Panel password</label>
    <input type="password" id="pw" placeholder="to save or send" autocomplete="current-password">
  </div>
  <p class="faint" style="margin:22px 4px 0;font-size:11.5px">Changes take effect on the next run. Sold-out is judged by what your online store can actually sell.</p>
  <script>
    var pw=document.getElementById('pw'), msg=document.getElementById('msg');
    var embedded=(typeof shopify!=='undefined' && !!shopify.idToken);
    if(embedded){ var pwd=document.querySelector('.pw'); if(pwd) pwd.style.display='none'; }
    else { try{ pw.value=localStorage.getItem('oos_pw')||''; }catch(e){} }
    function flash(t,err){ msg.textContent=t; msg.className=err?'err':''; if(!err) setTimeout(function(){ if(msg.textContent===t) msg.textContent=''; },2500); }
    function needAuth(){ if(embedded) return true; var v=(pw.value||'').trim(); if(!v){ flash('Enter the panel password',true); pw.focus(); return false; } return true; }
    // Email logo: upload a file to Vercel Blob + live preview of the current URL.
    var logoFile=document.getElementById('logoFile'), logoUpload=document.getElementById('logoUpload'), logoMsg=document.getElementById('logoMsg'), logoPrev=document.getElementById('logoPrev'), emailLogoUrl=document.getElementById('emailLogoUrl');
    function renderLogoPrev(){
      if(!logoPrev||!emailLogoUrl) return;
      var u=(emailLogoUrl.value||'').trim();
      logoPrev.textContent='';
      if(!u){ logoPrev.style.display='none'; return; }
      logoPrev.style.display='block';
      var im=document.createElement('img'); im.src=u; im.alt='logo preview';
      im.style.cssText='height:36px;max-height:44px;max-width:220px;border:1px solid var(--line);border-radius:8px;padding:5px 9px;background:#fff';
      im.onerror=function(){ logoPrev.textContent=''; var s=document.createElement('span'); s.className='faint'; s.style.fontSize='12px'; s.textContent="Couldn't load that image URL."; logoPrev.appendChild(s); };
      logoPrev.appendChild(im);
    }
    if(emailLogoUrl){ emailLogoUrl.addEventListener('input', renderLogoPrev); renderLogoPrev(); }
    if(logoUpload) logoUpload.addEventListener('click', async function(){
      if(!needAuth()) return;
      var f=logoFile && logoFile.files && logoFile.files[0];
      if(!f){ logoMsg.textContent='Choose an image first'; return; }
      if(f.size>90000){ logoMsg.textContent='Image must be under ~90 KB (try an SVG or a smaller PNG), or paste a URL'; return; }
      logoUpload.disabled=true; var old=logoUpload.textContent; logoUpload.textContent='Uploading\\u2026'; logoMsg.textContent='';
      try{
        var data=await new Promise(function(resolve,reject){ var fr=new FileReader(); fr.onload=function(){resolve(fr.result);}; fr.onerror=function(){reject(new Error('read'));}; fr.readAsDataURL(f); });
        var r=await fetch('/api/settings',{method:'POST',headers:await authH(true),body:JSON.stringify({action:'upload-logo', filename:f.name, contentType:f.type, data:data})});
        var j=await r.json().catch(function(){return{};});
        if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } emailLogoUrl.value=j.url; renderLogoPrev(); logoMsg.textContent='Uploaded \\u2713 \\u2014 now click Save changes'; }
        else logoMsg.textContent=(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Upload failed'));
      }catch(e){ logoMsg.textContent='Could not read the image'; }
      logoUpload.disabled=false; logoUpload.textContent=old;
    });
    // Gift fields: a Shopify product picker (inside the admin) + a live "added"
    // preview (thumbnail + name) so the owner can SEE the gift that's set, even on
    // reload. The picked product's image is stored so the email uses the exact photo.
    var GIFTIMG={freeGiftProduct:'freeGiftImage', incentiveMinorGift:'incentiveMinorGiftImage', incentiveMajorGift:'incentiveMajorGiftImage'};
    var GIFTVAR={freeGiftProduct:'freeGiftVariantId', incentiveMinorGift:'incentiveMinorGiftVariantId', incentiveMajorGift:'incentiveMajorGiftVariantId'};
    function renderGiftPrev(t){
      var prev=document.getElementById('prev_'+t); if(!prev) return;
      var inp=document.getElementById(t), himg=document.getElementById(GIFTIMG[t]);
      var name=(inp&&inp.value||'').trim(), src=(himg&&himg.value)||'';
      prev.textContent='';
      if(!name){ prev.style.display='none'; return; }
      prev.style.display='flex';
      if(src){ var im=document.createElement('img'); im.src=src+(src.indexOf('?')>-1?'&':'?')+'width=72'; im.alt=''; im.style.cssText='width:30px;height:30px;border-radius:7px;object-fit:cover;border:1px solid var(--line)'; prev.appendChild(im); }
      var sp=document.createElement('span'); sp.textContent=name; sp.style.cssText='font-weight:600;color:var(--ink)'; prev.appendChild(sp);
      var ok=document.createElement('span'); ok.textContent=src?'\\u2713 product added':'\\u2713 will be set'; ok.style.cssText='color:var(--accent-ink);font-weight:600'; prev.appendChild(ok);
    }
    ['freeGiftProduct','incentiveMinorGift','incentiveMajorGift'].forEach(function(t){
      var inp=document.getElementById(t); if(!inp) return;
      inp.addEventListener('input', function(){ var h=document.getElementById(GIFTIMG[t]); if(h) h.value=''; var vv=document.getElementById(GIFTVAR[t]); if(vv) vv.value=''; renderGiftPrev(t); });
      renderGiftPrev(t); // reflect the saved gift on load
    });
    (function(){
      if(!(embedded && typeof shopify!=='undefined' && shopify.resourcePicker)) return;
      document.querySelectorAll('.pickgift').forEach(function(b){
        b.style.display='';
        b.addEventListener('click', async function(){
          try{
            var sel=await shopify.resourcePicker({ type:'product', multiple:false, action:'select' });
            if(sel && sel.length){
              var p=sel[0], t=b.dataset.target;
              var inp=document.getElementById(t); if(inp) inp.value=p.title;
              var src=(p.images&&p.images[0]&&(p.images[0].originalSrc||p.images[0].src))||'';
              var himg=document.getElementById(GIFTIMG[t]); if(himg) himg.value=src;
              var vid=(p.variants&&p.variants[0]&&p.variants[0].id)||''; vid=String(vid).replace(/\\D/g,'');
              var hvar=document.getElementById(GIFTVAR[t]); if(hvar) hvar.value=vid;
              renderGiftPrev(t);
            }
          }catch(e){}
        });
      });
    })();
    async function authH(json){ var h=json?{'Content-Type':'application/json'}:{}; if(embedded){ try{ var t=await shopify.idToken(); if(t){ h['Authorization']='Bearer '+t; return h; } }catch(e){} } h['x-panel-password']=(pw.value||'').trim(); return h; }
    document.getElementById('f').addEventListener('submit', async function(e){
      e.preventDefault(); if(!needAuth()) return;
      var body={ sort:sort.checked, notify:notify.checked, draft:draft.checked, waitlist:waitlist.checked, monitor:monitor.checked, notifyEmails:document.getElementById('recips').value, slackWebhook:document.getElementById('slack').value, monitorSlackWebhook:document.getElementById('monitorSlack').value, sheetWebhook:document.getElementById('sheet').value, nudgeDays:document.getElementById('nudgeDays').value, emailLogoUrl:document.getElementById('emailLogoUrl').value, freeGiftEnabled:document.getElementById('freeGiftEnabled').checked, freeGiftProduct:document.getElementById('freeGiftProduct').value, freeGiftImage:document.getElementById('freeGiftImage').value, freeGiftVariantId:document.getElementById('freeGiftVariantId').value, addGiftsToCart:document.getElementById('addGiftsToCart').checked, incentivesEnabled:document.getElementById('incentivesEnabled').checked, incentiveTier1:document.getElementById('incentiveTier1').value, incentiveTier2:document.getElementById('incentiveTier2').value, incentiveTier3:document.getElementById('incentiveTier3').value, incentiveMinorGift:document.getElementById('incentiveMinorGift').value, incentiveMinorGiftImage:document.getElementById('incentiveMinorGiftImage').value, incentiveMinorGiftVariantId:document.getElementById('incentiveMinorGiftVariantId').value, incentiveMajorGift:document.getElementById('incentiveMajorGift').value, incentiveMajorGiftImage:document.getElementById('incentiveMajorGiftImage').value, incentiveMajorGiftVariantId:document.getElementById('incentiveMajorGiftVariantId').value };
      var r=await fetch('/api/settings',{method:'POST',headers:await authH(true),body:JSON.stringify(body)});
      if(r.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } flash('Saved \\u2713'); }
      else flash(r.status===401?(embedded?'Not authorized':'Wrong password'):'Couldn\\u2019t save',true);
    });
    document.getElementById('report').addEventListener('click', async function(){
      if(!needAuth()) return;
      var b=document.getElementById('report'); b.disabled=true; var old=b.textContent; b.textContent='Sending\\u2026';
      var r=await fetch('/api/report',{method:'POST',headers:await authH(false)});
      var j=await r.json().catch(function(){return{};});
      if(r.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } flash('Sent to your email ('+(j.count!=null?j.count:'?')+') \\u2713'); }
      else flash(r.status===401?(embedded?'Not authorized':'Wrong password'):'Couldn\\u2019t send',true);
      b.disabled=false; b.textContent=old;
    });
    document.getElementById('setupMon').addEventListener('click', async function(){
      if(!needAuth()) return;
      var sm=document.getElementById('setupMsg'), b=this, old=b.textContent; b.disabled=true; b.textContent='Setting up\\u2026'; sm.textContent='';
      var r=await fetch('/api/settings',{method:'POST',headers:await authH(true),body:JSON.stringify({action:'setup-monitor'})});
      var j=await r.json().catch(function(){return{};});
      if(r.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } sm.textContent='Monitor active \\u2713 webhook '+(j.webhook||'ready')+', '+(j.seeded!=null?j.seeded:'?')+' products baselined'; }
      else sm.textContent=(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Setup failed'));
      b.disabled=false; b.textContent=old;
    });
  </script>`;
}

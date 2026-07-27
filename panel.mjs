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
    {
      id: 'waitlist',
      on: settings.waitlist,
      title: 'Back-in-stock waitlist',
      desc: 'Let shoppers get an email when a sold-out product returns; auto-notify them on restock.',
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
    <label class="rowtitle" for="slack">Slack notifications</label>
    <p class="rowdesc" style="margin:3px 0 9px">Paste a Slack Incoming Webhook URL to get a message whenever a shopper joins a back-in-stock waitlist. Change it any time to point at a different channel or Slack workspace. Leave blank to turn Slack off.</p>
    <input id="slack" type="url" placeholder="https://hooks.slack.com/services/…" value="${esc(slack)}" style="width:100%;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
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
    async function authH(json){ var h=json?{'Content-Type':'application/json'}:{}; if(embedded){ try{ var t=await shopify.idToken(); if(t){ h['Authorization']='Bearer '+t; return h; } }catch(e){} } h['x-panel-password']=(pw.value||'').trim(); return h; }
    document.getElementById('f').addEventListener('submit', async function(e){
      e.preventDefault(); if(!needAuth()) return;
      var body={ sort:sort.checked, notify:notify.checked, draft:draft.checked, waitlist:waitlist.checked, notifyEmails:document.getElementById('recips').value, slackWebhook:document.getElementById('slack').value };
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
  </script>`;
}

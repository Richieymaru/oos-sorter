import { requireAuth } from './_auth.mjs';
import { shell, setPageHeaders, esc, statCard } from '../ui.mjs';
import { productsWithWaitlist, notifyOneProduct, resendOne, offerAltForProduct, previewResendEmail, previewOfferEmail } from '../restock.mjs';
import { fetchProductsByIds } from '../catalog.mjs';
import { isVariantInStock, isInStock } from '../stock.mjs';
import { shortId, longId } from '../shopify.mjs';
import { loadSettings } from '../settings.mjs';
import { sendWaitlistReport } from '../notify.mjs';
import { loadNotified, deriveStats, reconcileOrders } from '../notified.mjs';
import { ttlMemo } from '../cache.mjs';

export const config = { maxDuration: 30 };

// Per-instance caches so the page renders fast on repeat opens. The order
// reconcile (a 60-day scan) is the heaviest — cache it 2 min; the waitlist
// product list and per-id stock 1 min. Cold starts fetch fresh and correct.
const cachedWaitlist = ttlMemo(productsWithWaitlist, 60000);
const cachedProductsByIds = ttlMemo(fetchProductsByIds, 60000);

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

/** The owner's own email addresses (NOTIFY_EMAIL + notification recipients),
 *  lowercased. These rows may be re-sent even when sold out (a test to yourself). */
function ownerEmailSet(settings) {
  const list = [process.env.NOTIFY_EMAIL, ...((settings && settings.notifyEmails) || [])];
  return new Set(list.filter(Boolean).map((e) => String(e).trim().toLowerCase()));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  // POST = "Send now" for one product, OR the "email me the full list" report
  // (password / session-token gated).
  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await readJson(req);

      // Background order attribution (fired by the page after first paint, so the
      // 60-day order scan never blocks render). Idempotent — matchOrders skips
      // rows already marked ordered — so the page reloads at most once.
      if (body.action === 'reconcile') {
        let matched = 0, emailRedacted = false;
        try { const at = await reconcileOrders({ days: 60 }); matched = at.matched || 0; emailRedacted = !!at.emailRedacted; }
        catch (e) { console.error('reconcile (bg):', e.message); }
        res.end(JSON.stringify({ ok: true, matched, emailRedacted }));
        return;
      }

      // Email the whole waitlist to the owner + notification recipients.
      if (body.action === 'emailReport') {
        const items = await productsWithWaitlist();
        const shoppers = items.reduce((n, w) => n + w.list.length, 0);
        const settings = await loadSettings().catch(() => ({}));
        await sendWaitlistReport(items, { recipients: settings.notifyEmails || [] });
        res.end(JSON.stringify({ ok: true, products: items.length, shoppers }));
        return;
      }

      // Re-send the back-in-stock email to one shopper (dashboard "Resend"),
      // only if the product is in stock right now.
      if (body.action === 'resend') {
        const rs = String(body.productId || '');
        const rn = rs.replace(/\D/g, '');
        const rgid = rs.startsWith('gid://') ? rs : (rn ? longId(rn) : null);
        if (!rgid || !body.email) { res.end(JSON.stringify({ ok: false, error: 'Missing product or email.' })); return; }
        // `force` (re-send even when sold out) is honoured ONLY for the owner's own
        // addresses — a test send to yourself. Validated server-side.
        let force = false;
        if (body.force) {
          const st = await loadSettings().catch(() => ({}));
          force = ownerEmailSet(st).has(String(body.email || '').trim().toLowerCase());
        }
        const rr = await resendOne(rgid, String(body.email), { variantId: body.variantId || null, force, gift: body.gift || 'auto' });
        if (rr.soldOut) { res.end(JSON.stringify({ ok: false, soldOut: true, error: 'Sold out again — nothing sent.' })); return; }
        res.end(JSON.stringify({ ok: true, sent: rr.sent }));
        return;
      }

      // Render (don't send) the exact email a Resend or an Offer would produce, so
      // the owner can preview it before/after sending.
      if (body.action === 'previewResend' || body.action === 'previewOffer') {
        const ps = String(body.productId || '');
        const pn = ps.replace(/\D/g, '');
        const pgid = ps.startsWith('gid://') ? ps : (pn ? longId(pn) : null);
        if (!pgid) { res.end(JSON.stringify({ ok: false, error: 'Missing product.' })); return; }
        const pbase = `https://${req.headers['x-forwarded-host'] || req.headers['host'] || ''}`;
        const pr = body.action === 'previewResend'
          ? await previewResendEmail(pgid, String(body.email || ''), { variantId: body.variantId || null, base: pbase, gift: body.gift || 'auto' })
          : await previewOfferEmail(pgid, { offerVariantId: body.variantId, base: pbase, gift: body.gift || 'auto' });
        if (pr.error) { res.end(JSON.stringify({ ok: false, error: pr.error })); return; }
        res.end(JSON.stringify({ ok: true, subject: pr.subject, html: pr.html, soldOut: pr.soldOut || false, option: pr.option || null, cart: pr.cart || null }));
        return;
      }

      // Offer ONE in-stock variant as an alternative to everyone still waiting on
      // a product (the "Offer this option" buttons). Doesn't clear the list.
      if (body.action === 'offerAlt') {
        const os = String(body.productId || '');
        const on = os.replace(/\D/g, '');
        const ogid = os.startsWith('gid://') ? os : (on ? longId(on) : null);
        if (!ogid || !body.variantId) { res.end(JSON.stringify({ ok: false, error: 'Missing product or option.' })); return; }
        const or = await offerAltForProduct(ogid, { offerVariantId: body.variantId, gift: body.gift || 'auto' });
        if (or.error) { res.end(JSON.stringify({ ok: false, error: or.error })); return; }
        res.end(JSON.stringify({ ok: true, sent: or.sent, option: or.option }));
        return;
      }

      const { productId, variantId } = body;
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

  // GET = the page. Attribute recent orders to notified shoppers first, so the
  // "Ordered" status + waitlist revenue are fresh every time this page is opened
  // (GBU auto-chunks engine runs, so we can't rely on the full-sweep for this).
  const notifiedView = /[?&]view=notified\b/.test(req.url || '');

  // Fast metafield reads first — both views need these and they're cheap.
  // (loadState was being fetched and discarded; dropped.)
  const [notifiedLog, settings] = await Promise.all([
    loadNotified().catch(() => []),
    loadSettings().catch(() => ({})),
  ]);
  const recent = notifiedLog.slice(0, 100);
  const stats = deriveStats(notifiedLog);
  const recentIds = [...new Set(recent.map((r) => r.p))];

  // The heavy fetches run in ONE parallel batch instead of a serial chain:
  //  - current stock for the notified table's Resend buttons
  //  - the waitlist product list — WAITLISTS view only (unused on Notified)
  // The 60-day order reconcile ("Ordered" + waitlist revenue) is NOT here: it
  // used to block first paint. It now runs in the background after render (see
  // the reconcile fetch in the page script) and refreshes only if new orders
  // were attributed — so the page shows instantly from the persisted log.
  const [recentProds, items] = await Promise.all([
    recentIds.length ? cachedProductsByIds(recentIds).catch(() => []) : Promise.resolve([]),
    notifiedView ? Promise.resolve([]) : cachedWaitlist().catch(() => []),
  ]);
  const attrNote = '';
  const total = items.reduce((n, w) => n + w.list.length, 0);
  const stockById = new Map(recentProds.map((p) => [shortId(p.id), p]));

  // The waitlisted products' variants + stock (option names / offer chips) —
  // WAITLISTS view only; needs `items`, so it follows the batch above.
  let prodById = new Map();
  if (!notifiedView && items.length) {
    try {
      const prods = await cachedProductsByIds(items.map((w) => shortId(w.id)));
      prodById = new Map(prods.map((p) => [p.id, p]));
    } catch { /* leave dashes / no offer chips if the lookup fails */ }
  }
  /** A product's in-stock, real-named variants as [{id, title}] — the options a
   *  merchant can offer to shoppers whose own option is still sold out. */
  const inStockOptions = (prod) => {
    if (!prod) return [];
    return prod.variants.nodes
      .filter((v) => v.title && v.title !== 'Default Title' && isVariantInStock(prod, String(v.id).replace(/\D/g, '')))
      .map((v) => ({ id: String(v.id).replace(/\D/g, ''), title: v.title }));
  };
  /** Shoppers on a list whose own waited option is still sold out (unknown-variant
   *  entries count as waiting) — the recipients of an alternative-option offer. */
  const stillWaiting = (list, prod) => list.filter((s) => {
    const v = s.variantId ? String(s.variantId).replace(/\D/g, '') : null;
    if (!v) return true;
    return prod ? !isVariantInStock(prod, v) : true;
  });
  const fmt = (ts) => esc(String(ts || '').replace('T', ' ').slice(0, 16));
  // A compact, single-line date for narrow table columns: "Oct 19, 10:10".
  // Derived from the ISO string parts so it never shifts the stored time zone.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtShort = (ts) => {
    const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[4]}:${m[5]}` : esc(String(ts || '').slice(0, 16));
  };
  const money = (cur, amt) => `${cur ? cur + ' ' : ''}${(Number(amt) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  const chip = (bg, fg, label) =>
    `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};white-space:nowrap">${label}</span>`;
  const statusChip = (r) => {
    if (r.o) return chip('#e7f6ee', '#0e7a4b', 'Ordered' + (r.oa ? ' · ' + esc(money(r.oc, r.oa)) : ''));
    if (r.u) return chip('#eef1f6', '#8b95a3', 'Unsubscribed');
    if (r.c) return chip('#e7f6ee', '#0e7a4b', 'Clicked');
    if (r.k === 'alt') return chip('#eef2ff', '#4451c7', 'Offered option');
    if (r.n) return chip('#fff3e0', '#a15c00', 'Nudged' + (r.ns > 1 ? ` &times;${r.ns}` : ''));
    return chip('#eef1f6', '#5f6875', 'Notified');
  };
  const inStockNow = (r) => {
    const sp = stockById.get(r.p);
    if (!sp) return false;
    return r.v ? isVariantInStock(sp, r.v) : isInStock(sp);
  };
  const owners = ownerEmailSet(settings);
  const resendCell = (r) => {
    if (r.u) return `<span class="faint" style="font-size:12px">&mdash;</span>`;
    const prev = `<button class="ghost previewR" data-id="${esc(r.p)}" data-email="${esc(r.e)}" data-variant="${esc(r.v || '')}">Preview</button>`;
    if (!inStockNow(r)) {
      // Owner's own email: allow a test re-send even when sold out.
      if (owners.has(String(r.e).toLowerCase())) {
        return `<button class="ghost resend" data-id="${esc(r.p)}" data-email="${esc(r.e)}" data-variant="${esc(r.v || '')}" data-force="1" title="Sold out — send a test to yourself anyway">Resend (test)</button> ${prev}`;
      }
      return `<span class="faint" style="font-size:12px;margin-right:8px">Sold out again</span>${prev}`;
    }
    return `<button class="ghost resend" data-id="${esc(r.p)}" data-email="${esc(r.e)}" data-variant="${esc(r.v || '')}">Resend</button> ${prev}`;
  };
  const vName = (r) => (r.vt && r.vt !== 'Default Title') ? esc(r.vt) : (r.v ? `#${esc(r.v)}` : '&mdash;');
  const recentRows = recent.length
    ? recent.map((r) => `<tr>
        <td class="mono">${esc(r.e)}</td>
        <td>${esc(r.t)}</td>
        <td>${vName(r)}</td>
        <td class="when">${fmtShort(r.ts)}</td>
        <td class="when">${r.c ? fmtShort(r.c) : '<span class="faint">&mdash;</span>'}</td>
        <td>${statusChip(r)}</td>
        <td>${resendCell(r)}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="faint">No one has been notified yet.</td></tr>`;

  const cards = items.length
    ? items
        .map((w) => {
          const groups = byVariant(w.list);
          // One button per variant once a product has more than one waiting option —
          // sending product-wide would clear shoppers whose variant is still sold out.
          const perVariant = groups.length > 1;

          const prod = prodById.get(w.id) || null;

          // "Offer a different option" — in-stock options the merchant can push to
          // the people whose own option is still sold out. Same email as a restock,
          // but headlined with the option they pick; doesn't clear the list.
          const options = inStockOptions(prod);
          const waitingForAlt = stillWaiting(w.list, prod);
          const offerRow = options.length && waitingForAlt.length
            ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                 <span class="faint" style="font-size:12.5px">Offer an in-stock option to the ${waitingForAlt.length} still waiting:</span>
                 ${options
                   .map(
                     (v) =>
                       `<span style="display:inline-flex;align-items:center;gap:3px;margin:0 4px 4px 0">
                          <button class="ghost offer" data-id="${esc(shortId(w.id))}" data-variant="${esc(v.id)}" data-option="${esc(v.title)}" data-count="${waitingForAlt.length}">${esc(v.title)}</button>
                          <button class="ghost previewO" data-id="${esc(shortId(w.id))}" data-variant="${esc(v.id)}" data-option="${esc(v.title)}" title="Preview the email" style="padding:6px 9px;font-size:12px">Preview</button>
                        </span>`
                   )
                   .join('')}
               </div>`
            : '';

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
        ${offerRow}
        <table style="margin-top:12px">
          <thead><tr><th>Email</th><th>Variant</th><th class="num">Joined</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
        })
        .join('')
    : `<div class="card empty">No waitlists yet. Shoppers join from the "Notify me when available" button on sold-out product pages.</div>`;

  const body = `
  ${notifiedView
    ? `<div class="pagehead"><h1>Recently notified</h1><p>Who we emailed when a product came back &mdash; whether they clicked through, and resend if they missed it. <a href="/waitlists" style="color:var(--accent-ink);font-weight:600">&larr; back to waitlists</a></p></div>
  <div class="grid c3" style="margin-bottom:16px">
    ${statCard({ value: stats.totalSent, label: 'Emails sent', sub: (() => {
      const parts = [`${stats.notified - stats.offered} back-in-stock`];
      if (stats.offered) parts.push(`${stats.offered} offer${stats.offered === 1 ? '' : 's'}`);
      parts.push(`${stats.nudgeSends} follow-up${stats.nudgeSends === 1 ? '' : 's'}`);
      return parts.join(' · ');
    })() })}
    ${statCard({ value: `${stats.clicked}`, label: 'Clicked', sub: `${stats.clickRate}% click-through`, tone: stats.clicked ? 'pos' : '' })}
    ${statCard({ value: stats.revenue ? money(stats.currency, stats.revenue) : '—', label: 'Waitlist revenue', sub: `${stats.orders || 0} order(s) from notified`, tone: stats.revenue ? 'pos' : '' })}
  </div>`
    : `<div class="pagehead"><h1>Waitlists</h1><p>Shoppers waiting for a sold-out product to return. They're emailed automatically on restock &mdash; or send now. <a href="/notified" style="color:var(--accent-ink);font-weight:600">see who's been notified &rarr;</a></p></div>
  <div class="grid c3" style="margin-bottom:16px">
    ${statCard({ value: items.length, label: 'Products with a waitlist' })}
    ${statCard({ value: total, label: 'Shoppers waiting' })}
    ${statCard({ value: stats.notified, label: 'Notified (recent)', sub: `${stats.clicked} clicked · ${stats.clickRate}%`, tone: stats.clicked ? 'pos' : '' })}
  </div>`}
  ${attrNote ? `<div class="callout" style="margin:-4px 0 16px"><div class="ct" style="font-size:12.5px">${esc(attrNote)}</div></div>` : ''}
  ${notifiedView ? '' : `<div class="actions" style="margin:0 0 18px">
    <button class="ghost" id="emailAll">Email me the full list</button>
    <span id="msgAll" class="faint" style="font-size:12.5px"></span>
  </div>
  ${cards}`}
  ${notifiedView
    ? `<div class="callout" style="margin:-4px 0 16px"><div class="ct" style="font-size:12.5px">Shoppers who don’t click or order get up to <strong>3 automatic follow-ups</strong> (after ${settings.nudgeDays || 2} days, then +2, then +7) — then it stops. Anyone who <strong>orders or clicks</strong> is dropped automatically.${
        settings.freeGiftEnabled || settings.incentivesEnabled
          ? ` Follow-ups and Resends include ${settings.freeGiftEnabled ? 'your <strong>free-gift offer</strong>' : ''}${settings.freeGiftEnabled && settings.incentivesEnabled ? ' and ' : ''}${settings.incentivesEnabled ? 'your <strong>order perks</strong>' : ''}.`
          : ''
      } <a href="/preview" style="color:var(--accent-ink);font-weight:600">Preview the emails &rarr;</a></div></div>`
    : ''}
  ${notifiedView ? `<div class="card pad">
    <table>
      <thead><tr><th>Email</th><th>Product</th><th>Variant</th><th class="when">Notified</th><th class="when">Clicked</th><th>Status</th><th></th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table>
    <style>.when{text-align:left;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted)}thead th.when{color:var(--faint)}</style>
  </div>` : ''}
  <div class="pw" style="margin-top:16px">
    <label for="pw">Panel password</label>
    <input type="password" id="pw" placeholder="to send" autocomplete="current-password">
    <span id="msg" class="faint" style="margin-left:6px"></span>
  </div>
  <div id="emailModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,41,.55);z-index:1000;padding:18px;box-sizing:border-box">
    <div style="max-width:660px;height:100%;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--muted);text-transform:uppercase">Email preview</span>
        <span id="emSubject" style="font-size:12.5px;color:var(--ink);flex:1;min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        ${settings && settings.freeGiftEnabled ? `<select id="emGift" title="Switch the free gift for this send" style="font:12.5px var(--sans);padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink)">
          <option value="auto">Gift: Auto (by category)</option>
          <option value="default">Gift: Default gels</option>
          <option value="gas">Gift: Gas &amp; custom gels</option>
          <option value="none">Gift: No gift</option>
        </select>` : ''}
        <button type="button" class="primary" id="emSend" style="font-size:12.5px;padding:7px 14px">Send this email</button>
        <button type="button" class="ghost" id="emClose">Close</button>
      </div>
      <div id="emCart" style="display:none;padding:8px 16px;border-bottom:1px solid var(--line);background:#f7f9fc;font:12px var(--mono);color:#48506a;word-break:break-all"></div>
      <iframe id="emFrame" title="Email preview" style="flex:1;width:100%;border:0;background:#eef1f6"></iframe>
    </div>
  </div>
  <script>
    var pw=document.getElementById('pw'), msg=document.getElementById('msg');
    var embedded=(typeof shopify!=='undefined' && !!shopify.idToken);
    if(embedded){ var pwd=document.querySelector('.pw'); if(pwd) pwd.style.display='none'; }
    else { try{ pw.value=localStorage.getItem('oos_pw')||''; }catch(e){} }
    async function authH(){ var h={'Content-Type':'application/json'}; if(embedded){ try{ var t=await shopify.idToken(); if(t){ h['Authorization']='Bearer '+t; return h; } }catch(e){} } h['x-panel-password']=(pw.value||'').trim(); return h; }
    var emailAll=document.getElementById('emailAll'), msgAll=document.getElementById('msgAll');
    if(emailAll) emailAll.addEventListener('click', async function(){
      if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msgAll.textContent='Enter the panel password below'; pw.focus(); return; } }
      emailAll.disabled=true; var old=emailAll.textContent; emailAll.textContent='Sending\\u2026'; msgAll.textContent='';
      var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify({action:'emailReport'})});
      var j=await r.json().catch(function(){return{};});
      if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } msgAll.textContent='Emailed you the full list \\u2014 '+(j.shoppers||0)+' shopper(s) across '+(j.products||0)+' product(s) \\u2713'; }
      else msgAll.textContent=(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not send'));
      emailAll.disabled=false; emailAll.textContent=old;
    });
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
    // Email preview modal — render the exact email without sending it.
    var emModal=document.getElementById('emailModal'), emFrame=document.getElementById('emFrame'), emSubject=document.getElementById('emSubject'), emClose=document.getElementById('emClose');
    function closeEmail(){ if(emModal){ emModal.style.display='none'; emFrame.srcdoc=''; } }
    if(emClose) emClose.addEventListener('click', closeEmail);
    if(emModal) emModal.addEventListener('click', function(e){ if(e.target===emModal) closeEmail(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeEmail(); });
    var emCart=document.getElementById('emCart');
    function showEmail(subject, html, cart){
      emSubject.textContent=subject?('Subject: '+subject):'';
      if(emCart){ if(cart){ emCart.textContent='🛒 Add to cart adds → '+cart+(cart.indexOf(',')>-1?'  ✓ gift included':'  (only this product — no gift added)'); emCart.style.display='block'; } else { emCart.style.display='none'; emCart.textContent=''; } }
      emFrame.srcdoc=html; emModal.style.display='block';
    }
    // The gift override selector + send-from-modal: switch the free gift in the
    // preview and send the exact email you see, with that gift.
    var emGift=document.getElementById('emGift'), emSend=document.getElementById('emSend');
    var emCtx=null; // { kind:'resend'|'offer', data:{...} }
    function giftVal(){ return emGift ? emGift.value : 'auto'; }
    async function renderPreview(ctx, btn){
      if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msg.textContent='Enter the panel password'; pw.focus(); return; } }
      var action = ctx.kind==='resend' ? 'previewResend' : 'previewOffer';
      var old; if(btn){ old=btn.textContent; btn.disabled=true; btn.textContent='\\u2026'; }
      var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify(Object.assign({action:action, gift:giftVal()}, ctx.data))});
      var j=await r.json().catch(function(){return{};});
      if(btn){ btn.disabled=false; btn.textContent=old; }
      if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } showEmail(j.subject, j.html, j.cart); }
      else msg.textContent=(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not preview'));
    }
    function openPreview(kind, data, btn){ emCtx={kind:kind, data:data}; if(emGift) emGift.value='auto'; renderPreview(emCtx, btn); }
    if(emGift) emGift.addEventListener('change', function(){ if(emCtx) renderPreview(emCtx, null); });
    if(emSend) emSend.addEventListener('click', async function(){
      if(!emCtx) return;
      if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msg.textContent='Enter the panel password'; pw.focus(); return; } }
      if(emCtx.kind==='offer' && !confirm('Send this offer email to everyone still waiting (with the selected gift)?')) return;
      emSend.disabled=true; var old=emSend.textContent; emSend.textContent='Sending\\u2026';
      var action = emCtx.kind==='resend' ? 'resend' : 'offerAlt';
      var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify(Object.assign({action:action, gift:giftVal()}, emCtx.data))});
      var j=await r.json().catch(function(){return{};});
      emSend.disabled=false; emSend.textContent=old;
      if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } emSubject.textContent='Sent \\u2713'; setTimeout(function(){ closeEmail(); location.reload(); }, 900); }
      else msg.textContent=(j.soldOut?'Sold out again \\u2014 nothing sent':(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not send')));
    });
    document.querySelectorAll('.previewR').forEach(function(b){ b.addEventListener('click', function(){ openPreview('resend', {productId:b.dataset.id, email:b.dataset.email, variantId:b.dataset.variant}, b); }); });
    document.querySelectorAll('.previewO').forEach(function(b){ b.addEventListener('click', function(){ openPreview('offer', {productId:b.dataset.id, variantId:b.dataset.variant}, b); }); });
    document.querySelectorAll('.offer').forEach(function(b){
      b.addEventListener('click', async function(){
        if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msg.textContent='Enter the panel password'; pw.focus(); return; } }
        var n=b.dataset.count||'0';
        if(!confirm('Email the '+n+' shopper(s) still waiting that "'+b.dataset.option+'" is in stock as an alternative? They stay on the list for their own option.')) return;
        b.disabled=true; var old=b.textContent; b.textContent='Sending\\u2026';
        var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify({action:'offerAlt',productId:b.dataset.id,variantId:b.dataset.variant})});
        var j=await r.json().catch(function(){return{};});
        if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } b.textContent='Offered to '+(j.sent||0)+' \\u2713'; setTimeout(function(){ b.disabled=false; b.textContent=old; },2500); }
        else { b.textContent=old; b.disabled=false; msg.textContent=(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not send')); }
      });
    });
    document.querySelectorAll('.resend').forEach(function(b){
      b.addEventListener('click', async function(){
        if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msg.textContent='Enter the panel password'; pw.focus(); return; } }
        b.disabled=true; var old=b.textContent; b.textContent='Sending\\u2026';
        var body={action:'resend',productId:b.dataset.id,email:b.dataset.email};
        if(b.dataset.variant) body.variantId=b.dataset.variant;
        if(b.dataset.force) body.force=1;
        var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify(body)});
        var j=await r.json().catch(function(){return{};});
        if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } b.textContent='Sent \\u2713'; }
        else { b.textContent=old; b.disabled=false; msg.textContent=(j.soldOut?'Sold out again \\u2014 nothing sent':(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not resend'))); }
      });
    });

    // Freshen order attribution in the background so the 60-day order scan never
    // blocks first paint. Reloads once if new orders were just attributed;
    // reconcile is idempotent, so the reload can't loop.
    setTimeout(function(){
      authH().then(function(h){
        return fetch('/api/waitlists',{method:'POST',headers:h,body:JSON.stringify({action:'reconcile'})});
      }).then(function(r){ return r.json(); }).then(function(j){
        if(j && j.ok && j.matched>0){ location.reload(); }
      }).catch(function(){});
    }, 600);
  </script>`;
  setPageHeaders(res);
  res.end(shell({ title: notifiedView ? 'Recently notified' : 'Waitlists', active: notifiedView ? 'notified' : 'waitlists', body }));
}

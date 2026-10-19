/**
 * Email notifications via Gmail SMTP (nodemailer). The only module that knows
 * about email transport — swap this one file to move to an email API later.
 *
 * Two shapes:
 *   - daily digest: the products that newly sold out today
 *   - on-demand report: the full current sold-out list, sent now
 *
 * Each builder returns { subject, text, html }: a clean styled HTML email with
 * a plain-text fallback. Env: GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL.
 */

import nodemailer from 'nodemailer';

const SHOP = process.env.SHOP_DOMAIN;
const APP_NAME = process.env.APP_NAME || 'OOS Sorter';

/**
 * The name shoppers see as the sender/brand on back-in-stock + nudge emails.
 * They know the STORE, not the internal ops app — so this defaults to the store
 * name derived from the shop domain (gel-ball-undercover -> "Gel Ball Undercover")
 * and can be overridden per store with EMAIL_FROM_NAME. Owner-facing emails
 * (digest/report/alert) keep APP_NAME.
 */
export function fromName(shopDomain, override) {
  if (override) return override;
  const sub = String(shopDomain || '').split('.')[0];
  if (!sub) return APP_NAME;
  const titled = sub.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return titled || APP_NAME;
}
const FROM_NAME = fromName(SHOP, process.env.EMAIL_FROM_NAME);
// Brand accent for emails (buttons, labels, links). Per-store via EMAIL_ACCENT;
// defaults to the OOS Sorter emerald.
const ACCENT = process.env.EMAIL_ACCENT || '#0e9c6b';

function creds() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_EMAIL;
  const missing = [
    !user && 'GMAIL_USER',
    !pass && 'GMAIL_APP_PASSWORD',
    !to && 'NOTIFY_EMAIL',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `FEATURE_NOTIFY is on but these are missing: ${missing.join(', ')}. ` +
        'Set them in .env (GMAIL_APP_PASSWORD is a Gmail App Password, not your login password).'
    );
  }
  return { user, pass, to };
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Format a Shopify Money amount (a bare decimal string like "129.00") in the
 *  shop currency, e.g. formatMoney("129", "AUD") -> "A$129.00". Empty/non-numeric
 *  amounts return '' so the caller can omit the price entirely. */
export function formatMoney(amount, currency) {
  const n = Number(amount);
  if (amount === '' || amount == null || !Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`.trim();
  }
}

/** Plain-text line: "  • Title  (collection-a, collection-b)". */
function textLine(item) {
  const cols = item.collections?.length ? `  (${item.collections.join(', ')})` : '';
  return `  • ${item.title ?? item.id}${cols}`;
}

/** One product row in the HTML email. */
function htmlRow(item) {
  const tags = (item.collections ?? [])
    .map(
      (c) =>
        `<span style="font-size:11px;color:#5f6875;background:#eef1f6;border-radius:6px;padding:2px 8px;margin-left:6px;white-space:nowrap">${esc(c)}</span>`
    )
    .join('');
  return `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f2f6;font-size:14px;color:#161b22">${esc(item.title ?? item.id)}${tags}</td></tr>`;
}

/** Full HTML document for an email. Pass `bodyHtml` for a custom body (e.g. rich
 *  product cards); otherwise `items` render as plain title rows. */
function emailHtml({ subtitle, lead, items = [], bodyHtml = null }) {
  const rows = bodyHtml != null
    ? bodyHtml
    : items.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${items.map(htmlRow).join('')}</table>`
    : `<div style="font-size:14px;color:#5f6875;padding:6px 0">Nothing sold out right now — every product is available online.</div>`;
  return `<!doctype html><html><body style="margin:0;background:#eef1f6">
  <div style="background:#eef1f6;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e8ef;border-radius:16px;overflow:hidden">
        <tr><td style="padding:22px 24px;border-bottom:1px solid #eef1f6">
          <table cellpadding="0" cellspacing="0" role="presentation"><tr>
            <td style="padding-right:12px;vertical-align:middle" width="44">
              <div style="width:32px;height:32px;border:1px solid #e4e8ef;border-radius:8px;padding:7px 6px;box-sizing:border-box">
                <div style="height:3px;background:${ACCENT};border-radius:2px;width:100%"></div>
                <div style="height:3px;background:${ACCENT};border-radius:2px;width:70%;margin-top:3px;opacity:.6"></div>
                <div style="height:3px;background:${ACCENT};border-radius:2px;width:44%;margin-top:3px;opacity:.3"></div>
              </div>
            </td>
            <td style="vertical-align:middle">
              <div style="font-size:16px;font-weight:700;color:#161b22;letter-spacing:-.01em">${esc(APP_NAME)}</div>
              <div style="font-size:12px;color:#5f6875">${esc(subtitle)}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 24px 4px;font-size:15px;color:#161b22;line-height:1.5">${lead}</td></tr>
        <tr><td style="padding:8px 24px 20px">${rows}</td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #eef1f6;font-size:11px;color:#8b95a3;line-height:1.5">
          Sent by ${esc(APP_NAME)}. Sold-out is judged by what your online store can actually sell.
        </td></tr>
      </table>
    </td></tr></table>
  </div></body></html>`;
}

/** Pure: build the daily digest email (subject, text, html) from pending entries. */
export function buildDigest(pending) {
  const n = pending.length;
  const subject = `${APP_NAME}: ${n} product${n === 1 ? '' : 's'} sold out today`;
  const text =
    `${n} product${n === 1 ? '' : 's'} newly sold out on ${SHOP} today:\n\n` +
    pending.map(textLine).join('\n') +
    `\n\n— ${APP_NAME}`;
  const html = emailHtml({
    subtitle: 'Daily sold-out digest',
    lead: `<b>${n}</b> product${n === 1 ? '' : 's'} newly sold out on <span style="color:${ACCENT}">${esc(SHOP)}</span> today.`,
    items: pending,
  });
  return { subject, text, html };
}

/** Pure: build the on-demand report email (subject, text, html). */
export function buildReport(items) {
  const n = items.length;
  const subject = `${APP_NAME}: sold-out report (${n})`;
  const text =
    n === 0
      ? `No products are currently sold out on ${SHOP}.\n\n— ${APP_NAME}`
      : `${n} product${n === 1 ? '' : 's'} currently sold out on ${SHOP}:\n\n` +
        items.map(textLine).join('\n') +
        `\n\n— ${APP_NAME}`;
  const html = emailHtml({
    subtitle: 'Sold-out report',
    lead:
      n === 0
        ? `No products are currently sold out on <span style="color:${ACCENT}">${esc(SHOP)}</span>.`
        : `<b>${n}</b> product${n === 1 ? '' : 's'} currently sold out on <span style="color:${ACCENT}">${esc(SHOP)}</span>.`,
    items,
  });
  return { subject, text, html };
}

/** Pure: build the "full waitlist" report email the merchant sends to themselves.
 *  `items` is productsWithWaitlist() shape: [{title, handle, image, list:[{email,ts,variantId,variantTitle}]}]. */
export function buildWaitlistReport(items) {
  const products = items.length;
  const shoppers = items.reduce((n, w) => n + w.list.length, 0);
  const vlabel = (s) =>
    s.variantTitle && s.variantTitle !== 'Default Title' ? s.variantTitle : (s.variantId ? `#${s.variantId}` : 'Any option');
  const joined = (ts) => String(ts || '').replace('T', ' ').slice(0, 16);
  const subject = `${APP_NAME}: waitlist report (${shoppers} shopper${shoppers === 1 ? '' : 's'})`;

  const text = products === 0
    ? `No products have a waitlist right now on ${SHOP}.\n\n— ${APP_NAME}`
    : `${shoppers} shopper${shoppers === 1 ? '' : 's'} waiting across ${products} product${products === 1 ? '' : 's'} on ${SHOP}:\n\n` +
      items.map((w) =>
        `• ${w.title} (${w.list.length})\n` +
        w.list.map((s) => `    - ${s.email}  [${vlabel(s)}]  ${joined(s.ts)}`).join('\n')
      ).join('\n\n') +
      `\n\n— ${APP_NAME}`;

  const thumb = (url) => {
    if (!url) return `<div style="width:40px;height:40px;border-radius:8px;background:#eef1f6;border:1px solid #e4e8ef"></div>`;
    const src = url + (url.includes('?') ? '&' : '?') + 'width=96';
    return `<img src="${esc(src)}" width="40" height="40" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover;border:1px solid #eef1f6;display:block">`;
  };
  const block = (w) => {
    const rows = w.list.map((s) =>
      `<tr>
        <td style="padding:6px 10px 6px 0;font-size:13px;color:#161b22">${esc(s.email)}</td>
        <td style="padding:6px 10px;font-size:12.5px;color:#5f6875">${esc(vlabel(s))}</td>
        <td style="padding:6px 0 6px 10px;font-size:12px;color:#8b95a3;text-align:right;white-space:nowrap">${esc(joined(s.ts))}</td>
      </tr>`).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px">
      <tr><td colspan="3" style="padding:0 0 8px;border-bottom:1px solid #eef1f6">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td width="52" style="padding-right:12px;vertical-align:middle">${thumb(w.image)}</td>
          <td style="vertical-align:middle">
            <span style="font-size:14px;font-weight:700;color:#161b22">${esc(w.title)}</span>
            <span style="font-size:12px;color:#8b95a3">&nbsp;· ${w.list.length} waiting</span>
          </td>
        </tr></table>
      </td></tr>
      ${rows}
    </table>`;
  };
  const bodyHtml = products === 0
    ? `<div style="font-size:14px;color:#5f6875">No products have a waitlist right now.</div>`
    : items.map(block).join('');

  const html = emailHtml({
    subtitle: 'Waitlist report',
    lead: products === 0
      ? `No products have a waitlist right now on <span style="color:${ACCENT}">${esc(SHOP)}</span>.`
      : `<b>${shoppers}</b> shopper${shoppers === 1 ? '' : 's'} waiting across <b>${products}</b> product${products === 1 ? '' : 's'} on <span style="color:${ACCENT}">${esc(SHOP)}</span>.`,
    bodyHtml,
  });
  return { subject, text, html };
}

/** Email the full current waitlist to the owner + extra recipients. */
export function sendWaitlistReport(items, opts) {
  return send(buildWaitlistReport(items), opts);
}

/** The storefront product URL for an alert item, or the shop home as a fallback. */
function productUrl(item) {
  if (item.handle && SHOP) return `https://${SHOP}/products/${item.handle}`;
  return SHOP ? `https://${SHOP}` : '#';
}

/** One rich product card (thumbnail + linked title + "View product") for the alert. */
function alertCard(item) {
  const url = productUrl(item);
  const title = item.title ?? item.id;
  const thumb = item.image
    ? `<td width="78" style="padding-right:14px;vertical-align:top">
         <a href="${esc(url)}"><img src="${esc(item.image)}" alt="${esc(title)}" width="64" height="64" style="width:64px;height:64px;border-radius:10px;border:1px solid #eef1f6;object-fit:cover;display:block"></a>
       </td>`
    : '';
  return `<tr><td style="padding:9px 0;border-bottom:1px solid #f0f2f6">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      ${thumb}
      <td style="vertical-align:middle">
        <a href="${esc(url)}" style="font-size:15px;font-weight:600;color:#161b22;text-decoration:none;line-height:1.35">${esc(title)}</a>
        <div style="margin-top:5px">
          <a href="${esc(url)}" style="font-size:12.5px;font-weight:600;color:${ACCENT};text-decoration:none">View product &rarr;</a>
        </div>
      </td>
    </tr></table>
  </td></tr>`;
}

/** Pure: build a real-time "just sold out" alert for the owner/team. Each product
 *  shows its image and links to its storefront page. */
export function buildSoldOutAlert(items) {
  const n = items.length;
  const subject = n === 1
    ? `${items[0].title ?? 'A product'} just sold out`
    : `${APP_NAME}: ${n} products just sold out`;
  const text =
    `${n} product${n === 1 ? '' : 's'} just sold out on ${SHOP}:\n\n` +
    items.map((it) => `  • ${it.title ?? it.id}\n    ${productUrl(it)}`).join('\n\n') +
    `\n\n— ${APP_NAME}`;
  const bodyHtml = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${items.map(alertCard).join('')}</table>`;
  const html = emailHtml({
    subtitle: 'Sold-out alert',
    lead: `<b>${n}</b> product${n === 1 ? '' : 's'} just sold out on <a href="https://${esc(SHOP)}" style="color:${ACCENT};text-decoration:none">${esc(SHOP)}</a>.`,
    bodyHtml,
  });
  return { subject, text, html };
}

/** Send a real-time sold-out alert to the owner + extra recipients. */
export function sendSoldOutAlert(items, opts) {
  return send(buildSoldOutAlert(items), opts);
}

/** A 48×48 gift thumbnail: the product's real photo when we resolved one
 *  (`giftImages[name]`), otherwise a tasteful gift-icon tile so the row is never
 *  empty. `tint` is the box's accent (green for the free gift, blue for perks). */
function giftThumb(name, giftImages, tint) {
  const url = giftImages && giftImages[String(name).toLowerCase()];
  if (url) {
    const src = url + (url.includes('?') ? '&' : '?') + 'width=120';
    return `<img src="${esc(src)}" alt="${esc(name)}" width="48" height="48" style="width:48px;height:48px;border-radius:10px;object-fit:cover;border:1px solid rgba(0,0,0,.06);display:block">`;
  }
  return `<div style="width:48px;height:48px;border-radius:10px;background:#ffffff;border:1px solid ${tint}33;text-align:center;line-height:48px;font-size:24px">&#127873;</div>`;
}

/** One "gift item" row — thumbnail + name + a FREE pill — for the gift/perks box. */
function giftRowsHtml(names, giftImages, tint) {
  return (names || [])
    .map(
      (n) => `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:10px"><tr>
        <td width="60" style="padding-right:12px;vertical-align:middle">${giftThumb(n, giftImages, tint)}</td>
        <td style="vertical-align:middle">
          <span style="font-size:14px;font-weight:600;color:#161b22">${esc(n)}</span>
          <span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:.05em;color:#fff;background:${tint};border-radius:999px;padding:2px 8px;margin-left:8px;vertical-align:middle">FREE</span>
        </td>
      </tr></table>`
    )
    .join('');
}

/** Shared builder for the two single-product restock emails (back-in-stock and
 *  the follow-up nudge). `opts` supplies the only differences: eyebrow label,
 *  subject text, the HTML lead sentence, and the plain-text intro line.
 *  product: { title, handle, image, variantId, clickCartUrl?, clickProductUrl? }.
 *  When the tracked click URLs are present they replace the raw storefront links
 *  (so we can record click-through); otherwise it falls back to direct links. */
function buildRestockEmail(product, unsub, { eyebrow, subject, leadHtml, introText, freeGift = null }) {
  const title = product.title ?? 'Your item';
  // freeGift may come via opts (nudge) or ride on the payload (resend reuses the
  // back-in-stock builder but should still show the offer).
  freeGift = freeGift || product.freeGift || null;
  const hasGift = !!(freeGift && Array.isArray(freeGift.products) && freeGift.products.length);
  // Price-tiered order perks (free shipping / + gift), carried on the product payload.
  const inc = product.incentives && product.incentives.freeShipping ? product.incentives : null;
  const incGiftList = inc && Array.isArray(inc.gift) ? inc.gift : (inc && inc.gift ? [String(inc.gift)] : []);
  const incGift = incGiftList.join(', ');
  // Resolved gift product images (lowercased name -> url), attached to the payload.
  const giftImages = product.giftImages || {};
  // Single-variant products are literally titled "Default Title" — never show that.
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  // Shopper-facing host: the store's primary/custom domain (gelballundercover.com.au),
  // falling back to the myshopify domain when not supplied.
  const host = product.storeHost || SHOP;
  const productUrl = product.clickProductUrl
    || (product.handle && host ? `https://${host}/products/${product.handle}` : (host ? `https://${host}` : '#'));
  // A /cart/<variantId>:1 permalink adds the item and lands the shopper on the cart.
  const cartUrl = product.clickCartUrl
    || (product.variantId && host ? `https://${host}/cart/${product.variantId}:1` : productUrl);

  // ---- plain-text version ----
  const priceLine = product.priceText
    ? `${product.priceText}${product.compareAtText ? `  (was ${product.compareAtText})` : ''}\n`
    : '';
  const freeGiftText = hasGift
    ? `\nFREE gift if you order now: ${freeGift.products.join(', ')} free with your order.${freeGift.code ? ` Use code ${freeGift.code} at checkout.` : ''}\n`
    : '';
  const incText = inc
    ? `\nThis order qualifies for:\n  - Free shipping${incGift ? `\n  - Plus a free gift: ${incGift}` : ''}\n`
    : '';
  const text =
    `${introText}\n\n` +
    priceLine +
    incText +
    `Add it to your cart: ${cartUrl}\n` +
    `Or view the product: ${productUrl}\n` +
    freeGiftText +
    `\n— ${FROM_NAME}\n\n` +
    `Don't want these emails? Unsubscribe: ${unsub}`;

  // ---- HTML version (premium, single-column, conversion-focused) ----
  const priceBlock = product.priceText
    ? `<div style="margin:16px 0 0">
         <span style="font-size:24px;font-weight:800;color:#0f1729;letter-spacing:-.01em">${esc(product.priceText)}</span>${
        product.compareAtText
          ? `<span style="font-size:15px;font-weight:600;color:#9aa3b2;text-decoration:line-through;margin-left:10px">${esc(product.compareAtText)}</span>`
          : ''
      }
       </div>`
    : '';
  const variantChip = variant
    ? `<div style="margin:14px 0 0"><span style="display:inline-block;font-size:12.5px;color:#48506a;background:#f2f4f8;border:1px solid #e6eaf0;border-radius:8px;padding:5px 11px">Option: <strong style="color:#0f1729">${esc(variant)}</strong></span></div>`
    : '';
  // Hero text block (eyebrow pill + title + option + price), shared by both the
  // with-image and no-image layouts.
  const heroText =
    `<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.09em;color:#ffffff;background:${ACCENT};border-radius:999px;padding:5px 12px;text-transform:uppercase">${esc(eyebrow)}</span>` +
    `<div style="font-size:22px;line-height:1.25;font-weight:800;color:#0f1729;letter-spacing:-.02em;margin:12px 0 0">${esc(title)}</div>` +
    variantChip + priceBlock;
  const leadP = `<p style="font-size:14px;color:#5b6472;line-height:1.55;margin:14px 0 0">${leadHtml}</p>`;
  // Hero: product image on the LEFT, text on the right — a real 2-cell table so it
  // stays side-by-side on EVERY width (desktop and mobile), not just desktop. The
  // image scales with its cell (36%); the lead sits full-width below.
  const heroRow = product.image
    ? `<tr><td style="padding:18px 20px 4px">
         <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
           <td width="36%" valign="top" style="padding-right:14px">
             <a href="${esc(cartUrl)}" style="text-decoration:none;display:block"><img src="${esc(product.image)}" alt="${esc(title)}" style="width:100%;height:auto;border-radius:12px;border:1px solid #eef1f6;display:block"></a>
           </td>
           <td valign="top">${heroText}</td>
         </tr></table>
         ${leadP}
       </td></tr>`
    : `<tr><td style="padding:18px 20px 4px">${heroText}${leadP}</td></tr>`;
  const incentiveBlock = inc
    ? `<tr><td style="padding:6px 20px 10px">
         <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef5ff;border:1px solid #cfe0fb;border-radius:14px">
           <tr><td style="padding:14px 16px">
             <div style="font-size:14px;color:#0f1729;line-height:1.5">&#128666; <strong>Free shipping</strong> on this order</div>
             ${incGiftList.length ? giftRowsHtml(incGiftList, giftImages, '#1f6feb') : ''}
           </td></tr>
         </table>
       </td></tr>`
    : '';
  const freeGiftBlock = hasGift
    ? `<tr><td style="padding:6px 20px 10px">
         <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f0fbf6;border:1px solid #cdeede;border-radius:14px">
           <tr><td style="padding:16px 18px">
             <div style="font-size:12px;font-weight:800;letter-spacing:.05em;color:${ACCENT};text-transform:uppercase">&#127873; Free gift if you order now</div>
             ${giftRowsHtml(freeGift.products, giftImages, ACCENT)}
             ${freeGift.code ? `<div style="font-size:13px;color:#5f6875;margin-top:12px;padding-top:12px;border-top:1px solid #cdeede">Use code <strong style="color:#161b22;background:#fff;border:1px dashed #9bd3b6;border-radius:6px;padding:2px 8px">${esc(freeGift.code)}</strong> at checkout.</div>` : ''}
           </td></tr>
         </table>
       </td></tr>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
  <body style="margin:0;padding:0;background:#eef1f6">
  <div style="background:#eef1f6;padding:26px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6eaf0;border-radius:16px;overflow:hidden">
        <tr><td style="height:3px;background:${ACCENT};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:13px 20px;border-bottom:1px solid #f1f3f7">
          ${product.brandLogo
            ? `<img src="${esc(product.brandLogo)}" alt="${esc(FROM_NAME)}" height="28" style="height:28px;max-height:32px;width:auto;max-width:190px;display:block;border:0">`
            : `<span style="font-size:15px;font-weight:800;color:#0f1729;letter-spacing:-.01em">${esc(FROM_NAME)}</span>`}
        </td></tr>
        ${heroRow}
        ${freeGiftBlock}
        ${incentiveBlock}
        <tr><td style="padding:16px 20px 4px" align="center">
          <a href="${esc(cartUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:15px 44px;border-radius:12px">Add to cart &rarr;</a>
          <div style="margin-top:9px"><a href="${esc(productUrl)}" style="color:#6b7280;text-decoration:underline;font-size:13px">or view the product</a></div>
        </td></tr>
        <tr><td style="padding:16px 20px;border-top:1px solid #f1f3f7;font-size:11.5px;color:#9aa3b2;line-height:1.6">
          You asked ${esc(FROM_NAME)} to let you know when this was back in stock. <a href="${esc(unsub)}" style="color:#9aa3b2">Unsubscribe</a>.
        </td></tr>
      </table>
      <div style="font-size:11px;color:#9aa3b2;margin-top:14px">${esc(FROM_NAME)}${host ? ` &middot; ${esc(host)}` : ''}</div>
    </td></tr></table>
  </div></body></html>`;
  return { subject, text, html };
}

/** Pure: build a single-product "back in stock" email for one shopper. */
export function buildBackInStock(product, unsub) {
  const title = product.title ?? 'Your item';
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const named = variant ? `${title} — ${variant}` : title;
  const host = product.storeHost || SHOP;
  return buildRestockEmail(product, unsub, {
    eyebrow: 'Back in stock',
    subject: `${named} is back in stock`,
    leadHtml: `It's available again on ${esc(host)}. Grab it before it sells out.`,
    introText: `Good news! "${named}" is available again on ${host}.`,
  });
}

/** Pure: build the one-shot follow-up "still available" nudge for one shopper.
 *  Optionally carries a free-gift offer. */
export function buildNudge(product, unsub, { freeGift = null } = {}) {
  const title = product.title ?? 'Your item';
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const named = variant ? `${title} — ${variant}` : title;
  const host = product.storeHost || SHOP;
  const hasGift = !!(freeGift && Array.isArray(freeGift.products) && freeGift.products.length);
  return buildRestockEmail(product, unsub, {
    eyebrow: hasGift ? 'Still available + free gift' : 'Still available',
    subject: hasGift ? `Still available — plus a free gift: ${named}` : `Still available: ${named}`,
    leadHtml: hasGift
      ? `Still in stock on ${esc(host)} — order now and we'll throw in a free gift. Don't miss it before it's gone again.`
      : `Still in stock on ${esc(host)} — don't miss it before it's gone again.`,
    introText: `Still in stock: "${named}" is available on ${host}.`,
    freeGift,
  });
}

/** Pure: build the "a different variant is in stock" email. `product` carries the
 *  in-stock option being offered (its variantId/price). Sent to a shopper whose
 *  own waited variant is still sold out. */
export function buildAltVariant(product, unsub) {
  const title = product.title ?? 'Your item';
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const host = product.storeHost || SHOP;
  return buildRestockEmail(product, unsub, {
    eyebrow: 'A different option is in stock',
    subject: variant ? `${variant} is in stock for ${title}` : `A different option for ${title} is available`,
    leadHtml: `The option you were waiting for is still sold out on ${esc(host)}${variant ? ` — but <strong>${esc(variant)}</strong> is available right now` : ' — but another option is available right now'}. Grab it before it's gone.`,
    introText: `The option you wanted for "${title}" is still sold out, but ${variant ? `"${variant}"` : 'another option'} is in stock on ${host}.`,
  });
}

let transportCache = null;
function transport(user, pass) {
  if (!transportCache) {
    transportCache = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return transportCache;
}

/** Owner (NOTIFY_EMAIL) plus any extra recipients, deduped, as a comma list. */
function recipientList(base, recipients) {
  const extra = Array.isArray(recipients) ? recipients : [];
  return [...new Set([base, ...extra].filter(Boolean))].join(', ');
}

async function send({ subject, text, html }, { dryRun, recipients } = {}) {
  if (dryRun) {
    const to = recipientList(process.env.NOTIFY_EMAIL ?? '(NOTIFY_EMAIL unset)', recipients);
    console.log(`  [dry run] would email ${to}: "${subject}"`);
    text.split('\n').forEach((l) => console.log(`      ${l}`));
    return { dryRun: true };
  }
  const { user, pass, to: base } = creds();
  const to = recipientList(base, recipients);
  const info = await transport(user, pass).sendMail({
    from: `${APP_NAME} <${user}>`,
    to,
    subject,
    text,
    html,
  });
  console.log(`  emailed ${to}: "${subject}" (${info.messageId})`);
  return info;
}

/** Send a plain-text email (used by the OAuth flow to deliver the offline token). */
export async function sendPlain(subject, text) {
  const { user, pass, to } = creds();
  const info = await transport(user, pass).sendMail({ from: `${APP_NAME} <${user}>`, to, subject, text });
  console.log(`  emailed ${to}: "${subject}" (${info.messageId})`);
  return info;
}

export function sendDigest(pending, opts) {
  return send(buildDigest(pending), opts);
}

export function sendReport(items, opts) {
  return send(buildReport(items), opts);
}

/** Send a "back in stock" email to a single shopper (not the owner). */
export async function sendBackInStock(email, product, unsub, { dryRun } = {}) {
  const { subject, text, html } = buildBackInStock(product, unsub);
  if (dryRun) {
    console.log(`  [dry run] would email ${email}: "${subject}"`);
    return { dryRun: true };
  }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set for back-in-stock emails');
  const info = await transport(user, pass).sendMail({ from: `${FROM_NAME} <${user}>`, to: email, subject, text, html });
  console.log(`  emailed ${email}: "${subject}" (${info.messageId})`);
  return info;
}

/** Send a one-shot "still available" nudge to a single shopper. */
export async function sendNudge(email, product, unsub, { dryRun, freeGift = null } = {}) {
  const { subject, text, html } = buildNudge(product, unsub, { freeGift });
  if (dryRun) {
    console.log(`  [dry run] would nudge ${email}: "${subject}"`);
    return { dryRun: true };
  }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set for nudge emails');
  const info = await transport(user, pass).sendMail({ from: `${FROM_NAME} <${user}>`, to: email, subject, text, html });
  console.log(`  nudged ${email}: "${subject}" (${info.messageId})`);
  return info;
}

/** Send a one-shot "a different option is in stock" email to a single shopper
 *  whose own waited variant is still sold out. */
export async function sendAltVariant(email, product, unsub, { dryRun } = {}) {
  const { subject, text, html } = buildAltVariant(product, unsub);
  if (dryRun) {
    console.log(`  [dry run] would offer alternatives to ${email}: "${subject}"`);
    return { dryRun: true };
  }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set for alternative-variant emails');
  const info = await transport(user, pass).sendMail({ from: `${FROM_NAME} <${user}>`, to: email, subject, text, html });
  console.log(`  offered alternatives to ${email}: "${subject}" (${info.messageId})`);
  return info;
}

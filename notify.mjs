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

/** Full HTML document for an email. */
function emailHtml({ subtitle, lead, items }) {
  const rows = items.length
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

/** Pure: build a real-time "just sold out" alert for the owner/team. */
export function buildSoldOutAlert(items) {
  const n = items.length;
  const subject = n === 1
    ? `${items[0].title ?? 'A product'} just sold out`
    : `${APP_NAME}: ${n} products just sold out`;
  const text =
    `${n} product${n === 1 ? '' : 's'} just sold out on ${SHOP}:\n\n` +
    items.map(textLine).join('\n') +
    `\n\n— ${APP_NAME}`;
  const html = emailHtml({
    subtitle: 'Sold-out alert',
    lead: `<b>${n}</b> product${n === 1 ? '' : 's'} just sold out on <span style="color:${ACCENT}">${esc(SHOP)}</span>.`,
    items,
  });
  return { subject, text, html };
}

/** Send a real-time sold-out alert to the owner + extra recipients. */
export function sendSoldOutAlert(items, opts) {
  return send(buildSoldOutAlert(items), opts);
}

/** Pure: build a single-product "back in stock" email for one shopper.
 *  product: { title, handle, image, variantId } — image + variantId are optional.
 *  When variantId is present the "Add to Cart" button deep-links to the cart. */
export function buildBackInStock(product, unsub) {
  const title = product.title ?? 'Your item';
  // Single-variant products are literally titled "Default Title" — never show that.
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const named = variant ? `${title} — ${variant}` : title;
  const productUrl = product.handle && SHOP ? `https://${SHOP}/products/${product.handle}` : (SHOP ? `https://${SHOP}` : '#');
  // A /cart/<variantId>:1 permalink adds the item and lands the shopper on the cart.
  const cartUrl = product.variantId && SHOP ? `https://${SHOP}/cart/${product.variantId}:1` : productUrl;
  const subject = `${named} is back in stock`;
  const text =
    `Good news! "${named}" is available again on ${SHOP}.\n\n` +
    `Add it to your cart: ${cartUrl}\n` +
    `Or view the product: ${productUrl}\n\n— ${APP_NAME}\n\n` +
    `Don't want these emails? Unsubscribe: ${unsub}`;
  const imageBlock = product.image
    ? `<tr><td style="padding:0 24px 4px" align="center">
         <a href="${esc(cartUrl)}"><img src="${esc(product.image)}" alt="${esc(title)}" width="512" style="width:100%;max-width:512px;height:auto;border-radius:12px;border:1px solid #eef1f6;display:block"></a>
       </td></tr>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#eef1f6">
  <div style="background:#eef1f6;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:#fff;border:1px solid #e4e8ef;border-radius:16px;overflow:hidden">
        <tr><td style="padding:24px 24px 12px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:${ACCENT};text-transform:uppercase">Back in stock</div>
          <div style="font-size:20px;font-weight:700;color:#161b22;margin:8px 0 6px">${esc(title)}</div>
          ${variant ? `<div style="font-size:13px;color:#5f6875;margin:-2px 0 6px">Option: <strong style="color:#161b22">${esc(variant)}</strong></div>` : ''}
          <div style="font-size:14px;color:#5f6875;line-height:1.5">It's available again on ${esc(SHOP)}. Grab it before it sells out.</div>
        </td></tr>
        ${imageBlock}
        <tr><td style="padding:16px 24px 24px">
          <a href="${esc(cartUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px">Add to Cart</a>
          <a href="${esc(productUrl)}" style="display:inline-block;margin-left:6px;color:${ACCENT};text-decoration:none;font-size:14px;font-weight:600;padding:12px 10px">View product</a>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #eef1f6;font-size:11px;color:#8b95a3;line-height:1.5">
          You asked ${esc(APP_NAME)} to notify you when this came back. <a href="${esc(unsub)}" style="color:#8b95a3">Unsubscribe</a>.
        </td></tr>
      </table>
    </td></tr></table>
  </div></body></html>`;
  return { subject, text, html };
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
  const info = await transport(user, pass).sendMail({ from: `${APP_NAME} <${user}>`, to: email, subject, text, html });
  console.log(`  emailed ${email}: "${subject}" (${info.messageId})`);
  return info;
}

/**
 * Slack notifications via an Incoming Webhook (the simplest Slack integration —
 * no OAuth, no bot token). Set SLACK_WEBHOOK_URL to a channel webhook and the
 * app posts a message there whenever a shopper joins a product's waitlist.
 *
 * Fire-and-forget: a Slack failure (or an unset webhook) never breaks the
 * signup — notifySlackSignup swallows errors and returns a status instead.
 */

/** Pure: build the Slack message payload for a waitlist signup. Uses Slack
 *  mrkdwn (*bold*, <url|label>). Returns the object POSTed to the webhook. */
export function buildSignupMessage({ email, title, handle, count, shop, variantTitle }) {
  const name = title || 'a product';
  const link = handle && shop ? `https://${shop}/products/${handle}` : null;
  const product = link ? `<${link}|${name}>` : `*${name}*`;
  const waiting = count ? ` — ${count} now waiting` : '';
  // Only name the variant when there is one; single-variant products say 'Default Title'.
  const variant = variantTitle && variantTitle !== 'Default Title' ? ` (${variantTitle})` : '';
  return { text: `:bell: New waitlist signup: *${email}* wants ${product}${variant}${waiting}` };
}

/** Post a signup notification to Slack. The webhook comes from `webhookUrl`
 *  (the app Settings value) and falls back to the SLACK_WEBHOOK_URL env default.
 *  Never throws. @returns {Promise<{ok?:boolean, skipped?:boolean, error?:string}>} */
export async function notifySlackSignup({ email, title, handle, count, webhookUrl, variantTitle }) {
  const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (!url) return { skipped: true };
  const payload = buildSignupMessage({ email, title, handle, count, variantTitle, shop: process.env.SHOP_DOMAIN });
  return postToSlack(url, payload, 'signup');
}

/** Pure: build the Slack message for a product STATUS change. */
export function buildProductChangeMessage({ title, handle, fromLabel, toLabel, who, stock, shop }) {
  const name = title || 'a product';
  const link = handle && shop ? `https://${shop}/products/${handle}` : null;
  const product = link ? `<${link}|${name}>` : `*${name}*`;
  const actor = who ? `*${who}*` : '_unknown_';
  const stockTxt = stock == null ? '' : ` · stock: ${stock}`;
  return { text: `:label: ${product} status changed *${fromLabel} → ${toLabel}* by ${actor}${stockTxt}` };
}

/** Post a product-change notification to Slack. Never throws. */
export async function notifySlackProductChange({ title, handle, fromLabel, toLabel, who, stock, webhookUrl }) {
  const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (!url) return { skipped: true };
  const payload = buildProductChangeMessage({ title, handle, fromLabel, toLabel, who, stock, shop: process.env.SHOP_DOMAIN });
  return postToSlack(url, payload, 'product-change');
}

/** Pure: build a generic monitor Slack message. `action` is the human phrase
 *  ("was added", "was deleted", "status changed Draft → Active"); `path` is the
 *  storefront path ('products' | 'collections'); `stock` optional. */
export function buildMonitorMessage({ title, handle, action, who, stock, shop, path }) {
  const name = title || (path === 'collections' ? 'a collection' : 'a product');
  const link = handle && shop ? `https://${shop}/${path || 'products'}/${handle}` : null;
  const subject = link ? `<${link}|${name}>` : `*${name}*`;
  const actor = who ? `*${who}*` : '_unknown_';
  const stockTxt = stock == null || stock === '' ? '' : ` · stock: ${stock}`;
  return { text: `:label: ${subject} ${action} by ${actor}${stockTxt}` };
}

/** Post a generic monitor event to Slack. No env fallback — the caller passes
 *  the monitor's own webhook, so this never bleeds into other channels. */
export async function notifySlackMonitorEvent({ webhookUrl, title, handle, action, who, stock, path }) {
  if (!webhookUrl) return { skipped: true };
  const payload = buildMonitorMessage({ title, handle, action, who, stock, path, shop: process.env.SHOP_DOMAIN });
  return postToSlack(webhookUrl, payload, 'monitor');
}

/** Shared fire-and-forget POST to a Slack Incoming Webhook. */
async function postToSlack(url, payload, label) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`  ! Slack webhook returned HTTP ${res.status}`);
    return { ok: res.ok };
  } catch (e) {
    console.error(`  ! Slack ${label} notify failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

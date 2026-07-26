/**
 * One-click unsubscribe (linked from every back-in-stock email). The link is
 * signed (HMAC of product+email), so no login is needed and it can't be forged.
 *   /api/unsubscribe?product=<shortId>&email=<email>&sig=<hmac>
 */
import { verifyUnsub, unsubscribe, unsubSecret } from '../waitlist.mjs';
import { longId } from '../shopify.mjs';

function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  } catch {
    return {};
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const page = (title, body) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:14vh auto;padding:0 1.2rem;color:#161b22;text-align:center}
h1{font-size:1.3rem;margin:0 0 .5rem} p{color:#5f6875;line-height:1.5}</style>
<h1>${esc(title)}</h1><p>${body}</p>`;

export default async function handler(req, res) {
  const q = query(req);
  const product = String(q.product || '');
  const email = String(q.email || '');
  const sig = String(q.sig || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!product || !email || !sig || !verifyUnsub(product, email, sig, unsubSecret())) {
    res.statusCode = 400;
    res.end(page('Invalid link', 'This unsubscribe link is invalid or has expired.'));
    return;
  }
  try {
    await unsubscribe(longId(product.replace(/\D/g, '')), email);
    res.end(page('Unsubscribed', `You won&rsquo;t get back-in-stock emails for this product anymore.`));
  } catch (e) {
    res.statusCode = 500;
    res.end(page('Something went wrong', 'Please try the link again later.'));
  }
}

/**
 * Waitlist browsing Web Pixel.
 *
 * Tells the app whether a notified shopper is still exploring the store after
 * clicking their back-in-stock email: which products they view, add to cart, or
 * start checkout with. Runs in Shopify's STRICT sandbox and only fires when the
 * visitor has granted analytics consent (declared in shopify.extension.toml).
 *
 * Correlation carries NO email: the email's tracked link lands the shopper with
 * a signed `?wl=<token>` on the URL. We read it once, persist it, and send it
 * back with each event; the app matches it to the notified row.
 */
import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser, init }) => {
  // The GBU app's own endpoint (store-specific). Fold into settings for multi-store.
  const ENDPOINT = 'https://sold-out-sorter.vercel.app/api/unsubscribe?pixel=1';
  const KEY = 'oos_wl';

  async function token() {
    try {
      const stored = await browser.localStorage.getItem(KEY);
      if (stored) return stored;
      const loc = init && init.context && init.context.document && init.context.document.location;
      const search = (loc && loc.search) || '';
      const m = /[?&]wl=([^&#]+)/.exec(search);
      if (m && m[1]) {
        const wl = decodeURIComponent(m[1]);
        try { await browser.localStorage.setItem(KEY, wl); } catch (e) { /* storage blocked */ }
        return wl;
      }
    } catch (e) { /* no-op */ }
    return null;
  }

  async function send(event, products) {
    const wl = await token();
    if (!wl) return; // only report for shoppers who arrived via our email
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wl: wl, event: event, products: products || [] }),
        keepalive: true,
      });
    } catch (e) { /* best effort */ }
  }

  analytics.subscribe('product_viewed', (event) => {
    const p = event && event.data && event.data.productVariant && event.data.productVariant.product;
    send('product_viewed', p && p.title ? [{ title: p.title }] : []);
  });

  analytics.subscribe('product_added_to_cart', (event) => {
    const m = event && event.data && event.data.cartLine && event.data.cartLine.merchandise;
    const t = m && m.product && m.product.title;
    send('product_added_to_cart', t ? [{ title: t }] : []);
  });

  analytics.subscribe('checkout_started', (event) => {
    const items = (event && event.data && event.data.checkout && event.data.checkout.lineItems) || [];
    send('checkout_started', items.map((li) => ({ title: li && li.title })).filter((x) => x.title));
  });
});

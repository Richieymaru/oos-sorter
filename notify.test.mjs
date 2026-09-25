#!/usr/bin/env node
// buildBackInStock reads SHOP_DOMAIN at module load, so set it before importing.
process.env.SHOP_DOMAIN = 'demo.myshopify.com';
const { buildBackInStock, buildSoldOutAlert, buildNudge, fromName, formatMoney } = await import('./notify.mjs');

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}

const unsub = 'https://demo.myshopify.com/api/unsubscribe?e=a&p=1&s=x';

console.log('--- buildBackInStock: full (image + variant) ---');
const full = buildBackInStock(
  { title: 'Chef Knife', handle: 'chef-knife', image: 'https://cdn.shopify.com/knife.jpg', variantId: '999' },
  unsub
);
ok('subject names the product', full.subject === 'Chef Knife is back in stock');
ok('renders the product image', full.html.includes('src="https://cdn.shopify.com/knife.jpg"'));
ok('Add to Cart uses cart permalink', full.html.includes('https://demo.myshopify.com/cart/999:1'));
ok('has an Add to Cart button label', full.html.includes('>Add to Cart<'));
ok('still links the product page', full.html.includes('https://demo.myshopify.com/products/chef-knife'));
ok('text has the cart link', full.text.includes('cart/999:1'));
ok('text has the unsubscribe link', full.text.includes(unsub));

console.log('--- buildBackInStock: no image, no variant (graceful) ---');
const bare = buildBackInStock({ title: 'Widget', handle: 'widget' }, unsub);
ok('no <img> when image missing', !bare.html.includes('<img'));
ok('Add to Cart falls back to product url', bare.html.includes('https://demo.myshopify.com/products/widget'));
ok('no cart permalink without variant', !bare.html.includes('/cart/'));

console.log('--- buildSoldOutAlert: single product (image + link) ---');
const alert = buildSoldOutAlert([
  { title: 'Hi Capa Magazine Lip', handle: 'hi-capa-lip', image: 'https://cdn.shopify.com/lip.jpg' },
]);
ok('subject names the product', alert.subject === 'Hi Capa Magazine Lip just sold out');
ok('renders the product image', alert.html.includes('src="https://cdn.shopify.com/lip.jpg"'));
ok('links the product page', alert.html.includes('https://demo.myshopify.com/products/hi-capa-lip'));
ok('has a View product link', alert.html.includes('View product'));
ok('text includes the product url', alert.text.includes('https://demo.myshopify.com/products/hi-capa-lip'));

console.log('--- buildSoldOutAlert: no image (graceful) + multiple ---');
const multi = buildSoldOutAlert([
  { title: 'Alpha', handle: 'alpha' },
  { title: 'Beta', handle: 'beta', image: 'https://cdn.shopify.com/beta.jpg' },
]);
ok('subject counts products', multi.subject.includes('2 products just sold out'));
ok('no <img> for the item without an image', (multi.html.match(/<img/g) || []).length === 1);
ok('links both products', multi.html.includes('/products/alpha') && multi.html.includes('/products/beta'));

console.log('--- buildBackInStock: tracked links ---');
const tracked = buildBackInStock(
  { title: 'Chef Knife', handle: 'chef-knife', variantId: '999', clickCartUrl: 'https://app.test/t?to=cart', clickProductUrl: 'https://app.test/t?to=prod' },
  unsub
);
ok('uses the tracked cart url', tracked.html.includes('href="https://app.test/t?to=cart"'));
ok('drops the raw cart permalink when tracked', !tracked.html.includes('/cart/999:1'));
ok('uses the tracked product url', tracked.html.includes('https://app.test/t?to=prod'));

console.log('--- buildNudge ---');
const nudge = buildNudge({ title: 'Widget', handle: 'widget' }, unsub);
ok('nudge subject', nudge.subject === 'Still available: Widget');
ok('nudge eyebrow', nudge.html.includes('Still available'));
ok('nudge keeps the unsubscribe link', nudge.text.includes(unsub));
ok('nudge falls back to product url', nudge.html.includes('https://demo.myshopify.com/products/widget'));

console.log('--- fromName (shopper-facing sender/brand) ---');
ok('derives a store name from the shop domain', fromName('gel-ball-undercover.myshopify.com') === 'Gel Ball Undercover');
ok('honors the EMAIL_FROM_NAME override', fromName('x.myshopify.com', 'My Brand') === 'My Brand');
ok('falls back to the app name on an empty domain', fromName('') === 'OOS Sorter');
// SHOP_DOMAIN is demo.myshopify.com in this test, so FROM_NAME derives to "Demo".
ok('back-in-stock email is signed with the store name, not the app name', full.text.includes('— Demo'));
ok('back-in-stock footer credits the store name', full.html.includes('You asked Demo to notify you'));
ok('nudge email is branded with the store name', buildNudge({ title: 'Widget', handle: 'widget' }, unsub).html.includes('You asked Demo to notify you'));

console.log('--- formatMoney ---');
ok('formats a USD amount', formatMoney('129.00', 'USD') === '$129.00');
ok('formats an AUD amount', formatMoney('129', 'AUD') === 'A$129.00');
ok('empty amount -> empty string', formatMoney('', 'AUD') === '');
ok('non-numeric -> empty string', formatMoney(null, 'USD') === '');

console.log('--- buildBackInStock: price + compare-at ---');
const priced = buildBackInStock(
  { title: 'Chef Knife', handle: 'chef-knife', variantId: '999', storeHost: 'gelballundercover.com.au', priceText: 'A$129.00', compareAtText: 'A$159.00' },
  unsub
);
ok('renders the price', priced.html.includes('A$129.00'));
ok('renders the compare-at price struck through', priced.html.includes('line-through') && priced.html.includes('A$159.00'));
ok('lead + storefront links use the store host, not myshopify', priced.html.includes('available again on gelballundercover.com.au') && priced.html.includes('https://gelballundercover.com.au/products/chef-knife') && !priced.html.includes('myshopify.com/products'));
ok('price also appears in the plain text', priced.text.includes('A$129.00'));
const noSale = buildBackInStock({ title: 'X', handle: 'x', priceText: '$50.00' }, unsub);
ok('no strike-through when there is no compare-at', !noSale.html.includes('line-through') && noSale.html.includes('$50.00'));
const noPrice = buildBackInStock({ title: 'Y', handle: 'y' }, unsub);
ok('omits the price block when no priceText', !noPrice.html.includes('font-size:18px;font-weight:700'));

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

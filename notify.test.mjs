#!/usr/bin/env node
// buildBackInStock reads SHOP_DOMAIN at module load, so set it before importing.
process.env.SHOP_DOMAIN = 'demo.myshopify.com';
const { buildBackInStock, buildSoldOutAlert } = await import('./notify.mjs');

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

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

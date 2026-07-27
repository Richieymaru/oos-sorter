#!/usr/bin/env node
// buildBackInStock reads SHOP_DOMAIN at module load, so set it before importing.
process.env.SHOP_DOMAIN = 'demo.myshopify.com';
const { buildBackInStock } = await import('./notify.mjs');

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

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

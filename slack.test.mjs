#!/usr/bin/env node
import { buildSignupMessage } from './slack.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}

console.log('--- buildSignupMessage ---');
const full = buildSignupMessage({ email: 'jane@x.com', title: 'Chef Knife', handle: 'chef-knife', count: 3, shop: 'demo.myshopify.com' });
ok('has the email', full.text.includes('jane@x.com'));
ok('links the product with title label', full.text.includes('<https://demo.myshopify.com/products/chef-knife|Chef Knife>'));
ok('shows waiting count', full.text.includes('3 now waiting'));
ok('has the bell emoji', full.text.includes(':bell:'));

const noShop = buildSignupMessage({ email: 'a@b.com', title: 'Widget', handle: 'widget', count: 1 });
ok('no shop -> bold title, no link', noShop.text.includes('*Widget*') && !noShop.text.includes('http'));

const noHandle = buildSignupMessage({ email: 'a@b.com', title: 'Widget', shop: 'demo.myshopify.com', count: 0 });
ok('no handle -> bold title, no link', noHandle.text.includes('*Widget*') && !noHandle.text.includes('http'));
ok('count 0 -> no waiting suffix', !noHandle.text.includes('waiting'));

const noTitle = buildSignupMessage({ email: 'a@b.com', shop: 'demo.myshopify.com' });
ok('missing title -> falls back to "a product"', noTitle.text.includes('a product'));

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

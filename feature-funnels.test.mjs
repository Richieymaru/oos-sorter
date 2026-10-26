#!/usr/bin/env node
/** Pure tests for feature funnels. node feature-funnels.test.mjs — no env, no network. */
import { normalizeOrder } from './orders.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }

// --- normalizeOrder surfaces _origin / _src ---
const withAttrs = normalizeOrder({
  createdAt: '2026-10-01T00:00:00Z',
  customAttributes: [{ key: 'note', value: 'x' }, { key: '_origin', value: 'find-my-blaster' }],
  lineItems: { nodes: [{ title: 'A', quantity: 1, product: { id: 'gid://shopify/Product/1' }, customAttributes: [{ key: '_src', value: 'upgrade' }] }] },
});
ok('order origin read', withAttrs.origin === 'find-my-blaster');
ok('line src read', withAttrs.items[0].src === 'upgrade');

const bare = normalizeOrder({
  createdAt: '2026-10-01T00:00:00Z',
  lineItems: { nodes: [{ title: 'A', quantity: 1, customAttributes: [] }] },
});
ok('no attrs: origin null', bare.origin === null);
ok('no attrs: src null', bare.items[0].src === null);
ok('empty order tolerant', normalizeOrder({}).origin === null);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);

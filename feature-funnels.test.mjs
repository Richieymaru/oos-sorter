#!/usr/bin/env node
/** Pure tests for feature funnels. node feature-funnels.test.mjs — no env, no network. */
import { normalizeOrder } from './orders.mjs';
import { attributeOrders } from './feature-funnels.mjs';

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

// --- attributeOrders ---
const near = (a, b) => Math.abs(a - b) < 1e-9;
const mk = (amount, items) => ({ amount, currency: 'AUD', items: items.map(([qty, src]) => ({ title: 'x', qty, id: null, src })) });

const a1 = attributeOrders([mk(100, [[1, 'find-my-blaster'], [1, null]])]);
ok('single tagged: orders=1', a1.features['find-my-blaster'].orders === 1);
ok('single tagged: revenue share 50', near(a1.features['find-my-blaster'].revenue, 50));
ok('single tagged: other feature zero', a1.features.upgrade.orders === 0 && a1.features.upgrade.revenue === 0);
ok('currency from orders', a1.currency === 'AUD');

const a2 = attributeOrders([mk(90, [[1, 'find-my-blaster'], [2, 'upgrade']])]);
ok('both: orders=1 each', a2.features['find-my-blaster'].orders === 1 && a2.features.upgrade.orders === 1);
ok('both: revenue split per item', near(a2.features['find-my-blaster'].revenue, 30) && near(a2.features.upgrade.revenue, 60));

const a3 = attributeOrders([mk(50, [[1, null]])]);
ok('untagged: zeros', a3.features['find-my-blaster'].orders === 0 && a3.features.upgrade.revenue === 0);

const a4 = attributeOrders([]);
ok('empty: zeros, no throw', a4.features.upgrade.orders === 0 && a4.features['find-my-blaster'].revenue === 0);

const a5 = attributeOrders([mk(0, [[1, 'upgrade']]), mk(10, [[0, 'upgrade']])]);
ok('zero amount/qty: no NaN', a5.features.upgrade.orders === 2 && a5.features.upgrade.revenue === 0);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);

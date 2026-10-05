#!/usr/bin/env node
/** Pure tests for the notified-log helpers. node notified.test.mjs */
import {
  notifiedRow, appendNotified, trimToFit, markClicked, markNudged,
  markUnsubscribed, selectNudges, deriveStats, safeRelPath, cartVariantId, matchOrders,
} from './notified.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- notifiedRow ---');
const row = notifiedRow({ email: 'A@X.com', productId: 'gid://shopify/Product/55', title: 'Knife', variantId: 'gid://shopify/ProductVariant/99', variantTitle: 'Black', ts: 't1' });
ok('lowercases email + numeric ids', eq(row, { e: 'a@x.com', p: '55', t: 'Knife', v: '99', vt: 'Black', ts: 't1', c: null, n: null, u: false, o: null }));
ok('null variant when absent', notifiedRow({ email: 'a@x.com', productId: '55', title: 'X', ts: 't' }).v === null);

console.log('\n--- appendNotified ---');
let log = appendNotified([], row);
ok('prepends the row', log.length === 1 && log[0].e === 'a@x.com');
log = appendNotified(log, notifiedRow({ email: 'b@x.com', productId: '55', title: 'X', ts: 't2' }));
ok('newest-first', log[0].e === 'b@x.com' && log[1].e === 'a@x.com');
ok('dedupes (e,p,ts)', appendNotified(log, row).length === 2);
ok('non-array log is safe', appendNotified(null, row).length === 1);
let capped = [];
for (let i = 0; i < 5; i++) capped = appendNotified(capped, notifiedRow({ email: `u${i}@x.com`, productId: '1', title: 'X', ts: `t${i}` }), 3);
ok('caps to newest N', capped.length === 3 && capped[0].e === 'u4@x.com' && capped[2].e === 'u2@x.com');

console.log('\n--- trimToFit ---');
const big = [];
for (let i = 0; i < 50; i++) big.push(notifiedRow({ email: `user${i}@example.com`, productId: '1', title: 'Some Product Title', ts: `2026-09-25T00:00:${String(i).padStart(2, '0')}Z` }));
const fitted = trimToFit(big, 400);
ok('trims oldest until under the byte limit', Buffer.byteLength(JSON.stringify(fitted)) <= 400 && fitted.length < 50);
ok('keeps the newest rows', fitted[0].e === 'user0@example.com');
ok('no-op when already fits', trimToFit(big, 10_000_000).length === 50);

console.log('\n--- markClicked / markNudged ---');
const base = [
  notifiedRow({ email: 'a@x.com', productId: '55', title: 'X', ts: 't3' }),
  notifiedRow({ email: 'a@x.com', productId: '55', title: 'X', ts: 't1' }),
];
let clicked = markClicked(base, 'A@X.com', 'gid://shopify/Product/55', 'now');
ok('marks the newest matching row', clicked[0].c === 'now' && clicked[1].c === null);
ok('no-op if already clicked', markClicked(clicked, 'a@x.com', '55', 'later')[0].c === 'now');
ok('no-op when no match', markClicked(base, 'z@x.com', '55', 'now') === base);
let nudged = markNudged(base, 'a@x.com', '55', 'now');
ok('flags ALL matching rows nudged (no re-fire on older rows)', nudged[0].n === 'now' && nudged[1].n === 'now');
ok('markNudged no-op when none match', markNudged(base, 'z@x.com', '55', 'now') === base);

console.log('\n--- markUnsubscribed ---');
const uns = markUnsubscribed(base, 'a@x.com', '55');
ok('flags all matching rows', uns[0].u === true && uns[1].u === true);
ok('no-op when none match', markUnsubscribed(base, 'z@x.com', '55') === base);

console.log('\n--- selectNudges ---');
const NOW = '2026-09-25T00:00:00Z';
const mk = (over) => ({ ...notifiedRow({ email: 'a@x.com', productId: '7', title: 'X', ts: '2026-09-20T00:00:00Z' }), ...over });
const pool = [
  mk({ ts: '2026-09-20T00:00:00Z' }),                 // due (5 days old, in stock)
  mk({ ts: '2026-09-24T18:00:00Z' }),                 // too recent
  mk({ ts: '2026-09-20T00:00:00Z', c: 'x' }),         // clicked
  mk({ ts: '2026-09-20T00:00:00Z', n: 'x' }),         // already nudged
  mk({ ts: '2026-09-20T00:00:00Z', u: true }),        // unsubscribed
  mk({ ts: '2026-09-20T00:00:00Z', p: '8' }),         // out of stock
];
const due = selectNudges(pool, NOW, 2, (p) => p === '7');
ok('exactly the one due row', due.length === 1 && due[0].ts === '2026-09-20T00:00:00Z' && due[0].p === '7');
ok('respects the wait window', selectNudges([mk({ ts: '2026-09-24T18:00:00Z' })], NOW, 2, () => true).length === 0);
ok('non-array is safe', selectNudges(null, NOW, 2, () => true).length === 0);
const twoVariants = [
  mk({ ts: '2026-09-20T00:00:00Z', v: '1' }),
  mk({ ts: '2026-09-19T00:00:00Z', v: '2' }),
];
const dueDedup = selectNudges(twoVariants, NOW, 2, () => true);
ok('dedupes to one nudge per (email,product)', dueDedup.length === 1 && dueDedup[0].v === '1');

console.log('\n--- deriveStats ---');
const stats = deriveStats([mk({}), mk({ c: 'x' }), mk({ c: 'x', n: 'y' }), mk({ o: 'z' })]);
ok('counts + click rate', eq(stats, { notified: 4, clicked: 2, nudged: 1, ordered: 1, orders: 1, revenue: 0, currency: null, clickRate: 50 }));
ok('empty stats', eq(deriveStats([]), { notified: 0, clicked: 0, nudged: 0, ordered: 0, orders: 0, revenue: 0, currency: null, clickRate: 0 }));

console.log('\n--- safeRelPath ---');
ok('accepts a product path', safeRelPath('/products/x') === '/products/x');
ok('accepts a cart permalink', safeRelPath('/cart/999:1') === '/cart/999:1');
ok('rejects protocol-relative', safeRelPath('//evil.com') === null);
ok('rejects absolute url', safeRelPath('https://evil.com') === null);
ok('rejects backslash', safeRelPath('/\\evil') === null);
ok('rejects non-rooted', safeRelPath('evil') === null);
ok('rejects empty', safeRelPath('') === null);

console.log('\n--- cartVariantId ---');
ok('parses an add-to-cart permalink', cartVariantId('/cart/5965419872411:1') === '5965419872411');
ok('null for a product-page path', cartVariantId('/products/solid-m4') === null);
ok('null for a malformed cart path', cartVariantId('/cart/abc:1') === null);
ok('null for empty', cartVariantId('') === null);

console.log('\n--- matchOrders (order attribution) ---');
const nlog = [
  notifiedRow({ email: 'A@x.com', productId: '111', title: 'Widget', ts: '2026-09-30T00:00:00Z' }),
  notifiedRow({ email: 'b@x.com', productId: '222', title: 'Gadget', ts: '2026-09-30T00:00:00Z' }),
];
const ords = [
  { id: 'gid://shopify/Order/9001', email: 'a@x.com', createdAt: '2026-10-02T00:00:00Z', amount: 339.99, currency: 'AUD', productIds: ['111'] },
  { id: 'gid://shopify/Order/9002', email: 'b@x.com', createdAt: '2026-09-29T00:00:00Z', amount: 50, currency: 'AUD', productIds: ['222'] }, // BEFORE notification
];
const mr = matchOrders(nlog, ords);
ok('matches shopper to her order (email case-insensitive)', mr.matched === 1 && mr.log[0].o === '2026-10-02T00:00:00Z');
ok('stores amount + currency + order id', mr.log[0].oa === 339.99 && mr.log[0].oc === 'AUD' && mr.log[0].oid === '9001');
ok('does NOT match an order placed BEFORE notification', mr.log[1].o == null);
ok('no double-match on rerun (already ordered)', matchOrders(mr.log, ords).matched === 0);
ok('ignores orders with no email (redacted)', matchOrders(nlog, [{ id: 'gid://shopify/Order/9003', email: null, createdAt: '2026-10-03T00:00:00Z', amount: 10, productIds: ['111'] }]).matched === 0);
ok('wrong product does not match', matchOrders(nlog, [{ id: 'gid://shopify/Order/9004', email: 'a@x.com', createdAt: '2026-10-02T00:00:00Z', amount: 10, productIds: ['999'] }]).matched === 0);

console.log('\n--- deriveStats revenue (distinct orders) ---');
const paidRow = (email, p, extra) => ({ ...notifiedRow({ email, productId: p, title: 'X', ts: '2026-09-30T00:00:00Z' }), ...extra });
const paid = [
  paidRow('a@x.com', '111', { o: '2026-10-02T00:00:00Z', oa: 339.99, oc: 'AUD', oid: '9001' }),
  paidRow('a@x.com', '112', { o: '2026-10-02T00:00:00Z', oa: 339.99, oc: 'AUD', oid: '9001' }), // same order
  paidRow('c@x.com', '333', { o: '2026-10-03T00:00:00Z', oa: 100, oc: 'AUD', oid: '9005' }),
];
const st = deriveStats(paid);
ok('ordered counts rows', st.ordered === 3);
ok('orders counts DISTINCT orders', st.orders === 2);
ok('revenue dedups by order (no double-count)', st.revenue === 439.99);
ok('currency carried', st.currency === 'AUD');
ok('empty log -> zero revenue', deriveStats([]).revenue === 0);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

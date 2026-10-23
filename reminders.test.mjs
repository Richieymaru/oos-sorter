#!/usr/bin/env node
/** Pure tests for the gel & gas reorder reminders. node reminders.test.mjs */
import {
  emptyLog, normalizeLog, gelLines, kindOf, selectDue, reminderRow, markReordered,
  markClicked, addOptout, reminderStats, trimToFit, reminderKey, isReminderKey,
  normalizeReminderOrder, reminderPayload, dayKey,
} from './reminders.mjs';
import { buildReorderReminder, buildBackInStock } from './notify.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}

const NOW = '2026-10-23T08:00:00.000Z';
const daysAgo = (d) => new Date(new Date(NOW).getTime() - d * 86400000).toISOString();
const gelIds = new Set(['100', '101']); // 100 = hard gels, 101 = gas
const gel = (over = {}) => ({ title: '7,000 Hard Gel Balls', qty: 1, variantId: '9100', price: 13.99, productId: '100', handle: 'hard-gels', image: 'https://x/i.png', ...over });
const blaster = { title: 'M4 Gel Blaster', qty: 1, variantId: '9500', price: 250, productId: '500', handle: 'm4' };
const order = (over = {}) => ({
  id: '1', name: '#1001', createdAt: daysAgo(22), cancelledAt: null, financial: 'PAID',
  email: 'Sam@Example.com', consent: 'SUBSCRIBED', amount: 13.99, currency: 'AUD', lines: [gel()], ...over,
});
const opts = { now: NOW, delayDays: 21, gelIds };

console.log('--- keys + log shape ---');
ok('reminder key is r + digits', reminderKey('gid://shopify/Order/42') === 'r42' && isReminderKey('r42'));
ok('a waitlist product id is not a reminder key', !isReminderKey('42') && !isReminderKey('rx'));
ok('normalizeLog fills a bad value', JSON.stringify(normalizeLog('nope')) === JSON.stringify(emptyLog()));
ok('normalizeLog lowercases opt-outs and drops bad rows', (() => {
  const l = normalizeLog({ rows: [{ o: '1', e: 'a@x.com' }, { o: '2' }], optout: ['A@X.com', ''] });
  return l.rows.length === 1 && l.optout.length === 1 && l.optout[0] === 'a@x.com';
})());
ok('dayKey is the calendar day', dayKey(NOW) === '2026-10-23');

console.log('\n--- gel lines + kind ---');
ok('finds only gel/gas lines', gelLines({ lines: [gel(), blaster] }, gelIds).length === 1);
ok('kind is gels for gel balls', kindOf([gel()]) === 'gels');
ok('kind is gas when every line is gas', kindOf([gel({ title: 'Competition 14KG Puff Dino Gun Gas', productId: '101' })]) === 'gas');
ok('kind is both for a mix', kindOf([gel(), gel({ title: 'Green Gas', productId: '101' })]) === 'both');

console.log('\n--- selectDue ---');
let r = selectDue([order()], emptyLog(), opts);
ok('a consented gel order 22 days old is due', r.due.length === 1 && r.due[0].orderId === '1');
ok('too recent (20 days) is not due yet', selectDue([order({ createdAt: daysAgo(20) })], emptyLog(), opts).due.length === 0);
ok('older than the window (40 days) is left alone', selectDue([order({ createdAt: daysAgo(40) })], emptyLog(), opts).due.length === 0);
ok('no gel/gas lines -> not due', selectDue([order({ lines: [blaster] })], emptyLog(), opts).due.length === 0);
r = selectDue([order({ consent: 'NOT_SUBSCRIBED' })], emptyLog(), opts);
ok('no marketing consent -> skipped and counted', r.due.length === 0 && r.skipped.noConsent === 1);
ok('unknown consent (hidden) -> skipped', selectDue([order({ consent: null })], emptyLog(), opts).due.length === 0);
ok('cancelled -> skipped', selectDue([order({ cancelledAt: daysAgo(21) })], emptyLog(), opts).skipped.dead === 1);
ok('refunded -> skipped', selectDue([order({ financial: 'REFUNDED' })], emptyLog(), opts).skipped.dead === 1);
ok('partially refunded is still reminded', selectDue([order({ financial: 'PARTIALLY_REFUNDED' })], emptyLog(), opts).due.length === 1);
ok('no email -> skipped', selectDue([order({ email: null })], emptyLog(), opts).skipped.noEmail === 1);
r = selectDue([order(), order({ id: '2', createdAt: daysAgo(5), amount: 30 })], emptyLog(), opts);
ok('already reordered gels since -> skipped', r.due.length === 0 && r.skipped.reordered === 1);
r = selectDue([order(), order({ id: '2', createdAt: daysAgo(5), lines: [blaster] })], emptyLog(), opts);
ok('a later order WITHOUT gels does not count as a reorder', r.due.length === 1);
r = selectDue([order(), order({ id: '2', createdAt: daysAgo(5), financial: 'REFUNDED' })], emptyLog(), opts);
ok('a later refunded gel order does not count as a reorder', r.due.length === 1);
const logged = { ...emptyLog(), rows: [{ o: '1', e: 'sam@example.com', ts: daysAgo(1) }] };
ok('an order already reminded is not reminded again', selectDue([order()], logged, opts).skipped.already === 1);
ok('an opted-out customer is skipped', selectDue([order()], { ...emptyLog(), optout: ['sam@example.com'] }, opts).skipped.optout === 1);
r = selectDue([order(), order({ id: '3', createdAt: daysAgo(23) })], emptyLog(), opts);
ok('two due orders for one customer -> one email, the newest order (the older one counts as reordered)', r.due.length === 1 && r.due[0].orderId === '1' && r.skipped.reordered === 1);
const recent = { ...emptyLog(), rows: [{ o: '9', e: 'sam@example.com', ts: daysAgo(3) }] };
ok('reminded recently for another order -> not again this window', selectDue([order()], recent, opts).due.length === 0);
ok('email matching ignores case', selectDue([order()], { ...emptyLog(), optout: ['SAM@example.COM'.toLowerCase()] }, opts).due.length === 0);

console.log('\n--- rows, clicks, reorders, stats ---');
const row = reminderRow({ orderId: '1', name: '#1001', email: 'Sam@Example.com', lines: [gel({ qty: 2 })] }, daysAgo(2));
ok('row lowercases email and keeps items', row.e === 'sam@example.com' && row.items[0].q === 2 && row.items[0].v === '9100');
const log = { ...emptyLog(), rows: [row] };
ok('click recorded once', markClicked(log, 'r1'.slice(1), 'SAM@example.com', 't1') && !markClicked(log, '1', 'sam@example.com', 't2') && log.rows[0].c === 't1');
ok('click for another email is ignored', !markClicked(log, '1', 'other@x.com', 't3'));
ok('a gel order after the reminder marks a reorder', markReordered(log, [order({ id: '7', createdAt: daysAgo(1), amount: 27.98 })], gelIds) === 1 && log.rows[0].amt === 27.98);
ok('a reorder is only counted once', markReordered(log, [order({ id: '8', createdAt: daysAgo(0.5), amount: 99 })], gelIds) === 0 && log.rows[0].amt === 27.98);
const log2 = { ...emptyLog(), rows: [reminderRow({ orderId: '1', email: 'a@x.com', lines: [gel()] }, daysAgo(2))] };
ok('an order BEFORE the reminder is not its revenue', markReordered(log2, [order({ email: 'a@x.com', createdAt: daysAgo(3) })], gelIds) === 0);
ok('opt-out added once', addOptout(log, 'Sam@Example.com') && !addOptout(log, 'sam@example.com') && log.optout.length === 1);
const st = reminderStats(log);
ok('stats: sent, clicked, reordered, revenue', st.sent === 1 && st.clicked === 1 && st.reordered === 1 && st.revenue === 27.98 && st.optedOut === 1);
const big = { ...emptyLog(), rows: Array.from({ length: 3000 }, (_, i) => reminderRow({ orderId: String(i), email: `p${i}@x.com`, lines: [gel()] }, daysAgo(1))) };
const fit = trimToFit(big, 20000);
ok('trimToFit drops the oldest to fit', Buffer.byteLength(JSON.stringify(fit)) <= 20000 && fit.rows[fit.rows.length - 1].o === '2999');

console.log('\n--- order normalising + payload + email ---');
const n = normalizeReminderOrder({
  id: 'gid://shopify/Order/55', name: '#1055', createdAt: daysAgo(22), cancelledAt: null, displayFinancialStatus: 'PAID',
  email: 'x@y.com', customer: { emailMarketingConsent: { marketingState: 'SUBSCRIBED' } },
  currentTotalPriceSet: { shopMoney: { amount: '41.97', currencyCode: 'AUD' } },
  lineItems: { nodes: [{ quantity: 3, title: '7,000 Hard Gel Balls', variantTitle: 'Default Title', variant: { id: 'gid://shopify/ProductVariant/9100', price: '13.99', image: null }, product: { id: 'gid://shopify/Product/100', handle: 'hard-gels', featuredImage: { url: 'https://p.png' } } }] },
});
ok('normalised order: ids, consent, line', n.id === '55' && n.consent === 'SUBSCRIBED' && n.lines[0].variantId === '9100' && n.lines[0].qty === 3 && n.lines[0].image === 'https://p.png');
ok('no customer -> consent null (skipped later)', normalizeReminderOrder({ id: '1', lineItems: { nodes: [] } }).consent === null);
const due = { orderId: '55', email: 'x@y.com', lines: [gel({ qty: 3 }), gel({ title: 'Green Gas', productId: '101', variantId: '9101', price: 20, qty: 1 })] };
const p = reminderPayload(due, { host: 'gelballundercover.com.au', brandLogo: null }, {}, 'x@y.com', 'AUD');
ok('cart link reorders every gel/gas line with the same quantities', decodeURIComponent(p.product.clickCartUrl).includes('/cart/9100:3,9101:1'));
ok('links are signed with the reminder key', p.product.clickCartUrl.includes('product=r55') && p.unsub.includes('product=r55'));
ok('the biggest line is the hero, the rest are named', p.product.title === '7,000 Hard Gel Balls' && p.others[0] === 'Green Gas');
const em = buildReorderReminder(p.product, p.unsub, { weeks: 3, others: p.others, kind: p.kind });
ok('a mixed order asks about gels & gas', em.subject === 'Running low on gels & gas? Reorder them in one click');
ok('a gels-only order names the gels in the subject', /^Running low on gels\? Reorder 7,000 Hard Gel Balls in one click$/.test(buildReorderReminder(p.product, p.unsub, { kind: 'gels' }).subject));
const pricey = reminderPayload({ orderId: '9', email: 'x@y.com', lines: [gel({ qty: 1, price: 13.99 }), gel({ title: 'Competition 14KG Puff Dino Gun Gas', productId: '101', variantId: '9101', price: 41.2, qty: 1 })] }, { host: 'h' }, {}, 'x@y.com', 'AUD');
ok('gels lead even when the gas costs more', pricey.product.title === '7,000 Hard Gel Balls' && pricey.others[0].includes('Gas'));
ok('button says Reorder now', em.html.includes('Reorder now'));
ok('footer says why they got it, not the waitlist wording', em.html.includes('agreed to hear from us') && !em.html.includes('back in stock'));
ok('lead mentions the quantity and the other line', em.html.includes('3 &times;') && em.html.includes('Green Gas'));
ok('plain-text has the reorder link and unsubscribe', em.text.includes(p.product.clickCartUrl) && em.text.includes(p.unsub));
const bis = buildBackInStock({ title: 'X', variantId: '1', storeHost: 'h' }, '#u');
ok('back-in-stock email still says Add to cart and the waitlist footer', bis.html.includes('Add to cart') && bis.html.includes('back in stock'));

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

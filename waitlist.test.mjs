#!/usr/bin/env node
/** Pure tests for the waitlist helpers. node waitlist.test.mjs */
import { addEmail, removeEmail, signUnsub, verifyUnsub, partitionByStock } from './waitlist.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- addEmail ---');
let r = addEmail([], 'A@x.com', 't1');
ok('adds + lowercases', r.added && eq(r.list, [{ email: 'a@x.com', ts: 't1' }]));
ok('rejects invalid', addEmail([], 'notanemail', 't').added === false);
ok('rejects duplicate (case-insensitive)', addEmail([{ email: 'a@x.com', ts: 't1' }], 'A@X.com', 't2').added === false);
ok('duplicate reason', addEmail([{ email: 'a@x.com', ts: 't1' }], 'a@x.com', 't2').reason === 'exists');
r = addEmail([{ email: 'a@x.com', ts: 't1' }], 'b@y.com', 't2');
ok('appends a second distinct email', r.added && r.list.length === 2);
ok('respects the cap', addEmail([{ email: 'a@x.com', ts: 't' }], 'b@y.com', 't', { max: 1 }).reason === 'full');

console.log('\n--- addEmail: variants ---');
r = addEmail([], 'a@x.com', 't1', { variantId: '99', variantTitle: 'Black' });
ok('records the variant', r.added && eq(r.list, [{ email: 'a@x.com', ts: 't1', variantId: '99', variantTitle: 'Black' }]));
ok('omits variant keys when there is no variant', eq(addEmail([], 'a@x.com', 't1').list, [{ email: 'a@x.com', ts: 't1' }]));
const black = [{ email: 'a@x.com', ts: 't1', variantId: '99', variantTitle: 'Black' }];
ok('same email + same variant is a duplicate', addEmail(black, 'A@X.com', 't2', { variantId: '99' }).reason === 'exists');
r = addEmail(black, 'a@x.com', 't2', { variantId: '100', variantTitle: 'Tan' });
ok('same email + different variant is allowed', r.added && r.list.length === 2);
ok('variant id is compared as a string', addEmail(black, 'a@x.com', 't2', { variantId: 99 }).reason === 'exists');
ok('a legacy entry does not block a variant signup', addEmail([{ email: 'a@x.com', ts: 't' }], 'a@x.com', 't2', { variantId: '99' }).added);
ok('title without an id is not recorded', eq(addEmail([], 'a@x.com', 't', { variantTitle: 'Black' }).list, [{ email: 'a@x.com', ts: 't' }]));

console.log('\n--- removeEmail ---');
ok('removes match', eq(removeEmail([{ email: 'a@x.com' }, { email: 'b@y.com' }], 'A@X.com'), [{ email: 'b@y.com' }]));
ok('no-op when absent', removeEmail([{ email: 'a@x.com' }], 'z@z.com').length === 1);
ok(
  'unsubscribe drops every variant for that address',
  removeEmail([{ email: 'a@x.com', variantId: '1' }, { email: 'a@x.com', variantId: '2' }, { email: 'b@y.com' }], 'a@x.com').length === 1
);

console.log('\n--- partitionByStock ---');
const mixed = [
  { email: 'black@x.com', variantId: '99' },
  { email: 'tan@x.com', variantId: '100' },
  { email: 'legacy@x.com' },
];
let p = partitionByStock(mixed, (v) => v === '99');
ok('emails only the restocked variant', eq(p.notify.map((s) => s.email), ['black@x.com']));
ok('keeps the others waiting', eq(p.waiting.map((s) => s.email), ['tan@x.com', 'legacy@x.com']));
p = partitionByStock(mixed, (v) => v === null);
ok('legacy entries are asked as null (product-level)', eq(p.notify.map((s) => s.email), ['legacy@x.com']));
p = partitionByStock(mixed, () => true);
ok('everything back -> nobody left waiting', p.notify.length === 3 && p.waiting.length === 0);
p = partitionByStock(mixed, () => false);
ok('nothing back -> nobody emailed', p.notify.length === 0 && p.waiting.length === 3);
ok('empty list is safe', eq(partitionByStock([], () => true), { notify: [], waiting: [] }));
ok('null list is safe', eq(partitionByStock(null, () => true), { notify: [], waiting: [] }));

console.log('\n--- unsubscribe signature ---');
const SEC = 'shhh';
const sig = signUnsub('123', 'a@x.com', SEC);
ok('verifies a good sig', verifyUnsub('123', 'a@x.com', sig, SEC));
ok('email case-insensitive in sig', verifyUnsub('123', 'A@X.com', sig, SEC));
ok('wrong product -> false', verifyUnsub('999', 'a@x.com', sig, SEC) === false);
ok('wrong email -> false', verifyUnsub('123', 'b@y.com', sig, SEC) === false);
ok('wrong secret -> false', verifyUnsub('123', 'a@x.com', sig, 'other') === false);
ok('garbage sig -> false', verifyUnsub('123', 'a@x.com', 'nope', SEC) === false);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

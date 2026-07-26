#!/usr/bin/env node
/** Pure tests for the waitlist helpers. node waitlist.test.mjs */
import { addEmail, removeEmail, signUnsub, verifyUnsub } from './waitlist.mjs';

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
ok('respects the cap', addEmail([{ email: 'a@x.com', ts: 't' }], 'b@y.com', 't', 1).reason === 'full');

console.log('\n--- removeEmail ---');
ok('removes match', eq(removeEmail([{ email: 'a@x.com' }, { email: 'b@y.com' }], 'A@X.com'), [{ email: 'b@y.com' }]));
ok('no-op when absent', removeEmail([{ email: 'a@x.com' }], 'z@z.com').length === 1);

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

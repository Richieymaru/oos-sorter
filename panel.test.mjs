#!/usr/bin/env node
import { normalizeSettings, normalizeEmails } from './settings.mjs';
import { isAuthorized, settingsBody } from './panel.mjs';

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
  else console.log(`  ok  ${label}`);
}

console.log('--- normalizeSettings ---');
const E = []; // no recipients
eq('empty -> all false', normalizeSettings({}), { sort: false, notify: false, draft: false, notifyEmails: E });
eq('undefined -> all false', normalizeSettings(undefined), { sort: false, notify: false, draft: false, notifyEmails: E });
eq('true booleans pass', normalizeSettings({ sort: true, notify: true, draft: true }), { sort: true, notify: true, draft: true, notifyEmails: E });
eq('mixed', normalizeSettings({ sort: true, notify: false }), { sort: true, notify: false, draft: false, notifyEmails: E });
eq('string "true" is not true', normalizeSettings({ sort: 'true' }), { sort: false, notify: false, draft: false, notifyEmails: E });
eq('extra keys ignored', normalizeSettings({ sort: true, evil: true }), { sort: true, notify: false, draft: false, notifyEmails: E });
eq('recipients parsed inside settings', normalizeSettings({ notifyEmails: 'A@x.com, b@y.com' }).notifyEmails, ['a@x.com', 'b@y.com']);

console.log('\n--- normalizeEmails ---');
eq('comma + space split', normalizeEmails('a@x.com, b@y.com'), ['a@x.com', 'b@y.com']);
eq('newline + semicolon split', normalizeEmails('a@x.com\nb@y.com; c@z.com'), ['a@x.com', 'b@y.com', 'c@z.com']);
eq('array input', normalizeEmails(['a@x.com', 'b@y.com']), ['a@x.com', 'b@y.com']);
eq('lowercases + dedupes', normalizeEmails('A@X.com a@x.com'), ['a@x.com']);
eq('drops invalid entries', normalizeEmails('good@x.com notanemail bad@ @bad x@y.com'), ['good@x.com', 'x@y.com']);
eq('empty string -> []', normalizeEmails(''), []);
eq('null -> []', normalizeEmails(null), []);

const basic = (pass) => 'Basic ' + Buffer.from('admin:' + pass).toString('base64');

console.log('\n--- isAuthorized ---');
eq('correct password', isAuthorized(basic('s3cret'), 's3cret'), true);
eq('wrong password', isAuthorized(basic('nope'), 's3cret'), false);
eq('missing header', isAuthorized(undefined, 's3cret'), false);
eq('non-basic header', isAuthorized('Bearer x', 's3cret'), false);
eq('empty configured password denies', isAuthorized(basic(''), ''), false);

console.log('\n--- settingsBody ---');
const sb = settingsBody({ sort: true, notify: false, draft: false });
eq('sort checkbox checked', /id="sort"[^>]*checked/.test(sb), true);
eq('notify checkbox unchecked', /id="notify"(?![^>]*checked)/.test(sb), true);
eq('has save + report calls', sb.includes('/api/save') && sb.includes('/api/report'), true);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

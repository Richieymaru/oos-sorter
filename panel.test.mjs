#!/usr/bin/env node
import { normalizeSettings } from './settings.mjs';
import { isAuthorized, renderPage } from './panel.mjs';

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
  else console.log(`  ok  ${label}`);
}

console.log('--- normalizeSettings ---');
eq('empty -> all false', normalizeSettings({}), { sort: false, notify: false, draft: false });
eq('undefined -> all false', normalizeSettings(undefined), { sort: false, notify: false, draft: false });
eq('true booleans pass', normalizeSettings({ sort: true, notify: true, draft: true }), { sort: true, notify: true, draft: true });
eq('mixed', normalizeSettings({ sort: true, notify: false }), { sort: true, notify: false, draft: false });
eq('string "true" is not true', normalizeSettings({ sort: 'true' }), { sort: false, notify: false, draft: false });
eq('extra keys ignored', normalizeSettings({ sort: true, evil: true }), { sort: true, notify: false, draft: false });

const basic = (pass) => 'Basic ' + Buffer.from('admin:' + pass).toString('base64');

console.log('\n--- isAuthorized ---');
eq('correct password', isAuthorized(basic('s3cret'), 's3cret'), true);
eq('wrong password', isAuthorized(basic('nope'), 's3cret'), false);
eq('missing header', isAuthorized(undefined, 's3cret'), false);
eq('non-basic header', isAuthorized('Bearer x', 's3cret'), false);
eq('empty configured password denies', isAuthorized(basic(''), ''), false);

console.log('\n--- renderPage ---');
const html = renderPage({ settings: { sort: true, notify: false, draft: false }, status: { soldOutCount: 55, lastRun: '2026-07-24T08:00:00.000Z' } });
eq('sort checkbox checked', /id="sort"[^>]*checked/.test(html), true);
eq('notify checkbox unchecked', /id="notify"(?![^>]*checked)/.test(html), true);
eq('shows sold-out count', html.includes('55'), true);
eq('has save + report buttons', html.includes('/api/save') && html.includes('/api/report'), true);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
import { normalizeSettings } from './settings.mjs';

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

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

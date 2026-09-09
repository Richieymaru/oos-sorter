#!/usr/bin/env node
import { normalizeSettings, normalizeEmails, normalizeSlackWebhook, normalizeSheetWebhook } from './settings.mjs';
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
const base = { sort: false, notify: false, draft: false, waitlist: false, monitor: false, notifyEmails: E, slackWebhook: '', sheetWebhook: '' };
eq('empty -> all false', normalizeSettings({}), base);
eq('undefined -> all false', normalizeSettings(undefined), base);
eq('true booleans pass', normalizeSettings({ sort: true, notify: true, draft: true }), { ...base, sort: true, notify: true, draft: true });
eq('mixed', normalizeSettings({ sort: true, notify: false }), { ...base, sort: true });
eq('string "true" is not true', normalizeSettings({ sort: 'true' }), base);
eq('extra keys ignored', normalizeSettings({ sort: true, evil: true }), { ...base, sort: true });
eq('waitlist toggle', normalizeSettings({ waitlist: true }).waitlist, true);
eq('monitor toggle', normalizeSettings({ monitor: true }).monitor, true);
eq('recipients parsed inside settings', normalizeSettings({ notifyEmails: 'A@x.com, b@y.com' }).notifyEmails, ['a@x.com', 'b@y.com']);

eq('slack webhook stored inside settings', normalizeSettings({ slackWebhook: 'https://hooks.slack.com/services/A/B/C' }).slackWebhook, 'https://hooks.slack.com/services/A/B/C');
eq('sheet webhook stored inside settings', normalizeSettings({ sheetWebhook: 'https://script.google.com/macros/s/AAA/exec' }).sheetWebhook, 'https://script.google.com/macros/s/AAA/exec');

console.log('\n--- normalizeSheetWebhook ---');
eq('valid apps script url kept', normalizeSheetWebhook('https://script.google.com/macros/s/ABC/exec'), 'https://script.google.com/macros/s/ABC/exec');
eq('trims whitespace', normalizeSheetWebhook('  https://script.google.com/macros/s/ABC/exec '), 'https://script.google.com/macros/s/ABC/exec');
eq('non-google url rejected', normalizeSheetWebhook('https://evil.com/exec'), '');
eq('slack url is not a sheet url', normalizeSheetWebhook('https://hooks.slack.com/services/A/B/C'), '');
eq('empty -> empty', normalizeSheetWebhook(''), '');

console.log('\n--- normalizeSlackWebhook ---');
eq('valid slack hook kept', normalizeSlackWebhook('https://hooks.slack.com/services/T1/B1/xyz'), 'https://hooks.slack.com/services/T1/B1/xyz');
eq('trims whitespace', normalizeSlackWebhook('  https://hooks.slack.com/services/T1/B1/xyz  '), 'https://hooks.slack.com/services/T1/B1/xyz');
eq('non-slack url rejected', normalizeSlackWebhook('https://evil.com/hook'), '');
eq('random string rejected', normalizeSlackWebhook('not a url'), '');
eq('empty -> empty', normalizeSlackWebhook(''), '');
eq('null -> empty', normalizeSlackWebhook(null), '');

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
eq('has save + report calls', sb.includes('/api/settings') && sb.includes('/api/report'), true);
eq('renders the slack webhook field', /id="slack"/.test(sb) && sb.includes('slackWebhook:'), true);
eq('prefills existing slack webhook', settingsBody({ slackWebhook: 'https://hooks.slack.com/services/x/y/z' }).includes('https://hooks.slack.com/services/x/y/z'), true);
eq('renders the monitor toggle', /id="monitor"/.test(sb), true);
eq('renders the sheet webhook field', /id="sheet"/.test(sb) && sb.includes('sheetWebhook:'), true);
eq('renders the setup button wired to the setup-monitor action', /id="setupMon"/.test(sb) && sb.includes("action:'setup-monitor'"), true);
eq('prefills existing sheet webhook', settingsBody({ sheetWebhook: 'https://script.google.com/macros/s/x/exec' }).includes('https://script.google.com/macros/s/x/exec'), true);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
import { normalizeSettings, normalizeEmails, normalizeSlackWebhook, normalizeSheetWebhook, incentiveFor } from './settings.mjs';
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
const base = { sort: false, notify: false, draft: false, waitlist: false, monitor: false, notifyEmails: E, slackWebhook: '', monitorSlackWebhook: '', sheetWebhook: '', nudgeDays: 2, freeGiftEnabled: false, freeGiftProducts: ['Free gels'], freeGiftCode: '', offerAltVariant: false, incentivesEnabled: false, incentiveTier1: 200, incentiveTier2: 500, incentiveTier3: 1000, incentiveMinorGiftProducts: [], incentiveMajorGiftProducts: [] };
eq('empty -> all false', normalizeSettings({}), base);
eq('freeGift off by default', normalizeSettings({}).freeGiftEnabled, false);
eq('freeGift default product is Free gels', normalizeSettings({}).freeGiftProducts, ['Free gels']);
eq('freeGift enable + custom products parsed', normalizeSettings({ freeGiftEnabled: true, freeGiftProducts: 'Gel balls\nStickers' }).freeGiftProducts, ['Gel balls', 'Stickers']);
eq('freeGift empty list falls back to default', normalizeSettings({ freeGiftProducts: '' }).freeGiftProducts, ['Free gels']);
eq('freeGift code trimmed', normalizeSettings({ freeGiftCode: '  FREEGEL  ' }).freeGiftCode, 'FREEGEL');
eq('offerAltVariant off by default', normalizeSettings({}).offerAltVariant, false);
eq('offerAltVariant enables', normalizeSettings({ offerAltVariant: true }).offerAltVariant, true);
eq('offerAltVariant string "true" is not true', normalizeSettings({ offerAltVariant: 'true' }).offerAltVariant, false);

console.log('\n--- incentives (price-tier perks) ---');
eq('incentives off by default', normalizeSettings({}).incentivesEnabled, false);
eq('default thresholds 200/500/1000', [normalizeSettings({}).incentiveTier1, normalizeSettings({}).incentiveTier2, normalizeSettings({}).incentiveTier3], [200, 500, 1000]);
eq('gift products default empty', [normalizeSettings({}).incentiveMinorGiftProducts, normalizeSettings({}).incentiveMajorGiftProducts], [[], []]);
eq('custom thresholds clamped to int', [normalizeSettings({ incentiveTier1: '150.7' }).incentiveTier1], [151]);
eq('minor gift products parsed (one per line)', normalizeSettings({ incentiveMinorGiftProducts: 'Free gels\nSticker' }).incentiveMinorGiftProducts, ['Free gels', 'Sticker']);
// incentiveFor: off -> null
eq('incentiveFor returns null when disabled', incentiveFor(999, normalizeSettings({})), null);
const incOn = normalizeSettings({ incentivesEnabled: true, incentiveMinorGiftProducts: 'Sticker', incentiveMajorGiftProducts: 'Blaster' });
eq('below tier1 -> null', incentiveFor(199, incOn), null);
eq('tier1 (200) -> free shipping only', incentiveFor(200, incOn), { freeShipping: true, gift: null });
eq('tier2 (500) -> free shipping + minor gift', incentiveFor(500, incOn), { freeShipping: true, gift: ['Sticker'] });
eq('tier3 (1000) -> free shipping + major gift', incentiveFor(1500, incOn), { freeShipping: true, gift: ['Blaster'] });
eq('empty minor gift falls back to a free gift label', incentiveFor(500, normalizeSettings({ incentivesEnabled: true })), { freeShipping: true, gift: ['a free gift'] });
eq('non-numeric price -> null', incentiveFor('abc', incOn), null);
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
eq('monitor slack webhook stored + validated', normalizeSettings({ monitorSlackWebhook: 'https://hooks.slack.com/services/M/N/O' }).monitorSlackWebhook, 'https://hooks.slack.com/services/M/N/O');
eq('monitor slack rejects non-slack url', normalizeSettings({ monitorSlackWebhook: 'https://evil.com/x' }).monitorSlackWebhook, '');

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
eq('renders a separate product-changes slack field', /id="monitorSlack"/.test(sb) && sb.includes('monitorSlackWebhook:'), true);
eq('prefills existing monitor slack webhook', settingsBody({ monitorSlackWebhook: 'https://hooks.slack.com/services/p/q/r' }).includes('https://hooks.slack.com/services/p/q/r'), true);
eq('prefills existing sheet webhook', settingsBody({ sheetWebhook: 'https://script.google.com/macros/s/x/exec' }).includes('https://script.google.com/macros/s/x/exec'), true);
eq('renders the alt-variant toggle wired to the body', /id="offerAltVariant"/.test(sb) && sb.includes('offerAltVariant:'), true);
eq('alt-variant toggle reflects saved on-state', /id="offerAltVariant"[^>]*checked/.test(settingsBody({ offerAltVariant: true })), true);
eq('renders the incentives toggle + thresholds wired to the body', /id="incentivesEnabled"/.test(sb) && /id="incentiveTier1"/.test(sb) && sb.includes('incentivesEnabled:') && sb.includes('incentiveTier1:'), true);
eq('renders the minor/major gift product fields', /id="incentiveMinorGiftProducts"/.test(sb) && /id="incentiveMajorGiftProducts"/.test(sb), true);
eq('prefills saved thresholds', settingsBody({ incentiveTier1: 250 }).includes('value="250"'), true);
eq('prefills saved gift products', settingsBody({ incentiveMajorGiftProducts: ['Mega Bundle'] }).includes('Mega Bundle'), true);

console.log('\n--- nudgeDays ---');
eq('clamps + defaults nudgeDays', normalizeSettings({ nudgeDays: 99 }).nudgeDays, 14);
eq('defaults missing nudgeDays to 2', normalizeSettings({}).nudgeDays, 2);
const withNudge = settingsBody({ waitlist: true, nudgeDays: 3 });
eq('renders the nudge-days input', withNudge.includes('id="nudgeDays"'), true);
eq('shows the saved value', withNudge.includes('value="3"'), true);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

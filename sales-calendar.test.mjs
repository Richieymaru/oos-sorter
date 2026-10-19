#!/usr/bin/env node
/** Pure tests for the AU sales calendar. node sales-calendar.test.mjs */
import { saleEvents, activeSaleReminder } from './sales-calendar.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }
const day = (e) => e.date.toISOString().slice(0, 10);

console.log('--- saleEvents(2026) dates ---');
const ev = Object.fromEntries(saleEvents(2026).map((e) => [e.key, day(e)]));
ok('Black Friday 2026 = Nov 27 (4th Fri)', ev['black-friday'] === '2026-11-27');
ok('Cyber Monday 2026 = Nov 30', ev['cyber-monday'] === '2026-11-30');
ok('Boxing Day = Dec 26', ev['boxing-day'] === '2026-12-26');
ok('Christmas = Dec 25', ev['christmas'] === '2026-12-25');
ok('EOFY = Jun 30', ev['eofy'] === '2026-06-30');
ok("Father's Day 2026 = Sep 6 (1st Sun)", ev['fathers-day'] === '2026-09-06');
ok("Mother's Day 2026 = May 10 (2nd Sun)", ev['mothers-day'] === '2026-05-10');
ok('has two Afterpay Days', saleEvents(2026).filter((e) => e.key.startsWith('afterpay-day')).length === 2);

console.log('\n--- activeSaleReminder ---');
const r1 = activeSaleReminder(new Date('2026-11-17T00:00:00Z'));
ok('14-day lead surfaces Black Friday', r1 && r1.key === 'black-friday' && r1.daysUntil === 10);
const r2 = activeSaleReminder(new Date('2026-08-01T00:00:00Z'));
ok('Afterpay Day (Aug) surfaces ~12 days out', r2 && r2.key === 'afterpay-day-aug' && r2.daysUntil === 12);
const r3 = activeSaleReminder(new Date('2026-04-20T00:00:00Z'));
ok('quiet period -> null', r3 === null);
const r4 = activeSaleReminder(new Date('2026-12-28T00:00:00Z'));
ok('recently-started event stays active (Boxing Day)', r4 && r4.key === 'boxing-day' && r4.daysUntil === -2);
const r5 = activeSaleReminder(new Date('2026-11-17T00:00:00Z'), { tiers: [1] });
ok('tier filter respected', r5 && r5.tier === 1);
const r6 = activeSaleReminder(new Date('2026-11-17T00:00:00Z'), { leadDays: 5 });
ok('shorter lead hides a 10-day-out event', r6 === null);
ok('approx flag present on Click Frenzy', saleEvents(2026).find((e) => e.key === 'click-frenzy').approx === true);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

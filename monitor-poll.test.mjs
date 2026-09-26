#!/usr/bin/env node
/** Pure tests for the event-log poll (classify + consolidate). node monitor-poll.test.mjs */
import { classifyEvent, groupBursts, consolidateBurst, burstSummary } from './monitor-poll.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- classifyEvent ---');
ok('status change', eq(classifyEvent('update', 'changed product status from active to draft'), { kind: 'status', from: 'active', to: 'draft', name: null }));
ok('channel exclusion (strips actor prefix)', eq(classifyEvent('update', 'GBU Shop Staff excluded a product from Facebook & Instagram'), { kind: 'channel-out', from: null, to: null, name: 'Facebook & Instagram' }));
ok('channel exclusion trailing period', classifyEvent('update', 'excluded a product from Online Store.').name === 'Online Store');
ok('market exclusion', eq(classifyEvent('publish', 'Product was excluded from Australia'), { kind: 'market-out', from: null, to: null, name: 'Australia' }));
ok('channel inclusion', classifyEvent('update', 'included a product in TikTok').kind === 'channel-in');
ok('create', classifyEvent('create', '').kind === 'add');
ok('destroy', classifyEvent('destroy', '').kind === 'delete');
ok('unrelated edit is other', classifyEvent('update', 'changed the price').kind === 'other');

console.log('\n--- groupBursts ---');
const evs = [
  { subjectId: '1', at: '2026-09-26T03:16:10Z', classified: { kind: 'status', from: 'active', to: 'draft' } },
  { subjectId: '1', at: '2026-09-26T03:16:12Z', classified: { kind: 'channel-out', name: 'Facebook & Instagram' } },
  { subjectId: '1', at: '2026-09-26T03:16:14Z', classified: { kind: 'market-out', name: 'Australia' } },
  { subjectId: '2', at: '2026-09-26T03:16:14Z', classified: { kind: 'delete' } },
  { subjectId: '1', at: '2026-09-26T09:00:00Z', classified: { kind: 'status', from: 'draft', to: 'active' } },
];
const groups = groupBursts(evs);
ok('groups by product + minute', groups.length === 3);
ok('the 03:16 product-1 burst has all 3 of its events', groups.some((g) => g.length === 3));

console.log('\n--- consolidateBurst + burstSummary ---');
const burst = [
  { subjectId: '1', title: 'Bushnell Red Dot', handle: 'bushnell', type: 'Product', who: 'Nick Power', at: '2026-09-26T03:16:10Z', classified: { kind: 'status', from: 'active', to: 'draft' } },
  { subjectId: '1', classified: { kind: 'channel-out', name: 'Facebook & Instagram' } },
  { subjectId: '1', classified: { kind: 'channel-out', name: 'Online Store' } },
  { subjectId: '1', classified: { kind: 'market-out', name: 'Australia' } },
  { subjectId: '1', classified: { kind: 'market-out', name: 'New Zealand' } },
];
const c = consolidateBurst(burst);
ok('keeps status change', c.statusFrom === 'active' && c.statusTo === 'draft');
ok('collects channels + markets', c.channelsOut.length === 2 && c.marketsOut.length === 2);
ok('carries title + who', c.title === 'Bushnell Red Dot' && c.who === 'Nick Power');
const s = burstSummary(c);
ok('consolidated label', s.label === 'Active → Draft · hidden from 2 channels · off 2 markets');
ok('to-draft/exclusion tone is warn', s.tone === 'warn');
ok('single channel names it', burstSummary(consolidateBurst([{ classified: { kind: 'channel-out', name: 'TikTok' } }])).label === 'Hidden from TikTok');
ok('delete is danger', burstSummary(consolidateBurst([{ classified: { kind: 'delete' } }])).tone === 'danger');
ok('back to active is positive', burstSummary(consolidateBurst([{ classified: { kind: 'status', from: 'draft', to: 'active' } }])).tone === 'pos');
ok('a burst with only "other" events summarises to nothing', burstSummary(consolidateBurst([{ classified: { kind: 'other' } }])).label === '');

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/** Pure tests for the monitor activity log. node monitor-log.test.mjs */
import { monitorRow, appendMonitorLog, monitorTag } from './monitor-log.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- monitorRow ---');
const r = monitorRow({ at: 't1', type: 'Product', title: 'Knife', handle: 'knife', path: 'products', fromLabel: 'Draft', toLabel: 'Active', who: 'Nick', stock: 5 });
ok('shapes a compact row', eq(r, { ts: 't1', ty: 'Product', t: 'Knife', h: 'knife', p: 'products', f: 'Draft', to: 'Active', w: 'Nick', s: 5 }));
ok('non-number stock -> null', monitorRow({ at: 't', title: 'X', toLabel: 'Deleted', stock: '' }).s === null);

console.log('\n--- appendMonitorLog ---');
let log = appendMonitorLog([], r);
ok('prepends', log.length === 1 && log[0].t === 'Knife');
log = appendMonitorLog(log, monitorRow({ at: 't2', title: 'Y', toLabel: 'Draft' }));
ok('newest-first', log[0].t === 'Y' && log[1].t === 'Knife');
ok('non-array safe', appendMonitorLog(null, r).length === 1);
let capped = [];
for (let i = 0; i < 5; i++) capped = appendMonitorLog(capped, monitorRow({ at: 't' + i, title: 'P' + i, toLabel: 'Active' }), 3);
ok('caps oldest-out', capped.length === 3 && capped[0].t === 'P4' && capped[2].t === 'P2');

console.log('\n--- monitorTag ---');
ok('status change is a from -> to, active is positive', eq(monitorTag('Draft', 'Active'), { label: 'Draft → Active', tone: 'pos' }));
ok('active -> draft reads as a warning', eq(monitorTag('Active', 'Draft'), { label: 'Active → Draft', tone: 'warn' }));
ok('create drops the placeholder from-label', eq(monitorTag('—', 'Added (Active)'), { label: 'Added (Active)', tone: 'pos' }));
ok('delete is danger', eq(monitorTag('existed', 'Deleted'), { label: 'Deleted', tone: 'danger' }));
ok('collection added is positive', monitorTag('—', 'Collection added').tone === 'pos');

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

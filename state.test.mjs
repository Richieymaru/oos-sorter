#!/usr/bin/env node
/** Pure tests for the sold-out history helper. node state.test.mjs */
import { recordSoldOutHistory } from './state.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- recordSoldOutHistory ---');

ok('first point from empty', eq(
  recordSoldOutHistory([], 5, '2026-10-19T08:00:00Z'),
  [{ d: '2026-10-19', n: 5 }]
));

ok('appends a new day', eq(
  recordSoldOutHistory([{ d: '2026-10-18', n: 3 }], 5, '2026-10-19T08:00:00Z'),
  [{ d: '2026-10-18', n: 3 }, { d: '2026-10-19', n: 5 }]
));

ok('same-day run overwrites (latest wins)', eq(
  recordSoldOutHistory([{ d: '2026-10-19', n: 3 }], 7, '2026-10-19T20:00:00Z'),
  [{ d: '2026-10-19', n: 7 }]
));

ok('zero is a real recorded value', eq(
  recordSoldOutHistory([{ d: '2026-10-18', n: 4 }], 0, '2026-10-19T08:00:00Z'),
  [{ d: '2026-10-18', n: 4 }, { d: '2026-10-19', n: 0 }]
));

ok('keeps only the last 30 days', (() => {
  let h = [];
  for (let i = 0; i < 40; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    h = recordSoldOutHistory(h, i, day);
  }
  return h.length === 30 && h[0].d === '2026-01-11' && h[29].n === 39;
})());

ok('result stays sorted when input is out of order', eq(
  recordSoldOutHistory([{ d: '2026-10-19', n: 2 }, { d: '2026-10-17', n: 9 }], 1, '2026-10-18T08:00:00Z'),
  [{ d: '2026-10-17', n: 9 }, { d: '2026-10-18', n: 1 }, { d: '2026-10-19', n: 2 }]
));

ok('non-array history is safe', eq(
  recordSoldOutHistory(null, 3, '2026-10-19T08:00:00Z'),
  [{ d: '2026-10-19', n: 3 }]
));

ok('garbage entries are dropped', eq(
  recordSoldOutHistory([{ d: '2026-10-18', n: 4 }, null, { n: 9 }], 2, '2026-10-19T08:00:00Z'),
  [{ d: '2026-10-18', n: 4 }, { d: '2026-10-19', n: 2 }]
));

console.log(`\n${failures ? 'FAIL' : 'PASS'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);

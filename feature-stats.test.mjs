#!/usr/bin/env node
/**
 * Offline tests for the feature_stats pure reducer. No env, no network:
 *   node feature-stats.test.mjs
 */

import { emptyStats, applyEvent, trimStats, sanitizeEvent } from './feature-stats.mjs';

let failures = 0;
let checks = 0;

function ok(label, cond) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const D = '2026-10-23';
const day = (s, d = D) => s.days[d];

// emptyStats shape
const e = emptyStats();
ok('emptyStats version 1', e.version === 1);
ok('emptyStats no days', Object.keys(e.days).length === 0);

// open events
let s = applyEvent(e, { f: 'fmb', e: 'open' }, D);
ok('fmb/open increments', day(s).fmb.open === 1);
ok('fmb zeroed shape', JSON.stringify(day(s).fmb.step) === '[0,0,0,0,0]' && day(s).fmb.done === 0 && day(s).fmb.deadEnd === 0);
ok('ugb zeroed shape', day(s).ugb.open === 0 && day(s).ugb.fits === 0 && day(s).ugb.add === 0 && JSON.stringify(day(s).ugb.blaster) === '{}');

// step
s = applyEvent(s, { f: 'fmb', e: 'step', n: 3 }, D);
ok('fmb/step n=3 -> step[2]', JSON.stringify(day(s).fmb.step) === '[0,0,1,0,0]');
const s2 = applyEvent(s, { f: 'fmb', e: 'step', n: 9 }, D);
ok('fmb/step out of range is no-op', JSON.stringify(day(s2).fmb.step) === '[0,0,1,0,0]');

// pick
s = applyEvent(s, { f: 'fmb', e: 'pick', q: 'type', a: 'gel' }, D);
s = applyEvent(s, { f: 'fmb', e: 'pick', q: 'type', a: 'gel' }, D);
ok('fmb/pick counts q:a', day(s).fmb.picks['type:gel'] === 2);

// done / deadEnd
s = applyEvent(s, { f: 'fmb', e: 'done', m: 4 }, D);
ok('fmb/done m>0 no deadEnd', day(s).fmb.done === 1 && day(s).fmb.deadEnd === 0);
s = applyEvent(s, { f: 'fmb', e: 'done', m: 0 }, D);
ok('fmb/done m=0 bumps deadEnd', day(s).fmb.done === 2 && day(s).fmb.deadEnd === 1);

// ugb
s = applyEvent(s, { f: 'ugb', e: 'open' }, D);
s = applyEvent(s, { f: 'ugb', e: 'blaster', b: 'x-blaster' }, D);
s = applyEvent(s, { f: 'ugb', e: 'blaster', b: 'x-blaster' }, D);
s = applyEvent(s, { f: 'ugb', e: 'fits' }, D);
s = applyEvent(s, { f: 'ugb', e: 'add' }, D);
ok('ugb counters', day(s).ugb.open === 1 && day(s).ugb.blaster['x-blaster'] === 2 && day(s).ugb.fits === 1 && day(s).ugb.add === 1);

// different day
const s3 = applyEvent(s, { f: 'ugb', e: 'open' }, '2026-10-24');
ok('separate day bucket', s3.days['2026-10-24'].ugb.open === 1 && day(s3).ugb.open === 1);

// unknown
ok('unknown f is no-op', JSON.stringify(applyEvent(s, { f: 'zzz', e: 'open' }, D)) === JSON.stringify(s));
ok('unknown e is no-op', JSON.stringify(applyEvent(s, { f: 'fmb', e: 'zzz' }, D)) === JSON.stringify(s));

// clamp
const long = 'x'.repeat(100);
const c = applyEvent(emptyStats(), { f: 'fmb', e: 'pick', q: long, a: long }, D);
const key = Object.keys(day(c).fmb.picks)[0];
ok('q/a clamped to 60', key === `${'x'.repeat(60)}:${'x'.repeat(60)}`);
const cb = applyEvent(emptyStats(), { f: 'ugb', e: 'blaster', b: long }, D);
ok('b clamped to 60', Object.keys(day(cb).ugb.blaster)[0].length === 60);

// no mutation
const frozen = JSON.stringify(s);
applyEvent(s, { f: 'fmb', e: 'open' }, D);
applyEvent(s, { f: 'ugb', e: 'blaster', b: 'new' }, D);
ok('applyEvent does not mutate input', JSON.stringify(s) === frozen);
const e0 = JSON.stringify(emptyStats());
applyEvent(emptyStats(), { f: 'fmb', e: 'open' }, D);
ok('emptyStats fresh each call', JSON.stringify(emptyStats()) === e0);

// hostile keys
{
  let h = emptyStats();
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype']) {
    h = applyEvent(h, { f: 'ugb', e: 'blaster', b: k }, D);
    h = applyEvent(h, { f: 'fmb', e: 'pick', q: k, a: k }, D);
  }
  h = applyEvent(h, { f: 'ugb', e: 'blaster', b: '__proto__' }, D);
  const rt = JSON.parse(JSON.stringify(h));
  const h2 = applyEvent(rt, { f: 'ugb', e: 'blaster', b: 'toString' }, D);
  const bl = h2.days[D].ugb.blaster;
  ok('hostile keys: own counters', Object.hasOwn(bl, '__proto__') && bl['__proto__'] === 2 && bl.constructor === 1 && bl.toString === 2 && bl.hasOwnProperty === 1);
  ok('hostile keys: picks own', h.days[D].fmb.picks['toString:toString'] === 1);
  ok('hostile keys: no pollution', ({}).toString === Object.prototype.toString && ({}).polluted === undefined && Object.getPrototypeOf(h.days[D].ugb.blaster) === Object.prototype);
  ok('hostile keys: survive JSON round-trip', JSON.stringify(rt) === JSON.stringify(h));
  const other = applyEvent(h, { f: 'ugb', e: 'open' }, '2026-10-25');
  ok('hostile keys: other day clean', Object.keys(other.days['2026-10-25'].ugb.blaster).length === 0);
}

// sanitizeEvent
{
  const v = sanitizeEvent({ f: 'fmb', e: 'pick', q: 'power', a: 'Gas' });
  ok('sanitize: accepts valid', v && v.f === 'fmb' && v.e === 'pick' && v.q === 'power' && v.a === 'Gas');
  ok('sanitize: rejects missing f', sanitizeEvent({ e: 'open' }) === null);
  ok('sanitize: rejects unknown e', sanitizeEvent({ f: 'fmb', e: 'hack' }) === null);
  ok('sanitize: e must match f', sanitizeEvent({ f: 'ugb', e: 'pick' }) === null);
  ok('sanitize: rejects non-object', sanitizeEvent(null) === null && sanitizeEvent('x') === null);
  ok('sanitize: clamps a', sanitizeEvent({ f: 'fmb', e: 'pick', a: 'x'.repeat(500) }).a.length === 60);
  const d = sanitizeEvent({ f: 'fmb', e: 'done', m: '0' });
  ok('sanitize: m coerced to number 0', d.m === 0 && typeof d.m === 'number');
  ok('sanitize: NaN n dropped', !('n' in sanitizeEvent({ f: 'fmb', e: 'step', n: 'abc' })));
  const x = sanitizeEvent({ f: 'ugb', e: 'open', evil: 1, email: 'a@b.c' });
  ok('sanitize: drops extra keys', JSON.stringify(Object.keys(x).sort()) === '["e","f"]');
}

// trim
const big = emptyStats();
for (let i = 0; i < 200; i++) {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  big.days[d] = emptyStats().days[d] ?? applyEvent(emptyStats(), { f: 'fmb', e: 'open' }, d).days[d];
}
const bigBefore = JSON.stringify(big);
const t = trimStats(big, 90);
const keys = Object.keys(t.days).sort();
ok('trim keeps <= 90', keys.length === 90);
ok('trim keeps newest', keys[89] === Object.keys(big.days).sort()[199]);
ok('trim does not mutate', JSON.stringify(big) === bigBefore);
ok('trim small is unchanged', Object.keys(trimStats(s, 90).days).length === Object.keys(s.days).length);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

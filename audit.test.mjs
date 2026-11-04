/** Pure tests for the Product Status Audit. node audit.test.mjs — no env, no network. */
import assert from 'node:assert';
import { summarizeStatuses, bucketize, titleOf, diffStatuses, scanDue, nextDueMs, pushReport, normalizeTitles } from './audit.mjs';

let pass = 0;
const eq = (name, got, want) => { assert.deepStrictEqual(got, want, name); console.log('  ✓', name); pass++; };
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓', name); pass++; };

console.log('--- summarizeStatuses ---');
eq('counts per code + total', summarizeStatuses({ 1: 'a', 2: 'a', 3: 'd', 4: 'u', 5: 'r', 6: 'x' }),
  { a: 2, d: 1, u: 1, r: 1, '?': 1, total: 6 });
eq('empty / garbage tolerant', summarizeStatuses(null), { a: 0, d: 0, u: 0, r: 0, '?': 0, total: 0 });

console.log('--- titleOf / bucketize ---');
eq('titleOf present', titleOf({ 7: 'Blaster' }, '7'), 'Blaster');
eq('titleOf missing -> untitled', titleOf({}, '9'), '(untitled)');
const bk = bucketize({ 1: 'a', 2: 'd', 3: 'a', 4: 'x' }, { 1: 'Zeta', 3: 'Alpha', 2: 'Mid' });
ok('bucketize groups + sorts by title', bk.a.length === 2 && bk.a[0].title === 'Alpha' && bk.a[1].title === 'Zeta' && bk.d[0].title === 'Mid');
ok('bucketize unknown -> ?', bk['?'].length === 1 && bk['?'][0].id === '4');

console.log('--- normalizeTitles (fetchAllStatuses keys titles "p<id>") ---');
eq('strips leading p from numeric keys', normalizeTitles({ p1: 'A', p22: 'B' }), { 1: 'A', 22: 'B' });
eq('leaves bare numeric keys as-is', normalizeTitles({ 3: 'C' }), { 3: 'C' });
eq('null-safe', normalizeTitles(null), {});
// The real bug: statuses are bare-keyed, titles came "p"-keyed -> all untitled.
const pTitles = { p1: 'Zeta', p2: 'Mid', p3: 'Alpha' };
const bkRaw = bucketize({ 1: 'a', 2: 'd', 3: 'a' }, pTitles);
ok('reproduces bug: raw p-keyed titles -> untitled', bkRaw.a.every((x) => x.title === '(untitled)'));
const bkFixed = bucketize({ 1: 'a', 2: 'd', 3: 'a' }, normalizeTitles(pTitles));
ok('fixed: normalized titles resolve names', bkFixed.a[0].title === 'Alpha' && bkFixed.a[1].title === 'Zeta' && bkFixed.d[0].title === 'Mid');

console.log('--- diffStatuses ---');
const dChange = diffStatuses({ 1: 'd', 2: 'a', 3: 'a' }, { 1: 'a', 2: 'd', 3: 'a' }, { 1: 'Dropped One', 2: 'Was Live' });
eq('one went live, one went dark, settled unchanged', dChange.length, 2);
ok('wentLive ranked first', dChange[0].id === '1' && dChange[0].wentLive === true && dChange[0].wentDark === false && dChange[0].from === 'd' && dChange[0].to === 'a');
ok('wentDark ranked second', dChange[1].id === '2' && dChange[1].wentDark === true && dChange[1].wentLive === false);
ok('carries titles', dChange[0].title === 'Dropped One' && dChange[1].title === 'Was Live');

const dNew = diffStatuses({ 1: 'a' }, { 1: 'a', 9: 'd' }, { 9: 'Brand New' });
ok('new product detected', dNew.length === 1 && dNew[0].type === 'new' && dNew[0].id === '9' && dNew[0].to === 'd' && dNew[0].wentLive === false);
const dNewLive = diffStatuses({}, { 9: 'a' }, { 9: 'New Live' });
ok('new active flags wentLive', dNewLive[0].type === 'new' && dNewLive[0].wentLive === true);

const dGone = diffStatuses({ 1: 'a', 5: 'a' }, { 1: 'a' }, {}, { 5: 'Deleted Live' });
ok('gone product named from prev titles', dGone.length === 1 && dGone[0].type === 'gone' && dGone[0].id === '5' && dGone[0].from === 'a' && dGone[0].wentDark === true && dGone[0].title === 'Deleted Live');

const dOrder = diffStatuses(
  { 1: 'a', 2: 'd', 3: 'd', 4: 'a' },
  { 1: 'd', 2: 'a', 3: 'u', 5: 'a' },
  { 1: 'Went Dark', 2: 'Went Live', 3: 'Draft to Unlisted', 5: 'New Active' },
  { 4: 'Now Gone' }
);
// id2 d->a (went live), id5 new active (went live), id1 a->d (went dark),
// id4 deleted while live (went dark), id3 d->u (other flip).
eq('ordering: live flip, new-live, dark flip, deleted-live, other flip', dOrder.map((c) => c.type + ':' + c.id),
  ['change:2', 'new:5', 'change:1', 'gone:4', 'change:3']);
eq('empty diff when identical', diffStatuses({ 1: 'a' }, { 1: 'a' }), []);
eq('null-safe', diffStatuses(null, null), []);

console.log('--- scanDue / nextDueMs ---');
const T = (iso) => Date.parse(iso);
ok('no lastAt -> due', scanDue(null, T('2026-11-03T00:00:00Z')) === true);
ok('2 days < 3 -> not due', scanDue('2026-11-01T00:00:00Z', T('2026-11-03T00:00:00Z')) === false);
ok('exactly 3 days -> due', scanDue('2026-10-31T00:00:00Z', T('2026-11-03T00:00:00Z')) === true);
ok('unparseable lastAt -> due', scanDue('not-a-date', T('2026-11-03T00:00:00Z')) === true);
eq('nextDueMs when 1 day left', nextDueMs('2026-11-01T00:00:00Z', T('2026-11-03T00:00:00Z')), 24 * 60 * 60 * 1000);
eq('nextDueMs when overdue -> 0', nextDueMs('2026-10-01T00:00:00Z', T('2026-11-03T00:00:00Z')), 0);
eq('nextDueMs no lastAt -> 0', nextDueMs(null), 0);

console.log('--- pushReport ---');
const h1 = pushReport([], { at: 'a' });
const h2 = pushReport(h1, { at: 'b' });
ok('newest first', h2[0].at === 'b' && h2[1].at === 'a');
const capped = pushReport(Array.from({ length: 12 }, (_, i) => ({ at: 'old' + i })), { at: 'new' }, 12);
ok('capped at 12, newest kept, oldest dropped', capped.length === 12 && capped[0].at === 'new' && !capped.some((r) => r.at === 'old11'));
eq('garbage history tolerated', pushReport(null, { at: 'x' }), [{ at: 'x' }]);

console.log(`\n${pass} checks passed.`);

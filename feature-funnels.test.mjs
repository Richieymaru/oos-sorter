#!/usr/bin/env node
/** Pure tests for feature funnels. node feature-funnels.test.mjs — no env, no network. */
import { normalizeOrder } from './orders.mjs';
import { attributeOrders, sumStats, quizDropoff, answerDemand, ugbSummary, demandVsStock, worstCombo, FMB_QUESTIONS, buildFeatureRecs, analyzeFeatures } from './feature-funnels.mjs';
import { emptyStats } from './feature-stats.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }

// --- normalizeOrder surfaces _origin / _src ---
const withAttrs = normalizeOrder({
  createdAt: '2026-10-01T00:00:00Z',
  customAttributes: [{ key: 'note', value: 'x' }, { key: '_origin', value: 'find-my-blaster' }],
  lineItems: { nodes: [{ title: 'A', quantity: 1, product: { id: 'gid://shopify/Product/1' }, customAttributes: [{ key: '_src', value: 'upgrade' }] }] },
});
ok('order origin read', withAttrs.origin === 'find-my-blaster');
ok('line src read', withAttrs.items[0].src === 'upgrade');

const bare = normalizeOrder({
  createdAt: '2026-10-01T00:00:00Z',
  lineItems: { nodes: [{ title: 'A', quantity: 1, customAttributes: [] }] },
});
ok('no attrs: origin null', bare.origin === null);
ok('no attrs: src null', bare.items[0].src === null);
ok('empty order tolerant', normalizeOrder({}).origin === null);

// --- attributeOrders ---
const near = (a, b) => Math.abs(a - b) < 1e-9;
const mk = (amount, items) => ({ amount, currency: 'AUD', items: items.map(([qty, src]) => ({ title: 'x', qty, id: null, src })) });

const a1 = attributeOrders([mk(100, [[1, 'find-my-blaster'], [1, null]])]);
ok('single tagged: orders=1', a1.features['find-my-blaster'].orders === 1);
ok('single tagged: revenue share 50', near(a1.features['find-my-blaster'].revenue, 50));
ok('single tagged: other feature zero', a1.features.upgrade.orders === 0 && a1.features.upgrade.revenue === 0);
ok('currency from orders', a1.currency === 'AUD');

const a2 = attributeOrders([mk(90, [[1, 'find-my-blaster'], [2, 'upgrade']])]);
ok('both: orders=1 each', a2.features['find-my-blaster'].orders === 1 && a2.features.upgrade.orders === 1);
ok('both: revenue split per item', near(a2.features['find-my-blaster'].revenue, 30) && near(a2.features.upgrade.revenue, 60));

const a3 = attributeOrders([mk(50, [[1, null]])]);
ok('untagged: zeros', a3.features['find-my-blaster'].orders === 0 && a3.features.upgrade.revenue === 0);

const a4 = attributeOrders([]);
ok('empty: zeros, no throw', a4.features.upgrade.orders === 0 && a4.features['find-my-blaster'].revenue === 0);

const a5 = attributeOrders([mk(0, [[1, 'upgrade']]), mk(10, [[0, 'upgrade']])]);
ok('zero amount/qty: no NaN', a5.features.upgrade.orders === 2 && a5.features.upgrade.revenue === 0);

// --- behavior analysis ---
const st = emptyStats();
st.days['2026-10-01'] = { fmb: { open: 100, step: [80, 60, 20, 15, 10], done: 5, deadEnd: 1, picks: { '1:a': 3, '2:b': 1 } }, ugb: { open: 4, blaster: { x: 2 }, fits: 1, add: 1 } };
st.days['2026-10-02'] = { fmb: { open: 50, step: [40, 30, 10, 5, 5], done: 2, deadEnd: 0, picks: { '1:a': 2, '3:c': 4 } }, ugb: { open: 1, blaster: { x: 1, y: 5 }, fits: 0, add: 2 } };
st.days['2026-10-03'] = { fmb: { open: 10, step: [0, 0, 0, 0, 0], done: 0, deadEnd: 0, picks: {} }, ugb: { open: 0, blaster: {}, fits: 0, add: 0 } };
const all = sumStats(st, { since: null, until: null });
ok('sumStats totals', all.fmb.open === 160 && all.fmb.step[0] === 120 && all.fmb.picks['1:a'] === 5 && all.ugb.blaster.x === 3);
const win = sumStats(st, { since: '2026-10-02', until: '2026-10-02' });
ok('sumStats date filter', win.fmb.open === 50 && win.fmb.picks['3:c'] === 4 && win.ugb.blaster.y === 5);
const hostile = emptyStats();
hostile.days['2026-10-01'] = JSON.parse('{"fmb":{"open":1,"step":[0,0,0,0,0],"done":0,"deadEnd":0,"picks":{"__proto__":2}},"ugb":{"open":0,"blaster":{"__proto__":3},"fits":0,"add":0}}');
const hs = sumStats(hostile, {});
ok('sumStats proto-safe', ({}).x === undefined && Object.getPrototypeOf(hs.fmb.picks) === Object.prototype && Object.hasOwn(hs.fmb.picks, '__proto__') && hs.fmb.picks['__proto__'] === 2);
ok('sumStats empty', sumStats(emptyStats(), {}).fmb.open === 0);

const qd = quizDropoff(all);
ok('dropoff labels', qd.steps.map((s) => s.label).join('|') === 'Opened|Q1 · Player|Q2 · Budget|Q3 · Power|Q4 · Build|Q5 · Velocity');
ok('dropoff reached', qd.steps.map((s) => s.reached).join(',') === '160,120,90,30,20,15');
ok('dropoff row0 zero', qd.steps[0].dropPct === 0);
ok('dropoff worst', qd.worstIndex === 3 && near(qd.steps[3].dropPct, 100 * 60 / 90));
const qe = quizDropoff(sumStats(emptyStats(), {}));
ok('dropoff empty', qe.worstIndex === -1 && qe.steps.length === 6 && qe.steps.every((s) => s.reached === 0 && s.dropPct === 0));

const ad = answerDemand(all);
ok('demand sorted', ad[0].q === '1' && ad[0].a === 'a' && ad[0].picks === 5 && ad[1].picks >= ad[2].picks);
ok('demand shares sum 1', Math.abs(ad.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
ok('demand empty', answerDemand(sumStats(emptyStats(), {})).length === 0);

const us = ugbSummary(all);
ok('ugb summary', us.opens === 5 && us.blasterPicks === 8 && us.fitsViewed === 1 && us.adds === 3);
ok('ugb topBlasters sorted', us.topBlasters[0].handle === 'y' && us.topBlasters[0].picks === 5 && us.topBlasters[1].handle === 'x');

// --- demand vs stock ---
const P = (o) => ({ id: '1', price: 500, power: 'Electric', experience: 'Starter', material: 'Nylon', fps: '230 FPS', inStock: true, ...o });
const stock = [P({ power: 'Gas', price: 250 }), ...Array.from({ length: 9 }, () => P({}))];
const dem = [
  { q: 'power', a: 'Gas', picks: 9, share: 0.45 }, { q: 'power', a: 'Electric', picks: 1, share: 0.05 },
  { q: 'budget', a: 'Under $300', picks: 8, share: 0.4 }, { q: 'fps', a: '320+ FPS', picks: 2, share: 0.1 },
];
const dvs = demandVsStock(dem, stock);
const gasRow = dvs.find((r) => r.q === 'power' && r.a === 'Gas');
ok('dvs gas: 1 in stock, high unmet', gasRow.inStockCount === 1 && gasRow.unmetPct > 80 && near(gasRow.coveragePct + gasRow.unmetPct, 100));
ok('dvs fps approx', dvs.find((r) => r.q === 'fps').approx === true && !gasRow.approx);
ok('dvs comma power list', demandVsStock([{ q: 'power', a: 'Gas', picks: 1, share: 1 }], [P({ power: 'Electric, Gas' })])[0].inStockCount === 1);
const miss = demandVsStock(dem, [P({ power: undefined, fps: undefined, price: undefined })]);
ok('dvs missing field skipped', miss.find((r) => r.a === 'Gas').inStockCount === 0 && miss.find((r) => r.a === 'Under $300').inStockCount === 0 && miss.find((r) => r.a === '320+ FPS').inStockCount === 0);
ok('dvs out-of-stock not counted', demandVsStock([{ q: 'power', a: 'Gas', picks: 1, share: 1 }], [P({ power: 'Gas', inStock: false })])[0].inStockCount === 0);
const dz = demandVsStock(dem, []);
ok('dvs empty products', dz.length === 4 && dz.every((r) => r.coveragePct === 0 && r.unmetPct === 100 && Number.isFinite(r.demandShare)));
ok('dvs empty demand', demandVsStock([], stock).length === 0);
ok('dvs unknown answer ignored', demandVsStock([{ q: 'zzz', a: 'x', picks: 1, share: 1 }], stock).length === 0);
ok('FMB_QUESTIONS keys', Object.keys(FMB_QUESTIONS).join() === 'experience,budget,power,material,fps');
const wc = worstCombo(dem, stock);
ok('worstCombo gas + under 300', wc && wc.label === 'Gas + Under $300' && wc.inStock === 1 && wc.wanted === 8);
ok('worstCombo null no demand', worstCombo([], stock) === null);
ok('worstCombo empty products', worstCombo(dem, []).inStock === 0);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);

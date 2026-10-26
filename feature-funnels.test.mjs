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
// power is a Shopify LIST metafield: Admin API .value is a JSON-array string
const jp = (power) => P({ power, price: 250 });
const pw = (a, prods) => demandVsStock([{ q: 'power', a, picks: 1, share: 1 }], prods)[0].inStockCount;
ok('power json array matches Electric', pw('Electric', [jp('["Electric","Gas"]')]) === 1);
ok('power json array matches Gas', pw('Gas', [jp('["Electric","Gas"]')]) === 1);
ok('power json array no false match', pw('Manual', [jp('["Electric","Gas"]')]) === 0);
ok('power comma form still matches', pw('Gas', [jp('Electric, Gas')]) === 1 && pw('Electric', [jp('Electric, Gas')]) === 1);
ok('power malformed json falls back', pw('Gas', [jp('[Electric, Gas')]) === 1);
const jstock = [jp('["Electric"]'), jp('["Gas"]'), jp('["Electric","Gas"]')];
const jdem = [{ q: 'power', a: 'Gas', picks: 6, share: 0.6 }, { q: 'budget', a: 'Under $300', picks: 6, share: 0.6 }];
const jwc = worstCombo(jdem, jstock);
ok('worstCombo json power sane coverage', jwc && jwc.inStock === 2);

// --- recs + composer ---
const recDrop = { steps: [{ label: 'Opened', reached: 10, dropPct: 0 }, { label: 'Q1 · Player', reached: 4, dropPct: 60 }], worstIndex: 1 };
const combo0 = { label: 'Gas + Under $300', wanted: 8, inStock: 1 };
const recs = buildFeatureRecs({ dropoff: recDrop, worstCombo: combo0, ugb: { opens: 40, adds: 2 }, attribution: {} });
ok('recs 3 ranked: combo, step, ugb', recs.length === 3 && recs[0].text.includes('Gas + Under $300') && recs[1].text.includes('Q1') && recs[1].text.includes('60%') && recs[2].text.includes('Upgrade'));
ok('recs each fix + impact + tone', recs.every((r) => r.fix.length > 0 && r.impact && r.impact.up && r.impact.unit && r.tone && r.text));
ok('recs impact is short figure + unit', recs.every((r) => typeof r.impact.up === 'string' && r.impact.up.length <= 6 && /^[+\d]/.test(r.impact.up) && r.impact.unit.length <= 24));
ok('recs guard wanted=0', buildFeatureRecs({ worstCombo: { ...combo0, wanted: 0 } }).length === 0);
ok('recs guard worstIndex=0', buildFeatureRecs({ dropoff: { steps: recDrop.steps, worstIndex: 0 } }).length === 0);
ok('recs guard worstIndex -1', buildFeatureRecs({ dropoff: { steps: recDrop.steps, worstIndex: -1 } }).length === 0);
ok('recs guard opens<10', buildFeatureRecs({ ugb: { opens: 9, adds: 0 } }).length === 0);
ok('recs ugb healthy none', buildFeatureRecs({ ugb: { opens: 40, adds: 20 } }).length === 0);
ok('recs ugb low alone', buildFeatureRecs({ ugb: { opens: 40, adds: 2 } }).length === 1);
ok('recs empty', buildFeatureRecs({}).length === 0 && buildFeatureRecs().length === 0);

const ev = (src, origin) => ({ amount: 100, currency: 'PHP', items: [{ qty: 1, src }], origin });
const an = analyzeFeatures({
  orders: [ev('find-my-blaster'), ev('upgrade'), ev(undefined, 'find-my-blaster'), ev(undefined, undefined)],
  stats: { days: {
    '2026-10-05': { fmb: { open: 10, step: [6, 5, 4, 3, 2], done: 2, deadEnd: 0, picks: { 'power:Gas': 5 } }, ugb: { open: 4, blaster: {}, fits: 1, add: 1 } },
    '2026-10-04': { fmb: { open: 99, step: [0, 0, 0, 0, 0], done: 99, deadEnd: 0, picks: {} }, ugb: { open: 99, blaster: {}, fits: 0, add: 99 } },
  } },
  products: [], window: { key: '30d', label: 'x', since: '2026-10-05T00:00:00.000Z', until: '2026-10-05T23:59:59.999Z' },
});
ok('analyze shape', an.totals && an.perFeature.fmb && an.perFeature.ugb && an.dropoff && Array.isArray(an.recs) && Array.isArray(an.demand) && 'worstCombo' in an && an.currency);
ok('analyze since-boundary day included, prior day excluded', an.perFeature.fmb.stages[0].count === 10 && an.perFeature.fmb.stages[1].count === 2 && an.perFeature.ugb.stages[0].count === 4 && an.perFeature.ugb.stages[1].count === 1);
ok('analyze stage labels', an.perFeature.fmb.stages.map((s) => s.label).join() === 'Opened,Finished,Ordered' && an.perFeature.ugb.stages.map((s) => s.label).join() === 'Engaged,Added to cart,Ordered');
ok('analyze ordered counts', an.perFeature.fmb.stages[2].count === 1 && an.perFeature.ugb.stages[2].count === 1 && an.perFeature.fmb.key === 'find-my-blaster' && an.perFeature.ugb.key === 'upgrade');
ok('analyze totals', an.totals.orders === 3 && an.totals.revenue === an.perFeature.fmb.revenue + an.perFeature.ugb.revenue && an.totals.revenue === 200 && an.totals.trendPct === null);
ok('analyze dropoff + demand + combo', an.dropoff.steps.length === 6 && an.demand.length === 1 && an.worstCombo && an.worstCombo.wanted === 5);
for (const [name, v] of [['{}', analyzeFeatures({})], ['()', analyzeFeatures()], ['no window', analyzeFeatures({ orders: [], stats: { days: {} } })]]) {
  ok(`analyze empty ${name}`, v.totals.revenue === 0 && v.totals.orders === 0 && v.totals.trendPct === null && v.recs.length === 0 && v.worstCombo === null && v.perFeature.fmb.orders === 0 && v.perFeature.ugb.stages.every((s) => s.count === 0) && v.window && v.demand.length === 0);
}

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);

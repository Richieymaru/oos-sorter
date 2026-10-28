#!/usr/bin/env node
/** Pure tests for feature funnels. node feature-funnels.test.mjs — no env, no network. */
import { normalizeOrder } from './orders.mjs';
import { attributeOrders, attributeByOrigin, attributedOrders, titleMatch, sumStats, quizDropoff, answerDemand, ugbSummary, demandVsStock, worstCombo, FMB_QUESTIONS, buildFeatureRecs, analyzeFeatures } from './feature-funnels.mjs';
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
// Auto-skipped step: Q4 (step[3]) never beaconed but Q5 (step[4]) reached — funnel must stay
// monotonic (back-fill), so no phantom 100% drop / false "fix Q4" worst step.
const qs = quizDropoff({ fmb: { open: 1, step: [1, 1, 1, 0, 1] } });
ok('dropoff auto-skip monotonic', qs.steps.map((s) => s.reached).join(',') === '1,1,1,1,1,1');
ok('dropoff auto-skip no phantom worst', qs.worstIndex === -1 && qs.steps.every((s) => s.dropPct === 0));

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
ok('analyze stage labels', an.perFeature.fmb.stages.map((s) => s.label).join() === 'Opened,Finished,Added to cart,Ordered' && an.perFeature.ugb.stages.map((s) => s.label).join() === 'Engaged,Added to cart,Ordered');
ok('analyze ordered counts', an.perFeature.fmb.stages[3].count === 1 && an.perFeature.ugb.stages[2].count === 0 && an.perFeature.fmb.stages[2].count === 0 && an.perFeature.fmb.key === 'find-my-blaster' && an.perFeature.ugb.key === 'upgrade');
ok('analyze totals', an.totals.orders === 3 && an.totals.revenue === an.perFeature.fmb.revenue + an.perFeature.ugb.revenue && an.totals.revenue === 100 && an.perFeature.fmb.revenue === 100 && an.perFeature.fmb.orders === 1 && an.perFeature.ugb.orders === 0 && an.totals.trendPct === null);
ok('analyze dropoff + demand + combo', an.dropoff.steps.length === 6 && an.demand.length === 1 && an.worstCombo && an.worstCombo.wanted === 5);
for (const [name, v] of [['{}', analyzeFeatures({})], ['()', analyzeFeatures()], ['no window', analyzeFeatures({ orders: [], stats: { days: {} } })]]) {
  ok(`analyze empty ${name}`, v.totals.revenue === 0 && v.totals.orders === 0 && v.totals.trendPct === null && v.recs.length === 0 && v.worstCombo === null && v.perFeature.fmb.orders === 0 && v.perFeature.ugb.stages.every((s) => s.count === 0) && v.window && v.demand.length === 0);
}

// --- attributeByOrigin ---
const bo = attributeByOrigin([{ amount: 120, currency: 'PHP', items: [], origin: 'find-my-blaster' }, { amount: 80, items: [], origin: 'upgrade' }, { amount: 50, items: [{ qty: 1, src: 'upgrade' }], origin: null }]);
ok('origin fmb credited full amount', bo.features['find-my-blaster'].orders === 1 && bo.features['find-my-blaster'].revenue === 120);
ok('origin upgrade credited; no-origin neither', bo.features.upgrade.orders === 1 && bo.features.upgrade.revenue === 80 && bo.currency === 'PHP');
const bz = attributeByOrigin([]);
ok('origin empty zeros', bz.features.upgrade.revenue === 0 && bz.features['find-my-blaster'].orders === 0 && bz.currency === 'USD');
ok('origin non-numeric amount -> 0', attributeByOrigin([{ amount: 'abc', origin: 'upgrade' }]).features.upgrade.revenue === 0);
const an4 = analyzeFeatures({ stats: { days: { '2026-10-05': { fmb: { open: 10, step: [0, 0, 0, 0, 0], done: 4, deadEnd: 0, add: 3, picks: {} }, ugb: { open: 0, blaster: {}, fits: 0, add: 0 } } } }, window: { key: '30d', label: 'x', since: '2026-10-05T00:00:00.000Z', until: '2026-10-05T23:59:59.999Z' } });
ok('fmb funnel Added to cart from fmb.add', an4.perFeature.fmb.stages[2].label === 'Added to cart' && an4.perFeature.fmb.stages[2].count === 3);

// --- normalizeOrder surfaces line price ---
const priced = normalizeOrder({ lineItems: { nodes: [{ title: 'Blaster', quantity: 2, originalUnitPriceSet: { shopMoney: { amount: '499.00' } }, customAttributes: [] }] } });
ok('line price read', priced.items[0].price === 499 && priced.items[0].qty === 2);
ok('line price absent -> 0', normalizeOrder({ lineItems: { nodes: [{ title: 'x', quantity: 1, customAttributes: [] }] } }).items[0].price === 0);

// --- attributedOrders (per-order explorer) ---
const mko = (o) => ({ createdAt: o.at, amount: o.amount, currency: o.cur || 'AUD', origin: o.origin ?? null, source: o.source ?? null, journey: o.journey ?? null, picks: o.picks ?? {}, items: (o.items || []).map(([title, qty, price, src]) => ({ title, qty, price, src: src ?? null })) });
const exp = attributedOrders([
  mko({ at: '2026-10-20T00:00:00Z', amount: 300, origin: 'find-my-blaster', items: [['Quiz Blaster', 1, 300, 'find-my-blaster']] }),
  mko({ at: '2026-10-25T00:00:00Z', amount: 150, origin: 'upgrade', items: [['Scope', 1, 150, null], ['Battery', 2, 20, null]] }),
  mko({ at: '2026-10-22T00:00:00Z', amount: 90, origin: null, items: [['Part', 1, 90, 'upgrade']] }),
  mko({ at: '2026-10-10T00:00:00Z', amount: 40, origin: null, items: [['Random', 1, 40, null]] }),
]);
ok('explorer excludes untouched orders', exp.length === 3);
ok('explorer newest first', exp.map((o) => o.at).join() === '2026-10-25T00:00:00Z,2026-10-22T00:00:00Z,2026-10-20T00:00:00Z');
const fmbRow = exp.find((o) => o.at === '2026-10-20T00:00:00Z');
ok('explorer direct add flagged', fmbRow.feature === 'find-my-blaster' && fmbRow.direct === true && fmbRow.items[0].viaFeature === 'find-my-blaster' && fmbRow.items[0].price === 300);
const infRow = exp.find((o) => o.at === '2026-10-25T00:00:00Z');
ok('explorer influenced (origin, no tagged line)', infRow.feature === 'upgrade' && infRow.direct === false && infRow.items.every((i) => i.viaFeature === null));
const srcOnly = exp.find((o) => o.at === '2026-10-22T00:00:00Z');
ok('explorer src-only credited to that feature', srcOnly.feature === 'upgrade' && srcOnly.origin === null && srcOnly.direct === true);
ok('explorer carries amount/currency', infRow.amount === 150 && infRow.currency === 'AUD');
ok('explorer empty/garbage tolerant', attributedOrders([]).length === 0 && attributedOrders().length === 0 && attributedOrders([null, {}]).length === 0);
const jr = attributedOrders([mko({ at: '2026-10-21T00:00:00Z', amount: 10, origin: 'find-my-blaster', journey: { source: 'google', landing: '/quiz', days: 2 }, items: [['x', 1, 10, null]] })])[0];
ok('explorer passes journey through', jr.journey.source === 'google' && jr.journey.days === 2);
ok('explorer in analyzeFeatures view', Array.isArray(an.explorer) && an.explorer.length === 3);

// --- titleMatch + per-order picks (answers / chosen product / conversion) ---
ok('titleMatch exact + contains', titleMatch('TEC9 SMG Tactical - Gel Blaster', 'TEC9 SMG Tactical') && titleMatch('TEC9', 'TEC9 SMG Tactical - Gel Blaster'));
ok('titleMatch case-insensitive + spacing', titleMatch('tec9  smg', 'TEC9 SMG'));
ok('titleMatch rejects short/empty', !titleMatch('A', 'A') && !titleMatch('Scope', '') && !titleMatch('', 'Scope'));
ok('titleMatch rejects unrelated', !titleMatch('Battery Charger', 'TEC9 SMG Tactical'));

const pk = attributedOrders([
  mko({ at: '2026-10-27T00:00:00Z', amount: 300, origin: 'find-my-blaster',
    picks: { answers: 'Player: Advanced · Power: Gas', fmb: 'TEC9 SMG Tactical' },
    items: [['TEC9 SMG Tactical - Gel Blaster', 1, 300, null], ['Shipping Protection', 1, 4, null]] }),
  mko({ at: '2026-10-26T00:00:00Z', amount: 50, origin: 'find-my-blaster',
    picks: { answers: 'Player: Starter', fmb: 'Hi-Capa Gas Pistol' },
    items: [['Gel Balls', 1, 6, null]] }),
  mko({ at: '2026-10-25T00:00:00Z', amount: 145, origin: 'upgrade',
    picks: { ugbBlaster: 'Kublai P1', ugb: 'Extended Magazine' },
    items: [['Extended Magazine - Black', 1, 30, 'upgrade']] }),
]);
const pFmbHit = pk.find((o) => o.at === '2026-10-27T00:00:00Z');
ok('fmb answers surfaced', pFmbHit.answers === 'Player: Advanced · Power: Gas' && pFmbHit.blaster === null);
ok('fmb pick matched to a line -> direct + ★', pFmbHit.pick === 'TEC9 SMG Tactical' && pFmbHit.pickInOrder === true && pFmbHit.direct === true && pFmbHit.items[0].viaFeature === 'find-my-blaster' && pFmbHit.items[1].viaFeature === null);
const pFmbMiss = pk.find((o) => o.at === '2026-10-26T00:00:00Z');
ok('fmb pick NOT in order -> not direct, no ★', pFmbMiss.pick === 'Hi-Capa Gas Pistol' && pFmbMiss.pickInOrder === false && pFmbMiss.direct === false && pFmbMiss.items.every((i) => i.viaFeature === null));
const pUgb = pk.find((o) => o.at === '2026-10-25T00:00:00Z');
ok('ugb blaster + pick surfaced, _src line still ★', pUgb.blaster === 'Kublai P1' && pUgb.answers === null && pUgb.pick === 'Extended Magazine' && pUgb.pickInOrder === true && pUgb.items[0].viaFeature === 'upgrade');
ok('no picks object -> graceful nulls', attributedOrders([mko({ at: '2026-10-20T00:00:00Z', amount: 10, origin: 'find-my-blaster', items: [['x', 1, 10, null]] })])[0].answers === null);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);

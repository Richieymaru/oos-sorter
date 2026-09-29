#!/usr/bin/env node
/** Pure tests for funnel analytics. node funnels.test.mjs — no env, no network. */
import { analyzeFunnels, channelLabel, hostOf, dailyTrend, topProducts, buildInsights, analyzeCheckout, checkoutInsights, buildTrend, resolveRange, RANGES } from './funnels.mjs';
import { normalizeOrder, normalizeAbandoned } from './orders.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0); // 2026-09-27
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

function order({ amount = 100, source = 'web', day = 0, items = [], journey = null }) {
  return { createdAt: iso(day), source, amount, currency: 'AUD', items, journey };
}

console.log('--- channelLabel / hostOf ---');
ok('web -> Online Store', channelLabel('web') === 'Online Store');
ok('pos -> Point of Sale', channelLabel('pos') === 'Point of Sale');
ok('unknown app handle title-cased', channelLabel('some_app') === 'Some App');
ok('null source -> Unknown', channelLabel(null) === 'Unknown');
ok('hostOf strips www + path', hostOf('https://www.instagram.com/p/abc') === 'instagram.com');
ok('hostOf bare host', hostOf('l.facebook.com') === 'l.facebook.com');
ok('hostOf null -> null', hostOf(null) === null);

console.log('\n--- normalizeOrder (shape from raw node) ---');
const raw = {
  createdAt: '2026-09-20T00:00:00Z',
  sourceName: 'web',
  currentTotalPriceSet: { shopMoney: { amount: '49.90', currencyCode: 'AUD' } },
  lineItems: { nodes: [{ title: 'Gel Blaster', quantity: 2 }] },
  customerJourneySummary: { daysToConversion: 3, momentsCount: { count: 7 }, firstVisit: { source: 'facebook', referrerUrl: 'https://l.facebook.com/x', landingPage: '/products/gel-blaster' } },
};
const n = normalizeOrder(raw);
ok('amount parsed to number', n.amount === 49.9);
ok('items mapped', n.items.length === 1 && n.items[0].qty === 2);
ok('journey source lifted', n.journey.source === 'facebook' && n.journey.days === 3 && n.journey.moments === 7);
ok('journey referrer/landing kept', n.journey.referrer === 'https://l.facebook.com/x' && n.journey.landing === '/products/gel-blaster');
ok('missing journey -> null', normalizeOrder({ sourceName: 'web' }).journey === null);
ok('missing money -> 0', normalizeOrder({}).amount === 0);

console.log('\n--- analyzeFunnels totals + channels ---');
const orders = [
  order({ amount: 100, source: 'web', day: 0, items: [{ title: 'A', qty: 1 }], journey: { source: 'facebook', referrer: 'https://l.facebook.com/x', landing: '/a', days: 2, moments: 4 } }),
  order({ amount: 300, source: 'web', day: 1, items: [{ title: 'A', qty: 2 }, { title: 'B', qty: 1 }], journey: { source: 'facebook', referrer: 'https://l.facebook.com/y', landing: '/a', days: 0, moments: 1 } }),
  order({ amount: 50, source: 'pos', day: 2, items: [{ title: 'B', qty: 1 }], journey: { source: 'direct', referrer: null, landing: '/b', days: 5, moments: 9 } }),
];
const WIN = { since: iso(5), until: iso(-1) };
const a = analyzeFunnels(orders, { tier: 'full', ...WIN });
ok('total orders', a.totalOrders === 3);
ok('total revenue', a.totalRevenue === 450);
ok('AOV', a.aov === 150);
ok('currency picked up', a.currency === 'AUD');
ok('channels ranked by revenue (web first)', a.channels[0].label === 'Online Store' && a.channels[0].orders === 2);
ok('channel share adds context', a.channels[0].share === Math.round((400 / 450) * 1000) / 10);
ok('traffic sources present at full tier (facebook leads)', a.trafficSources[0].label === 'Facebook' && a.trafficSources[0].orders === 2);
ok('referrers grouped by host', a.referrers[0].label === 'l.facebook.com' && a.referrers[0].orders === 2);
ok('avg days to convert', a.avgDaysToConvert === Math.round(((2 + 0 + 5) / 3) * 100) / 100);

console.log('\n--- tier=base hides journey-derived data ---');
const base = analyzeFunnels(orders, { tier: 'base', ...WIN });
ok('base tier: no traffic sources', base.trafficSources.length === 0);
ok('base tier: no referrers', base.referrers.length === 0);
ok('base tier: still has revenue + channels', base.totalRevenue === 450 && base.channels.length === 2);
ok('base tier: avg days still derivable if journey present', base.avgDaysToConvert !== undefined);

console.log('\n--- topProducts ---');
const tp = topProducts(orders);
ok('top product by units is A (3)', tp[0].title === 'A' && tp[0].units === 3);
ok('B counted across 2 orders', tp.find((p) => p.title === 'B').orders === 2);

console.log('\n--- dailyTrend ---');
const tr = dailyTrend(orders, 14, NOW);
ok('trend has 14 zero-filled days', tr.length === 14);
ok('trend oldest first, newest last is today', tr[13].day === new Date(NOW).toISOString().slice(0, 10));
ok('today has 1 order (day 0)', tr[13].orders === 1 && tr[13].revenue === 100);
ok('a gap day is zero', tr.filter((d) => d.orders === 0).length === 11);

console.log('\n--- buildInsights ---');
ok('empty orders -> no insights', buildInsights({ totalOrders: 0 }).length === 0);
ok('insights generated for real data', a.insights.length >= 2);
ok('concentrated source flagged warn', a.insights.some((i) => i.tone === 'warn' && /%/.test(i.text)));

console.log('\n--- empty / none tier is safe ---');
const empty = analyzeFunnels([], { tier: 'none', ...WIN });
ok('no orders -> zeros, no crash', empty.totalOrders === 0 && empty.totalRevenue === 0 && empty.insights.length === 0);
ok('empty trend zero-filled over the window (daily)', empty.trend.length >= 6 && empty.trend.every((p) => p.orders === 0));
ok('trend unit is day for a short window', a.trendUnit === 'day');

console.log('\n--- normalizeAbandoned ---');
const ab = normalizeAbandoned({ createdAt: '2026-09-20T00:00:00Z', totalPriceSet: { shopMoney: { amount: '80.00', currencyCode: 'AUD' } }, lineItems: { nodes: [{ title: 'Gel Blaster', quantity: 1 }] } });
ok('amount parsed', ab.amount === 80 && ab.currency === 'AUD');
ok('items mapped', ab.items[0].title === 'Gel Blaster');

console.log('\n--- analyzeCheckout (drop-off funnel) ---');
const compl = [order({ amount: 100 }), order({ amount: 200 }), order({ amount: 150 })]; // 3 completed
const aband = [
  { createdAt: iso(1), amount: 90, currency: 'AUD', items: [{ title: 'Gel Blaster', qty: 1 }] },
  { createdAt: iso(2), amount: 60, currency: 'AUD', items: [{ title: 'Gel Blaster', qty: 1 }, { title: 'Ammo', qty: 2 }] },
];
const co = analyzeCheckout(compl, aband, 2, { currency: 'AUD' });
ok('completed = 3', co.completed === 3);
ok('abandoned = 2 (uses exact count)', co.abandoned === 2);
ok('reached checkout = 5', co.reached === 5);
ok('completion rate = 60%', co.completionRate === 60);
ok('abandon rate = 40%', co.abandonRate === 40);
ok('value lost summed', co.valueLost === 150);
ok('top abandoned = Gel Blaster (2 checkouts)', co.topAbandoned[0].title === 'Gel Blaster' && co.topAbandoned[0].checkouts === 2);
ok('exact count overrides sampled length', analyzeCheckout(compl, aband, 57, { currency: 'AUD' }).abandoned === 57);
const coEmpty = analyzeCheckout([], [], 0, {});
ok('no data -> zeros, no divide-by-zero', coEmpty.reached === 0 && coEmpty.completionRate === 0);

console.log('\n--- checkoutInsights ---');
ok('flags the leak with value', checkoutInsights(co).some((i) => /didn.t finish/.test(i.text) && /150/.test(i.text)));
ok('high abandon rate is danger', checkoutInsights(analyzeCheckout([order({})], aband, 9, { currency: 'AUD' }))[0].tone === 'danger');
ok('names most-abandoned product', checkoutInsights(co).some((i) => /Gel Blaster/.test(i.text)));
ok('no abandoned -> positive', checkoutInsights(analyzeCheckout(compl, [], 0, {}))[0].tone === 'pos');
ok('empty funnel -> no insights', checkoutInsights(coEmpty).length === 0);

console.log('\n--- resolveRange ---');
ok('has 7 selectable ranges', RANGES.length === 7);
ok('30d default for unknown key', resolveRange('zzz').key === '30d' && resolveRange('zzz').days === 30);
ok('today = 1 day, no until offset into future', resolveRange('today').days === 1);
ok('yesterday has an until bound', !!resolveRange('yesterday').until);
ok('1y ≈ 365 days', resolveRange('1y').days === 365);
ok('since is before until/now', new Date(resolveRange('3mo').since) < new Date());

console.log('\n--- buildTrend adaptive granularity ---');
const dayT = buildTrend([{ createdAt: iso(1), amount: 50 }, { createdAt: iso(1), amount: 50 }], iso(10), iso(-1));
ok('short window -> daily unit', dayT.unit === 'day');
ok('daily buckets zero-filled + a populated day', dayT.points.length >= 10 && dayT.points.some((p) => p.orders === 2 && p.revenue === 100));
const wkT = buildTrend([], iso(120), iso(-1));
ok('~4 month window -> weekly unit', wkT.unit === 'week');
const moT = buildTrend([], iso(300), iso(-1));
ok('~10 month window -> monthly unit', moT.unit === 'month' && moT.points.length >= 6);

console.log('\n--- analyzeCheckout carts (per-cart list) ---');
ok('carts carry each abandoned cart with its items', co.carts.length === 2 && co.carts[0].items.length >= 1);
ok('cart has value + date', co.carts.every((k) => k.amount != null && k.at));

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

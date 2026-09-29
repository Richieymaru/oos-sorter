/**
 * Pure funnel analytics — turns a list of normalised orders (from orders.mjs)
 * into the numbers the Funnels page shows: revenue, the sales-channel and
 * traffic-source breakdowns, top products, a day-by-day trend, and a few plain
 * "where to focus" insights.
 *
 * Everything here is a pure function of its input, so it's unit-tested offline
 * with synthetic orders (funnels.test.mjs) — no store, no network, the same way
 * the move math and feature logic are tested.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Prettify a raw sourceName ("web", "pos", "shopify_draft_order", app handles). */
export function channelLabel(source) {
  if (!source) return 'Unknown';
  const map = {
    web: 'Online Store',
    pos: 'Point of Sale',
    shopify_draft_order: 'Draft order',
    iphone: 'Mobile (iPhone)',
    android: 'Mobile (Android)',
  };
  if (map[source]) return map[source];
  return String(source).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Host of a URL, for grouping referrers ("https://l.instagram.com/..." -> "l.instagram.com"). */
export function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    const m = String(url).match(/^(?:https?:\/\/)?([^/?#]+)/i);
    return m ? m[1].replace(/^www\./, '') : String(url);
  }
}

/** Group orders into [{ key, label, orders, revenue, share }], biggest revenue first. */
function groupBy(orders, keyFn, labelFn) {
  const map = new Map();
  let total = 0;
  for (const o of orders) {
    total += o.amount;
    const key = keyFn(o);
    if (key == null) continue;
    if (!map.has(key)) map.set(key, { key, label: labelFn ? labelFn(key) : key, orders: 0, revenue: 0 });
    const g = map.get(key);
    g.orders += 1;
    g.revenue += o.amount;
  }
  const rows = [...map.values()].map((g) => ({ ...g, revenue: round2(g.revenue), share: pct(g.revenue, total) }));
  rows.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  return rows;
}

/** A day key (UTC yyyy-mm-dd) for trend bucketing. */
const dayKey = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

/** Order/revenue per day for the last `days` days, oldest first (zero-filled). */
export function dailyTrend(orders, days = 14, now = Date.now()) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    buckets.set(d, { day: d, orders: 0, revenue: 0 });
  }
  for (const o of orders) {
    const k = dayKey(o.createdAt);
    if (k && buckets.has(k)) {
      const b = buckets.get(k);
      b.orders += 1;
      b.revenue += o.amount;
    }
  }
  return [...buckets.values()].map((b) => ({ ...b, revenue: round2(b.revenue) }));
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** The selectable date ranges for the Funnels page. */
export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '14d', label: '14 days' },
  { key: '30d', label: '30 days' },
  { key: '3mo', label: '3 months' },
  { key: '6mo', label: '6 months' },
  { key: '1y', label: '1 year' },
];

/** Resolve a range key to { key, label, days, since, until } (ISO bounds). */
export function resolveRange(key, now = new Date()) {
  const day = 86400000;
  const today0 = startOfDay(now);
  let since;
  let until = null;
  let days;
  let label;
  switch (key) {
    case 'today': since = today0; days = 1; label = 'Today'; break;
    case 'yesterday': since = new Date(+today0 - day); until = today0; days = 1; label = 'Yesterday'; break;
    case '14d': since = new Date(+now - 14 * day); days = 14; label = 'Last 14 days'; break;
    case '3mo': since = new Date(+now - 90 * day); days = 90; label = 'Last 3 months'; break;
    case '6mo': since = new Date(+now - 180 * day); days = 180; label = 'Last 6 months'; break;
    case '1y': since = new Date(+now - 365 * day); days = 365; label = 'Last 12 months'; break;
    case '30d':
    default: key = '30d'; since = new Date(+now - 30 * day); days = 30; label = 'Last 30 days'; break;
  }
  return { key, label, days, since: since.toISOString(), until: until ? until.toISOString() : null };
}

/**
 * Order/revenue over the window, bucketed adaptively so the chart stays readable:
 * daily up to ~a month, weekly up to ~6 months, monthly beyond. Zero-filled.
 * Returns { unit: 'day'|'week'|'month', points: [{ label, orders, revenue }] }.
 */
export function buildTrend(orders, sinceISO, untilISO) {
  const since = startOfDay(sinceISO ? new Date(sinceISO) : new Date(Date.now() - 30 * 86400000));
  const until = untilISO ? new Date(untilISO) : new Date();
  const spanDays = Math.max(1, Math.round((until - since) / 86400000));
  const unit = spanDays <= 31 ? 'day' : spanDays <= 183 ? 'week' : 'month';
  const points = [];
  const idx = new Map();
  const weekKey = (d) => 'w' + Math.floor((+startOfDay(d) - +since) / (7 * 86400000));
  const keyOf = (d) => (unit === 'day' ? d.toISOString().slice(0, 10) : unit === 'week' ? weekKey(d) : d.toISOString().slice(0, 7));
  const mmdd = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  if (unit === 'day') {
    for (let t = +since; t <= +until; t += 86400000) { const d = new Date(t); idx.set(keyOf(d), points.length); points.push({ label: mmdd(d), orders: 0, revenue: 0 }); }
  } else if (unit === 'week') {
    for (let t = +since; t <= +until; t += 7 * 86400000) { const d = new Date(t); idx.set(keyOf(d), points.length); points.push({ label: mmdd(d), orders: 0, revenue: 0 }); }
  } else {
    let d = new Date(since.getFullYear(), since.getMonth(), 1);
    while (d <= until) { idx.set(d.toISOString().slice(0, 7), points.length); points.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), orders: 0, revenue: 0 }); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  }
  for (const o of (orders || [])) {
    if (!o.createdAt) continue;
    const i = idx.get(keyOf(new Date(o.createdAt)));
    if (i != null) { points[i].orders += 1; points[i].revenue += o.amount; }
  }
  for (const p of points) p.revenue = round2(p.revenue);
  return { unit, points };
}

/** Top products by units sold across order line items. */
export function topProducts(orders, limit = 8) {
  const map = new Map();
  for (const o of orders) {
    for (const li of o.items || []) {
      if (!map.has(li.title)) map.set(li.title, { title: li.title, units: 0, orders: 0 });
      const p = map.get(li.title);
      p.units += li.qty;
      p.orders += 1;
    }
  }
  const rows = [...map.values()];
  rows.sort((a, b) => b.units - a.units || b.orders - a.orders);
  return rows.slice(0, limit);
}

/**
 * The whole funnel analysis. `tier` comes from orders.mjs:
 *   'full' — traffic-source insights available
 *   'base' — revenue/channel/products only (protected data off)
 *   'none' — no order access yet
 */
export function analyzeFunnels(orders, { tier = 'full', since = null, until = null } = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const totalOrders = list.length;
  const totalRevenue = round2(list.reduce((s, o) => s + o.amount, 0));
  const currency = (list.find((o) => o.currency) || {}).currency || 'USD';
  const aov = totalOrders ? round2(totalRevenue / totalOrders) : 0;

  const channels = groupBy(list, (o) => o.source || 'unknown', channelLabel);

  const withJourney = list.filter((o) => o.journey);
  const trafficSources = tier === 'full'
    ? groupBy(withJourney, (o) => o.journey.source || 'unknown', channelLabel)
    : [];
  const referrers = tier === 'full'
    ? groupBy(withJourney.filter((o) => o.journey.referrer), (o) => hostOf(o.journey.referrer))
    : [];
  const landings = tier === 'full'
    ? groupBy(withJourney.filter((o) => o.journey.landing), (o) => o.journey.landing)
    : [];

  const convDays = withJourney.map((o) => o.journey.days).filter((d) => d != null && !Number.isNaN(d));
  const avgDaysToConvert = convDays.length ? round2(convDays.reduce((a, b) => a + b, 0) / convDays.length) : null;

  return {
    tier,
    totalOrders,
    totalRevenue,
    currency,
    aov,
    channels,
    trafficSources,
    referrers,
    landings,
    avgDaysToConvert,
    products: topProducts(list),
    ...(() => { const bt = buildTrend(list, since, until); return { trend: bt.points, trendUnit: bt.unit }; })(),
    insights: buildInsights({ tier, totalOrders, totalRevenue, currency, aov, channels, trafficSources, referrers, products: topProducts(list), avgDaysToConvert }),
  };
}

/**
 * The checkout drop-off funnel from orders + abandoned checkouts (both same
 * window). "Reached checkout" = completed orders + abandoned checkouts; the gap
 * between reached and completed is where money is lost. `abandonedCount` is
 * Shopify's exact total; `abandoned` is the sampled records (to see WHICH
 * products get abandoned). Pure.
 */
export function analyzeCheckout(orders, abandoned, abandonedCount, { currency } = {}) {
  const completed = Array.isArray(orders) ? orders.length : 0;
  const abandonedN = Number.isFinite(abandonedCount) ? abandonedCount : (Array.isArray(abandoned) ? abandoned.length : 0);
  const reached = completed + abandonedN;
  const cur = currency
    || (abandoned || []).find((a) => a.currency)?.currency
    || (orders || []).find((o) => o.currency)?.currency
    || 'USD';
  const valueLost = round2((abandoned || []).reduce((s, a) => s + a.amount, 0));
  // Which products sit in abandoned carts most often — the "why they hesitate" hint.
  const map = new Map();
  for (const a of (abandoned || [])) {
    for (const li of (a.items || [])) {
      if (!map.has(li.title)) map.set(li.title, { title: li.title, units: 0, checkouts: 0 });
      const p = map.get(li.title);
      p.units += li.qty;
      p.checkouts += 1;
    }
  }
  const topAbandoned = [...map.values()].sort((a, b) => b.checkouts - a.checkouts || b.units - a.units).slice(0, 6);
  // Each abandoned cart on its own (most recent first) — the per-shopper list.
  const carts = (abandoned || []).map((a) => ({
    at: a.createdAt,
    amount: a.amount,
    currency: a.currency || cur,
    items: a.items || [],
  }));
  return {
    completed,
    abandoned: abandonedN,
    reached,
    completionRate: pct(completed, reached),
    abandonRate: pct(abandonedN, reached),
    valueLost,
    currency: cur,
    topAbandoned,
    carts,
    sampled: (abandoned || []).length, // how many abandoned records we actually inspected
  };
}

/** "Where to focus" lines for the checkout funnel, ranked most-actionable first. Pure. */
export function checkoutInsights(c) {
  const out = [];
  if (!c || !c.reached) return out;
  if (c.abandoned > 0) {
    out.push({
      tone: c.abandonRate >= 70 ? 'danger' : 'warn',
      text: `${c.abandonRate}% of shoppers who reached checkout didn't finish — about ${c.currency} ${c.valueLost} left in abandoned carts. This is your biggest, most fixable leak.`,
    });
    out.push({
      tone: 'neutral',
      text: `Fastest wins for checkout drop-off: show shipping cost earlier, offer express/Shop Pay, and turn on an abandoned-cart email (Shopify → Marketing → Automations) to recover a slice automatically.`,
    });
    if (c.topAbandoned.length) {
      const p = c.topAbandoned[0];
      out.push({
        tone: 'neutral',
        text: `Most-abandoned item: “${p.title}” (in ${p.checkouts} abandoned checkout${p.checkouts === 1 ? '' : 's'}). Check its price, shipping and stock — friction on a popular item costs the most.`,
      });
    }
  } else {
    out.push({ tone: 'pos', text: `No abandoned checkouts in this window — shoppers who reach checkout are completing. Focus effort higher up (traffic and add-to-cart).` });
  }
  return out;
}

/** A few plain-English "where to focus" lines, ranked. Pure. */
export function buildInsights(a) {
  const out = [];
  if (!a.totalOrders) return out;
  const top = a.trafficSources[0] || a.channels[0];
  if (top && top.share >= 40) {
    out.push({
      tone: 'warn',
      text: `${top.label} drives ${top.share}% of revenue — strong, but concentrated. A dip there hits hard; worth diversifying where buyers come from.`,
    });
  } else if (top) {
    out.push({ tone: 'pos', text: `Revenue is spread across sources — ${top.label} leads at ${top.share}%. No single point of failure.` });
  }
  if (a.referrers && a.referrers.length) {
    const r = a.referrers[0];
    out.push({ tone: 'neutral', text: `Top external referrer: ${r.label} (${r.orders} order${r.orders === 1 ? '' : 's'}). Double down where the traffic already converts.` });
  }
  if (a.products && a.products.length) {
    const p = a.products[0];
    out.push({ tone: 'pos', text: `Best seller: “${p.title}” — ${p.units} unit${p.units === 1 ? '' : 's'} across recent orders. Keep it in stock and featured.` });
  }
  if (a.avgDaysToConvert != null) {
    const fast = a.avgDaysToConvert <= 1;
    out.push({
      tone: fast ? 'pos' : 'neutral',
      text: fast
        ? `Buyers convert fast — about ${a.avgDaysToConvert} day(s) from first visit. Your funnel isn't the bottleneck.`
        : `Buyers take ~${a.avgDaysToConvert} days from first visit to purchase. A back-in-stock or reminder nudge in that window could lift conversion.`,
    });
  }
  out.push({ tone: 'neutral', text: `Average order value is ${a.currency} ${a.aov}. Bundles or a free-shipping threshold above it can raise it.` });
  return out;
}

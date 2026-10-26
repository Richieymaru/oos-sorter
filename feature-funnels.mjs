/** Feature funnels — pure attribution of orders to features. No network. */
const FEATURES = ['find-my-blaster', 'upgrade'];

/**
 * Attribute normalized orders to features via each line's `src`.
 *
 * Revenue approximation: no per-line price is available, so a line's share of
 * the order is order.amount * (line.qty / total qty in the order). Orders with
 * zero total qty or a falsy amount contribute 0 revenue (never NaN).
 *
 * `orders` is "orders touched": an order with lines from both features counts
 * once in EACH feature, so the per-feature counts can sum to more than the
 * true order total. Intentional.
 */
export function attributeOrders(orders) {
  const features = Object.fromEntries(FEATURES.map((f) => [f, { orders: 0, revenue: 0 }]));
  for (const order of orders || []) {
    const items = order.items || [];
    const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const amount = Number(order.amount) || 0;
    const touched = new Set();
    for (const line of items) {
      if (!FEATURES.includes(line.src)) continue;
      touched.add(line.src);
      if (totalQty > 0 && amount) features[line.src].revenue += amount * ((Number(line.qty) || 0) / totalQty);
    }
    for (const f of touched) features[f].orders++;
  }
  return { currency: (orders && orders[0] && orders[0].currency) || 'USD', features };
}

// Untrusted map keys: read with hasOwn, write with defineProperty so
// '__proto__' stays an own data property and never touches the prototype.
function addTo(map, key, n) {
  const cur = Object.hasOwn(map, key) ? Number(map[key]) || 0 : 0;
  Object.defineProperty(map, key, { value: cur + (Number(n) || 0), enumerable: true, writable: true, configurable: true });
}
function mergeMap(into, from) {
  for (const k of Object.keys(from || {})) addTo(into, k, from[k]);
}

/** Sum every day bucket with since <= ymd <= until (null = unbounded) into one DayBucket. */
export function sumStats(stats, { since = null, until = null } = {}) {
  const out = { fmb: { open: 0, step: [0, 0, 0, 0, 0], done: 0, deadEnd: 0, picks: {} }, ugb: { open: 0, blaster: {}, fits: 0, add: 0 } };
  const days = (stats && stats.days) || {};
  for (const ymd of Object.keys(days)) {
    if (since && ymd < since) continue;
    if (until && ymd > until) continue;
    const { fmb = {}, ugb = {} } = days[ymd] || {};
    out.fmb.open += Number(fmb.open) || 0;
    out.fmb.done += Number(fmb.done) || 0;
    out.fmb.deadEnd += Number(fmb.deadEnd) || 0;
    for (let i = 0; i < 5; i++) out.fmb.step[i] += Number((fmb.step || [])[i]) || 0;
    mergeMap(out.fmb.picks, fmb.picks);
    out.ugb.open += Number(ugb.open) || 0;
    out.ugb.fits += Number(ugb.fits) || 0;
    out.ugb.add += Number(ugb.add) || 0;
    mergeMap(out.ugb.blaster, ugb.blaster);
  }
  return out;
}

const STEP_LABELS = ['Opened', 'Q1 · Player', 'Q2 · Budget', 'Q3 · Power', 'Q4 · Build', 'Q5 · Velocity'];

/** Quiz funnel: people reached at each step and % lost vs the previous step. */
export function quizDropoff(summed) {
  const f = (summed && summed.fmb) || {};
  const counts = [Number(f.open) || 0, ...[0, 1, 2, 3, 4].map((i) => Number((f.step || [])[i]) || 0)];
  let worstIndex = -1, worst = 0;
  const steps = counts.map((reached, i) => {
    const prev = i ? counts[i - 1] : 0;
    const dropPct = i && prev > 0 ? Math.max(0, ((prev - reached) / prev) * 100) : 0;
    if (dropPct > worst) { worst = dropPct; worstIndex = i; }
    return { label: STEP_LABELS[i], reached, dropPct };
  });
  return { steps, worstIndex };
}

/** Which answers get picked most. Keys are "<q>:<a>". */
export function answerDemand(summed) {
  const picks = (summed && summed.fmb && summed.fmb.picks) || {};
  const rows = Object.keys(picks).map((key) => {
    const at = key.indexOf(':');
    return { q: at < 0 ? key : key.slice(0, at), a: at < 0 ? '' : key.slice(at + 1), picks: Number(picks[key]) || 0 };
  });
  const total = rows.reduce((s, r) => s + r.picks, 0);
  return rows.map((r) => ({ ...r, share: total ? r.picks / total : 0 })).sort((x, y) => y.picks - x.picks);
}

/** Upgrade-blaster summary for the window. */
export function ugbSummary(summed) {
  const u = (summed && summed.ugb) || {};
  const blaster = u.blaster || {};
  const topBlasters = Object.keys(blaster).map((handle) => ({ handle, picks: Number(blaster[handle]) || 0 })).sort((a, b) => b.picks - a.picks);
  return {
    opens: Number(u.open) || 0,
    blasterPicks: topBlasters.reduce((s, b) => s + b.picks, 0),
    fitsViewed: Number(u.fits) || 0,
    adds: Number(u.add) || 0,
    topBlasters,
  };
}

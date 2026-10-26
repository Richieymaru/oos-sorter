/** Feature funnels — pure attribution of orders to features. No network. */
import { resolveRange } from './funnels.mjs';
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

/* ---- demand vs stock ---- */

const fpsNum = (t) => { const m = /(\d{2,3})/.exec(String(t || '')); return m ? parseInt(m[1], 10) : null; };
const has = (list, word) => String(list || '').split(',').map((s) => s.trim()).includes(word);
const band = (n, lo, hi) => n != null && Number.isFinite(n) && n >= lo && n < hi;

/**
 * Quiz answer -> product matcher. KEEP IN SYNC with assets/gbu-find-my-blaster.js
 * (theme quiz). Keys are the question keys / short answer labels the beacon sends.
 * A product missing the needed field never matches (empty string / null fail).
 */
export const FMB_QUESTIONS = {
  experience: [
    { short: 'Starter', match: (p) => p.experience === 'Starter' },
    { short: 'Intermediate', match: (p) => p.experience === 'Intermediate' },
    { short: 'Advanced', match: (p) => p.experience === 'Advanced' },
  ],
  budget: [
    { short: 'Under $300', match: (p) => band(p.price, 0, 300) },
    { short: '$300 to $700', match: (p) => band(p.price, 300, 700) },
    { short: '$700 and above', match: (p) => band(p.price, 700, Infinity) },
  ],
  power: [ // power is a list ("Electric, Gas"): membership
    { short: 'Electric', match: (p) => has(p.power, 'Electric') },
    { short: 'Gas', match: (p) => has(p.power, 'Gas') },
    { short: 'Manual', match: (p) => has(p.power, 'Manual') },
  ],
  material: [
    { short: 'Full metal', match: (p) => p.material === 'Full Metal' },
    { short: 'Nylon', match: (p) => p.material === 'Nylon' },
    { short: 'Metal + nylon', match: (p) => p.material === 'Full Metal + Nylon' },
  ],
  fps: [ // free text, so approximate
    { short: 'Under 250 FPS', match: (p) => band(fpsNum(p.fps), 0, 250), approx: true },
    { short: '250 to 320 FPS', match: (p) => band(fpsNum(p.fps), 250, 320), approx: true },
    { short: '320+ FPS', match: (p) => band(fpsNum(p.fps), 320, Infinity), approx: true },
  ],
};

const findRule = (q, a) => (FMB_QUESTIONS[q] || []).find((r) => r.short === a) || null;
const inStockOf = (products) => (products || []).filter((p) => p && p.inStock);

/**
 * Per picked answer: how well in-stock catalog covers it.
 * supply = inStockCount / all in-stock products; demand = answer's share of its
 * own question's picks. coveragePct = min(100, supply / demand * 100), so an
 * answer wanted by 60% of people but matched by 10% of stock covers ~17%.
 * unmetPct = 100 - coveragePct. No demand or no stock -> coveragePct 0.
 */
export function demandVsStock(demand, products) {
  const live = inStockOf(products);
  const qTotal = {};
  for (const d of demand || []) qTotal[d.q] = (qTotal[d.q] || 0) + d.picks;
  const out = [];
  for (const d of demand || []) {
    const rule = findRule(d.q, d.a);
    if (!rule) continue;
    const inStockCount = live.filter((p) => rule.match(p)).length;
    const demandWithinQ = qTotal[d.q] ? d.picks / qTotal[d.q] : 0;
    const supply = live.length ? inStockCount / live.length : 0;
    const coveragePct = demandWithinQ > 0 && supply > 0 ? Math.min(100, (supply / demandWithinQ) * 100) : 0;
    const row = { q: d.q, a: d.a, demandShare: d.share, inStockCount, coveragePct, unmetPct: 100 - coveragePct };
    if (rule.approx) row.approx = true;
    out.push(row);
  }
  return out;
}

/**
 * The most-wanted answer pair (across two different questions) with the fewest
 * in-stock matches, ranked by demand per unit of stock (min of the two answers' picks / (inStock+1)). Falls back to single answers when
 * only one question was answered. Null when no demand.
 */
export function worstCombo(demand, products) {
  const rows = (demand || []).filter((d) => d.picks > 0 && findRule(d.q, d.a));
  if (!rows.length) return null;
  const live = inStockOf(products);
  const cands = rows.map((r) => ({ label: r.a, wanted: r.picks, rules: [findRule(r.q, r.a)] }));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].q === rows[j].q) continue;
      cands.push({ label: `${rows[i].a} + ${rows[j].a}`, wanted: Math.min(rows[i].picks, rows[j].picks), rules: [findRule(rows[i].q, rows[i].a), findRule(rows[j].q, rows[j].a)] });
    }
  }
  const pairs = cands.filter((c) => c.rules.length === 2);
  let best = null;
  for (const c of pairs.length ? pairs : cands) {
    const inStock = live.filter((p) => c.rules.every((r) => r.match(p))).length;
    const unmet = c.wanted / (inStock + 1); // demand per unit of stock
    if (!best || unmet > best.unmet) best = { label: c.label, wanted: c.wanted, inStock, unmet };
  }
  return { label: best.label, wanted: best.wanted, inStock: best.inStock };
}

/* ---- recommendations + page view model ---- */

/**
 * Ranked recommendations. `impact` values are rough heuristic estimates, not forecasts.
 * Order: unmet demand combo, worst quiz drop-off step, low upgrade add-rate.
 */
// `attribution` is accepted but reserved (unused in v1).
export function buildFeatureRecs({ dropoff, worstCombo: combo, ugb } = {}) {
  const recs = [];
  if (combo && combo.wanted > 0) {
    recs.push({
      tone: 'danger',
      text: `Stock more ${combo.label}: ${combo.wanted} quiz takers want it and only ${combo.inStock} in-stock product${combo.inStock === 1 ? '' : 's'} match. Rough estimate: restocking could lift quiz orders 10-20%.`,
      fix: [`Add or restock products matching ${combo.label}`, 'Or tighten the quiz so it stops promising what you cannot ship'],
      impact: { up: '+15%', unit: 'est. quiz orders' },
    });
  }
  const steps = (dropoff && dropoff.steps) || [];
  if (dropoff && dropoff.worstIndex > 0 && steps[dropoff.worstIndex]) {
    const s = steps[dropoff.worstIndex];
    recs.push({
      tone: 'warn',
      text: `Fix the "${s.label}" step: ${Math.round(s.dropPct)}% of people quit here. Rough estimate: fixing it could recover about a third of them.`,
      fix: ['Simplify the question or its answer options', 'Check it on mobile and make the choices obvious'],
      impact: { up: `+${Math.round(s.dropPct / 3)}%`, unit: 'est. finishers' },
    });
  }
  const opens = Number(ugb && ugb.opens) || 0, adds = Number(ugb && ugb.adds) || 0;
  if (opens >= 10 && adds / opens < 0.15) {
    recs.push({
      tone: 'warn',
      text: `Upgrade Your Blaster: only ${Math.round((adds / opens) * 100)}% of ${opens} engaged visitors add an upgrade to cart. Rough estimate: lifting it to about 15% would roughly double add-to-carts.`,
      fix: ['Show compatible upgrades higher up', 'Add price or "fits your blaster" cues next to the add button'],
      impact: { up: '2x', unit: 'est. add-to-carts' },
    });
  }
  return recs;
}

/** Compose the Feature Funnels page view model. Tolerates empty/missing inputs. */
export function analyzeFeatures({ orders = [], stats = null, products = [], window = null } = {}) {
  const win = window || resolveRange('all'); // 'all' is not a key -> yields the 30d default; Tasks 8/10 always pass a window
  const attribution = attributeOrders(orders || []);
  // sumStats compares plain strings against YYYY-MM-DD keys; resolveRange gives full ISO.
  const summed = sumStats(stats, { since: win.since && win.since.slice(0, 10), until: win.until && win.until.slice(0, 10) });
  const dropoff = quizDropoff(summed);
  const demandRows = answerDemand(summed);
  const demand = demandVsStock(demandRows, products || []);
  const combo = worstCombo(demandRows, products || []);
  const ugb = ugbSummary(summed);
  const f = attribution.features['find-my-blaster'] || { orders: 0, revenue: 0 };
  const u = attribution.features['upgrade'] || { orders: 0, revenue: 0 };
  const touched = (orders || []).filter((o) => o && (o.origin || (o.items || []).some((i) => i && i.src))).length;
  return {
    window: win,
    currency: attribution.currency,
    totals: { revenue: f.revenue + u.revenue, orders: touched, trendPct: null },
    perFeature: {
      fmb: { key: 'find-my-blaster', label: 'Find My Blaster', stages: [{ label: 'Opened', count: summed.fmb.open }, { label: 'Finished', count: summed.fmb.done }, { label: 'Ordered', count: f.orders }], revenue: f.revenue, orders: f.orders },
      ugb: { key: 'upgrade', label: 'Upgrade Your Blaster', stages: [{ label: 'Engaged', count: summed.ugb.open }, { label: 'Added to cart', count: summed.ugb.add }, { label: 'Ordered', count: u.orders }], revenue: u.revenue, orders: u.orders },
    },
    dropoff,
    demand,
    worstCombo: combo,
    recs: buildFeatureRecs({ dropoff, worstCombo: combo, ugb, attribution }),
  };
}

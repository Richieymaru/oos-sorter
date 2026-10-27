/**
 * Feature usage counters (Feature Funnels), stored in one shop metafield
 * (oos_sort.feature_stats). Beaconed from the storefront, aggregated per day.
 *
 * Shape:
 *   { version: 1, days: { 'YYYY-MM-DD': DayBucket } }
 *   DayBucket = {
 *     fmb: { open, step:[n1..n5], done, deadEnd, picks:{ 'q:a': n } },
 *     ugb: { open, blaster:{ [handle]: n }, fits, add },
 *   }
 */

import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'feature_stats';
const METAFIELD_LIMIT = 131072;
const CLAMP = 60;

export const emptyStats = () => ({ version: 1, days: {} });

const emptyDay = () => ({
  fmb: { open: 0, step: [0, 0, 0, 0, 0], done: 0, deadEnd: 0, add: 0, picks: {} },
  ugb: { open: 0, blaster: {}, fits: 0, add: 0 },
});

// Untrusted keys: read with hasOwn, write with defineProperty so '__proto__',
// 'constructor', 'toString' etc. become plain own counters and never touch the prototype.
function bump(map, key) {
  const n = Object.hasOwn(map, key) ? Number(map[key]) || 0 : 0;
  Object.defineProperty(map, key, { value: n + 1, enumerable: true, writable: true, configurable: true });
}

const clamp = (v) => String(v ?? '').slice(0, CLAMP);

/** Pure: returns a new stats object with the one counter for `ev` bumped on `ymd`. */
export function applyEvent(stats, ev, ymd) {
  if (!ev || (ev.f !== 'fmb' && ev.f !== 'ugb')) return stats;
  const prev = stats.days?.[ymd];
  const day = prev ? structuredClone(prev) : emptyDay();
  const { fmb, ugb } = day;

  if (ev.f === 'fmb') {
    if (ev.e === 'open') fmb.open++;
    else if (ev.e === 'step') {
      const n = Number(ev.n);
      if (!Number.isInteger(n) || n < 1 || n > 5) return stats;
      fmb.step[n - 1]++;
    } else if (ev.e === 'pick') {
      const k = `${clamp(ev.q)}:${clamp(ev.a)}`;
      bump(fmb.picks, k);
    } else if (ev.e === 'done') {
      fmb.done++;
      if (ev.m === 0) fmb.deadEnd++;
    } else if (ev.e === 'add') fmb.add++;
    else return stats;
  } else {
    if (ev.e === 'open') ugb.open++;
    else if (ev.e === 'blaster') {
      const b = clamp(ev.b);
      bump(ugb.blaster, b);
    } else if (ev.e === 'fits') ugb.fits++;
    else if (ev.e === 'add') ugb.add++;
    else return stats;
  }

  return { ...stats, days: { ...stats.days, [ymd]: day } };
}

const KNOWN = {
  fmb: ['open', 'step', 'pick', 'done', 'add'],
  ugb: ['open', 'blaster', 'fits', 'add'],
};

/** Pure: validate/clamp an untrusted beacon body. Returns a clean event or null. Never throws. */
export function sanitizeEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { f, e } = body;
  if (typeof f !== 'string' || !Object.hasOwn(KNOWN, f)) return null;
  if (typeof e !== 'string' || !KNOWN[f].includes(e)) return null;
  const ev = { f, e };
  for (const k of ['q', 'a', 'b']) {
    if (typeof body[k] === 'string') ev[k] = body[k].slice(0, CLAMP);
  }
  for (const k of ['n', 'm']) {
    if (body[k] === undefined || body[k] === null || body[k] === '') continue;
    const n = Math.trunc(Number(body[k]));
    if (Number.isFinite(n)) ev[k] = n;
  }
  return ev;
}

/** Pure: sanitize a { batch: [events] } body into valid events (max 50). Never throws. */
export function sanitizeBatch(body) {
  const b = body && typeof body === 'object' ? body.batch : null;
  if (!Array.isArray(b)) return [];
  return b.slice(0, 50).map(sanitizeEvent).filter(Boolean);
}

/** Pure: keep only the newest `maxDays` day keys. */
export function trimStats(stats, maxDays = 90) {
  const keys = Object.keys(stats.days ?? {}).sort();
  if (keys.length <= maxDays) return stats;
  const days = {};
  for (const k of keys.slice(keys.length - maxDays)) days[k] = stats.days[k];
  return { ...stats, days };
}

export async function loadFeatureStats() {
  const d = await gql(
    `{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`
  );
  const raw = d.shop?.metafield?.value;
  if (!raw) return emptyStats();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.days !== 'object' || Array.isArray(parsed.days)) return emptyStats();
    return { ...emptyStats(), ...parsed };
  } catch {
    console.warn('  ! oos_sort.feature_stats metafield was unparseable — starting fresh');
    return emptyStats();
  }
}

export async function saveFeatureStats(stats) {
  const shopId = await getShopId();
  let s = trimStats(stats, 90);
  while (JSON.stringify(s).length > METAFIELD_LIMIT - 2048 && Object.keys(s.days).length) {
    s = trimStats(s, Object.keys(s.days).length - 1);
  }
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $m) { userErrors { field message } }
     }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(s) }] }
  );
  assertNoUserErrors('metafieldsSet(feature_stats)', d.metafieldsSet);
}

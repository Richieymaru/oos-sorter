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
  fmb: { open: 0, step: [0, 0, 0, 0, 0], done: 0, deadEnd: 0, picks: {} },
  ugb: { open: 0, blaster: {}, fits: 0, add: 0 },
});

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
      fmb.picks[k] = (fmb.picks[k] || 0) + 1;
    } else if (ev.e === 'done') {
      fmb.done++;
      if (ev.m === 0) fmb.deadEnd++;
    } else return stats;
  } else {
    if (ev.e === 'open') ugb.open++;
    else if (ev.e === 'blaster') {
      const b = clamp(ev.b);
      ugb.blaster[b] = (ugb.blaster[b] || 0) + 1;
    } else if (ev.e === 'fits') ugb.fits++;
    else if (ev.e === 'add') ugb.add++;
    else return stats;
  }

  return { ...stats, days: { ...stats.days, [ymd]: day } };
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
    if (!parsed || typeof parsed.days !== 'object') return emptyStats();
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

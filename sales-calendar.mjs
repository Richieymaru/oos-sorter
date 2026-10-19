/**
 * Australian sales calendar — the big retail/gifting days that are a good time
 * to recover abandoned carts. Drives the in-app reminder banner.
 *
 * Pure and year-aware (no network, no clock baked in) so it unit-tests offline.
 * Dates are UTC; close enough for a "14 days before" reminder (we don't need
 * AEST precision to tell the owner Black Friday is coming).
 *
 * Tier 1 = the biggest for a gel-blaster store; Tier 2 = strong. Variable promos
 * (Click Frenzy, Afterpay Day, Prime Day) move year to year, so they're marked
 * `approx` — the banner says "(approx)" and the owner confirms exact dates.
 */

const DAY = 86400000;

/** nth (1-based) `weekday` (0=Sun..6=Sat) of `month1` (1=Jan..12=Dec), UTC. */
function nthWeekday(year, month1, weekday, n) {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + shift + (n - 1) * 7));
}
const d = (year, month1, day) => new Date(Date.UTC(year, month1 - 1, day));

/** Every tracked sale event for a given year, with its date. */
export function saleEvents(year) {
  const blackFriday = nthWeekday(year, 11, 5, 4); // 4th Friday of November
  const cyberMonday = new Date(+blackFriday + 3 * DAY);
  return [
    // Tier 1 — biggest for GBU
    { key: 'black-friday', label: 'Black Friday', tier: 1, date: blackFriday },
    { key: 'cyber-monday', label: 'Cyber Monday', tier: 1, date: cyberMonday },
    { key: 'christmas', label: 'Christmas', tier: 1, date: d(year, 12, 25) },
    { key: 'boxing-day', label: 'Boxing Day', tier: 1, date: d(year, 12, 26) },
    { key: 'eofy', label: 'EOFY sales', tier: 1, date: d(year, 6, 30) },
    { key: 'fathers-day', label: "Father's Day", tier: 1, date: nthWeekday(year, 9, 0, 1) },
    // Tier 2 — strong
    { key: 'click-frenzy', label: 'Click Frenzy', tier: 2, approx: true, date: d(year, 11, 11) },
    { key: 'click-frenzy-mayhem', label: 'Click Frenzy Mayhem', tier: 2, approx: true, date: d(year, 5, 20) },
    { key: 'afterpay-day-mar', label: 'Afterpay Day', tier: 2, approx: true, date: d(year, 3, 19) },
    { key: 'afterpay-day-aug', label: 'Afterpay Day', tier: 2, approx: true, date: d(year, 8, 13) },
    { key: 'mothers-day', label: "Mother's Day", tier: 2, date: nthWeekday(year, 5, 0, 2) },
    { key: 'prime-day', label: 'Amazon Prime Day', tier: 2, approx: true, date: d(year, 7, 8) },
  ];
}

/**
 * The soonest sale event to prompt abandoned-cart recovery, or null. Looks at
 * this year AND next (so late-December still catches January events). An event
 * qualifies when it's upcoming within `leadDays`, or active up to `afterDays`
 * past its date. Returns the event plus `daysUntil` (negative = already started).
 */
export function activeSaleReminder(now = new Date(), { leadDays = 14, tiers = [1, 2], afterDays = 2 } = {}) {
  const t = now instanceof Date ? now : new Date(now);
  const y = t.getUTCFullYear();
  const events = [...saleEvents(y), ...saleEvents(y + 1)].filter((e) => tiers.includes(e.tier));
  let best = null;
  for (const e of events) {
    const daysUntil = Math.ceil((+e.date - +t) / DAY);
    if (daysUntil <= leadDays && daysUntil >= -afterDays) {
      if (!best || +e.date < +best.date) best = { ...e, daysUntil };
    }
  }
  return best;
}

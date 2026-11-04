/**
 * Product Status Audit — a full-catalog snapshot + diff, independent of the
 * webhook-driven Product Change Monitor. The monitor reacts to events as they
 * fire (and can miss one if a webhook never arrives); this scans the ENTIRE
 * catalog on a schedule (every 3 days) and every time you press Generate, diffs
 * it against the last scan, and reports every product whose status changed —
 * WITH who changed it — as a report you can show your boss.
 *
 * Status codes are the monitor's: a=Active, d=Draft, r=Archived, u=Unlisted,
 * '?'=unknown (codeOf/labelOf, reused).
 *
 * Stored in one shop metafield (oos_sort.audit), separate from oos_sort.state
 * and oos_sort.monitor:
 *   {
 *     statuses: { "<numericId>": "<code>" }   // last scan's full catalog state
 *     titles:   { "<numericId>": "<title>" }  // to name a product that later vanishes
 *     lastAt:   string|null                    // ISO of the last scan (3-day gate)
 *     reports:  Report[]                        // bounded, newest-first
 *   }
 * Report = { at, baseline?, counts, total, changes: Change[] }
 * Change = { type:'change'|'new'|'gone', id, title, from?, to?, wentLive, wentDark,
 *            who, whoAt, message }
 *
 * The pure functions (summarizeStatuses, diffStatuses, scanDue, pushReport,
 * bucketize, titleOf) are tested offline in audit.test.mjs — no env, no network.
 */

import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';
import { fetchAllStatuses, whoFromProductEvents, whoDeleted, labelOf } from './monitor.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'audit';

// Display order the owner thinks in: live first, then the hidden states.
export const BUCKETS = [
  { code: 'a', label: 'Active' },
  { code: 'd', label: 'Draft' },
  { code: 'u', label: 'Unlisted' },
  { code: 'r', label: 'Archived' },
];

/* ---------------------------------------------------------------- pure core */

/** Title for a numeric id from a {"<id>": title} map. '(untitled)' when absent. */
export function titleOf(titles, id) {
  const t = titles && typeof titles === 'object' ? titles[id] : null;
  return (t && String(t)) || '(untitled)';
}

/** fetchAllStatuses() keys titles "p<id>" (the monitor's delete-cache
 *  convention), but statuses — and every audit lookup (bucketize, diffStatuses)
 *  — is keyed by the BARE numeric id. Strip the leading "p" so titles[id] lines
 *  up with statuses[id]; without this every product shows "(untitled)". Pure. */
export function normalizeTitles(titles) {
  const out = {};
  if (titles && typeof titles === 'object') {
    for (const k of Object.keys(titles)) {
      out[/^p\d+$/.test(k) ? k.slice(1) : k] = titles[k];
    }
  }
  return out;
}

/** Count products per status code from a { id: code } map. */
export function summarizeStatuses(statuses) {
  const counts = { a: 0, d: 0, u: 0, r: 0, '?': 0, total: 0 };
  const m = statuses && typeof statuses === 'object' ? statuses : {};
  for (const id of Object.keys(m)) {
    const c = m[id];
    if (counts[c] != null) counts[c]++; else counts['?']++;
    counts.total++;
  }
  return counts;
}

/** Group products into display buckets (with titles) for the page lists. */
export function bucketize(statuses, titles) {
  const m = statuses && typeof statuses === 'object' ? statuses : {};
  const out = {};
  for (const b of BUCKETS) out[b.code] = [];
  out['?'] = [];
  for (const id of Object.keys(m)) {
    const code = out[m[id]] ? m[id] : '?';
    out[code].push({ id, title: titleOf(titles, id) });
  }
  for (const code of Object.keys(out)) out[code].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

const isLive = (code) => code === 'a';

/**
 * Diff the previous scan's { id: code } against the current one. Returns a list
 * of changes, most sensitive first:
 *   wentLive  (something became Active — the "surprise" case)  ->
 *   wentDark  (a live product was hidden/dropped)             ->
 *   other status flips -> new products -> gone (deleted) products.
 * Titles come from the current titles map, falling back to the previous one so a
 * deleted product can still be named. Pure — attribution is added by the caller.
 */
export function diffStatuses(prevStatuses, currStatuses, currTitles = {}, prevTitles = {}) {
  const prev = prevStatuses && typeof prevStatuses === 'object' ? prevStatuses : {};
  const curr = currStatuses && typeof currStatuses === 'object' ? currStatuses : {};
  const name = (id) => {
    const t = currTitles && currTitles[id];
    return (t && String(t)) || titleOf(prevTitles, id);
  };
  const changes = [];
  for (const id of Object.keys(curr)) {
    const to = curr[id];
    if (!(id in prev)) {
      changes.push({ type: 'new', id, title: name(id), to, wentLive: isLive(to), wentDark: false });
    } else if (prev[id] !== to) {
      const from = prev[id];
      changes.push({ type: 'change', id, title: name(id), from, to, wentLive: isLive(to) && !isLive(from), wentDark: isLive(from) && !isLive(to) });
    }
  }
  for (const id of Object.keys(prev)) {
    if (!(id in curr)) {
      const from = prev[id];
      changes.push({ type: 'gone', id, title: name(id), from, wentLive: false, wentDark: isLive(from) });
    }
  }
  // Order by severity first (became visible -> became hidden -> other flip ->
  // untouched-severity new/gone), then by kind (a status FLIP outranks a brand
  // new or deleted product in the same severity band), then by title.
  const sev = (c) => (c.wentLive ? 0 : c.wentDark ? 1 : c.type === 'change' ? 2 : 3);
  const kind = (c) => (c.type === 'change' ? 0 : c.type === 'new' ? 1 : 2);
  changes.sort((a, b) => sev(a) - sev(b) || kind(a) - kind(b) || a.title.localeCompare(b.title));
  return changes;
}

/** Is a scan due? True when there's no last scan or >= intervalDays have passed. */
export function scanDue(lastAt, nowMs = Date.now(), intervalDays = 3) {
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last) || !Number.isFinite(nowMs)) return true;
  return nowMs - last >= intervalDays * 24 * 60 * 60 * 1000;
}

/** ms until the next scan is due (0 when due now). */
export function nextDueMs(lastAt, nowMs = Date.now(), intervalDays = 3) {
  if (!lastAt) return 0;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, intervalDays * 24 * 60 * 60 * 1000 - (nowMs - last));
}

/** Prepend a report and keep only the newest `cap`. Pure (new array). */
export function pushReport(history, report, cap = 12) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.unshift(report);
  return list.slice(0, cap);
}

/* ------------------------------------------------------------- metafield io */

const EMPTY = () => ({ statuses: {}, titles: {}, lastAt: null, reports: [] });
const METAFIELD_LIMIT = 131072;

export async function loadAudit() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return EMPTY();
  try {
    return { ...EMPTY(), ...JSON.parse(raw) };
  } catch {
    console.warn('  ! oos_sort.audit metafield was unparseable — starting fresh');
    return EMPTY();
  }
}

export async function saveAudit(data) {
  const shopId = await getShopId();
  const d = {
    statuses: data.statuses || {},
    titles: data.titles || {},
    lastAt: data.lastAt ?? null,
    reports: Array.isArray(data.reports) ? data.reports : [],
  };
  // Trim to fit the 128KB cap, cheapest-to-lose first: old reports, then the
  // titles cache (only used to name deletes — codes still diff without it).
  while (JSON.stringify(d).length > METAFIELD_LIMIT - 2048 && d.reports.length > 1) {
    d.reports = d.reports.slice(0, d.reports.length - 1);
  }
  if (JSON.stringify(d).length > METAFIELD_LIMIT - 2048) d.titles = {};
  const value = JSON.stringify(d);
  const r = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value }] }
  );
  assertNoUserErrors('metafieldsSet(audit)', r.metafieldsSet);
  return d;
}

/* ----------------------------------------------------------------- runners */

// Cap live author lookups per scan so a huge first diff can't blow the 60s
// function limit. Baseline scans emit no changes, so the normal case is tiny.
const MAX_ATTRIBUTIONS = 60;

/** Attribute one change to a person via Shopify's event log. Never throws. */
async function attribute(change) {
  try {
    if (change.type === 'gone') {
      const w = await whoDeleted(change.id, 'PRODUCT');
      return { who: w.author || null, whoAt: w.createdAt || null, message: null };
    }
    const w = await whoFromProductEvents(change.id);
    return { who: w.author || null, whoAt: w.createdAt || null, message: w.message || null };
  } catch {
    return { who: null, whoAt: null, message: null };
  }
}

/**
 * Run one audit scan: read the whole catalog, diff against the last scan, name
 * the culprit for each change, store the new snapshot + report. The first scan
 * is a baseline (establishes state, emits no changes) — same philosophy as the
 * monitor's first run. Returns the report.
 */
export async function runAudit({ now = new Date() } = {}) {
  const nowISO = now.toISOString();
  const { statuses, titles: rawTitles } = await fetchAllStatuses();
  const titles = normalizeTitles(rawTitles); // "p<id>" -> bare id, to match statuses
  const prev = await loadAudit();
  const prevTitles = normalizeTitles(prev.titles); // tolerate older p-keyed snapshots
  const baseline = !prev.lastAt || Object.keys(prev.statuses || {}).length === 0;

  let changes = baseline ? [] : diffStatuses(prev.statuses, statuses, titles, prevTitles);
  const truncated = changes.length > MAX_ATTRIBUTIONS;
  if (truncated) changes = changes.slice(0, MAX_ATTRIBUTIONS);
  for (const c of changes) Object.assign(c, await attribute(c));

  const report = {
    at: nowISO,
    baseline,
    counts: summarizeStatuses(statuses),
    total: Object.keys(statuses).length,
    changes,
    ...(truncated ? { truncated: true } : {}),
  };
  const saved = await saveAudit({ statuses, titles, lastAt: nowISO, reports: pushReport(prev.reports, report) });
  return { report, total: saved.statuses ? Object.keys(saved.statuses).length : report.total };
}

/**
 * Self-gating scan for the cron: only runs when >= intervalDays since the last
 * scan. Wrapped so it can never break the caller (the engine run). Returns a
 * small status object.
 */
export async function maybeRunAudit({ intervalDays = 3, now = new Date() } = {}) {
  try {
    const prev = await loadAudit();
    if (!scanDue(prev.lastAt, now.getTime(), intervalDays)) {
      return { ran: false, nextDueMs: nextDueMs(prev.lastAt, now.getTime(), intervalDays) };
    }
    const { report } = await runAudit({ now });
    return { ran: true, baseline: report.baseline, changes: report.changes.length };
  } catch (e) {
    console.error('  ! audit scan failed:', e.message);
    return { ran: false, error: e.message };
  }
}

export { labelOf };

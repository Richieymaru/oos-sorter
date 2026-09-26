/**
 * Event-log poll for the Product Change Monitor. The webhook only sees a
 * product's STATUS (Active/Draft/…); it never sees publication changes — who
 * "excluded a product from Facebook" or "from Australia". Those live only in
 * Shopify's event log. So this polls that log (on the 5-min cron), CONSOLIDATES
 * the burst of events one action produces (a Draft cascades into ~10 exclusions)
 * into ONE summary per product, and emits it to Slack + the Sheet + the dashboard
 * log — the poll is now the monitor's single, consolidated source of truth.
 *
 * Message parsing is Shopify-wording-dependent and English-only; anything it
 * can't classify becomes 'other' and is dropped, so a wording change degrades to
 * "nothing logged", never to a crash. Pure core is unit-tested (monitor-poll.test.mjs).
 */
import { gql } from './shopify.mjs';
import { loadMonitorState, saveMonitorState } from './monitor-state.mjs';
import { notifySlackMonitorEvent } from './slack.mjs';
import { appendToSheet, buildSheetRow } from './monitor.mjs';
import { recordMonitorEvent } from './monitor-log.mjs';

const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : s);

/* ---- pure ---- */

/** Classify one shop event (its action + human message) into a monitor kind. */
export function classifyEvent(action, message) {
  const a = String(action || '').toLowerCase();
  const m = String(message || '');
  const clean = (s) => s.replace(/[.\s]+$/, '').trim();
  let mm;
  if ((mm = /status from (\w+) to (\w+)/i.exec(m))) return { kind: 'status', from: mm[1].toLowerCase(), to: mm[2].toLowerCase(), name: null };
  if ((mm = /excluded a product from (.+)/i.exec(m))) return { kind: 'channel-out', from: null, to: null, name: clean(mm[1]) };
  if ((mm = /(?:product )?was excluded from (.+)/i.exec(m))) return { kind: 'market-out', from: null, to: null, name: clean(mm[1]) };
  if ((mm = /(?:included a product (?:in|to|on)|made (?:a product )?available (?:in|on)) (.+)/i.exec(m))) return { kind: 'channel-in', from: null, to: null, name: clean(mm[1]) };
  if ((mm = /(?:product )?was included in (.+)/i.exec(m))) return { kind: 'market-in', from: null, to: null, name: clean(mm[1]) };
  if (a === 'create' || /\b(?:created|added)\b/i.test(m)) return { kind: 'add', from: null, to: null, name: null };
  if (a === 'destroy' || /\b(?:deleted|destroyed)\b/i.test(m)) return { kind: 'delete', from: null, to: null, name: null };
  return { kind: 'other', from: null, to: null, name: null };
}

/** Group events into bursts by (subject, minute) — one merchant action fires a
 *  cluster of events within the same minute. */
export function groupBursts(events) {
  const map = new Map();
  for (const e of (Array.isArray(events) ? events : [])) {
    const key = String(e.subjectId ?? '') + '|' + String(e.at ?? '').slice(0, 16);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return [...map.values()];
}

/** Merge one burst's classified events into a single summary. */
export function consolidateBurst(events) {
  const list = Array.isArray(events) ? events : [];
  const first = list.find((e) => e.title) || list[0] || {};
  const out = {
    title: first.title || null, handle: first.handle || null, type: first.type || 'Product',
    subjectId: first.subjectId || null, who: first.who || null, at: first.at || null,
    statusFrom: null, statusTo: null, channelsOut: [], channelsIn: [], marketsOut: [], marketsIn: [], added: false, deleted: false,
  };
  for (const e of list) {
    const c = e.classified || {};
    if (c.kind === 'status') { out.statusFrom = c.from; out.statusTo = c.to; }
    else if (c.kind === 'channel-out' && c.name) out.channelsOut.push(c.name);
    else if (c.kind === 'channel-in' && c.name) out.channelsIn.push(c.name);
    else if (c.kind === 'market-out' && c.name) out.marketsOut.push(c.name);
    else if (c.kind === 'market-in' && c.name) out.marketsIn.push(c.name);
    else if (c.kind === 'add') out.added = true;
    else if (c.kind === 'delete') out.deleted = true;
  }
  return out;
}

/** A consolidated burst -> a display label + tone (empty label = nothing worth showing). */
export function burstSummary(c) {
  if (!c) return { label: '', tone: 'neutral' };
  if (c.deleted) return { label: 'Deleted', tone: 'danger' };
  const parts = [];
  if (c.statusFrom && c.statusTo) parts.push(`${cap(c.statusFrom)} → ${cap(c.statusTo)}`);
  else if (c.added) parts.push('Added');
  const phrase = (arr, one, manyLabel) => (arr.length === 1 ? `${one} ${arr[0]}` : `${one} ${arr.length} ${manyLabel}`);
  if (c.channelsOut.length) parts.push(phrase(c.channelsOut, 'hidden from', 'channels'));
  if (c.channelsIn.length) parts.push(phrase(c.channelsIn, 'shown on', 'channels'));
  if (c.marketsOut.length) parts.push(phrase(c.marketsOut, 'off', 'markets'));
  if (c.marketsIn.length) parts.push(phrase(c.marketsIn, 'on', 'markets'));
  let label = parts.join(' · ');
  if (label) label = label[0].toUpperCase() + label.slice(1);
  const to = (c.statusTo || '').toLowerCase();
  let tone = 'neutral';
  if (to === 'active' || c.channelsIn.length || c.marketsIn.length || c.added) tone = 'pos';
  if (to === 'draft' || to === 'archived' || to === 'unlisted' || c.channelsOut.length || c.marketsOut.length) tone = 'warn';
  return { label, tone };
}

/* ---- I/O + orchestration ---- */

/** Product/collection events newer than `sinceISO`, oldest-first. */
export async function pollShopEvents(sinceISO, limit = 100) {
  const q = `(subject_type:PRODUCT OR subject_type:COLLECTION) AND created_at:>'${sinceISO}'`;
  const d = await gql(
    `query($q: String!, $n: Int!) {
       events(first: $n, sortKey: CREATED_AT, reverse: false, query: $q) {
         nodes { ... on BasicEvent {
           action message author createdAt subjectType subjectId
           subject { __typename ... on Product { title handle } ... on Collection { title handle } }
         } }
       }
     }`,
    { q, n: limit }
  );
  return (d.events?.nodes || []).filter(Boolean);
}

/**
 * Poll the event log, consolidate new bursts, and emit each. Advances a cursor
 * (lastEventAt in oos_sort.monitor) so each event is reported once. Full runs only.
 * @returns {Promise<{emitted:number}>}
 */
export async function runMonitorPoll(settings, { dryRun = false } = {}) {
  const state = await loadMonitorState().catch(() => ({ titles: {} }));
  // First ever run: only look back an hour, so we don't dump the whole history.
  const since = state.lastEventAt || new Date(Date.now() - 3600000).toISOString();
  const raw = await pollShopEvents(since, 100);
  if (!raw.length) return { emitted: 0 };

  const events = raw.map((n) => ({
    subjectId: String(n.subjectId || '').split('/').pop(),
    type: n.subjectType === 'COLLECTION' ? 'Collection' : 'Product',
    title: n.subject?.title || null,
    handle: n.subject?.handle || null,
    who: n.author || null,
    at: n.createdAt,
    action: n.action,
    classified: classifyEvent(n.action, n.message),
  }));

  const shop = process.env.SHOP_DOMAIN;
  const titles = state.titles || {};
  let emitted = 0;
  for (const group of groupBursts(events)) {
    const c = consolidateBurst(group);
    const s = burstSummary(c);
    if (!s.label) continue; // nothing monitor-worthy in this burst

    const path = c.type === 'Collection' ? 'collections' : 'products';
    const cacheKey = (c.type === 'Collection' ? 'c' : 'p') + c.subjectId;
    const title = c.title || titles[cacheKey] || `#${c.subjectId}`;
    const who = c.who || 'unknown';

    if (!dryRun) {
      try {
        await notifySlackMonitorEvent({ webhookUrl: settings.monitorSlackWebhook, title, handle: c.handle, path, action: s.label, who, stock: '' });
        await appendToSheet(settings.sheetWebhook, buildSheetRow({ at: c.at, title, handle: c.handle, path, fromLabel: '—', toLabel: s.label, who, stock: '', shop }));
        await recordMonitorEvent({ at: c.at, type: c.type, title, handle: c.handle, path, fromLabel: '—', toLabel: s.label, who, stock: null });
      } catch (e) {
        console.error('monitor poll emit failed:', e.message);
      }
    }
    console.log(`monitor poll: ${title} — ${s.label} — by ${who}`);
    emitted++;
  }

  const newest = raw.reduce((mx, n) => (n.createdAt > mx ? n.createdAt : mx), since);
  if (!dryRun && newest !== state.lastEventAt) {
    state.lastEventAt = newest;
    await saveMonitorState(state);
  }
  return { emitted };
}

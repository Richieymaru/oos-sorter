/**
 * Gel & gas reorder reminders ("Running low on gels?").
 *
 * Some days after a customer's order that included gel balls or gas (the
 * `gel-balls-gas` collection), they get ONE email with the same items in a
 * one-click reorder cart. OFF by default (settings.remindersEnabled).
 *
 * Who is skipped, always:
 *   - customers who have NOT agreed to marketing email (Shopify's own consent) -
 *     a reorder nudge is marketing, so consent is required, not assumed;
 *   - orders that were cancelled, refunded or voided;
 *   - customers who already reordered gels/gas since that order;
 *   - orders already reminded, and customers who unsubscribed from reminders;
 *   - every order but the newest due one per customer, so nobody gets two at once.
 * If Shopify hides the order email or the consent (protected customer data not
 * granted), NOTHING is sent and the run says why on the Reminders page.
 *
 * State lives in shop metafield oos_sort.reminders:
 *   { lastRun, lastStatus, rows:[{ o, n, e, ts, items:[{t,v,q}], c, r, amt }], optout:[email] }
 * where o = order id, n = order name, e = email, ts = sent, c = clicked, r = reordered,
 * amt = the reorder's total. Pure logic first (reminders.test.mjs), thin I/O below.
 */
import { gql, getShopId, assertNoUserErrors, getShopContext } from './shopify.mjs';
import { formatMoney, sendReorderReminder } from './notify.mjs';
import { trackUrl, unsubUrl } from './waitlist.mjs';
import { fetchCollectionProductIds } from './catalog.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'reminders';
const LIMIT = 131072; // Shopify metafield JSON value cap, in bytes
export const GEL_COLLECTION = process.env.REMINDER_COLLECTION || 'gel-balls-gas';
export const WINDOW_DAYS = 14; // orders this many days past the delay are still caught
export const MAX_PER_RUN = 80;  // a ceiling well under Gmail's daily send limit

const DAY = 86400000;
const lc = (s) => String(s ?? '').trim().toLowerCase();
const sid = (gid) => String(gid ?? '').split('/').pop();

/** The signed "product" key reminder links use, so they never collide with waitlist links. */
export const reminderKey = (orderId) => 'r' + String(orderId).replace(/\D/g, '');
export const isReminderKey = (k) => /^r\d+$/.test(String(k || ''));

/* ---------------------------------------------------------------- pure ---- */

/** An empty, well-formed log. */
export function emptyLog() {
  return { lastRun: null, lastStatus: null, rows: [], optout: [] };
}

/** Pure: coerce whatever came out of the metafield into a well-formed log. */
export function normalizeLog(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    lastRun: o.lastRun || null,
    lastStatus: o.lastStatus || null,
    rows: Array.isArray(o.rows) ? o.rows.filter((r) => r && r.o && r.e) : [],
    optout: Array.isArray(o.optout) ? o.optout.map(lc).filter(Boolean) : [],
  };
}

/** Pure: the order's gel/gas lines (those whose product is in the gel collection). */
export function gelLines(order, gelIds) {
  return (order.lines || []).filter((l) => l.productId && gelIds.has(String(l.productId)));
}

const isGas = (l) => /\bgas\b/i.test(l.title || '');

/** Pure: 'gels', 'gas' or 'both' - the subject line wording. */
export function kindOf(lines) {
  const gas = lines.filter(isGas).length;
  if (!gas) return 'gels';
  return gas === lines.length ? 'gas' : 'both';
}

const dead = (o) => !!o.cancelledAt || /^(REFUNDED|VOIDED)$/.test(String(o.financial || ''));

/**
 * Pure: which orders get a reminder now. `orders` are normalized orders covering the
 * due window AND everything after it (so later reorders are seen). Returns
 * { due:[{ orderId, name, email, createdAt, lines }], skipped:{...counts} }.
 */
export function selectDue(orders, log, { now, delayDays, gelIds, windowDays = WINDOW_DAYS }) {
  const nowMs = new Date(now).getTime();
  const newest = nowMs - delayDays * DAY;           // must be at least this old
  const oldest = newest - windowDays * DAY;         // and no older than this
  const reminded = new Set(log.rows.map((r) => String(r.o)));
  const optout = new Set(log.optout.map(lc));
  const skipped = { noEmail: 0, noConsent: 0, dead: 0, reordered: 0, already: 0, optout: 0, older: 0 };

  // Each customer's gel/gas orders, for the "already reordered" check.
  const gelOrdersByEmail = new Map();
  for (const o of orders) {
    if (!o.email || dead(o) || !gelLines(o, gelIds).length) continue;
    const k = lc(o.email);
    if (!gelOrdersByEmail.has(k)) gelOrdersByEmail.set(k, []);
    gelOrdersByEmail.get(k).push(new Date(o.createdAt).getTime());
  }

  const candidates = [];
  for (const o of orders) {
    const t = new Date(o.createdAt).getTime();
    if (!(t <= newest && t > oldest)) continue;
    const lines = gelLines(o, gelIds);
    if (!lines.length) continue;
    if (!o.email) { skipped.noEmail++; continue; }
    if (dead(o)) { skipped.dead++; continue; }
    if (reminded.has(String(o.id))) { skipped.already++; continue; }
    const k = lc(o.email);
    if (optout.has(k)) { skipped.optout++; continue; }
    if (o.consent !== 'SUBSCRIBED') { skipped.noConsent++; continue; }
    if ((gelOrdersByEmail.get(k) || []).some((x) => x > t)) { skipped.reordered++; continue; }
    candidates.push({ orderId: String(o.id), name: o.name || null, email: o.email, createdAt: o.createdAt, lines });
  }

  // One per customer: their newest due order. Anyone already reminded in this
  // window is left alone too, so two close orders never mean two emails.
  const recentlyReminded = new Set(
    log.rows.filter((r) => new Date(r.ts).getTime() > nowMs - windowDays * DAY).map((r) => lc(r.e))
  );
  const byEmail = new Map();
  for (const c of candidates) {
    const k = lc(c.email);
    if (recentlyReminded.has(k)) { skipped.already++; continue; }
    const prev = byEmail.get(k);
    if (!prev) byEmail.set(k, c);
    else {
      skipped.older++;
      if (new Date(c.createdAt) > new Date(prev.createdAt)) byEmail.set(k, c);
    }
  }
  return { due: [...byEmail.values()], skipped };
}

/** Pure: a log row for one sent reminder. */
export function reminderRow(due, whenISO) {
  return {
    o: String(due.orderId),
    n: due.name || null,
    e: lc(due.email),
    ts: whenISO,
    items: due.lines.map((l) => ({ t: l.title, v: l.variantId ? String(l.variantId) : null, q: Number(l.qty || 1) })),
  };
}

/**
 * Pure: mark rows whose customer placed a gel/gas order after the reminder went out
 * (the reminder's revenue). Only the first such order counts. Returns how many were marked.
 */
export function markReordered(log, orders, gelIds) {
  let marked = 0;
  for (const row of log.rows) {
    if (row.r) continue;
    const sentAt = new Date(row.ts).getTime();
    const hit = orders
      .filter((o) => lc(o.email) === row.e && !dead(o) && new Date(o.createdAt).getTime() > sentAt && gelLines(o, gelIds).length)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    if (hit) {
      row.r = hit.createdAt;
      row.amt = Number(hit.amount || 0);
      row.cur = hit.currency || null;
      marked++;
    }
  }
  return marked;
}

/** Pure: mark a click on a reminder (first click wins). */
export function markClicked(log, orderId, email, whenISO) {
  const row = log.rows.find((r) => String(r.o) === String(orderId).replace(/\D/g, '') && r.e === lc(email));
  if (!row || row.c) return false;
  row.c = whenISO;
  return true;
}

/** Pure: add an email to the reminder opt-out list. */
export function addOptout(log, email) {
  const k = lc(email);
  if (!k || log.optout.includes(k)) return false;
  log.optout.push(k);
  return true;
}

/** Pure: headline numbers for the Reminders page. */
export function reminderStats(log) {
  const rows = log.rows;
  const revenue = rows.reduce((s, r) => s + (r.r ? Number(r.amt || 0) : 0), 0);
  return {
    sent: rows.length,
    clicked: rows.filter((r) => r.c).length,
    reordered: rows.filter((r) => r.r).length,
    revenue,
    currency: (rows.find((r) => r.cur) || {}).cur || null,
    optedOut: log.optout.length,
  };
}

/** Pure: drop the oldest rows until the log fits the metafield cap. */
export function trimToFit(log, limit = LIMIT) {
  const out = { ...log, rows: [...log.rows] };
  while (out.rows.length && Buffer.byteLength(JSON.stringify(out)) > limit) out.rows.shift();
  return out;
}

/** Pure: the calendar day (YYYY-MM-DD, store timezone-agnostic UTC) a run belongs to. */
export const dayKey = (iso) => String(iso).slice(0, 10);

/* ----------------------------------------------------------------- I/O ---- */

export async function loadReminders() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return emptyLog();
  try { return normalizeLog(JSON.parse(raw)); } catch { return emptyLog(); }
}

export async function saveReminders(log) {
  const shopId = await getShopId();
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(trimToFit(log)) }] }
  );
  assertNoUserErrors('metafieldsSet(reminders)', d.metafieldsSet);
}

const ORDER_FIELDS = (withCustomer) => `
  id
  name
  createdAt
  cancelledAt
  displayFinancialStatus
  email
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  ${withCustomer ? 'customer { emailMarketingConsent { marketingState } }' : ''}
  lineItems(first: 25) {
    nodes {
      quantity
      title
      variantTitle
      variant { id price image { url } }
      product { id handle featuredImage { url } }
    }
  }`;

/** Pure: flatten one order node. */
export function normalizeReminderOrder(n) {
  const money = n.currentTotalPriceSet?.shopMoney || {};
  return {
    id: sid(n.id),
    name: n.name || null,
    createdAt: n.createdAt,
    cancelledAt: n.cancelledAt || null,
    financial: n.displayFinancialStatus || null,
    email: n.email || null,
    consent: n.customer?.emailMarketingConsent?.marketingState || null,
    amount: Number(money.amount || 0),
    currency: money.currencyCode || null,
    lines: (n.lineItems?.nodes || []).map((li) => ({
      title: li.title || '',
      variantTitle: li.variantTitle || null,
      qty: Number(li.quantity || 1),
      variantId: li.variant?.id ? sid(li.variant.id) : null,
      price: li.variant?.price != null ? Number(li.variant.price) : null,
      image: li.variant?.image?.url || li.product?.featuredImage?.url || null,
      productId: li.product?.id ? sid(li.product.id) : null,
      handle: li.product?.handle || null,
    })),
  };
}

/**
 * Orders from `since` to now, with marketing consent when the app may read it.
 * Returns { orders, consentReadable, emailRedacted }. A denied customer field falls
 * back to the same query without it - those orders then carry no consent and are
 * skipped, which is the safe failure.
 */
export async function fetchReminderOrders(sinceISO, { pageSize = 250, maxPages = 12 } = {}) {
  const q = `created_at:>='${sinceISO}'`;
  async function run(withCustomer) {
    const out = [];
    let cursor = null;
    let pages = 0;
    do {
      const d = await gql(
        `query Rem($n: Int!, $q: String!, $c: String) {
           orders(first: $n, after: $c, sortKey: CREATED_AT, reverse: true, query: $q) {
             pageInfo { hasNextPage endCursor }
             nodes { ${ORDER_FIELDS(withCustomer)} }
           }
         }`,
        { n: pageSize, q, c: cursor }
      );
      out.push(...(d.orders?.nodes || []).map(normalizeReminderOrder));
      cursor = d.orders?.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return out;
  }
  let orders;
  let consentReadable = true;
  try {
    orders = await run(true);
  } catch (e) {
    if (!/ACCESS_DENIED/i.test(String(e && e.message))) throw e;
    consentReadable = false;
    orders = await run(false);
  }
  const emailRedacted = orders.length > 0 && !orders.some((o) => o.email);
  return { orders, consentReadable, emailRedacted };
}

/** The email payload for one due reminder: the biggest gel/gas line is the hero. */
export function reminderPayload(due, ctx, settings, email, cur) {
  // Gels lead (the email asks about gels), then by value - a pricier gas tin should
  // not become the headline of a "running low on gels?" email.
  const lines = [...due.lines].sort((a, b) => (isGas(a) - isGas(b)) || ((b.price || 0) * b.qty - (a.price || 0) * a.qty));
  const hero = lines[0];
  const cartPath = '/cart/' + lines.filter((l) => l.variantId).map((l) => `${l.variantId}:${l.qty}`).join(',');
  const key = reminderKey(due.orderId);
  return {
    product: {
      title: hero.title,
      variantTitle: hero.variantTitle,
      qty: hero.qty,
      image: hero.image,
      handle: hero.handle,
      variantId: hero.variantId,
      priceText: hero.price != null ? formatMoney(String(hero.price), cur) : null,
      storeHost: ctx.host,
      brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
      clickCartUrl: trackUrl(null, key, email, cartPath),
      clickProductUrl: hero.handle ? trackUrl(null, key, email, `/products/${hero.handle}`) : undefined,
    },
    unsub: unsubUrl(null, key, email),
    others: lines.slice(1).map((l) => l.title),
    kind: kindOf(lines),
  };
}

/**
 * The daily pass: at most once per calendar day (unless `force`). Marks reorders,
 * picks who is due, sends, records. Never throws for a single failed send.
 * Returns { ran, sent, due, skipped, reordered, status }.
 */
export async function runReminders(settings, { dryRun = false, force = false, now = new Date().toISOString() } = {}) {
  if (!settings || !settings.remindersEnabled) return { ran: false, status: 'off' };
  const log = await loadReminders();
  if (!force && log.lastRun && dayKey(log.lastRun) === dayKey(now)) return { ran: false, status: 'already ran today' };

  const delayDays = Number(settings.reminderDays) || 21;
  const since = new Date(new Date(now).getTime() - (delayDays + WINDOW_DAYS + 1) * DAY).toISOString();
  const [gelArr, fetched, ctx] = await Promise.all([
    fetchCollectionProductIds(GEL_COLLECTION),
    fetchReminderOrders(since),
    getShopContext(),
  ]);
  const gelIds = new Set(gelArr.map(String));
  const reordered = markReordered(log, fetched.orders, gelIds);

  let status = 'ok';
  if (!gelIds.size) status = `no products in the "${GEL_COLLECTION}" collection`;
  else if (fetched.emailRedacted) status = 'order emails are hidden - turn on protected customer data (Level 2) for the app';
  else if (!fetched.consentReadable) status = 'marketing consent is hidden - nothing sent (needs protected customer data access)';

  let sel = { due: [], skipped: {} };
  let sent = 0;
  if (status === 'ok') {
    sel = selectDue(fetched.orders, log, { now, delayDays, gelIds });
    const weeks = Math.max(1, Math.round(delayDays / 7));
    for (const due of sel.due.slice(0, MAX_PER_RUN)) {
      const p = reminderPayload(due, ctx, settings, due.email, ctx.currency || 'AUD');
      try {
        await sendReorderReminder(due.email, p.product, p.unsub, { dryRun, weeks, others: p.others, kind: p.kind });
        if (!dryRun) log.rows.push(reminderRow(due, new Date().toISOString()));
        sent++;
      } catch (e) {
        console.error(`reminder to ${due.email} failed:`, e.message);
      }
    }
  }

  log.lastRun = now;
  log.lastStatus = { status, sent, due: sel.due.length, skipped: sel.skipped, at: now, dryRun };
  if (!dryRun) await saveReminders(log);
  return { ran: true, sent, due: sel.due.length, skipped: sel.skipped, reordered, status };
}

/** Click on a reminder link (from api/unsubscribe): record it. Best-effort. */
export async function applyReminderClicked(key, email) {
  const log = await loadReminders();
  if (markClicked(log, String(key).slice(1), email, new Date().toISOString())) await saveReminders(log);
}

/** Unsubscribe from reminders (from api/unsubscribe). */
export async function applyReminderOptout(email) {
  const log = await loadReminders();
  if (addOptout(log, email)) await saveReminders(log);
}

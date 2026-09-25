# Waitlist Notified Log + Engagement Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain a per-send "notified log" so the merchant can see who was notified, which products restocked, whether shoppers clicked through, and can resend / auto-nudge shoppers who didn't act.

**Architecture:** One new pure-core + thin-I/O module (`notified.mjs`) owning a new shop metafield `oos_sort.notified`. Every back-in-stock send records a log row (instead of only bumping a counter). Email links become signed tracked redirects through the existing `api/unsubscribe.mjs`. A one-shot auto-nudge runs in the existing `/api/run` full pass; a manual Resend button hangs off the existing `/api/waitlists` POST. No new `api/` files, no new Shopify scopes.

**Tech Stack:** Node 20.6+ ESM, Shopify Admin GraphQL 2026-07, nodemailer (Gmail), Vercel serverless. Tests are hand-rolled `ok(label, cond)` harnesses run via `node <file>.test.mjs`, chained in `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-25-waitlist-notified-log-engagement-design.md`

## Global Constraints

- **Zero new `api/*.mjs` files.** The deploy is AT Vercel's 12-function cap; a 13th silently fails to deploy. Click + unsub-flag fold into `api/unsubscribe.mjs`; resend folds into `api/waitlists.mjs` POST; auto-nudge runs inside the `/api/run` engine pass.
- **Shopify metafield JSON value cap = 131072 bytes.** `saveNotified` trims oldest rows to fit, same pattern as `state.mjs saveState` (uses `LIMIT - 2048` margin).
- **No new Shopify scopes in Phase 1.** Order attribution (the `o` field) is reserved but not populated.
- **No database / no hosting.** All state lives in shop metafields.
- **Pure decision logic is pure and offline-tested**; I/O modules stay thin and follow existing patterns (`state.mjs`, `waitlist.mjs`).
- **Stock is decided only by `isInStock` / `isVariantInStock`** (from `stock.mjs`), never re-derived.
- **All product ids in the log are numeric** (`String(id).replace(/\D/g,'')`); markers normalize both sides so callers may pass a gid or numeric id.
- **Windows/PowerShell dev env.** Prefer Node over shell one-liners. `npm test` is the gate.

## Review Focus

- **Malformed / non-array notified metafield** → the pure helpers must treat a non-array log as empty and never throw (pinned in Task 1).
- **Open-redirect via a crafted `to` on the click link** → `safeRelPath` must reject `//host`, `https://host`, and backslash paths, so the redirect can only ever land on the shop domain (pinned in Task 1).
- **Log outgrows the 131072-byte metafield cap** → `trimToFit` must drop oldest rows until the serialized array fits (pinned in Task 1).
- **Nudge double-fire / idempotence** → `selectNudges` must exclude rows already clicked, ordered, nudged, or unsubscribed, and rows still inside the wait window (pinned in Task 1).
- **Duplicate row when the same shopper is emailed twice in one run** → `appendNotified` must dedupe by `(e,p,ts)` (pinned in Task 1).

---

### Task 1: `notified.mjs` pure core + tests

**Files:**
- Create: `notified.mjs` (pure functions only in this task)
- Create: `notified.test.mjs`
- Modify: `package.json:11` (add `notified.test.mjs` to the `test` script)

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `notifiedRow({email, productId, title, variantId?, variantTitle?, ts?}) -> row` where `row = {e,p,t,v,vt,ts,c:null,n:null,u:false,o:null}` (`p`,`v` numeric strings; `v` null when absent; `ts` defaults to `new Date().toISOString()`).
  - `appendNotified(log, row, cap=1000) -> array` (prepend, dedupe by `(e,p,ts)`, cap oldest-out).
  - `trimToFit(log, limit=131072) -> array` (drop oldest until `Buffer.byteLength(JSON.stringify(list)) <= limit`).
  - `markClicked(log, email, productId, whenISO) -> array` (set `c` on newest matching `(e,p)` if unset).
  - `markNudged(log, email, productId, whenISO) -> array` (set `n` on newest matching `(e,p)` if unset).
  - `markUnsubscribed(log, email, productId) -> array` (set `u=true` on all matching `(e,p)`).
  - `selectNudges(log, nowISO, days, isInStockByProduct) -> array` (due rows: not clicked/ordered/nudged/unsubscribed, `ts <= now - days`, and `isInStockByProduct(p) === true`).
  - `deriveStats(log) -> {notified, clicked, nudged, ordered, clickRate}`.
  - `safeRelPath(to) -> string|null` (accept single-slash-rooted relative path with no scheme/backslash/`//`).

- [ ] **Step 1: Write the failing test**

Create `notified.test.mjs`:

```js
#!/usr/bin/env node
/** Pure tests for the notified-log helpers. node notified.test.mjs */
import {
  notifiedRow, appendNotified, trimToFit, markClicked, markNudged,
  markUnsubscribed, selectNudges, deriveStats, safeRelPath,
} from './notified.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- notifiedRow ---');
const row = notifiedRow({ email: 'A@X.com', productId: 'gid://shopify/Product/55', title: 'Knife', variantId: 'gid://shopify/ProductVariant/99', variantTitle: 'Black', ts: 't1' });
ok('lowercases email + numeric ids', eq(row, { e: 'a@x.com', p: '55', t: 'Knife', v: '99', vt: 'Black', ts: 't1', c: null, n: null, u: false, o: null }));
ok('null variant when absent', notifiedRow({ email: 'a@x.com', productId: '55', title: 'X', ts: 't' }).v === null);

console.log('\n--- appendNotified ---');
let log = appendNotified([], row);
ok('prepends the row', log.length === 1 && log[0].e === 'a@x.com');
log = appendNotified(log, notifiedRow({ email: 'b@x.com', productId: '55', title: 'X', ts: 't2' }));
ok('newest-first', log[0].e === 'b@x.com' && log[1].e === 'a@x.com');
ok('dedupes (e,p,ts)', appendNotified(log, row).length === 2);
ok('non-array log is safe', appendNotified(null, row).length === 1);
let capped = [];
for (let i = 0; i < 5; i++) capped = appendNotified(capped, notifiedRow({ email: `u${i}@x.com`, productId: '1', title: 'X', ts: `t${i}` }), 3);
ok('caps to newest N', capped.length === 3 && capped[0].e === 'u4@x.com' && capped[2].e === 'u2@x.com');

console.log('\n--- trimToFit ---');
const big = [];
for (let i = 0; i < 50; i++) big.push(notifiedRow({ email: `user${i}@example.com`, productId: '1', title: 'Some Product Title', ts: `2026-09-25T00:00:${String(i).padStart(2, '0')}Z` }));
const fitted = trimToFit(big, 400);
ok('trims oldest until under the byte limit', Buffer.byteLength(JSON.stringify(fitted)) <= 400 && fitted.length < 50);
ok('keeps the newest rows', fitted[0].e === 'user0@example.com');
ok('no-op when already fits', trimToFit(big, 10_000_000).length === 50);

console.log('\n--- markClicked / markNudged ---');
const base = [
  notifiedRow({ email: 'a@x.com', productId: '55', title: 'X', ts: 't3' }),
  notifiedRow({ email: 'a@x.com', productId: '55', title: 'X', ts: 't1' }),
];
let clicked = markClicked(base, 'A@X.com', 'gid://shopify/Product/55', 'now');
ok('marks the newest matching row', clicked[0].c === 'now' && clicked[1].c === null);
ok('no-op if already clicked', markClicked(clicked, 'a@x.com', '55', 'later')[0].c === 'now');
ok('no-op when no match', markClicked(base, 'z@x.com', '55', 'now') === base);
let nudged = markNudged(base, 'a@x.com', '55', 'now');
ok('marks newest row nudged', nudged[0].n === 'now' && nudged[1].n === null);

console.log('\n--- markUnsubscribed ---');
const uns = markUnsubscribed(base, 'a@x.com', '55');
ok('flags all matching rows', uns[0].u === true && uns[1].u === true);
ok('no-op when none match', markUnsubscribed(base, 'z@x.com', '55') === base);

console.log('\n--- selectNudges ---');
const NOW = '2026-09-25T00:00:00Z';
const mk = (over) => ({ ...notifiedRow({ email: 'a@x.com', productId: '7', title: 'X', ts: '2026-09-20T00:00:00Z' }), ...over });
const pool = [
  mk({ ts: '2026-09-20T00:00:00Z' }),                 // due (5 days old, in stock)
  mk({ ts: '2026-09-24T18:00:00Z' }),                 // too recent
  mk({ ts: '2026-09-20T00:00:00Z', c: 'x' }),         // clicked
  mk({ ts: '2026-09-20T00:00:00Z', n: 'x' }),         // already nudged
  mk({ ts: '2026-09-20T00:00:00Z', u: true }),        // unsubscribed
  mk({ ts: '2026-09-20T00:00:00Z', p: '8' }),         // out of stock
];
const due = selectNudges(pool, NOW, 2, (p) => p === '7');
ok('exactly the one due row', due.length === 1 && due[0].ts === '2026-09-20T00:00:00Z' && due[0].p === '7');
ok('respects the wait window', selectNudges([mk({ ts: '2026-09-24T18:00:00Z' })], NOW, 2, () => true).length === 0);
ok('non-array is safe', selectNudges(null, NOW, 2, () => true).length === 0);

console.log('\n--- deriveStats ---');
const stats = deriveStats([mk({}), mk({ c: 'x' }), mk({ c: 'x', n: 'y' }), mk({ o: 'z' })]);
ok('counts + click rate', eq(stats, { notified: 4, clicked: 2, nudged: 1, ordered: 1, clickRate: 50 }));
ok('empty stats', eq(deriveStats([]), { notified: 0, clicked: 0, nudged: 0, ordered: 0, clickRate: 0 }));

console.log('\n--- safeRelPath ---');
ok('accepts a product path', safeRelPath('/products/x') === '/products/x');
ok('accepts a cart permalink', safeRelPath('/cart/999:1') === '/cart/999:1');
ok('rejects protocol-relative', safeRelPath('//evil.com') === null);
ok('rejects absolute url', safeRelPath('https://evil.com') === null);
ok('rejects backslash', safeRelPath('/\\evil') === null);
ok('rejects non-rooted', safeRelPath('evil') === null);
ok('rejects empty', safeRelPath('') === null);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node notified.test.mjs`
Expected: FAIL — `Cannot find module './notified.mjs'` (or import error).

- [ ] **Step 3: Write minimal implementation**

Create `notified.mjs` (pure section — I/O added in Task 2):

```js
/**
 * Back-in-stock NOTIFIED LOG: one row per email we actually sent, kept in the
 * shop metafield `oos_sort.notified` (separate from oos_sort.state). Retaining
 * these rows is what makes "who was notified / which restocked / did they click /
 * resend / nudge" possible — before this, notifying a shopper deleted the record.
 *
 * This file is split like waitlist.mjs: a PURE core (tested offline in
 * notified.test.mjs) and thin metafield I/O below it. All product/variant ids in
 * a row are NUMERIC; every marker normalizes ids, so callers may pass a gid or a
 * numeric short id. Rows are newest-first.
 */

const CAP = 1000;           // max rows kept (also trimmed by byte size below)
const LIMIT = 131072;       // Shopify metafield JSON value cap, in bytes
const DAY = 86400000;

const nid = (id) => String(id ?? '').replace(/\D/g, '');
const lc = (e) => String(e ?? '').trim().toLowerCase();

/** Build a log row from a shopper + product. */
export function notifiedRow({ email, productId, title, variantId = null, variantTitle = null, ts = null }) {
  return {
    e: lc(email),
    p: nid(productId),
    t: String(title ?? ''),
    v: variantId == null || variantId === '' ? null : nid(variantId),
    vt: variantTitle ? String(variantTitle) : null,
    ts: ts || new Date().toISOString(),
    c: null,   // clickedAt
    n: null,   // nudgedAt (the one manual/auto follow-up)
    u: false,  // unsubscribed
    o: null,   // orderedAt — reserved for Phase 2
  };
}

/** Prepend a row (newest-first), dedupe by (e,p,ts), cap oldest-out. */
export function appendNotified(log, row, cap = CAP) {
  const list = Array.isArray(log) ? log : [];
  if (list.some((x) => x.e === row.e && x.p === row.p && x.ts === row.ts)) return list;
  const next = [row, ...list];
  return next.length > cap ? next.slice(0, cap) : next;
}

/** Drop oldest rows (they sit at the end) until the JSON fits `limit` bytes. */
export function trimToFit(log, limit = LIMIT) {
  let list = Array.isArray(log) ? log.slice() : [];
  while (list.length && Buffer.byteLength(JSON.stringify(list)) > limit) {
    list = list.slice(0, list.length - 1);
  }
  return list;
}

function setNewest(log, email, productId, field, value) {
  const e = lc(email), p = nid(productId);
  const list = Array.isArray(log) ? log : [];
  const i = list.findIndex((x) => x.e === e && x.p === p); // newest-first => first match is most recent
  if (i < 0 || list[i][field]) return list;
  const next = list.slice();
  next[i] = { ...next[i], [field]: value };
  return next;
}

export const markClicked = (log, email, productId, whenISO) => setNewest(log, email, productId, 'c', whenISO);
export const markNudged = (log, email, productId, whenISO) => setNewest(log, email, productId, 'n', whenISO);

/** Flag every row for (email, product) unsubscribed (nudge suppression). */
export function markUnsubscribed(log, email, productId) {
  const e = lc(email), p = nid(productId);
  const list = Array.isArray(log) ? log : [];
  let changed = false;
  const next = list.map((x) => {
    if (x.e === e && x.p === p && !x.u) { changed = true; return { ...x, u: true }; }
    return x;
  });
  return changed ? next : list;
}

/** Rows due for the one nudge. `isInStockByProduct(numericId) -> boolean`. */
export function selectNudges(log, nowISO, days, isInStockByProduct) {
  const cutoff = new Date(nowISO).getTime() - days * DAY;
  const list = Array.isArray(log) ? log : [];
  return list.filter((x) =>
    x.c == null && x.o == null && x.n == null && x.u !== true &&
    new Date(x.ts).getTime() <= cutoff &&
    isInStockByProduct(x.p) === true
  );
}

/** Dashboard counters over the retained window. */
export function deriveStats(log) {
  const list = Array.isArray(log) ? log : [];
  const notified = list.length;
  const clicked = list.filter((x) => x.c).length;
  const nudged = list.filter((x) => x.n).length;
  const ordered = list.filter((x) => x.o).length;
  const clickRate = notified ? Math.round((clicked / notified) * 100) : 0;
  return { notified, clicked, nudged, ordered, clickRate };
}

/** A safe storefront-relative redirect target, or null. Blocks open-redirects. */
export function safeRelPath(to) {
  const s = String(to ?? '');
  if (!s.startsWith('/')) return null;
  if (s.startsWith('//')) return null;
  if (s.includes('\\')) return null;
  if (s.includes('://')) return null;
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node notified.test.mjs`
Expected: PASS — all checks ok.

- [ ] **Step 5: Wire into `npm test`**

In `package.json`, append ` && node notified.test.mjs` to the end of the `test` script (line 11), after `node monitor.test.mjs`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (all files, including the new one).

- [ ] **Step 7: Commit**

```bash
git add notified.mjs notified.test.mjs package.json
git commit -m "Notified log pure core (append/trim/mark/selectNudges/stats/safeRelPath)"
```

---

### Task 2: `notified.mjs` metafield I/O

**Files:**
- Modify: `notified.mjs` (append the I/O section below the pure core)

**Interfaces:**
- Consumes: pure core from Task 1 (`appendNotified`, `trimToFit`, `markClicked`, `markNudged`, `markUnsubscribed`); `gql`, `getShopId`, `assertNoUserErrors` from `shopify.mjs`.
- Produces:
  - `loadNotified() -> Promise<array>` (empty array if unset/unparsable/non-array).
  - `saveNotified(log) -> Promise<array>` (trims to `LIMIT-2048`, writes `oos_sort.notified`, returns the fitted list).
  - `recordNotified(rows) -> Promise<void>` (load, append each, save once).
  - `applyClicked(email, productId, whenISO?) -> Promise<void>`
  - `applyNudged(email, productId, whenISO?) -> Promise<void>`
  - `applyUnsubscribed(email, productId) -> Promise<void>`

- [ ] **Step 1: Add the import at the top of `notified.mjs`**

Directly under the file's opening doc comment, add:

```js
import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';
```

- [ ] **Step 2: Append the I/O section at the end of `notified.mjs`**

```js
/* ---- metafield I/O (shop-level oos_sort.notified) ---- */

const NAMESPACE = 'oos_sort';
const KEY = 'notified';

/** Read the notified log (empty array if unset/unparsable). */
export async function loadNotified() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** Persist the log, trimmed to fit the metafield byte cap (oldest dropped). */
export async function saveNotified(log) {
  const shopId = await getShopId();
  const fitted = trimToFit(log, LIMIT - 2048);
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value: JSON.stringify(fitted) }] }
  );
  assertNoUserErrors('metafieldsSet(notified)', d.metafieldsSet);
  return fitted;
}

/** Append one row per email we sent, in a single load+save. */
export async function recordNotified(rows) {
  if (!rows || !rows.length) return;
  let log = await loadNotified();
  for (const r of rows) log = appendNotified(log, r);
  await saveNotified(log);
}

async function applyMark(fn) {
  const log = await loadNotified();
  const next = fn(log);
  if (next !== log) await saveNotified(next);
}

export const applyClicked = (email, productId, whenISO = new Date().toISOString()) =>
  applyMark((log) => markClicked(log, email, productId, whenISO));
export const applyNudged = (email, productId, whenISO = new Date().toISOString()) =>
  applyMark((log) => markNudged(log, email, productId, whenISO));
export const applyUnsubscribed = (email, productId) =>
  applyMark((log) => markUnsubscribed(log, email, productId));
```

- [ ] **Step 3: Verify the module loads and the pure suite still passes**

Run: `node --check notified.mjs && node notified.test.mjs`
Expected: no syntax error; PASS. (The I/O functions need a store, so they're exercised live in Task 8's manual check, not unit-tested — same convention as `state.mjs`.)

- [ ] **Step 4: Commit**

```bash
git add notified.mjs
git commit -m "Notified log metafield I/O (load/save/record/apply*)"
```

---

### Task 3: `trackUrl` helper in `waitlist.mjs`

**Files:**
- Modify: `waitlist.mjs` (add `trackUrl` next to `unsubUrl`, ~line 120)
- Modify: `waitlist.test.mjs` (add a `--- trackUrl ---` block before the final summary)

**Interfaces:**
- Consumes: existing `signUnsub`, `unsubSecret` in `waitlist.mjs`.
- Produces: `trackUrl(base, productShortId, email, relPath) -> string` — a signed `/api/unsubscribe?click=1&product=&email=&sig=&to=` URL. Reuses the `product:email` HMAC (same sig as `unsubUrl`).

- [ ] **Step 1: Write the failing test**

In `waitlist.test.mjs`, change the import line to also import `trackUrl` and `unsubSecret`:

```js
import { addEmail, removeEmail, signUnsub, verifyUnsub, partitionByStock, trackUrl, unsubSecret } from './waitlist.mjs';
```

Then, immediately before the final `console.log(\`\n${failures ? 'FAILED' ...` summary line, add:

```js
console.log('\n--- trackUrl ---');
const tu = new URL(trackUrl('https://app.test', '123', 'a@x.com', '/cart/999:1'));
ok('targets the unsubscribe endpoint', tu.pathname === '/api/unsubscribe');
ok('sets the click flag', tu.searchParams.get('click') === '1');
ok('carries the product id', tu.searchParams.get('product') === '123');
ok('carries the email', tu.searchParams.get('email') === 'a@x.com');
ok('carries the relative destination', tu.searchParams.get('to') === '/cart/999:1');
ok('signs with the unsubscribe HMAC', tu.searchParams.get('sig') === signUnsub('123', 'a@x.com', unsubSecret()));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node waitlist.test.mjs`
Expected: FAIL — `trackUrl is not a function` (or import error).

- [ ] **Step 3: Write minimal implementation**

In `waitlist.mjs`, directly after the `unsubUrl` function (ends ~line 120), add:

```js
/** A signed, tracked redirect URL for the back-in-stock email links. Reuses the
 *  unsubscribe HMAC (product:email); `relPath` is a storefront-relative path
 *  ("/cart/<vid>:1" or "/products/<handle>") the redirect validates before use. */
export function trackUrl(base, productShortId, email, relPath) {
  const root = base || process.env.PUBLIC_URL || 'https://oos-sorter.vercel.app';
  const u = new URL('/api/unsubscribe', root);
  u.searchParams.set('click', '1');
  u.searchParams.set('product', String(productShortId));
  u.searchParams.set('email', email);
  u.searchParams.set('sig', signUnsub(productShortId, email, unsubSecret()));
  u.searchParams.set('to', relPath);
  return u.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node waitlist.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add waitlist.mjs waitlist.test.mjs
git commit -m "waitlist: trackUrl helper (signed tracked-redirect link)"
```

---

### Task 4: Tracked links + nudge email in `notify.mjs`

**Files:**
- Modify: `notify.mjs` (`buildBackInStock` uses tracked URLs when present; add `buildRestockEmail`, `buildNudge`, `sendNudge`)
- Modify: `notify.test.mjs` (import `buildNudge`; add tracked-link + nudge assertions)

**Interfaces:**
- Consumes: existing `notify.mjs` internals (`esc`, `SHOP`, `APP_NAME`, `ACCENT`, `transport`).
- Produces:
  - `buildBackInStock(product, unsub)` — unchanged signature; now honors optional `product.clickCartUrl` / `product.clickProductUrl`.
  - `buildNudge(product, unsub) -> {subject, text, html}` — "still available" variant, same optional tracked-URL support.
  - `sendNudge(email, product, unsub, {dryRun}) -> Promise` — sends `buildNudge` output.

- [ ] **Step 1: Write the failing test**

In `notify.test.mjs`, change the dynamic import to include `buildNudge`:

```js
const { buildBackInStock, buildSoldOutAlert, buildNudge } = await import('./notify.mjs');
```

Then, immediately before the final summary line, add:

```js
console.log('--- buildBackInStock: tracked links ---');
const tracked = buildBackInStock(
  { title: 'Chef Knife', handle: 'chef-knife', variantId: '999', clickCartUrl: 'https://app.test/t?to=cart', clickProductUrl: 'https://app.test/t?to=prod' },
  unsub
);
ok('uses the tracked cart url', tracked.html.includes('href="https://app.test/t?to=cart"'));
ok('drops the raw cart permalink when tracked', !tracked.html.includes('/cart/999:1'));
ok('uses the tracked product url', tracked.html.includes('https://app.test/t?to=prod'));

console.log('--- buildNudge ---');
const nudge = buildNudge({ title: 'Widget', handle: 'widget' }, unsub);
ok('nudge subject', nudge.subject === 'Still available: Widget');
ok('nudge eyebrow', nudge.html.includes('Still available'));
ok('nudge keeps the unsubscribe link', nudge.text.includes(unsub));
ok('nudge falls back to product url', nudge.html.includes('https://demo.myshopify.com/products/widget'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node notify.test.mjs`
Expected: FAIL — `buildNudge is not a function` and the tracked-link asserts fail.

- [ ] **Step 3: Refactor `buildBackInStock` into a shared builder + add `buildNudge`**

In `notify.mjs`, replace the whole `buildBackInStock` function (currently ~lines 249–293) with a shared `buildRestockEmail` plus two thin wrappers. Keep the existing image/button/footer markup **verbatim** — only the four parameterized values (`eyebrow`, `subject`, the lead sentence, the plain-text intro line) and the two URL fallbacks change:

```js
/** Shared builder for the two single-product restock emails (back-in-stock and
 *  the follow-up nudge). `opts` supplies the only differences: eyebrow label,
 *  subject text, the HTML lead sentence, and the plain-text intro line. */
function buildRestockEmail(product, unsub, { eyebrow, subject, leadHtml, introText }) {
  const title = product.title ?? 'Your item';
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const productUrl = product.clickProductUrl
    || (product.handle && SHOP ? `https://${SHOP}/products/${product.handle}` : (SHOP ? `https://${SHOP}` : '#'));
  const cartUrl = product.clickCartUrl
    || (product.variantId && SHOP ? `https://${SHOP}/cart/${product.variantId}:1` : productUrl);
  const text =
    `${introText}\n\n` +
    `Add it to your cart: ${cartUrl}\n` +
    `Or view the product: ${productUrl}\n\n— ${APP_NAME}\n\n` +
    `Don't want these emails? Unsubscribe: ${unsub}`;
  const imageBlock = product.image
    ? `<tr><td style="padding:0 24px 4px" align="center">
         <a href="${esc(cartUrl)}"><img src="${esc(product.image)}" alt="${esc(title)}" width="512" style="width:100%;max-width:512px;height:auto;border-radius:12px;border:1px solid #eef1f6;display:block"></a>
       </td></tr>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#eef1f6">
  <div style="background:#eef1f6;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:#fff;border:1px solid #e4e8ef;border-radius:16px;overflow:hidden">
        <tr><td style="padding:24px 24px 12px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:${ACCENT};text-transform:uppercase">${esc(eyebrow)}</div>
          <div style="font-size:20px;font-weight:700;color:#161b22;margin:8px 0 6px">${esc(title)}</div>
          ${variant ? `<div style="font-size:13px;color:#5f6875;margin:-2px 0 6px">Option: <strong style="color:#161b22">${esc(variant)}</strong></div>` : ''}
          <div style="font-size:14px;color:#5f6875;line-height:1.5">${leadHtml}</div>
        </td></tr>
        ${imageBlock}
        <tr><td style="padding:16px 24px 24px">
          <a href="${esc(cartUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px">Add to Cart</a>
          <a href="${esc(productUrl)}" style="display:inline-block;margin-left:6px;color:${ACCENT};text-decoration:none;font-size:14px;font-weight:600;padding:12px 10px">View product</a>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #eef1f6;font-size:11px;color:#8b95a3;line-height:1.5">
          You asked ${esc(APP_NAME)} to notify you when this came back. <a href="${esc(unsub)}" style="color:#8b95a3">Unsubscribe</a>.
        </td></tr>
      </table>
    </td></tr></table>
  </div></body></html>`;
  return { subject, text, html };
}

/** Pure: build a single-product "back in stock" email for one shopper. */
export function buildBackInStock(product, unsub) {
  const title = product.title ?? 'Your item';
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const named = variant ? `${title} — ${variant}` : title;
  return buildRestockEmail(product, unsub, {
    eyebrow: 'Back in stock',
    subject: `${named} is back in stock`,
    leadHtml: `It's available again on ${esc(SHOP)}. Grab it before it sells out.`,
    introText: `Good news! "${named}" is available again on ${SHOP}.`,
  });
}

/** Pure: build the one-shot follow-up "still available" nudge for one shopper. */
export function buildNudge(product, unsub) {
  const title = product.title ?? 'Your item';
  const variant = product.variantTitle && product.variantTitle !== 'Default Title' ? product.variantTitle : null;
  const named = variant ? `${title} — ${variant}` : title;
  return buildRestockEmail(product, unsub, {
    eyebrow: 'Still available',
    subject: `Still available: ${named}`,
    leadHtml: `Still in stock on ${esc(SHOP)} — don't miss it before it's gone again.`,
    introText: `Still in stock: "${named}" is available on ${SHOP}.`,
  });
}
```

- [ ] **Step 4: Add `sendNudge` next to `sendBackInStock`**

At the end of `notify.mjs` (after `sendBackInStock`), add:

```js
/** Send a one-shot "still available" nudge to a single shopper. */
export async function sendNudge(email, product, unsub, { dryRun } = {}) {
  const { subject, text, html } = buildNudge(product, unsub);
  if (dryRun) {
    console.log(`  [dry run] would nudge ${email}: "${subject}"`);
    return { dryRun: true };
  }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set for nudge emails');
  const info = await transport(user, pass).sendMail({ from: `${APP_NAME} <${user}>`, to: email, subject, text, html });
  console.log(`  nudged ${email}: "${subject}" (${info.messageId})`);
  return info;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node notify.test.mjs`
Expected: PASS — existing back-in-stock asserts still green (fallback URLs unchanged) **and** the new tracked-link + nudge asserts pass.

- [ ] **Step 6: Commit**

```bash
git add notify.mjs notify.test.mjs
git commit -m "notify: tracked email links + one-shot nudge email"
```

---

### Task 5: Record a log row on every back-in-stock send

**Files:**
- Modify: `restock.mjs` (`emailAndPrune` — build tracked URLs into the payload and `recordNotified` after the send loop)

**Interfaces:**
- Consumes: `notifiedRow`, `recordNotified` from `notified.mjs`; `trackUrl` from `waitlist.mjs`.
- Produces: no new exports. `emailAndPrune` now (a) deep-links via tracked URLs and (b) appends a log row per successful send. Used by `notifyRestocks`, `notifyRestocksForProducts`, and `notifyOneProduct` (manual "Send now"), so all three record.

- [ ] **Step 1: Add imports to `restock.mjs`**

Extend the existing waitlist import and add the notified import:

```js
import { readWaitlist, clearWaitlist, setWaitlist, unsubUrl, trackUrl, partitionByStock } from './waitlist.mjs';
import { notifiedRow, recordNotified } from './notified.mjs';
```

- [ ] **Step 2: Rewrite the send loop + prune in `emailAndPrune`**

Replace the body of `emailAndPrune` (the `for (const sub of due)` loop through the `bumpNotified` call) with:

```js
  let sent = 0;
  const failed = [];
  const rows = [];
  const short = shortId(gid);

  for (const sub of due) {
    const variantId = sub.variantId || fallbackVariantId;
    const relCart = variantId ? `/cart/${variantId}:1` : (product.handle ? `/products/${product.handle}` : '/');
    const relProduct = product.handle ? `/products/${product.handle}` : '/';
    const payload = {
      ...product,
      variantId,
      variantTitle: sub.variantTitle || null,
      clickCartUrl: trackUrl(base, short, sub.email, relCart),
      clickProductUrl: trackUrl(base, short, sub.email, relProduct),
    };
    try {
      await sendBackInStock(sub.email, payload, unsubUrl(base, short, sub.email), { dryRun });
      sent++;
      rows.push(notifiedRow({ email: sub.email, productId: short, title: product.title, variantId, variantTitle: sub.variantTitle || null }));
    } catch (e) {
      console.error(`  ! back-in-stock email to ${sub.email} failed: ${e.message}`);
      failed.push(sub); // keep them so they retry next run
    }
  }

  if (!dryRun) {
    const keep = [...waiting, ...failed];
    if (keep.length === list.length) {
      /* nothing changed — skip the write */
    } else if (keep.length) {
      await setWaitlist(gid, keep);
    } else {
      await clearWaitlist(gid);
    }
    await bumpNotified(sent); // cumulative "notified so far" stat (no-op when sent === 0)
    try {
      await recordNotified(rows); // detailed log; best-effort, never breaks the send/prune
    } catch (e) {
      console.error(`  ! notified-log write failed: ${e.message}`);
    }
  }

  return sent;
```

- [ ] **Step 3: Verify the module loads and the suite is green**

Run: `node --check restock.mjs && npm test`
Expected: no syntax error; PASS. (`emailAndPrune` itself needs a store; it's exercised live in Task 8's manual DRY_RUN check. Its new pure pieces — `notifiedRow`, `trackUrl` — are already unit-tested.)

- [ ] **Step 4: Commit**

```bash
git add restock.mjs
git commit -m "restock: record a notified-log row + tracked links on each send"
```

---

### Task 6: Click tracking + unsubscribe flagging in `api/unsubscribe.mjs`

**Files:**
- Modify: `api/unsubscribe.mjs` (add a `click` branch that 302-redirects; flag the log on unsubscribe)

**Interfaces:**
- Consumes: `verifyUnsub`, `unsubscribe`, `unsubSecret` (existing); `safeRelPath`, `applyClicked`, `applyUnsubscribed` from `notified.mjs`.
- Produces: no new export. `GET /api/unsubscribe?click=1&product=&email=&sig=&to=` marks the click and 302s to the shop; the plain unsubscribe path additionally flags the log.

- [ ] **Step 1: Add imports**

At the top of `api/unsubscribe.mjs`, add:

```js
import { safeRelPath, applyClicked, applyUnsubscribed } from '../notified.mjs';
```

- [ ] **Step 2: Add the click branch at the start of the handler**

Inside `handler`, immediately after `const sig = String(q.sig || '');` (and before the `res.setHeader('Content-Type', 'text/html'...)` line), add:

```js
  // Tracked click redirect: mark the click, then 302 to the storefront. Never
  // errors — a bad/forged link just lands on the shop home and records nothing.
  if (String(q.click || '') === '1') {
    const shop = process.env.SHOP_DOMAIN;
    const rel = safeRelPath(q.to);
    const dest = rel && shop ? `https://${shop}${rel}` : (shop ? `https://${shop}` : '/');
    if (product && email && sig && verifyUnsub(product, email, sig, unsubSecret())) {
      try { await applyClicked(email, product); } catch (e) { console.error('click log failed:', e.message); }
    }
    res.statusCode = 302;
    res.setHeader('Location', dest);
    res.end();
    return;
  }
```

- [ ] **Step 3: Flag the log on a successful unsubscribe**

In the existing success branch, replace:

```js
    await unsubscribe(longId(product.replace(/\D/g, '')), email);
    res.end(page('Unsubscribed', `You won&rsquo;t get back-in-stock emails for this product anymore.`));
```

with:

```js
    await unsubscribe(longId(product.replace(/\D/g, '')), email);
    try { await applyUnsubscribed(email, product); } catch (e) { console.error('unsub log flag failed:', e.message); }
    res.end(page('Unsubscribed', `You won&rsquo;t get back-in-stock emails for this product anymore.`));
```

- [ ] **Step 4: Verify the module loads**

Run: `node --check api/unsubscribe.mjs && npm test`
Expected: no syntax error; suite PASS (the security core, `safeRelPath`, is covered by Task 1).

- [ ] **Step 5: Commit**

```bash
git add api/unsubscribe.mjs
git commit -m "unsubscribe endpoint: click-tracking redirect + nudge suppression flag"
```

---

### Task 7: Manual Resend (stock-gated)

**Files:**
- Modify: `restock.mjs` (add `resendOne`)
- Modify: `api/waitlists.mjs` (POST `action:'resend'`)

**Interfaces:**
- Consumes: `fetchProductsByIds` (catalog), `isInStock`/`isVariantInStock` (stock), `shortId`/`longId` (shopify), `trackUrl`/`unsubUrl` (waitlist), `applyNudged` (notified), `sendBackInStock` (notify).
- Produces: `resendOne(productGid, email, {variantId?, base?, dryRun?}) -> Promise<{sent, soldOut}>`. Sends **only if in stock now**; otherwise `{sent:0, soldOut:true}`. On send, sets the row's nudge slot so the auto-nudge won't double-hit.

- [ ] **Step 1: Add `isVariantInStock` + `applyNudged` imports to `restock.mjs`**

Ensure the stock import includes both and add the notified import:

```js
import { isInStock, isVariantInStock } from './stock.mjs';
import { notifiedRow, recordNotified, applyNudged } from './notified.mjs';
```

- [ ] **Step 2: Add `resendOne` to `restock.mjs`**

After `notifyOneProduct`, add:

```js
/**
 * Manually re-send the back-in-stock email to ONE shopper (dashboard "Resend").
 * Guarded on current stock: if the product (or the shopper's variant) is sold out
 * again it sends nothing and reports soldOut, so we never tell a shopper "it's
 * back" when it isn't. Consumes the row's one nudge slot so the auto-nudge won't
 * also fire. @returns {{sent:number, soldOut:boolean}}
 */
export async function resendOne(productGid, email, { variantId = null, base = null, dryRun = false } = {}) {
  const short = shortId(productGid);
  const [sp] = await fetchProductsByIds([short]);
  if (!sp) return { sent: 0, soldOut: true };

  const vWant = variantId ? String(variantId).replace(/\D/g, '') : null;
  const inStock = vWant ? isVariantInStock(sp, vWant) : isInStock(sp);
  if (!inStock) return { sent: 0, soldOut: true };

  const first = sp.variants?.nodes?.[0];
  const vId = vWant || (first?.id ? shortId(first.id) : null);
  const relCart = vId ? `/cart/${vId}:1` : (sp.handle ? `/products/${sp.handle}` : '/');
  const relProduct = sp.handle ? `/products/${sp.handle}` : '/';
  const payload = {
    title: sp.title,
    handle: sp.handle,
    image: sp.featuredImage?.url || null,
    variantId: vId,
    variantTitle: null,
    clickCartUrl: trackUrl(base, short, email, relCart),
    clickProductUrl: trackUrl(base, short, email, relProduct),
  };

  if (!dryRun) {
    await sendBackInStock(email, payload, unsubUrl(base, short, email), { dryRun: false });
    try { await applyNudged(email, short); } catch (e) { console.error('resend nudge-flag failed:', e.message); }
  }
  return { sent: 1, soldOut: false };
}
```

- [ ] **Step 3: Add the `resend` action to `api/waitlists.mjs` POST**

Import `resendOne`:

```js
import { productsWithWaitlist, notifyOneProduct, resendOne } from '../restock.mjs';
```

Inside the POST `try` block, immediately after the `emailReport` branch, add:

```js
      // Re-send the back-in-stock email to one shopper (dashboard "Resend"),
      // only if the product is in stock right now.
      if (body.action === 'resend') {
        const s = String(body.productId || '');
        const num = s.replace(/\D/g, '');
        const gid = s.startsWith('gid://') ? s : (num ? longId(num) : null);
        if (!gid || !body.email) { res.end(JSON.stringify({ ok: false, error: 'Missing product or email.' })); return; }
        const r = await resendOne(gid, String(body.email), { variantId: body.variantId || null });
        if (r.soldOut) { res.end(JSON.stringify({ ok: false, soldOut: true, error: 'Sold out again — nothing sent.' })); return; }
        res.end(JSON.stringify({ ok: true, sent: r.sent }));
        return;
      }
```

- [ ] **Step 4: Verify modules load and suite is green**

Run: `node --check restock.mjs && node --check api/waitlists.mjs && npm test`
Expected: no syntax errors; PASS.

- [ ] **Step 5: Commit**

```bash
git add restock.mjs api/waitlists.mjs
git commit -m "Manual Resend action, gated on current stock"
```

---

### Task 8: Dashboard — stats + "Recently notified" table + Resend buttons

**Files:**
- Modify: `api/waitlists.mjs` (GET: load the log, add stats + a "Recently notified" section with status chips, per-row Resend, and a current-stock fetch)

**Interfaces:**
- Consumes: `loadNotified`, `deriveStats` (notified); existing `fetchProductsByIds`, `isInStock`, `shortId`, `statCard`, `esc`.
- Produces: no new export. Renders up to the 100 most-recent log rows, each with a status chip and a Resend button disabled when the product is sold out now.

- [ ] **Step 1: Add imports + isInStock to `api/waitlists.mjs`**

Extend the stock/notified imports:

```js
import { isInStock, isVariantInStock } from '../stock.mjs';
import { loadNotified, deriveStats } from '../notified.mjs';
```

- [ ] **Step 2: Load the log + current stock in the GET handler**

In the GET section, replace the existing `const [items, state] = await Promise.all([...])` block with:

```js
  const [items, state, notifiedLog] = await Promise.all([
    productsWithWaitlist().catch(() => []),
    loadState().catch(() => ({})),
    loadNotified().catch(() => []),
  ]);
  const recent = notifiedLog.slice(0, 100);
  const stats = deriveStats(notifiedLog);

  // Current stock for the distinct products shown, so Resend is only offered when
  // the product is actually available now (mirrors the server-side guard).
  const recentIds = [...new Set(recent.map((r) => r.p))];
  let stockById = new Map();
  if (recentIds.length) {
    try {
      const prods = await fetchProductsByIds(recentIds);
      stockById = new Map(prods.map((p) => [shortId(p.id), p]));
    } catch { /* leave stock unknown -> Resend disabled, never blocks the page */ }
  }
```

- [ ] **Step 3: Replace the stat cards to use the log**

Replace the existing `notified`/`restocked` derivation and the third stat card. After the `const total = ...` line, remove the old `const notified = state.waitlistNotified || 0;` / `const restocked = ...` lines and rely on `stats`. Then change the stat-card grid (around the `statCard({ value: notified, ... })` line) to:

```js
  <div class="grid c3" style="margin-bottom:16px">
    ${statCard({ value: items.length, label: 'Products with a waitlist' })}
    ${statCard({ value: total, label: 'Shoppers waiting' })}
    ${statCard({ value: stats.notified, label: 'Notified (recent)', sub: `${stats.clicked} clicked · ${stats.clickRate}% · ${stats.nudged} nudged`, tone: stats.clicked ? 'pos' : '' })}
  </div>
```

- [ ] **Step 4: Add helper renderers before the `cards` variable**

Just above the existing `const cards = ...` assignment, add:

```js
  const chip = (bg, fg, label) =>
    `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};white-space:nowrap">${label}</span>`;
  const statusChip = (r) => {
    if (r.o) return chip('#e7f6ee', '#0e7a4b', 'Ordered');
    if (r.u) return chip('#eef1f6', '#8b95a3', 'Unsubscribed');
    if (r.c) return chip('#e7f6ee', '#0e7a4b', 'Clicked');
    if (r.n) return chip('#fff3e0', '#a15c00', 'Nudged');
    return chip('#eef1f6', '#5f6875', 'Notified');
  };
  const inStockNow = (r) => {
    const sp = stockById.get(r.p);
    if (!sp) return false;
    return r.v ? isVariantInStock(sp, r.v) : isInStock(sp);
  };
  const resendCell = (r) => {
    if (r.u) return `<span class="faint" style="font-size:12px">—</span>`;
    if (!inStockNow(r)) return `<span class="faint" style="font-size:12px">Sold out again</span>`;
    return `<button class="ghost resend" data-id="${esc(r.p)}" data-email="${esc(r.e)}" data-variant="${esc(r.v || '')}">Resend</button>`;
  };
  const vName = (r) => (r.vt && r.vt !== 'Default Title') ? esc(r.vt) : (r.v ? `#${esc(r.v)}` : '&mdash;');
  const recentRows = recent.length
    ? recent.map((r) => `<tr>
        <td class="mono">${esc(r.e)}</td>
        <td>${esc(r.t)}</td>
        <td>${vName(r)}</td>
        <td class="num">${fmt(r.ts)}</td>
        <td>${statusChip(r)}</td>
        <td>${resendCell(r)}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="faint">No one has been notified yet.</td></tr>`;
```

(`fmt` and `esc` already exist in this file.)

- [ ] **Step 5: Render the "Recently notified" section in the page body**

In the `body` template string, immediately after the `${cards}` interpolation, add:

```js
  <div class="pagehead" style="margin-top:26px"><h2 style="font-size:16px;margin:0 0 2px">Recently notified</h2><p style="margin:0">Who we emailed when a product came back — whether they clicked through, and resend if they missed it.</p></div>
  <div class="card pad">
    <table>
      <thead><tr><th>Email</th><th>Product</th><th>Variant</th><th class="num">Notified</th><th>Status</th><th></th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table>
  </div>
```

- [ ] **Step 6: Add the Resend click handler to the page script**

Inside the existing `<script>` block (after the `.send` buttons handler, before `</script>`), add:

```js
    document.querySelectorAll('.resend').forEach(function(b){
      b.addEventListener('click', async function(){
        if(!embedded){ var p=(pw.value||'').trim(); if(!p){ msg.textContent='Enter the panel password'; pw.focus(); return; } }
        b.disabled=true; var old=b.textContent; b.textContent='Sending\\u2026';
        var body={action:'resend',productId:b.dataset.id,email:b.dataset.email};
        if(b.dataset.variant) body.variantId=b.dataset.variant;
        var r=await fetch('/api/waitlists',{method:'POST',headers:await authH(),body:JSON.stringify(body)});
        var j=await r.json().catch(function(){return{};});
        if(r.ok&&j.ok){ if(!embedded){ try{localStorage.setItem('oos_pw',(pw.value||'').trim());}catch(e){} } b.textContent='Sent \\u2713'; }
        else { b.textContent=old; b.disabled=false; msg.textContent=(j.soldOut?'Sold out again — nothing sent':(r.status===401?(embedded?'Not authorized':'Wrong password'):(j.error||'Could not resend'))); }
      });
    });
```

- [ ] **Step 7: Verify the module loads + live smoke**

Run: `node --check api/waitlists.mjs && npm test`
Expected: no syntax error; suite PASS.

Then a live read-only smoke (requires `.env`):
Run: `node --env-file=.env -e "import('./notified.mjs').then(async m=>{const l=await m.loadNotified();console.log('rows',l.length, m.deriveStats(l));})"`
Expected: prints a row count + stats object without throwing (0 rows is fine on a store that hasn't notified since deploy).

- [ ] **Step 8: Commit**

```bash
git add api/waitlists.mjs
git commit -m "Waitlists dashboard: engagement stats + Recently notified table with Resend"
```

---

### Task 9: Auto-nudge in the `/api/run` full pass

**Files:**
- Modify: `restock.mjs` (add `nudgeUnengaged`)
- Modify: `sort-oos.mjs` (call it in Phase 3.5, full runs only; resolve `nudgeDays`)

**Interfaces:**
- Consumes: `loadNotified`, `selectNudges`, `applyNudged` (notified); `fetchProductsByIds`, `isInStock`, `shortId`, `trackUrl`, `unsubUrl`, `sendNudge`.
- Produces: `nudgeUnengaged({dryRun?, base?, days?}) -> Promise<{nudged}>`. One-shot follow-up to un-engaged rows past the window whose product is in stock now.

- [ ] **Step 1: Add `sendNudge` + notified selection imports to `restock.mjs`**

Extend the notify import and the notified import:

```js
import { sendBackInStock, sendSoldOutAlert, sendNudge } from './notify.mjs';
import { notifiedRow, recordNotified, applyNudged, loadNotified, selectNudges } from './notified.mjs';
```

- [ ] **Step 2: Add `nudgeUnengaged` to `restock.mjs`**

After `resendOne`, add:

```js
/**
 * One-shot follow-up: nudge shoppers who were notified >= `days` ago but haven't
 * clicked/ordered and haven't already been nudged, for products still in stock.
 * Full runs only (scans the whole log). Idempotent — once a row's nudge slot is
 * set it never re-qualifies. @returns {{nudged:number}}
 */
export async function nudgeUnengaged({ dryRun = false, base = null, days = 2 } = {}) {
  const log = await loadNotified();
  const now = new Date().toISOString();
  // Cheap pre-filter (state + window) before spending a stock fetch.
  const windowed = selectNudges(log, now, days, () => true);
  if (!windowed.length) return { nudged: 0 };

  const ids = [...new Set(windowed.map((x) => x.p))];
  const stock = await fetchProductsByIds(ids);
  const spById = new Map(stock.map((p) => [shortId(p.id), p]));
  const due = selectNudges(log, now, days, (p) => {
    const sp = spById.get(p);
    return sp ? isInStock(sp) : false;
  });

  let nudged = 0;
  for (const row of due) {
    const sp = spById.get(row.p);
    const relCart = row.v ? `/cart/${row.v}:1` : (sp?.handle ? `/products/${sp.handle}` : '/');
    const relProduct = sp?.handle ? `/products/${sp.handle}` : '/';
    const payload = {
      title: row.t,
      handle: sp?.handle,
      image: sp?.featuredImage?.url || null,
      variantId: row.v,
      variantTitle: row.vt,
      clickCartUrl: trackUrl(base, row.p, row.e, relCart),
      clickProductUrl: trackUrl(base, row.p, row.e, relProduct),
    };
    try {
      await sendNudge(row.e, payload, unsubUrl(base, row.p, row.e), { dryRun });
      if (!dryRun) await applyNudged(row.e, row.p, now);
      nudged++;
    } catch (e) {
      console.error(`  ! nudge email to ${row.e} failed: ${e.message}`);
    }
  }
  return { nudged };
}
```

- [ ] **Step 3: Wire it into `sort-oos.mjs` Phase 3.5**

Extend the restock import:

```js
import { notifyRestocks, nudgeUnengaged } from './restock.mjs';
```

Then, inside the `if (FEATURE_WAITLIST && !only) { ... }` block (Phase 3.5), after the existing `notifyRestocks` reporting, add:

```js
    const nudgeDays = Number.isFinite(settings.nudgeDays) ? settings.nudgeDays : Number(process.env.NUDGE_DAYS) || 2;
    const nu = await nudgeUnengaged({ dryRun: DRY_RUN, days: nudgeDays });
    if (nu.nudged) {
      console.log(`Nudge: ${DRY_RUN ? 'would nudge' : 'nudged'} ${nu.nudged} un-engaged shopper(s)`);
    }
```

(`settings` is already in scope in `runEngine`; `settings.nudgeDays` arrives in Task 10 and is simply absent — falling back to env/2 — until then.)

- [ ] **Step 4: Verify modules load + suite green**

Run: `node --check restock.mjs && node --check sort-oos.mjs && npm test`
Expected: no syntax errors; PASS. (`selectNudges` — the nudge gate — is covered by Task 1.)

- [ ] **Step 5: Commit**

```bash
git add restock.mjs sort-oos.mjs
git commit -m "Auto-nudge un-engaged shoppers in the /api/run full pass"
```

---

### Task 10: `nudgeDays` setting (schema + form)

**Files:**
- Modify: `settings.mjs` (`normalizeSettings` — clamp `nudgeDays`; add `clampInt`)
- Modify: `panel.mjs` (`settingsBody` — a numeric field + include it in the save body)
- Modify: `panel.test.mjs` (extend the `base` fixture; assert the field renders)

**Interfaces:**
- Consumes: existing settings I/O.
- Produces: `settings.nudgeDays` (integer 1–14, default 2) available to `runEngine` (Task 9 already reads it). `api/settings.mjs` needs **no change** — its POST already calls `normalizeSettings(body)` on the whole body, so `nudgeDays` flows through.

- [ ] **Step 1: Write the failing test**

`panel.test.mjs` uses an `eq(label, got, want)` harness (there is no `ok` in that file). It also asserts the **full** `normalizeSettings` object against a `base` fixture, so adding a key there requires updating the fixture.

First, in `panel.test.mjs`, add `nudgeDays: 2` to the `base` fixture object (currently `const base = { sort: false, ... sheetWebhook: '' };`) so it becomes:

```js
const base = { sort: false, notify: false, draft: false, waitlist: false, monitor: false, notifyEmails: E, slackWebhook: '', monitorSlackWebhook: '', sheetWebhook: '', nudgeDays: 2 };
```

Then, before that file's final summary line, add (using the file's own `eq` helper):

```js
console.log('\n--- nudgeDays ---');
eq('clamps + defaults nudgeDays', normalizeSettings({ nudgeDays: 99 }).nudgeDays, 14);
eq('defaults missing nudgeDays to 2', normalizeSettings({}).nudgeDays, 2);
const withNudge = settingsBody({ waitlist: true, nudgeDays: 3 });
eq('renders the nudge-days input', withNudge.includes('id="nudgeDays"'), true);
eq('shows the saved value', withNudge.includes('value="3"'), true);
```

(`settingsBody` is already imported in `panel.test.mjs`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node panel.test.mjs`
Expected: FAIL — the field isn't rendered yet.

- [ ] **Step 3: Clamp `nudgeDays` in `settings.mjs`**

In `normalizeSettings` (the returned object in `settings.mjs`), add a `nudgeDays` line:

```js
    sheetWebhook: normalizeSheetWebhook(o.sheetWebhook),
    nudgeDays: clampInt(o.nudgeDays, 2, 1, 14),
```

And add this pure helper near the top of `settings.mjs` (after the `EMAIL_RE` line):

```js
/** Pure: coerce to an integer within [min,max], falling back to `def`. */
export function clampInt(v, def, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
```

- [ ] **Step 4: Render the field in `panel.mjs`**

In `settingsBody`, add `const nudgeDays = Number.isFinite(settings.nudgeDays) ? settings.nudgeDays : 2;` near the other `const` reads, then add this block inside the waitlist Slack card (after the `slack` input's closing `</div>` for that card, i.e. right after the back-in-stock Slack card):

```js
  <div class="card pad" style="margin-top:14px">
    <label class="rowtitle" for="nudgeDays">Back-in-stock nudge delay</label>
    <p class="rowdesc" style="margin:3px 0 9px">If a notified shopper hasn't clicked or ordered after this many days and the product is still in stock, send one automatic follow-up. Range 1–14 days.</p>
    <input id="nudgeDays" type="number" min="1" max="14" value="${nudgeDays}" style="width:90px;box-sizing:border-box;font:13px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
  </div>
```

Then, in the form-submit handler's `body` object, add `nudgeDays`:

```js
      var body={ sort:sort.checked, notify:notify.checked, draft:draft.checked, waitlist:waitlist.checked, monitor:monitor.checked, notifyEmails:document.getElementById('recips').value, slackWebhook:document.getElementById('slack').value, monitorSlackWebhook:document.getElementById('monitorSlack').value, sheetWebhook:document.getElementById('sheet').value, nudgeDays:document.getElementById('nudgeDays').value };
```

- [ ] **Step 5: Confirm `api/settings.mjs` needs no change**

Open `api/settings.mjs` and confirm the POST handler does `const settings = normalizeSettings(body);` (it passes the whole body). Because `nudgeDays` is now normalized, it persists with no edit here. No change to make.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node panel.test.mjs && npm test`
Expected: PASS (including the updated `base` fixture and the new nudgeDays assertions).

- [ ] **Step 7: Commit**

```bash
git add settings.mjs panel.mjs panel.test.mjs
git commit -m "Settings: configurable back-in-stock nudge delay (1-14 days, default 2)"
```

---

## After all tasks

- Run the full suite once more: `npm test` — all green.
- Optional live DRY_RUN of the engine (reads only, no writes when `DRY_RUN=true`):
  `node --env-file=.env sort-oos.mjs` with `DRY_RUN=true` and `FEATURE_WAITLIST=true` in `.env`, to confirm the nudge pass runs without error.
- Deploy note: this adds **zero** `api/` files, so the Vercel function count stays at 12. Confirm the deploy shows ● Ready, not ● Error, after pushing.
- Then use **superpowers:finishing-a-development-branch** to merge/PR `feat/waitlist-notified-log`.

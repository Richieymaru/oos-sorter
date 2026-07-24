# OOS Sorter Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected web page (on Vercel) that turns the three OOS Sorter features on/off, shows status, and can email the sold-out list on demand — driving the existing engine through a shop metafield.

**Architecture:** The page is a thin control panel. Three Vercel serverless functions (`/api/*`) read/write a new shop metafield `oos_sort.settings`; the existing engine reads that metafield each run instead of env flags. All heavy logic reuses the modules already built and tested (`shopify`, `state`, `stock`, `notify`, `report`). Pure logic (auth check, HTML render, settings normalization) is isolated and unit-tested offline; metafield and email paths are verified live against the dev store.

**Tech Stack:** Node ESM (20.6+), no web framework, Vercel serverless functions, nodemailer (already present), Shopify Admin GraphQL. Basic Auth for the page.

## Global Constraints

- Node ESM only, `>=20.6`. Every module is `.mjs`, `import`/`export`, top-level `await` allowed.
- No new dependencies beyond the existing `nodemailer`. No web framework.
- Secrets NEVER in code. `PANEL_PASSWORD`, `CLIENT_ID`, `CLIENT_SECRET`, `GMAIL_*`, `NOTIFY_EMAIL` come from env only. `.env` stays gitignored.
- The three feature toggles default to **`false`** when `oos_sort.settings` is absent.
- The metafield `oos_sort.settings` is the production source of truth for the toggles; an explicitly-set `FEATURE_*` env var overrides it (for local testing) only when present.
- Pure functions stay import-only and offline-testable; run them with `node <file>.test.mjs` (no env, no network). Live checks run with `node --env-file=.env <script>`.
- Windows/PowerShell shell. Use `node --env-file=.env` for anything touching the store. Prefer Node over shell one-liners.
- Metafield namespace/key constants: namespace `oos_sort`, settings key `settings`, state key `state`, base-order key `base_order`.

---

### Task 1: Add `lastRun` to shop state

**Files:**
- Modify: `state.mjs`

**Interfaces:**
- Consumes: existing `state.mjs` (`loadState`, `saveState`).
- Produces: state shape now includes `lastRun: string|null` (ISO timestamp), round-tripped by `loadState`/`saveState`.

- [ ] **Step 1: Update the empty-state factory and save serialization**

In `state.mjs`, change the `EMPTY` factory and the `saveState` value object to include `lastRun`.

```js
const EMPTY = () => ({ soldOut: [], drafted: [], pending: [], lastDigest: null, lastRun: null });
```

And in `saveState`, extend the serialized object:

```js
  const value = JSON.stringify({
    soldOut: state.soldOut ?? [],
    drafted: state.drafted ?? [],
    pending: state.pending ?? [],
    lastDigest: state.lastDigest ?? null,
    lastRun: state.lastRun ?? null,
  });
```

- [ ] **Step 2: Live round-trip check**

Run:
```
node --env-file=.env -e "import('./state.mjs').then(async m => { const s = await m.loadState(); s.lastRun='2026-07-24T00:00:00.000Z'; await m.saveState(s); const r = await m.loadState(); console.log('lastRun ->', r.lastRun); await m.saveState({soldOut:[],drafted:[],pending:[],lastDigest:null,lastRun:null}); })"
```
Expected: prints `lastRun -> 2026-07-24T00:00:00.000Z` (then resets state clean).

- [ ] **Step 3: Confirm existing tests still pass**

Run: `node moves.test.mjs && node features.test.mjs`
Expected: both print `PASSED`.

- [ ] **Step 4: Commit**

```
git add state.mjs
git commit -m "feat(state): track lastRun timestamp in shop state"
```

---

### Task 2: `settings.mjs` — read/write the toggles metafield

**Files:**
- Create: `settings.mjs`
- Create/extend test: `panel.test.mjs` (normalizeSettings cases)

**Interfaces:**
- Consumes: `shopify.mjs` (`gql`, `getShopId`, `assertNoUserErrors`).
- Produces:
  - `normalizeSettings(obj) -> { sort: boolean, notify: boolean, draft: boolean }` (pure; only strict `true` becomes `true`, everything else `false`).
  - `loadSettings() -> Promise<{sort,notify,draft}>` (reads `oos_sort.settings`; all false if absent/unparseable).
  - `saveSettings(settings) -> Promise<void>` (writes `oos_sort.settings` as JSON).

- [ ] **Step 1: Write the failing test for `normalizeSettings`**

Create `panel.test.mjs`:

```js
#!/usr/bin/env node
import { normalizeSettings } from './settings.mjs';

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
  else console.log(`  ok  ${label}`);
}

console.log('--- normalizeSettings ---');
eq('empty -> all false', normalizeSettings({}), { sort: false, notify: false, draft: false });
eq('undefined -> all false', normalizeSettings(undefined), { sort: false, notify: false, draft: false });
eq('true booleans pass', normalizeSettings({ sort: true, notify: true, draft: true }), { sort: true, notify: true, draft: true });
eq('mixed', normalizeSettings({ sort: true, notify: false }), { sort: true, notify: false, draft: false });
eq('string "true" is not true', normalizeSettings({ sort: 'true' }), { sort: false, notify: false, draft: false });
eq('extra keys ignored', normalizeSettings({ sort: true, evil: true }), { sort: true, notify: false, draft: false });

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node panel.test.mjs`
Expected: FAIL — `Cannot find module './settings.mjs'` (or import error), since `settings.mjs` doesn't exist yet.

- [ ] **Step 3: Create `settings.mjs`**

```js
/**
 * The three feature toggles, stored in shop metafield oos_sort.settings.
 * Written by the settings page, read by the engine. Absent => all off.
 */
import { gql, getShopId, assertNoUserErrors } from './shopify.mjs';

const NAMESPACE = 'oos_sort';
const KEY = 'settings';

/** Pure: coerce an arbitrary object to strict boolean toggles (default false). */
export function normalizeSettings(obj) {
  const o = obj || {};
  return { sort: o.sort === true, notify: o.notify === true, draft: o.draft === true };
}

export async function loadSettings() {
  const d = await gql(`{ shop { metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value } } }`);
  const raw = d.shop?.metafield?.value;
  if (!raw) return normalizeSettings({});
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings({});
  }
}

export async function saveSettings(settings) {
  const shopId = await getShopId();
  const value = JSON.stringify(normalizeSettings(settings));
  const d = await gql(
    `mutation Save($m: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $m) { userErrors { field message } }
     }`,
    { m: [{ ownerId: shopId, namespace: NAMESPACE, key: KEY, type: 'json', value }] }
  );
  assertNoUserErrors('metafieldsSet(settings)', d.metafieldsSet);
}
```

- [ ] **Step 4: Run the unit test to confirm it passes**

Run: `node panel.test.mjs`
Expected: PASS — all `normalizeSettings` checks ok.

- [ ] **Step 5: Live round-trip check**

Run:
```
node --env-file=.env -e "import('./settings.mjs').then(async m => { await m.saveSettings({sort:true,notify:false,draft:true}); console.log('reload ->', JSON.stringify(await m.loadSettings())); await m.saveSettings({sort:false,notify:false,draft:false}); console.log('reset ->', JSON.stringify(await m.loadSettings())); })"
```
Expected: `reload -> {"sort":true,"notify":false,"draft":true}` then `reset -> {"sort":false,"notify":false,"draft":false}`.

- [ ] **Step 6: Wire the test into `npm test` and commit**

In `package.json`, extend the test script:
```json
    "test": "node moves.test.mjs && node features.test.mjs && node panel.test.mjs"
```
Run: `npm test` — Expected: three `PASSED` lines.

```
git add settings.mjs panel.test.mjs package.json
git commit -m "feat(settings): oos_sort.settings metafield load/save + normalize"
```

---

### Task 3: Engine reads toggles from the metafield + stamps `lastRun`

**Files:**
- Modify: `sort-oos.mjs`

**Interfaces:**
- Consumes: `settings.mjs` (`loadSettings`), `state.mjs` (`loadState`, `saveState`).
- Produces: engine behaviour unchanged, but feature flags now come from `oos_sort.settings` (env `FEATURE_*` overrides when set), and `oos_sort.state.lastRun` is written every run.

- [ ] **Step 1: Make the feature flags reassignable and import settings**

In `sort-oos.mjs`, change the three `const FEATURE_*` declarations to `let`, and add the settings import near the other imports.

Add to imports:
```js
import { loadSettings } from './settings.mjs';
```

Change:
```js
let FEATURE_SORT = (process.env.FEATURE_SORT ?? 'true') === 'true';
let FEATURE_NOTIFY = process.env.FEATURE_NOTIFY === 'true';
let FEATURE_DRAFT = process.env.FEATURE_DRAFT === 'true';
```
to:
```js
// Resolved in main() from the settings metafield; env overrides for local testing.
let FEATURE_SORT = false;
let FEATURE_NOTIFY = false;
let FEATURE_DRAFT = false;
```

- [ ] **Step 2: Resolve flags from settings at the top of `main()`**

In `main()`, immediately after `requireEnv('SHOP_DOMAIN');`, insert:

```js
  const settings = await loadSettings();
  const resolve = (envName, key) =>
    process.env[envName] !== undefined ? process.env[envName] === 'true' : settings[key];
  FEATURE_SORT = resolve('FEATURE_SORT', 'sort');
  FEATURE_NOTIFY = resolve('FEATURE_NOTIFY', 'notify');
  FEATURE_DRAFT = resolve('FEATURE_DRAFT', 'draft');
```

- [ ] **Step 3: Always load + stamp state (for the status line)**

Replace the state-loading line:
```js
  const usesState = FEATURE_NOTIFY || FEATURE_DRAFT;
  const state = usesState ? await loadState() : null;
```
with:
```js
  // Always keep state so the settings page has a fresh status line, even when
  // only sort is on or all features are off.
  const state = await loadState();
```
Then replace the whole `// Phase 4: persist state.` block:
```js
  if (usesState && state) {
    state.soldOut = [...ctx.soldOutNow];
    state.drafted = [...draftedSet];
    if (DRY_RUN) {
      console.log('\n[dry run] would save state:', JSON.stringify(state));
    } else {
      await saveState(state);
    }
  }
```
with:
```js
  // Phase 4: persist state (always — records lastRun + current sold-out count).
  state.soldOut = [...ctx.soldOutNow];
  state.drafted = [...draftedSet];
  state.lastRun = new Date().toISOString();
  if (DRY_RUN) {
    console.log('\n[dry run] would save state:', JSON.stringify(state));
  } else {
    await saveState(state);
  }
```
Also remove the now-unused `usesState` reference in the notify block guard: change `if (FEATURE_NOTIFY && state) {` to `if (FEATURE_NOTIFY) {` (state is always present now).

- [ ] **Step 4: Dry-run verifying metafield-driven flags**

First ensure the metafield says sort-only:
```
node --env-file=.env -e "import('./settings.mjs').then(m=>m.saveSettings({sort:true,notify:false,draft:false}))"
```
Then run the engine with NO `FEATURE_*` env vars and DRY_RUN on:
```
$env:DRY_RUN='true'; node --env-file=.env sort-oos.mjs 2>&1 | Select-String 'features|Finished'; Remove-Item Env:\DRY_RUN
```
Expected: header shows `features: sort` (proving it read the metafield, not env), and `Finished.`

- [ ] **Step 5: Confirm env override still works**

```
$env:DRY_RUN='true'; $env:FEATURE_NOTIFY='true'; node --env-file=.env sort-oos.mjs 2>&1 | Select-String 'features'; Remove-Item Env:\DRY_RUN,Env:\FEATURE_NOTIFY
```
Expected: header shows `features: sort+notify` (env override applied on top of the metafield).

- [ ] **Step 6: Reset settings and commit**

```
node --env-file=.env -e "import('./settings.mjs').then(m=>m.saveSettings({sort:false,notify:false,draft:false}))"
git add sort-oos.mjs
git commit -m "feat(engine): read toggles from oos_sort.settings + stamp lastRun"
```

---

### Task 4: `panel.mjs` — pure auth check + HTML render

**Files:**
- Create: `panel.mjs`
- Modify test: `panel.test.mjs` (add auth + render cases)

**Interfaces:**
- Consumes: nothing (pure; uses Node global `Buffer`).
- Produces:
  - `isAuthorized(authHeader, password) -> boolean` (HTTP Basic; compares the password segment).
  - `renderPage({ settings, status }) -> string` where `status = { soldOutCount: number, lastRun: string|null }`.

- [ ] **Step 1: Add failing auth + render tests to `panel.test.mjs`**

Append to `panel.test.mjs` (before the final summary/exit lines):

```js
import { isAuthorized, renderPage } from './panel.mjs';

const basic = (pass) => 'Basic ' + Buffer.from('admin:' + pass).toString('base64');

console.log('\n--- isAuthorized ---');
eq('correct password', isAuthorized(basic('s3cret'), 's3cret'), true);
eq('wrong password', isAuthorized(basic('nope'), 's3cret'), false);
eq('missing header', isAuthorized(undefined, 's3cret'), false);
eq('non-basic header', isAuthorized('Bearer x', 's3cret'), false);
eq('empty configured password denies', isAuthorized(basic(''), ''), false);

console.log('\n--- renderPage ---');
const html = renderPage({ settings: { sort: true, notify: false, draft: false }, status: { soldOutCount: 55, lastRun: '2026-07-24T08:00:00.000Z' } });
eq('sort checkbox checked', /id="sort"[^>]*checked/.test(html), true);
eq('notify checkbox unchecked', /id="notify"(?![^>]*checked)/.test(html), true);
eq('shows sold-out count', html.includes('55'), true);
eq('has save + report buttons', html.includes('/api/save') && html.includes('/api/report'), true);
```

- [ ] **Step 2: Run to confirm failure**

Run: `node panel.test.mjs`
Expected: FAIL — cannot import `./panel.mjs`.

- [ ] **Step 3: Create `panel.mjs`**

```js
/**
 * Pure rendering + auth logic for the settings page. No I/O, no env reads —
 * unit-tested offline in panel.test.mjs.
 */

/** HTTP Basic Auth: true only when the password segment matches. */
export function isAuthorized(authHeader, password) {
  if (!password) return false;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  const pass = i === -1 ? decoded : decoded.slice(i + 1);
  return pass === password;
}

/** Server-rendered settings page. `status = { soldOutCount, lastRun }`. */
export function renderPage({ settings, status }) {
  const ck = (b) => (b ? ' checked' : '');
  const last = status.lastRun ? new Date(status.lastRun).toLocaleString() : 'never';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OOS Sorter</title>
<style>
  body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.4rem} .row{display:flex;align-items:center;gap:.6rem;margin:1rem 0}
  .status{color:#555;font-size:.9rem;margin:1.5rem 0} button{font-size:1rem;padding:.5rem 1rem;cursor:pointer}
  #msg{margin-left:.5rem;color:#0a7d29}
</style></head><body>
<h1>OOS Sorter</h1>
<form id="f">
  <div class="row"><input type="checkbox" id="sort"${ck(settings.sort)}><label for="sort">Push sold-out products to the bottom</label></div>
  <div class="row"><input type="checkbox" id="notify"${ck(settings.notify)}><label for="notify">Email me a daily sold-out digest</label></div>
  <div class="row"><input type="checkbox" id="draft"${ck(settings.draft)}><label for="draft">Draft (hide) sold-out products</label></div>
  <button type="submit">Save</button><span id="msg"></span>
</form>
<div class="status">Currently sold out: <b>${status.soldOutCount}</b> &middot; last run: ${last}</div>
<button id="report">Email me the sold-out list now</button>
<script>
  const msg = document.getElementById('msg');
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { sort: sort.checked, notify: notify.checked, draft: draft.checked };
    const r = await fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    msg.textContent = r.ok ? 'Saved ✓' : 'Error';
    setTimeout(() => msg.textContent = '', 2000);
  });
  document.getElementById('report').addEventListener('click', async () => {
    const b = document.getElementById('report'); b.disabled = true; b.textContent = 'Sending…';
    const r = await fetch('/api/report', { method:'POST' });
    const j = await r.json().catch(() => ({}));
    b.textContent = r.ok ? ('Sent to your email (' + (j.count ?? '?') + ') ✓') : 'Error';
    setTimeout(() => { b.disabled = false; b.textContent = 'Email me the sold-out list now'; }, 3000);
  });
</script>
</body></html>`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `node panel.test.mjs`
Expected: PASS — all normalizeSettings, isAuthorized, and renderPage checks ok.

- [ ] **Step 5: Commit**

```
git add panel.mjs panel.test.mjs
git commit -m "feat(panel): pure Basic-auth check + settings page render"
```

---

### Task 5: Shared auth guard + GET settings page (`/api/index`)

**Files:**
- Create: `api/_auth.mjs`
- Create: `api/index.mjs`

**Interfaces:**
- Consumes: `panel.mjs` (`isAuthorized`, `renderPage`), `settings.mjs` (`loadSettings`), `state.mjs` (`loadState`).
- Produces: `requireAuth(req, res) -> boolean` (sends 401 + `WWW-Authenticate` when unauthorized); default export Vercel handler rendering the page.

- [ ] **Step 1: Create the auth guard**

`api/_auth.mjs`:
```js
import { isAuthorized } from '../panel.mjs';

/** Returns true if authorized; otherwise writes a 401 challenge and returns false. */
export function requireAuth(req, res) {
  if (isAuthorized(req.headers['authorization'], process.env.PANEL_PASSWORD)) return true;
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="OOS Sorter"');
  res.end('Authentication required');
  return false;
}
```

- [ ] **Step 2: Create the page handler**

`api/index.mjs`:
```js
import { requireAuth } from './_auth.mjs';
import { loadSettings } from '../settings.mjs';
import { loadState } from '../state.mjs';
import { renderPage } from '../panel.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const [settings, state] = await Promise.all([loadSettings(), loadState()]);
  const status = { soldOutCount: (state.soldOut || []).length, lastRun: state.lastRun ?? null };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(renderPage({ settings, status }));
}
```

- [ ] **Step 3: Live smoke test via a mock req/res**

Create a throwaway check (run, then delete the file):
```
node --env-file=.env -e "
process.env.PANEL_PASSWORD='testpass';
const { default: handler } = await import('./api/index.mjs');
const auth = 'Basic '+Buffer.from('admin:testpass').toString('base64');
function res(){ let s=200,b='',h={}; return { get statusCode(){return s}, set statusCode(v){s=v}, setHeader:(k,v)=>h[k]=v, end:(x)=>{b=x||''; console.log('status',s); console.log('has 3 checkboxes:', (b.match(/type=.checkbox./g)||[]).length===3); } }; }
await handler({ method:'GET', headers:{ authorization: auth } }, res());
const r2 = res(); await handler({ method:'GET', headers:{} }, r2); console.log('no-auth status', r2.statusCode);
"
```
Expected: `status 200`, `has 3 checkboxes: true`, `no-auth status 401`.

- [ ] **Step 4: Commit**

```
git add api/_auth.mjs api/index.mjs
git commit -m "feat(api): Basic-auth guard + GET settings page"
```

---

### Task 6: Save handler (`/api/save`)

**Files:**
- Create: `api/save.mjs`

**Interfaces:**
- Consumes: `_auth.mjs` (`requireAuth`), `settings.mjs` (`saveSettings`, `normalizeSettings`).
- Produces: default Vercel handler; POST JSON `{sort,notify,draft}` → writes metafield → `200 {ok:true, settings}`.

- [ ] **Step 1: Create the handler**

`api/save.mjs`:
```js
import { requireAuth } from './_auth.mjs';
import { saveSettings, normalizeSettings } from '../settings.mjs';

/** Read a JSON body whether or not the platform pre-parsed it. */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('POST only');
    return;
  }
  const settings = normalizeSettings(await readJson(req));
  await saveSettings(settings);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, settings }));
}
```

- [ ] **Step 2: Live smoke test (writes then resets the metafield)**

```
node --env-file=.env -e "
process.env.PANEL_PASSWORD='testpass';
const { default: handler } = await import('./api/save.mjs');
const { loadSettings, saveSettings } = await import('./settings.mjs');
const auth='Basic '+Buffer.from('admin:testpass').toString('base64');
function res(){ let s=200,b=''; return { get statusCode(){return s}, set statusCode(v){s=v}, setHeader(){}, end(x){b=x||''; console.log('status',s,'body',b);} }; }
await handler({ method:'POST', headers:{ authorization:auth, 'content-type':'application/json' }, body:{ sort:true, notify:true, draft:false } }, res());
console.log('reloaded ->', JSON.stringify(await loadSettings()));
await saveSettings({ sort:false, notify:false, draft:false });
"
```
Expected: `status 200 body {"ok":true,"settings":{"sort":true,"notify":true,"draft":false}}` then `reloaded -> {"sort":true,"notify":true,"draft":false}` (then reset).

- [ ] **Step 3: Commit**

```
git add api/save.mjs
git commit -m "feat(api): POST /api/save persists toggles to metafield"
```

---

### Task 7: Report-now handler (`/api/report`) + reusable gather

**Files:**
- Modify: `report.mjs` (export `gatherSoldOut`, guard `main`)
- Create: `api/report.mjs`

**Interfaces:**
- Consumes: `report.mjs` (`gatherSoldOut`), `notify.mjs` (`sendReport`), `_auth.mjs`.
- Produces:
  - `gatherSoldOut() -> Promise<Array<{id,title,collections}>>` (current sold-out across `COLLECTION_HANDLES`).
  - default Vercel handler; POST → emails the list → `200 {ok:true,count}`.

- [ ] **Step 1: Refactor `report.mjs` to export the gather + guard main**

At the top of `report.mjs`, add the entry-point guard import:
```js
import { pathToFileURL } from 'node:url';
```
Add, after the imports:
```js
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
```
Extract the gathering loop into an exported function (replaces the inline `byId` loop in `main`):
```js
export async function gatherSoldOut() {
  const byId = new Map();
  for (const handle of HANDLES) {
    const col = await findCollection(handle);
    if (!col) {
      console.warn(`  ! collection "${handle}" not found, skipping`);
      continue;
    }
    const products = await fetchProducts(col.id);
    for (const p of products) {
      if (isInStock(p)) continue;
      const id = shortId(p.id);
      const info = byId.get(id) ?? { id, title: p.title, collections: [] };
      if (!info.collections.includes(handle)) info.collections.push(handle);
      byId.set(id, info);
    }
  }
  return [...byId.values()];
}
```
Change `main()` to use it:
```js
  const items = await gatherSoldOut();
  console.log(`${items.length} product(s) currently sold out across ${HANDLES.length} collection(s).`);
  if (PRINT_ONLY) {
    const { subject, text } = buildReport(items);
    console.log(`\n${subject}\n${text}`);
    return;
  }
  await sendReport(items, {});
```
Guard the bottom invocation:
```js
if (IS_MAIN) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: Confirm report.mjs still works as a script and is import-safe**

Run: `node --env-file=.env report.mjs --print` — Expected: prints the current sold-out list (no email).
Run: `node -e "import('./report.mjs').then(m=>console.log('exports gatherSoldOut:', typeof m.gatherSoldOut))"` — Expected: `exports gatherSoldOut: function` and NO report output (main did not auto-run on import).

- [ ] **Step 3: Create `api/report.mjs`**

```js
import { requireAuth } from './_auth.mjs';
import { gatherSoldOut } from '../report.mjs';
import { sendReport } from '../notify.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('POST only');
    return;
  }
  const items = await gatherSoldOut();
  await sendReport(items, {});
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, count: items.length }));
}
```

- [ ] **Step 4: Live smoke test (sends a real email)**

Requires `GMAIL_*` + `NOTIFY_EMAIL` in `.env`.
```
node --env-file=.env -e "
process.env.PANEL_PASSWORD='testpass';
const { default: handler } = await import('./api/report.mjs');
const auth='Basic '+Buffer.from('admin:testpass').toString('base64');
function res(){ let s=200; return { get statusCode(){return s}, set statusCode(v){s=v}, setHeader(){}, end(x){ console.log('status',s,'body',x);} }; }
await handler({ method:'POST', headers:{ authorization:auth } }, res());
"
```
Expected: `status 200 body {"ok":true,"count":<n>}` and an email arrives at `NOTIFY_EMAIL`.

- [ ] **Step 5: Commit**

```
git add report.mjs api/report.mjs
git commit -m "feat(api): POST /api/report emails current sold-out list; reusable gatherSoldOut"
```

---

### Task 8: Vercel routing + 5-minute cron

**Files:**
- Create: `vercel.json`
- Modify: `github-actions-workflow.yml`

**Interfaces:**
- Consumes: the `/api/*` handlers from Tasks 5–7.
- Produces: `/` serves the settings page; engine cron runs every 5 minutes.

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "rewrites": [{ "source": "/", "destination": "/api/index" }]
}
```

- [ ] **Step 2: Change the frequent cron to every 5 minutes**

In `github-actions-workflow.yml`, change:
```yaml
    - cron: '*/15 * * * *' # every 15 minutes (GitHub's minimum is 5)
```
to:
```yaml
    - cron: '*/5 * * * *' # every 5 minutes (GitHub's minimum)
```
Leave the daily digest line (`0 8 * * *`) unchanged.

- [ ] **Step 3: Validate the workflow YAML parses**

Run: `node -e "const f=require('fs').readFileSync('github-actions-workflow.yml','utf8'); if(!/cron: '\*\/5 \* \* \* \*'/.test(f)) throw new Error('5-min cron missing'); console.log('cron ok')"`
Expected: `cron ok`.

- [ ] **Step 4: Commit**

```
git add vercel.json github-actions-workflow.yml
git commit -m "chore(deploy): Vercel routing + 5-minute engine cron"
```

---

### Task 9: Scrub identifying details for the public repo

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-07-24-oos-sorter-toggle-features-design.md`, `docs/superpowers/specs/2026-07-24-oos-sorter-settings-ui-design.md`, `.env.example` (verify)

**Interfaces:**
- Consumes: nothing.
- Produces: committed files contain no real store domain, client id, or personal email — only placeholders. Real values remain solely in the gitignored `.env`.

- [ ] **Step 1: Find every occurrence of the identifying strings**

Run (records what must change):
```
node -e "const fs=require('fs'),g=require('child_process').execSync('git ls-files',{encoding:'utf8'}).split('\n').filter(Boolean); const pats=[/your-store/, /your_client_id/, /stainesrinand@gmail\.com/]; for(const f of g){ let t; try{t=fs.readFileSync(f,'utf8')}catch{continue} pats.forEach(p=>{ if(p.test(t)) console.log(f,'contains',p) }); }"
```
Expected: a list of files/patterns. If empty, skip to Step 3.

- [ ] **Step 2: Replace each with a placeholder**

For every file reported, replace:
- `your-store.myshopify.com` → `your-store.myshopify.com`
- the client id `your_client_id` → `your_client_id`
- `you@example.com` → `you@example.com`

Use the Edit tool per occurrence (do NOT touch `.env`, which is gitignored and keeps the real values).

- [ ] **Step 3: Verify the working tree is clean of identifiers (tracked files only)**

Run the Step-1 command again.
Expected: no output (no tracked file contains any identifier).

- [ ] **Step 4: Confirm `.env` is still ignored and still holds the real values**

Run: `git check-ignore .env` — Expected: `.env`.
Run: `node -e "console.log(require('fs').existsSync('.env')?'env present':'MISSING')"` — Expected: `env present`.

- [ ] **Step 5: Full test suite + commit**

Run: `npm test` — Expected: `PASSED` for all three suites.
```
git add -A
git commit -m "chore: scrub identifying details from tracked files for public repo"
```

---

## Post-plan: deployment (owner-driven, not code)

Not tasks in this plan, but the finish line after the code lands:
1. Create the GitHub repo, push, make it **public** (scrub already done in Task 9).
2. Add GitHub Secrets/Variables for the engine (SHOP_DOMAIN, CLIENT_ID, CLIENT_SECRET, COLLECTION_HANDLES, SHOPIFY_API_VERSION, GMAIL_*, NOTIFY_EMAIL) and rename the workflow to `.github/workflows/oos-sort.yml`.
3. Create a Vercel project from the repo; set env vars including `PANEL_PASSWORD`.
4. Open the Vercel URL, log in, verify toggles/status/report, bookmark it.

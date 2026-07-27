# Spin to Win — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lean MVP of "Spin to Win" — a storefront spin-wheel popup that captures a shopper's email, decides a weighted prize server-side, issues a unique Shopify discount code, stores signups in Postgres, and gives the merchant a small admin (configure wheel, view signups, basic stats).

**Architecture:** New standalone Shopify app + Vercel project, reusing the OOS Sorter base (Vercel serverless, theme app extension, session-token/password admin auth, `ui.mjs` shell). Adds a managed Postgres DB. Outcome is server-authoritative — the browser never sees weights or win/lose flags.

**Tech Stack:** Node 20.6+ ESM (`.mjs`), Vercel serverless, Vercel Postgres (Neon) via `@vercel/postgres`, Shopify Admin GraphQL `2026-07`, theme app extension (Shopify CLI), `nodemailer` not needed (MVP shows codes on-screen).

**Spec:** `docs/superpowers/specs/2026-07-27-spin-to-win-mvp-design.md`

## Global Constraints

- **New repo/folder:** `C:\Users\stain\OneDrive\Desktop\spin-to-win` (outside oos-sorter). New GitHub repo `Richieymaru/spin-to-win`, new Vercel project `spin-to-win`, new Shopify Dev Dashboard app. Develop on the **test-apps dev store**; point at GBU for production later.
- **Vercel Hobby ≤ 12 serverless functions** (files in `api/` not prefixed `_`). MVP uses 8.
- **API version pinned `2026-07`.** Before using any Shopify mutation, confirm its argument shape against the store's live schema (introspection), same as OOS Sorter. Already verified: `discountCodeBasicCreate(basicCodeDiscount: DiscountCodeBasicInput!)` — arg is `basicCodeDiscount`, NOT `input`.
- **Outcome decided server-side.** `/api/spin` picks the slice and issues the code; `/api/config` exposes only display data (labels, colors), never `weight` or `is_win`.
- **Scopes:** `write_discounts` (create codes). Add `read_products`/`write_customers` only when a later phase needs them.
- **Secrets:** `.env` gitignored; DB URL + Shopify creds in Vercel env only. Reuse OOS Sorter's `auth.mjs`/`session.mjs`/`shopify.mjs`/`ui.mjs` by copying them into the new repo (do not import across projects).
- **Pure logic is unit-tested offline** (`wheel.test.mjs`); I/O modules are exercised by live dry-run scripts, not unit tests.

---

## Phase 0 — Scaffold & infrastructure

### Task 0.1: New repo scaffold + reused modules

**Files:**
- Create: `spin-to-win/package.json`, `.gitignore`, `.env.example`, `vercel.json`, `README.md`
- Copy (from oos-sorter, unmodified): `shopify.mjs`, `auth.mjs`, `session.mjs`, `session.test.mjs`, `api/_auth.mjs`, `api/install.mjs`, `api/oauth-callback.mjs`
- Adapt: `ui.mjs` (reuse shell/CSS; change nav tabs to Dashboard / Campaign / Signups; keep `notConnectedBody`, `appBridgeHead`, `setPageHeaders`, `esc`, `APP_NAME`)

**Steps:**
- [ ] Create the folder + `package.json` (`"type":"module"`, deps: `@vercel/postgres`; scripts: `test`, `migrate`, `check`). `APP_NAME` defaults to `"Spin to Win"`.
- [ ] Copy the reused modules; delete OOS-specific bits from `ui.mjs` nav.
- [ ] `.gitignore` (`.env`, `.vercel`, `node_modules`). `.env.example` documents: `SHOP_DOMAIN`, `CLIENT_ID`, `CLIENT_SECRET`, `ADMIN_TOKEN`, `SHOPIFY_API_VERSION=2026-07`, `POSTGRES_URL`, `PANEL_PASSWORD`, `RUN_TOKEN`.
- [ ] `git init`, first commit, create GitHub repo `Richieymaru/spin-to-win`, push.
- [ ] Commit: `chore: scaffold Spin to Win + reused auth/ui modules`

### Task 0.2: Shopify app + auth on the dev store

**Steps:**
- [ ] Create a new Dev Dashboard app "Spin to Win"; note `client_id`/`client_secret`.
- [ ] `shopify.app.toml`: `scopes = "write_discounts"`, `application_url`/redirect = the Vercel URL, `use_legacy_install_flow=false` (dev store, same org).
- [ ] Set `.env` with dev-store `CLIENT_ID`/`CLIENT_SECRET`/`SHOP_DOMAIN`.
- [ ] Write `check-setup.mjs` (copy from oos-sorter; assert token + `write_discounts` granted). Run it.
- [ ] Commit: `chore: Shopify app config + preflight (write_discounts)`

### Task 0.3: Vercel project + Postgres

**Steps:**
- [ ] `vercel link` a new project `spin-to-win`; add Vercel Postgres (Neon) — confirm free-tier limits; if inadequate, switch to Upstash (document the choice in README).
- [ ] Set Vercel env: `POSTGRES_URL` (auto from the integration), `CLIENT_ID`, `CLIENT_SECRET`, `SHOP_DOMAIN`, `SHOPIFY_API_VERSION`, `PANEL_PASSWORD`, `RUN_TOKEN`.
- [ ] Commit: `chore: Vercel project + Postgres provisioned`

---

## Phase 1 — Database layer

### Task 1.1: `db.mjs` + schema migration

**Files:** Create `db.mjs`, `schema.sql`, `migrate.mjs`
**Interfaces — Produces:** `sql` (tagged template from `@vercel/postgres`), `query(text, params)`, and typed helpers used later: `getCampaign(id)`, `saveCampaign(c)`, `listSlices(id)`, `insertSignup(row)`, `findSignup(campaignId,email)`, `recordEvent(campaignId,kind)`, `stats(campaignId)`, `listSignups(campaignId,{q})`.

- [ ] **Step 1 (schema):** write `schema.sql` with the four tables from the spec (campaigns, slices, signups with `unique(campaign_id,email)`, events) + indexes on `signups(campaign_id)`, `events(campaign_id,kind)`.
- [ ] **Step 2:** `migrate.mjs` runs `schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`). `npm run migrate`.
- [ ] **Step 3:** `db.mjs` exports the helpers above (thin wrappers over parameterized SQL). No business logic here.
- [ ] **Step 4:** run `migrate`; verify tables exist (a throwaway `SELECT` script).
- [ ] Commit: `feat: Postgres schema + db.mjs data helpers`

---

## Phase 2 — Pure wheel logic (TDD)

### Task 2.1: `wheel.mjs` (weighted pick + code generator) + tests

**Files:** Create `wheel.mjs`, `wheel.test.mjs`
**Interfaces — Produces:** `pickSlice(slices, rand=Math.random)`, `makeCode(prefix, rand=Math.random)`.

- [ ] **Step 1 (failing test):** `wheel.test.mjs`:

```js
import { pickSlice, makeCode } from './wheel.mjs';
let f=0,c=0; const ok=(l,x)=>{c++;if(!x){f++;console.error('FAIL '+l);}else console.log('  ok '+l);};

// deterministic rand
const seq = (arr)=>{let i=0;return ()=>arr[i++ % arr.length];};

const slices=[{id:1,weight:1},{id:2,weight:3},{id:3,weight:0}]; // total live weight 4
ok('picks first bucket at 0.0', pickSlice(slices, seq([0])).id===1);
ok('picks second bucket mid', pickSlice(slices, seq([0.5])).id===2);
ok('weight:0 never chosen', [...Array(1000)].every(()=>pickSlice(slices, seq([Math.min(0.999,Math.random())])).id!==3));
// distribution ~ proportional
let n1=0,n2=0,N=40000; for(let i=0;i<N;i++){const s=pickSlice(slices,()=> (i+0.5)/N); s.id===1?n1++:s.id===2&&n2++;}
ok('~25% bucket1', Math.abs(n1/N-0.25)<0.02);
ok('~75% bucket2', Math.abs(n2/N-0.75)<0.02);
ok('single slice degenerate', pickSlice([{id:9,weight:5}], seq([0.9])).id===9);
ok('all-zero -> null (display only)', pickSlice([{id:1,weight:0}], seq([0.5]))===null);

const code=makeCode('XMAS', seq([0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]));
ok('code has prefix', code.startsWith('XMAS-'));
ok('code charset safe', /^XMAS-[A-HJ-NP-Z2-9]{8}$/.test(code)); // no O/0/I/1/l
console.log(`\n${f?'FAILED':'PASSED'} — ${c} checks, ${f} failure(s)`); process.exit(f?1:0);
```

- [ ] **Step 2:** run `node wheel.test.mjs` → fails (module missing).
- [ ] **Step 3 (implement):** `wheel.mjs`:

```js
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous O/0/I/1/L

/** Weighted pick over slices by `weight`. weight:0 = display-only (never wins).
 *  Returns the chosen slice, or null if no slice has positive weight. */
export function pickSlice(slices, rand = Math.random) {
  const live = slices.filter((s) => s.weight > 0);
  const total = live.reduce((n, s) => n + s.weight, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const s of live) { if (r < s.weight) return s; r -= s.weight; }
  return live[live.length - 1];
}

/** PREFIX-XXXXXXXX unique-ish code from a safe charset. */
export function makeCode(prefix, rand = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return `${(prefix || 'SPIN').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${s}`;
}
```

- [ ] **Step 4:** run test → PASS. Add `wheel.test.mjs` + `session.test.mjs` to `package.json` `test`.
- [ ] Commit: `feat: pure weighted wheel picker + code generator (tested)`

---

## Phase 3 — Discount issuance

### Task 3.1: `discounts.mjs` — issue a unique Shopify code

**Files:** Create `discounts.mjs`
**Interfaces — Consumes:** `gql` from `shopify.mjs`, `makeCode` from `wheel.mjs`. **Produces:** `issueCode({ title, prefix, discount })` → `{ code }`.
`discount` = `{ type:'percentage'|'amount', value:number, prefix?:string }`.

- [ ] **Step 1:** implement using the verified mutation:

```js
import { gql } from './shopify.mjs';
import { makeCode } from './wheel.mjs';

// customerGets shape for percentage vs fixed amount (verified: DiscountCodeBasicInput.customerGets)
function customerGets(discount) {
  const value = discount.type === 'percentage'
    ? { percentage: discount.value / 100 }               // 10 => 0.10
    : { discountAmount: { amount: String(discount.value), appliesOnEachItem: false } };
  return { items: { all: true }, value };
}

export async function issueCode({ title, prefix, discount }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeCode(prefix || 'SPIN');
    const d = await gql(
      `mutation Create($basicCodeDiscount: DiscountCodeBasicInput!) {
         discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
           codeDiscountNode { id }
           userErrors { field message code }
         }
       }`,
      { basicCodeDiscount: {
          title: title || `Spin to Win ${code}`,
          code,
          startsAt: new Date().toISOString(),
          usageLimit: 1,
          appliesOncePerCustomer: true,
          customerGets: customerGets(discount),
      } }
    );
    const errs = d.discountCodeBasicCreate.userErrors || [];
    if (!errs.length) return { code };
    // retry only on code collision; otherwise throw
    if (!errs.some((e) => /taken|exists|duplicate/i.test(e.message))) {
      throw new Error('discountCodeBasicCreate: ' + JSON.stringify(errs));
    }
  }
  throw new Error('discountCodeBasicCreate: could not mint a unique code');
}
```

- [ ] **Step 2 (live dry-run script, not committed):** `_disc-test.mjs` calls `issueCode` on the dev store with a 10% discount; confirm the code appears in Admin → Discounts; then deactivate/delete it. Delete the script.
- [ ] **Step 3:** `startsAt` note — `new Date().toISOString()` is fine at runtime (only the pure tests avoid `Date`). Add a `read_discounts`/`write_discounts` scope check to `check-setup.mjs`.
- [ ] Commit: `feat: issue unique Shopify discount codes (verified 2026-07 mutation)`

---

## Phase 4 — Campaign model + admin config

### Task 4.1: `campaign.mjs`

**Files:** Create `campaign.mjs`
**Interfaces — Produces:** `loadCampaign(id)` → `{campaign, slices}`; `saveCampaign({campaign, slices})`; `normalizeCampaign(obj)` (pure: clamp weights ≥0, coerce discount shapes, cap slices ≤ 16, validate colors/hex). `MVP_CAMPAIGN_ID = 'default'` (single campaign).

- [ ] **Step 1:** pure `normalizeCampaign` + a small `campaign.test.mjs` (weights clamp, bad discount dropped, slice cap). Add to `test`.
- [ ] **Step 2:** `loadCampaign`/`saveCampaign` over `db.mjs`. Seed a `default` campaign on first load (disabled, a sample 8-slice wheel).
- [ ] Commit: `feat: campaign model + normalizer (tested)`

### Task 4.2: `api/campaign.mjs` (admin GET page + POST save)

**Files:** Create `api/campaign.mjs`, extend `ui.mjs` if needed.
**Consumes:** `requireAuth` (`_auth.mjs`), `loadCampaign`/`saveCampaign`/`normalizeCampaign`, `shell`/`notConnectedBody`/`shopOf`.

- [ ] **Step 1:** GET renders a form: campaign name, enabled toggle, and a slice editor (rows: label, weight, win/lose, discount type+value) + design fields (colors, header text, button copy). Wrap the data load in try/catch → `notConnectedBody` (the OOS Sorter crash-fix pattern).
- [ ] **Step 2:** POST (auth-gated) → `normalizeCampaign` → `saveCampaign` → JSON `{ok:true}`. Client JS mirrors OOS Sorter's `authH()` (session token else `x-panel-password`).
- [ ] **Step 3:** manual check on the dev store: edit slices, save, reload → persists.
- [ ] Commit: `feat: admin campaign editor`

---

## Phase 5 — Public endpoints

### Task 5.1: `api/config.mjs` (public display config)

**Files:** Create `api/config.mjs`
- [ ] GET `?c=<campaignId>` → CORS JSON with **display only**: `{enabled, header, buttonText, colors, slices:[{label,position}]}`. Never include `weight`/`is_win`/`discount`. Disabled campaign → `{enabled:false}`.
- [ ] Commit: `feat: public campaign display config endpoint`

### Task 5.2: `api/spin.mjs` (+ `api/view.mjs`)

**Files:** Create `api/spin.mjs`, `api/view.mjs`
**Consumes:** `loadCampaign`, `pickSlice`, `issueCode`, `db` helpers.

- [ ] **Step 1:** `api/view.mjs` — CORS, POST `{c}` → `recordEvent(c,'view')` → `{ok:true}`.
- [ ] **Step 2:** `api/spin.mjs` — the core flow (spec §"/api/spin flow"):
  1. CORS/POST/readJson; honeypot → `{ok:true}`.
  2. validate email; load campaign+slices; disabled → `{ok:false}`.
  3. `findSignup(c,email)` exists → return the stored prior result (idempotent).
  4. `pickSlice(slices)`; if `is_win` && `discount` → `issueCode(...)` (on failure: log, set `couponCode:null`, `message` = graceful fallback, still record signup).
  5. `insertSignup(...)` + `recordEvent(c,'spin')`.
  6. return `{ok:true, sliceIndex, label, couponCode, message}`.
- [ ] **Step 3:** live dry-run on the dev store via `curl` (a real email) → row in `signups`, code in Admin discounts.
- [ ] Commit: `feat: spin + view endpoints (server-authoritative outcome)`

---

## Phase 6 — Storefront widget (theme app extension)

### Task 6.1: `extensions/spin-to-win` (wheel + email form)

**Files:** Create `extensions/spin-to-win/shopify.extension.toml`, `blocks/spin-to-win.liquid`, `assets/spin.js`, `assets/spin.css`, `locales/en.default.json`
- [ ] **Step 1:** block liquid — a launch button + container with `data-campaign-id`, `data-endpoint` (the Vercel base URL). Schema settings: campaign id, endpoint base, trigger (on-load / after N seconds), launch position.
- [ ] **Step 2:** `spin.js` — on load: POST `/api/view`; on trigger: fetch `/api/config`, render the wheel (CSS `conic-gradient` + `transform: rotate` animation; **no external libs**) with slice labels. On Play: validate email → POST `/api/spin` → animate the wheel to `sliceIndex` (compute target rotation) → on settle, reveal `label` + `couponCode` with a copy button. Honeypot field.
- [ ] **Step 3:** `spin.css` — wheel, pointer, modal, result panel; theme-aware, responsive, `prefers-reduced-motion` (skip spin animation).
- [ ] **Step 4:** deploy via Shopify CLI (automation token + `--allow-updates`); add the block on the dev store theme; test a full spin.
- [ ] Commit: `feat: spin-wheel theme app extension`

---

## Phase 7 — Admin dashboard + signups

### Task 7.1: `api/index.mjs` (stats dashboard)
- [ ] GET → `stats(campaignId)`: views, emails (signups), opt-in rate (emails÷views), recent signups. Stat cards via `ui.statCard`. try/catch → `notConnectedBody`.
- [ ] Commit: `feat: admin dashboard stats`

### Task 7.2: `api/signups.mjs` (table + CSV export)
- [ ] GET → table (email, coupon, date, referrer, country) + search box (client filter) + **Export CSV** (a `?format=csv` branch returning `text/csv`).
- [ ] Commit: `feat: signups table + CSV export`

---

## Phase 8 — Wire, deploy, end-to-end

- [ ] **Task 8.1:** confirm ≤12 functions (`spin, config, view, index, campaign, signups, install, oauth-callback` = 8). Deploy to Vercel prod. Run `check-setup`.
- [ ] **Task 8.2:** dev-store end-to-end: enable campaign → open storefront → spin → win → code applies at checkout → signup + event rows → dashboard stats update → CSV export works.
- [ ] **Task 8.3:** README (setup, env, deploy, the 2026-07 discount-API note, the server-authoritative-outcome invariant). Commit.
- [ ] **Task 8.4 (production, later):** new Shopify app config for GBU (`shopify.app.gbu.toml`), separate Vercel project env, owner install → `ADMIN_TOKEN`, add block to GBU theme. (Mirrors the Sold out Sorter GBU flow.)

---

## Self-review notes

- Coverage: every spec MVP component maps to a task (DB→P1, wheel→P2, discounts→P3, campaign/admin→P4, public endpoints→P5, widget→P6, dashboard/signups→P7, deploy→P8). Deferred items are out of scope by design.
- Type consistency: `pickSlice`/`makeCode`/`issueCode`/`loadCampaign` signatures are used consistently across tasks. `discount` shape `{type,value,prefix}` is fixed in P2/P3/P4.
- `Date.now()`/`new Date()` appear only in runtime code (endpoints, `issueCode`), never in the pure tested functions — safe.
- Open items (from spec) tracked: DB free-tier confirm (Task 0.3), app name resolved ("Spin to Win"), wheel rendering approach fixed (CSS `conic-gradient`, no libs — Task 6.1).

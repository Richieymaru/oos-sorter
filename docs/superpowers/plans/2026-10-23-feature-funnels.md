# Feature Funnels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Feature Funnels" page to the Orderly app that measures usage, conversion (orders + revenue), shopper behavior, and recommendations for GBU's two storefront features — Find My Blaster (quiz) and Upgrade Your Blaster (UGB modal) — backed by lightweight, speed-safe theme instrumentation.

**Architecture:** Attribution rides on the order itself — a hidden line-item property `_src` (tags the specific product a feature steered the shopper to) and a cart attribute `_origin` (first-touch, set on modal open), both read back via `read_orders`. Usage/behavior counters are beaconed from the theme to an existing app endpoint and aggregated in a shop metafield `oos_sort.feature_stats`. The app computes everything in **pure functions** (synthetic data in, numbers out) so it is fully testable offline; the page is a new `?view=features` branch in `api/index.mjs` rendering the approved light-theme mockup.

**Tech Stack:** Node 20.6+ ESM, no framework, pure string-rendered HTML; Shopify Admin GraphQL `2026-07`; shop-level JSON metafields (`oos_sort.*`); Vercel serverless (Hobby, 12-function cap); GBU Horizon theme (classic `gbu-*.js` scripts, Liquid snippets).

**Spec:** `docs/superpowers/specs/2026-10-21-feature-funnels-design.md` (read it — the plan argues from it).

## Global Constraints

- **Vercel Hobby 12-function cap — the app is AT 12.** No new `api/*.mjs` file. The page is a `?view=features` branch in `api/index.mjs`; the beacon receiver is a `?fev=1` branch in `api/unsubscribe.mjs`.
- **Metafield:** owner = shop GID (`getShopId()`), namespace `oos_sort`, new key `feature_stats`, type `json`. Cap 131072 bytes; trim like `state.mjs` (retain last 90 days).
- **Pure logic is TDD, offline.** Every analytics function is pure and tested with synthetic data via the repo's hand-rolled harness (`ok(label, cond)`, `process.exit(failures?1:0)`); no `node:test`, no assert lib. New test files appended to the `package.json` `"test"` chain. `features.test.mjs` is taken — use `feature-stats.test.mjs` and `feature-funnels.test.mjs`.
- **GraphQL:** `gql(query, vars)` returns `body.data`. Validate any new query against the `2026-07` schema via the shopify-admin skill. `Count` fields (`momentsCount { count }`) keep their inner braces.
- **No PII** in `feature_stats` or the beacon payload (no emails, no cart tokens, no customer data).
- **Data contract (both repos must agree):**
  - Line-item property `_src` ∈ {`find-my-blaster`, `upgrade`}; order/cart attribute `_origin` ∈ same set.
  - Beacon payload JSON: `{ f: 'fmb'|'ugb', e: <event>, q?, a?, n?, m?, b? }` (keys below). Always answered with HTTP 200.
- **Theme:** no core-file edits; classic self-guarded `gbu-*.js` scripts; listeners on `document` (header re-renders); `staging → PR → main` (merge = live); features live in `main` + `rollout`.
- **Attribution rule (owner):** purchase → credit the feature whose `_src` is on the purchased line (per-item revenue, never double-counted); no purchase → first-touch `_origin` counts as engagement only.
- Windows/PowerShell dev; prefer Node over shell one-liners.

## Review Focus

1. **Order missing `_origin`, or `_src` present on a line but no order-level origin** — `attributeOrders` must not crash or produce `NaN` revenue; an untagged order simply contributes nothing. (Task 4)
2. **`feature_stats` growth** — many days or many answer/blaster keys must stay under 131072 bytes; `saveFeatureStats` trims to the last 90 days and drops oldest first. (Task 2)
3. **Hostile/malformed beacon** — missing `f`/`e`, oversized strings, array/key floods; receiver validates against a known enum, clamps lengths, ignores unknown events, always returns 200, never throws, stores no PII. (Task 9)
4. **`read_orders` denied / `tier:'none'` / zero orders in range** — the page renders an honest empty state, not a crash (mirror the funnels `try/catch` + `error` body). (Task 8)
5. **Catalog product missing a `custom.*` metafield, or `key_specs_fps` unparseable** — `demandVsStock` skips/buckets gracefully, never divides by zero, and labels FPS coverage approximate. (Task 6)

---

## File Structure

**App (`oos-sorter`), new files:**
- `feature-stats.mjs` — `oos_sort.feature_stats` metafield I/O + the pure `applyEvent` reducer + `emptyStats`.
- `feature-funnels.mjs` — pure analytics: attribution, behavior, demand-vs-stock, recommendations, and the `analyzeFeatures` composer + the `FMB_QUESTIONS` mapping mirrored from the quiz.
- `feature-stats.test.mjs`, `feature-funnels.test.mjs` — pure tests.

**App, modified:**
- `orders.mjs` — add order-level `customAttributes` + line-item `customAttributes` to the query; surface them in `normalizeOrder`.
- `catalog.mjs` — add a fetcher for the quiz collection's products with `custom.*` metafields + price + online stock.
- `ui.mjs` — `featureFunnelsBody(view)` + a `features` nav tab (two nav blocks).
- `api/index.mjs` — `?view=features` branch.
- `api/unsubscribe.mjs` — `?fev=1` beacon branch.
- `settings.mjs` — `featureFunnels` toggle; `api/settings.mjs` — expose it in the form.
- `package.json` — append the two new test files.

**Theme (`shopify-gbu-horizon`), modified/new:**
- `assets/gbu-find-my-blaster.js` — tag quick-add, append `?_src` to pick links, beacon.
- `assets/gbu-upgrade-blaster.js` — tag `addVariant`, append `?_src` to step-2 links, beacon.
- `assets/gbu-src-tracking.js` (new) — carry `_src` → hidden PDP form input; first-touch `_origin` on modal open.
- `layout/theme.liquid` — load `gbu-src-tracking.js` once (next to `gbu-ugb-fits.js`).

---

## Task 1: Verify the attribution model against the live schema (gate)

Load-bearing: the whole scheme fails if underscore attributes don't round-trip on orders. No code ships from this task — it's a go/no-go check.

**Files:** none (a throwaway query via the shopify-admin skill / a scratch script).

- [ ] **Step 1: Confirm the Order query shape** — using the shopify-admin skill, validate against `2026-07` that `orders.nodes` can select `customAttributes { key value }` and `lineItems.nodes.customAttributes { key value }`.
- [ ] **Step 2: Prove round-trip on a real order** — in a DRY/manual check, add a cart with attribute `_origin=find-my-blaster` and a line property `properties[_src]=find-my-blaster`, complete a test order on the dev/GBU store, then query that order and confirm both `_origin` (order `customAttributes`) and `_src` (line `customAttributes`) come back under `read_orders`.
- [ ] **Step 3: Record the result** — note in the plan/commit whether line-item properties surface as `customAttributes` or need a different field. If they don't round-trip, STOP and escalate (the design's core assumption is void).

Expected: both attributes present. Proceed only then.

---

## Task 2: `feature-stats.mjs` — metafield I/O + pure reducer

**Files:**
- Create: `feature-stats.mjs`
- Test: `feature-stats.test.mjs`

**Interfaces:**
- Produces:
  - `emptyStats(): Stats` where `Stats = { version:1, days: { [ymd:string]: DayBucket } }` and `DayBucket = { fmb:{ open, step:[n1..n5], done, deadEnd, picks:{[`${q}:${a}`]:number} }, ugb:{ open, blaster:{[handle]:number}, fits, add } }` (all counters default 0, arrays length-5 of 0, maps `{}`).
  - `applyEvent(stats, ev, ymd): Stats` — pure; returns a new stats object with the one counter for `ev` on day `ymd` incremented. `ev` = `{ f:'fmb'|'ugb', e, q?, a?, n?, m?, b? }`. Event→counter map: `fmb/open→fmb.open`; `fmb/step` n∈1..5 → `fmb.step[n-1]`; `fmb/pick` → `fmb.picks['q:a']++`; `fmb/done` → `fmb.done++` and if `m===0` also `fmb.deadEnd++`; `ugb/open→ugb.open`; `ugb/blaster` → `ugb.blaster[b]++`; `ugb/fits→ugb.fits`; `ugb/add→ugb.add`. Unknown `f`/`e` → stats returned unchanged. `q`,`a`,`b` clamped to 60 chars.
  - `loadFeatureStats(): Promise<Stats>` — reads `oos_sort.feature_stats` (mirror `state.mjs` `loadState`: parse-with-fallback to `emptyStats()`).
  - `saveFeatureStats(stats): Promise<void>` — mirror `state.mjs` `saveState`: `getShopId()`, `metafieldsSet` with `{namespace:'oos_sort', key:'feature_stats', type:'json'}`, `assertNoUserErrors`. Before writing: drop day keys older than 90 days, then while `JSON.stringify > 131072-2048` drop the oldest remaining day.

- [ ] **Step 1: Write failing tests** in `feature-stats.test.mjs` (harness copied from `features.test.mjs`): `emptyStats()` has zeroed shape; `applyEvent` increments each event type on the right day; `fmb/done` with `m:0` bumps `deadEnd`; unknown event is a no-op; `applyEvent` does not mutate its input; a stats object with 200 day-keys, after the retention trim helper, keeps ≤90. (Test the trim via an exported pure `trimStats(stats, maxDays=90): Stats`.)
- [ ] **Step 2: Run** `node feature-stats.test.mjs` — Expected: FAIL (module/functions missing).
- [ ] **Step 3: Implement** `emptyStats`, `applyEvent`, `trimStats` (pure), then `loadFeatureStats`/`saveFeatureStats` (I/O, using `gql`/`getShopId` from `shopify.mjs`). `saveFeatureStats` calls `trimStats` then the byte-trim loop.
- [ ] **Step 4: Run** `node feature-stats.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: feature_stats metafield + pure event reducer`).

---

## Task 3: `orders.mjs` — surface `_src` / `_origin`

**Files:**
- Modify: `orders.mjs` (`BASE_FIELDS` ~19-23; `normalizeOrder` ~51-74)
- Test: extend `feature-funnels.test.mjs` indirectly (normalizeOrder is covered by Task 4's fixtures); add one direct assertion in `feature-stats.test.mjs` is wrong — put it in a new `orders-attr.test.mjs`? No: add to `feature-funnels.test.mjs` since it imports `normalizeOrder`.

**Interfaces:**
- Produces: `normalizeOrder(n)` return object gains `origin: string|null` (from order `customAttributes` key `_origin`) and each `items[]` entry gains `src: string|null` (from that line's `customAttributes` key `_src`). Existing fields unchanged.

- [ ] **Step 1: Write failing test** in `feature-funnels.test.mjs`: build a raw order node with `customAttributes:[{key:'_origin',value:'find-my-blaster'}]` and a line with `customAttributes:[{key:'_src',value:'upgrade'}]`; assert `normalizeOrder(node).origin==='find-my-blaster'` and `.items[0].src==='upgrade'`; and an order with no attributes gives `origin:null`, `items[0].src:null`.
- [ ] **Step 2: Run** `node feature-funnels.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** — add `customAttributes { key value }` to `BASE_FIELDS` at the order node level and inside `lineItems(first: 10){ nodes { ... } }`; in `normalizeOrder`, read `_origin` off the order and `_src` off each line (helper `attr(list, key)`), tolerant of missing/empty arrays.
- [ ] **Step 4: Run** `node feature-funnels.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: read _src/_origin attributes off orders`).

---

## Task 4: `feature-funnels.mjs` — attribution (pure)

**Files:**
- Create: `feature-funnels.mjs`
- Test: `feature-funnels.test.mjs`

**Interfaces:**
- Consumes: normalized orders from `orders.mjs` (Task 3).
- Produces: `attributeOrders(orders): { currency, features: { 'find-my-blaster': FeatRev, 'upgrade': FeatRev } }` where `FeatRev = { orders:number, revenue:number }`. Rules: revenue sums each line's share **per item whose `src` matches** (line share = order.amount × qty / order total qty when no per-line price is available — document this approximation); `orders` counts each order once per feature that has ≥1 matching `src` line (an order touching both counts in both). Orders with no `_src` lines contribute nothing. Never `NaN` (guard zero totals).

- [ ] **Step 1: Write failing tests**: order with one `_src=find-my-blaster` line → that feature's `orders=1`, `revenue=order amount share`; order with both features' lines → both `orders=1`, revenue split per item; untagged order → both features zero; empty list → zeros, no throw; a zero-amount order → no `NaN`.
- [ ] **Step 2: Run** `node feature-funnels.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** `attributeOrders`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: per-item order attribution`).

---

## Task 5: `feature-funnels.mjs` — behavior analysis (pure)

**Files:** Modify `feature-funnels.mjs`; Test `feature-funnels.test.mjs`.

**Interfaces:**
- Consumes: a `Stats` (Task 2) summed over the window's day buckets.
- Produces:
  - `sumStats(stats, { since, until }): DayBucket` — sum day buckets in range into one.
  - `quizDropoff(summed): { steps:[{label,reached,dropPct}], worstIndex }` — labels `['Opened','Q1 · Player','Q2 · Budget','Q3 · Power','Q4 · Build','Q5 · Velocity']`; `reached` from `fmb.open` then `fmb.step[0..4]`; `dropPct` vs previous; `worstIndex` = largest drop.
  - `answerDemand(summed): [{ q, a, picks, share }]` sorted desc — from `fmb.picks`.
  - `ugbSummary(summed): { opens, blasterPicks, fitsViewed, adds, topBlasters:[{handle,picks}] }`.

- [ ] **Step 1: Write failing tests** with a synthetic summed bucket: drop-off reached counts + worstIndex land on the biggest drop; `dropPct` is 0 for the first row; empty stats → steps all zero, `worstIndex:-1`, no throw; `answerDemand` shares sum ~100%; `ugbSummary.topBlasters` sorted.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `sumStats`, `quizDropoff`, `answerDemand`, `ugbSummary`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: quiz drop-off + answer demand + UGB summary`).

---

## Task 6: `feature-funnels.mjs` — demand vs stock (pure) + catalog fetcher

**Files:**
- Modify: `catalog.mjs` (new fetcher), `feature-funnels.mjs` (pure coverage + `FMB_QUESTIONS`)
- Test: `feature-funnels.test.mjs`

**Interfaces:**
- Produces (catalog): `fetchBlasterAttributes(handle): Promise<[{ id, price:number, power:string, experience:string, material:string, fps:string, inStock:boolean }]>` — fetches the quiz collection's products with `metafield(namespace:"custom", key:"power_source"|"experience_level"|"build_material"|"key_specs_fps")`, per-variant price + online stock (reuse `variantFields`/`normalize`/`isInStock`). FPS is raw text.
- Produces (pure): `FMB_QUESTIONS` — the answer→value mapping mirrored from `assets/gbu-find-my-blaster.js` (power: Electric/Gas/Manual; experience: Starter/Intermediate/Advanced; material: Full Metal/Nylon/Full Metal + Nylon; budget bands 0–300/300–700/700+; fps bands via a `fpsNumber` regex copy). Comment: **keep in sync with the theme quiz.**
  - `demandVsStock(answerDemand, products): [{ q, a, demandShare, inStockCount, coveragePct, unmetPct }]` and `worstCombo(answerDemand, products): { label, wanted, inStock } | null` (e.g. "gas under $300"). FPS rows carry `approx:true`. Guards: product missing a field → not counted for that answer; zero demand or zero catalog → `coveragePct:0`, no divide-by-zero.

- [ ] **Step 1: Write failing tests** (pure part only, synthetic products): a product set with 1 gas blaster under $300 vs demand for gas+under-$300 yields high `unmetPct`; FPS rows flagged `approx`; product missing `power` is skipped not crashed; empty products → coverage 0.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `FMB_QUESTIONS`, `demandVsStock`, `worstCombo` (pure), then `fetchBlasterAttributes` in `catalog.mjs` (validate the query via shopify-admin skill).
- [ ] **Step 4: Run** `node feature-funnels.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: demand-vs-stock coverage + blaster attribute fetch`).

---

## Task 7: `feature-funnels.mjs` — recommendations + `analyzeFeatures` composer (pure)

**Files:** Modify `feature-funnels.mjs`; Test `feature-funnels.test.mjs`.

**Interfaces:**
- Consumes: outputs of Tasks 4–6.
- Produces:
  - `buildFeatureRecs({ dropoff, coverage, worstCombo, ugb, attribution }): [{ tone, text, fix:[], impact:{ up, unit } }]` ranked — mirror `funnels.mjs` insight shape (`{tone,text,fix}`) plus an `impact` field. Rules: worst unmet combo → rec #1; worst drop-off step → rec #2; low UGB add-rate → rec #3. Empty inputs → `[]`.
  - `analyzeFeatures({ orders, stats, products, window }): FeatureView` — composes everything into the view model the page needs: `{ window, currency, totals:{ revenue, orders, trendPct }, perFeature:{ fmb, ugb } funnels, dropoff, demand, worstCombo, recs }`.

- [ ] **Step 1: Write failing tests**: `buildFeatureRecs` ranks unmet-combo first and each rec has a non-empty `fix`; empty → `[]`; `analyzeFeatures` returns a shape with `totals`, `perFeature`, `dropoff`, `recs` present given synthetic inputs.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `buildFeatureRecs`, `analyzeFeatures`.
- [ ] **Step 4: Run** `node feature-funnels.test.mjs`; also run full `npm test` to confirm no regressions. Expected: PASS.
- [ ] **Step 5: Commit** (`feat: feature recommendations + analyzeFeatures composer`).

---

## Task 8: `ui.mjs` — `featureFunnelsBody(view)` + nav tab

**Files:** Modify `ui.mjs` (add `featureFunnelsBody`; nav tab in both blocks ~449-459 and ~462-472).

**Interfaces:**
- Consumes: `FeatureView` from `analyzeFeatures` (or `{ error }`).
- Produces: `featureFunnelsBody(view): string` — renders the approved light mockup (hero with revenue + trend + per-feature split; two funnel cards emerald/`--info`; behavior: quiz drop-off as left-aligned bars with worst step amber + demand-vs-stock gap bars + unmet callout; ranked recommendation cards). Reuses exported `statCard`/`badge`/`ring` where natural; range picker mirrors the funnels page. Early-returns an honest empty/error state on `view.error` or no data. Adds nav entry `features '/features'` labelled "Features" to both nav blocks.

- [ ] **Step 1:** Add the `features` tab to both nav blocks in `shell`.
- [ ] **Step 2:** Implement `featureFunnelsBody(view)` to the approved mockup markup/CSS (light tokens already in `ui.mjs`), including the empty/error branch.
- [ ] **Step 3: Verify render offline** — write a tiny scratch script (in scratchpad) that imports `featureFunnelsBody` with a synthetic `FeatureView` and prints HTML; eyeball that all four sections render and the error branch returns markup. (No unit test; this is a render helper.)
- [ ] **Step 4: Commit** (`feat: Feature Funnels page body + nav tab`).

---

## Task 9: `api/unsubscribe.mjs` — beacon receiver (`?fev=1`)

**Files:** Modify `api/unsubscribe.mjs` (add a branch beside the `?pixel=1` branch ~43-58).
Test: `feature-stats.test.mjs` (validate the pure parse/clamp helper).

**Interfaces:**
- Consumes: POST body `{ f, e, q?, a?, n?, m?, b? }`.
- Produces: increments `feature_stats` via `applyEvent` + `saveFeatureStats`. A pure exported helper `sanitizeEvent(body): Event|null` (in `feature-stats.mjs`) validates `f∈{fmb,ugb}`, `e` in the known set, clamps `q/a/b` to 60 chars, coerces `n`/`m` to ints, returns `null` for junk.

- [ ] **Step 1: Write failing test** (`feature-stats.test.mjs`): `sanitizeEvent` accepts a valid fmb/pick, rejects missing `f`, rejects unknown `e`, clamps a 500-char `a`, drops extra keys.
- [ ] **Step 2: Run** `node feature-stats.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** `sanitizeEvent` (pure, in `feature-stats.mjs`). Then add the `?fev=1` branch to `api/unsubscribe.mjs`: reuse the existing CORS + OPTIONS 204 pattern; `readJson`; `const ev = sanitizeEvent(body); if (ev) { const s = await loadFeatureStats(); await saveFeatureStats(applyEvent(s, ev, todayYmd())); }`; always `res.end(JSON.stringify({ok:true}))`; swallow errors (never 5xx to the storefront). Gate on the `featureFunnels` setting (Task 10) — if off, 200 no-op.
- [ ] **Step 4: Run** `node feature-stats.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** (`feat: feature-event beacon receiver`).

---

## Task 10: `?view=features` branch + settings toggle

**Files:** Modify `api/index.mjs` (new branch before the dashboard fall-through ~line 219), `settings.mjs` (`normalizeSettings`), `api/settings.mjs` (form field).

**Interfaces:**
- Consumes: `analyzeFeatures`, `featureFunnelsBody`, `loadFeatureStats`, `fetchBlasterAttributes`, `fetchOrders`, `resolveRange`.
- Produces: GET `/features` rendered page, gated on `settings.featureFunnels`.

- [ ] **Step 1:** Add `featureFunnels: o.featureFunnels === true` to `normalizeSettings` in `settings.mjs`; add the toggle to the settings form in `api/settings.mjs` (mirror an existing switch like `monitor`).
- [ ] **Step 2:** Add the `if (param(req,'view')==='features')` branch to `api/index.mjs`: `resolveRange` → `Promise.all([cachedOrders(...), loadFeatureStats(), cachedBlasterAttrs(QUIZ_COLLECTION_HANDLE)])` → `analyzeFeatures(...)` → `featureFunnelsBody(view)` → `setPageHeaders(res); res.end(shell({title:'Features', active:'features', body}))`. Wrap in `try/catch` mirroring funnels (`featureFunnelsBody({error})` on failure). Add a `ttlMemo` cache for the blaster-attrs fetch. Define `QUIZ_COLLECTION_HANDLE` (the quiz's collection) as a const.
- [ ] **Step 3: Verify offline** — `node -e` import check that the branch wiring imports resolve; run `npm test` (no regressions).
- [ ] **Step 4: Commit** (`feat: /features route + featureFunnels toggle`).

---

## Task 11: Theme — Find My Blaster tagging + beacon

**Files (gbu-horizon repo):** Modify `assets/gbu-find-my-blaster.js`.

- [ ] **Step 1:** In `quickAdd` (line ~705) change the add to `window.GBUCartSync.add([{ id: id, quantity: 1, properties: { _src: 'find-my-blaster' } }])`.
- [ ] **Step 2:** In the results card template (lines ~672, 679, 683) append `?_src=find-my-blaster` to the three `p.url` links and the `action` "Choose options" link (line ~668). (`p.url` is a bare path — safe to append `?`.) Leave `browseUrl()` alone unless merging into its existing query string.
- [ ] **Step 3:** Add a tiny `beacon(ev)` helper (POST `navigator.sendBeacon` to `https://sold-out-sorter.vercel.app/api/unsubscribe?fev=1` with the payload) and fire `{f:'fmb',e:'open'}` on open, `{f:'fmb',e:'step',n}` as each question renders, `{f:'fmb',e:'pick',q,a}` on answer, `{f:'fmb',e:'done',m:<matchCount>}` on results. No PII.
- [ ] **Step 4: Verify** — `node --check assets/gbu-find-my-blaster.js`; manually confirm in a browser preview that opening/answering fires beacons (Network tab) and a quick-add shows `_src` in `/cart.js`.
- [ ] **Step 5: Commit** on a `staging` branch (`feat: Find My Blaster source tag + usage beacons`).

---

## Task 12: Theme — Upgrade Your Blaster tagging + beacon

**Files:** Modify `assets/gbu-upgrade-blaster.js`.

- [ ] **Step 1:** In `addVariant(id, btn)` (line ~389) add `properties: { _src: 'upgrade' }` to the `GBUCartSync.add(...)` call (tags both `quickAdd` and `sheetAdd`).
- [ ] **Step 2:** Append `?_src=upgrade` to the step-2 card `p.url` links (lines ~297, 299, 304) and the variant sheet "View product" link (line ~484).
- [ ] **Step 3:** Add the same `beacon` helper; fire `{f:'ugb',e:'open'}` on open, `{f:'ugb',e:'blaster',b:<handle>}` on blaster pick, `{f:'ugb',e:'fits'}` when step-2 renders, `{f:'ugb',e:'add'}` on a successful `addVariant`.
- [ ] **Step 4: Verify** — `node --check`; browser preview: open UGB, pick a blaster, add → beacons fire and `_src=upgrade` appears in `/cart.js`.
- [ ] **Step 5: Commit** on `staging` (`feat: Upgrade Your Blaster source tag + usage beacons`).

---

## Task 13: Theme — site-wide `_src`→PDP + first-touch `_origin`

**Files:** Create `assets/gbu-src-tracking.js`; Modify `layout/theme.liquid` (load it once near `gbu-ugb-fits.js` line ~492).

- [ ] **Step 1:** Write `assets/gbu-src-tracking.js` — a classic, self-guarded IIFE, listeners on `document`:
  - On load: if `location.search` has `_src` ∈ {find-my-blaster,upgrade}, remember it in `sessionStorage` keyed by the current product id (read from `ShopifyAnalytics.meta.product.id` / the product form), and inject `<input type="hidden" name="properties[_src]" value="…">` as a direct child of the product `<form>` inside `product-form-component`; re-assert on `ThemeEvents.variantUpdate`.
  - First-touch: on a `document` click matching `[data-fmb-open]` or `[data-ugb-open]`, if the cart has no `_origin` yet, POST `/cart/update.js` with `{attributes:{_origin:'find-my-blaster'|'upgrade'}}` (check current cart attributes first; never overwrite).
- [ ] **Step 2:** Add `<script src="{{ 'gbu-src-tracking.js' | asset_url }}" defer></script>` to `layout/theme.liquid` beside the existing global `gbu-ugb-fits.js` include.
- [ ] **Step 3: Verify** — `node --check`; browser preview: open quiz/UGB (origin set once, not overwritten on second open); land on a product via a `?_src=` link and add → the order/cart line carries `_src`.
- [ ] **Step 4: Commit** on `staging` (`feat: site-wide _src→PDP tag + first-touch _origin`).

---

## Task 14: End-to-end live verification

**Files:** none (verification + the theme PR).

- [ ] **Step 1:** On the GBU dev/staging theme, run one full journey per feature: open the quiz, pick a multi-variant blaster, add on the PDP, check out → confirm the order shows `_src=find-my-blaster` on the line and `_origin=find-my-blaster` on the order. Repeat for UGB.
- [ ] **Step 2:** Turn on the `featureFunnels` setting; open `/features` on the deployed app → confirm the page renders real numbers (engagement from beacons, orders/revenue from the tagged orders, behavior + recommendations populated), and the empty state when the range has no data.
- [ ] **Step 3:** Confirm no storefront speed regression (quiz/UGB JS still lazy; `gbu-src-tracking.js` issues no network until engagement) — spot-check with the theme's usual check against the live site.
- [ ] **Step 4:** Open the theme PR `staging → main` (merge = live) only after the owner okays; keep `rollout` in sync. App side deploys via push to `main` (auto-deploys the GBU Vercel project).
- [ ] **Step 5: Commit/PR** and report results faithfully (what passed, what was skipped).

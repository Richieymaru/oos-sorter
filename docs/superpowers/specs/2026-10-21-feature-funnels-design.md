# Feature Funnels — design

**Status:** approved look, design under review
**Date:** 2026-10-21
**Repos:** `oos-sorter` (the Orderly app) **and** `shopify-gbu-horizon` (the GBU Horizon theme)

---

## Intent & why

GBU built two storefront features in the Horizon theme:

- **Find My Blaster** — a 5-question modal quiz (Player → Budget → Power → Build →
  Velocity) that scores the catalogue client-side, shows up to three picks, and can
  add the pick straight to cart or send the shopper to the product page.
  (`assets/gbu-find-my-blaster.js`, `blocks/gbu-find-my-blaster.liquid`,
  `templates/collection.quiz-data.liquid`.)
- **Upgrade Your Blaster (UGB)** — a modal tool, structurally a twin of the quiz:
  "pick the blaster you own, then shop what fits it." Opened by `data-ugb-open` (tiles on
  the parts/accessories/gels/tactical-gear collection pages + the mobile menu). Step 1 =
  pick your blaster (from `/pages/select-your-blaster?view=ugb-guns`); step 2 = what's in
  stock that fits it, split Parts / Accessories / Gels, each card either a quick-add
  (`data-ugb-add`, through `GBUCartSync.add` via `addVariant()`), a variant sheet, or a
  `p.url` product link. (`snippets/gbu-upgrade-blaster.liquid`,
  `assets/gbu-upgrade-blaster.js`; `templates/collection.ugb-data.liquid`,
  `templates/page.ugb-guns.liquid` feed it; `assets/gbu-ugb-fits.js` only *annotates*
  cards/PDP with "fits your blaster" and is not an attribution point.)
  **(Corrected 2026-10-23: the earlier draft wrongly named `by-part.liquid` /
  `gbu-learn-upgrades.liquid`; those are a static part-collection grid and a YouTube
  guide carousel, not this feature.)**

The owner (Johny) cannot currently tell whether anyone uses these, or whether they
produce sales. **The theme emits no analytics today** — grepped the whole theme: no
`dataLayer`, `gtag`, `fbq`, or `analytics.publish`, and the quiz's add-to-cart carries
no source tag. So nothing, anywhere, records that a feature caused a sale.

This project adds a **Feature Funnels** page to the Orderly app that measures, per
feature: **usage** (engagement + quiz step-by-step drop-off), **real conversion**
(orders + revenue the feature drove), **shopper behavior** (which answers people pick,
where demand goes unmet), and generates **ranked, plain-language recommendations** for
raising conversion.

The visual design is approved (light Orderly theme, one scroll). See "The page" below.

## Goals

1. Per feature, show the funnel **engaged → added-to-cart → ordered**, plus the
   **revenue** it drove, on the live Orderly light design system.
2. Attribute real orders and revenue to the feature a purchase came **through**,
   consent-proof, with no code inside checkout.
3. Show the **quiz step-by-step drop-off** and flag the worst step.
4. Show **answer demand vs stock coverage** → surface **unmet demand** (the opportunity).
5. Produce **ranked recommendations** generated from the behavior above.
6. One scrolling page, Orderly light theme, with **no measurable storefront speed cost**.

## Non-goals

- Changing how the features themselves look or behave (we only add lightweight tracking).
- Rolling the panel out beyond GBU for now (GBU-only first; dev store optional).
- Any individual-shopper tracking or PII in behavior analytics (aggregate only).
- Measuring anything else (collection sort order, other features).

## Anti-goals (failure even if it technically works)

- Slowing the storefront or hurting the Shopify speed score.
- Attribution that double-counts — one feature stealing another's sale.
- Numbers that silently undercount without the UI saying so.
- Editing theme core files, or breaking either feature.

## Attribution model (owner-confirmed)

> "basta kung saan siya nakabili, kung hindi nakabili sa unang touch."

- **If an order contains an item that was added _through_ a feature** → credit that
  feature with the order and that item's revenue ("where they bought"). Mechanism: a
  hidden line-item property `_src = find-my-blaster | upgrade` on feature-influenced
  cart adds, read back from the order's line items (`read_orders`, already granted and
  live on GBU). This covers **both** the add made directly inside the quiz **and** the
  add made later on the normal product page the feature steered the shopper to — see
  "Instrumentation" for how the tag reaches the product-page add. Credit attaches to the
  **specific product the feature pointed at**, not to a browsing session, so one feature
  never steals an unrelated item's sale.
- **If there is no purchase** → count the shopper's **first-touch** feature as
  *engagement only* (never as revenue). Mechanism: a cart attribute `_origin`, set
  **once** and never overwritten, when they first open the quiz or land on an upgrade
  page.

Cart attributes and line-item properties both persist through the cart drawer, the
cart page, and **into checkout and onto the order** — so attribution needs no checkout
code (theme scripts cannot run inside Shopify checkout) and is **not consent-gated**,
making it the most trustworthy signal.

## Instrumentation — GBU Horizon theme (separate repo)

Small, scoped additions only; no core-file edits; follows the theme's
`staging → PR → main` workflow (merging to `main` is the live deploy). The features
live in `main` and `rollout`.

**Attribution reaches the product-page add via a tag on the feature's own links**
(owner-confirmed, 2026-10-21): credit attaches to the *specific product the feature
pointed at*, not to a browsing session. The quiz/upgrade product links carry a
`?_src=find-my-blaster | upgrade` param; the tiny site-wide script remembers that
`_src` for the product the shopper landed on and, if that product is added to cart,
puts `properties: { _src: … }` on the line. No session-wide tagging, so an unrelated
item bought later is never credited.

1. **Quiz — `assets/gbu-find-my-blaster.js`:**
   - On **quick-add** (single-variant picks), pass `properties: { _src: 'find-my-blaster' }`
     to the existing `window.GBUCartSync.add(...)` call (it already accepts a `properties`
     arg). ~40 extra bytes on a request that already fires; zero new request.
   - On **multi-variant picks** ("Choose options" / "View" links), append
     `?_src=find-my-blaster` to the product URL, so the add later made on the product
     page is tagged by the site-wide script (below). This is the high-ticket path, so it
     matters most for revenue accuracy.
   - Emit aggregate **usage events** — `opened`, `step_reached:<n>`, `finished`,
     `result:<matchCount>`, and the `picked` answers — via `navigator.sendBeacon` to
     the app (fire-and-forget, non-blocking). No PII. Events fire **only during quiz
     interaction**; the quiz JS already lazy-loads on first open, so initial page load,
     LCP, and the speed score are untouched.

2. **Upgrade (UGB) — `assets/gbu-upgrade-blaster.js`** (mirrors the quiz, since UGB is
   the same kind of modal):
   - In `addVariant(id, btn)` — the **one** place every UGB add funnels through
     (`quickAdd` and the variant-sheet `sheetAdd` both call it) — add
     `properties: { _src: 'upgrade' }` to the `GBUCartSync.add(...)` call. One edit tags
     both add paths.
   - Append `?_src=upgrade` to the step-2 card product links (`p.url`: media, title, the
     "Choose options" link, and the variant sheet's "View product"), so a UGB product
     opened on its own page is tagged by the site-wide script.
   - Emit aggregate **usage events** — `opened`, `blaster_picked`, `fits_viewed`,
     `added` — via `navigator.sendBeacon`. Same no-PII, interaction-only, lazy rules as
     the quiz. (`gbu-ugb-fits.js`, which only annotates cards, is **not** touched — a
     "fits" badge is informational, not a product the shopper opened *from* UGB, so per
     the owner's rule it earns no credit.)

3. **One tiny site-wide script** (a small classic script loaded once from
   `layout/theme.liquid`, following the existing `gbu-*.js` global-script pattern — e.g.
   next to `gbu-ugb-fits.js`; not core edits):
   - **Carry + apply `_src`:** if the current URL has `?_src=…`, remember it for this
     product (e.g. `sessionStorage` keyed by product id), and on that product's page
     inject a hidden `<input name="properties[_src]" value="…">` into the native
     product `<form>` (direct child of the form, re-asserted on `ThemeEvents.variantUpdate`
     since Horizon morphs the button subtree). Shopify's `/cart/add.js` reads
     `properties[…]` from the form automatically — no interception of Horizon's
     `product-form.js` needed. Covers the quiz multi-variant path and the UGB product
     path.
   - **First-touch origin:** set cart attribute `_origin` **once** (never overwritten)
     via `/cart/update.js` when the shopper **opens** either modal — listen on `document`
     for a click on `[data-fmb-open]` → `find-my-blaster`, `[data-ugb-open]` → `upgrade`.
     Tied to the modal *open*, not to being on a page, so a global element never floods
     `_origin` with page-view noise.
   - Listeners bind to `document` (the header re-renders itself); classic script,
     self-guarded against double-execution.
   - Kept tiny; issues **no network until an actual engagement**, so it does not affect
     page speed even though it loads site-wide.
   - *(Exact hook into Horizon's product-form add — event name / interception point — is
     decided in the plan; see "Left to the builder".)*

## App side — Orderly (`oos-sorter`)

### Storage
- Aggregate usage/behavior counters in a **new shop metafield `oos_sort.feature_stats`**
  (same `oos_sort.*` namespace as existing state; persists through uninstall). Rolling
  daily buckets (bounded, e.g. last 90 days) per feature: `opens`, `finishes`,
  per-step `reached`, per-answer `picks`, and `deadEnd` (completed quizzes whose final
  match count was ≤ threshold). Keys and days are capped to keep the metafield bounded.
- **Conversion/revenue is derived on read** from orders (origin / `_src`), **not stored**.

### Endpoints — Vercel Hobby 12-function cap (we are AT 12; no new `api/*.mjs` file)
- **Beacon receiver:** add an `action` branch to an existing endpoint. `api/unsubscribe.mjs`
  already handles CORS + `OPTIONS` for storefront pixel posts and is the natural host;
  `api/webhook.mjs` / `api/product-webhook.mjs` are alternates. It validates input,
  increments `oos_sort.feature_stats`, stores **no PII**. *(Final host chosen in the plan.)*
- **Page render:** a **new view inside `api/index.mjs`** (e.g. `?view=features`), exactly
  as the existing Funnels page is a `?view=funnels` view in the same file — **no new
  function.** Registered in the app shell nav (`ui.mjs`).

### Reads / compute (pure, testable)
- **Orders:** fetch orders in range (reuse `orders.mjs`), read each order's custom
  attribute `_origin` and line-item `_src`; credit a feature with that line's revenue
  when a purchased line's `_src` matches. **Revenue is always per-item, so no sale is
  double-counted.** The hero's per-feature **order** number is "orders this feature
  touched" (an order containing lines from both features counts under both, with a small
  overlap note in the UI) — this keeps revenue exact while making the headline honest.
- **Behavior:** from `feature_stats` → step drop-off + worst step, per-answer demand.
  Stock coverage via `catalog.mjs`, computed **over the quiz's own blaster collection**
  using the **same answer→metafield mapping the quiz uses** (`custom.experience_level`,
  `custom.power_source`, `custom.build_material`, and FPS parsed with the quiz's regex),
  so definitions can't drift from the storefront. Surfaces per-answer coverage and the
  worst combo (e.g. "gas under $300") → unmet demand. FPS is free text on the product, so
  the velocity coverage is approximate and labeled as such.
- **Recommendations:** a **pure function** turning (worst step, biggest unmet combo, low
  upgrade add-rate, …) into ranked actions with a rough, clearly-labeled impact estimate.
  Property/unit-tested offline like the project's other pure logic (`moves.test.mjs`,
  `features.test.mjs`, funnels tests).

### The page (approved mockup)
New **Feature Funnels** page on the Orderly shell (`ui.mjs`), **one scroll, light theme**:
1. **Hero** — revenue the two features drove, trend vs previous period, split into
   quiz vs upgrade orders.
2. **Two feature funnel cards** — emerald = quiz, blue (`--info`) = upgrade; each
   engaged → cart → ordered with drop-% and the revenue it sold.
3. **Behavior** — quiz drop-off as **left-aligned bars (style B)** with the worst step
   in amber; "what shoppers ask for" as a **demand-vs-stock gap** bar (solid = stocked,
   amber stripes = unmet) + an unmet-demand callout.
4. **Do this to lift conversion** — ranked recommendation cards with estimated impact.
- Date range control: 7 / 30 / 90 days.

## Honest limitations (surfaced in the UI)
- Usage counts depend on JS running and the beacon reaching us; a visitor with JS off or
  who blocks it won't be counted. **Revenue via orders is unaffected** (order attributes).
- Baselines build up over time; the first days after launch are thin.
- Recommendation "impact" figures are heuristics, labeled as estimates.

## Constraints (global)
- Node 20.6+, no framework, pure string-render; single dependency (`nodemailer`) unchanged.
- **Vercel Hobby 12-function cap — AT 12.** No new `api/*.mjs`; extend existing endpoints
  via `action`/`view`.
- GBU theme: **no core-file edits**; `staging → PR → main` (merge = live); features in
  `main` + `rollout`.
- Shopify Admin API `2026-07`; validate any new GraphQL via the shopify-admin skill.
- Metafield namespace `oos_sort.*`.
- **No PII** in `feature_stats` or the beacon payload.
- Windows/PowerShell dev; prefer Node over shell one-liners.

## Settled during review (2026-10-21)
- **Quiz credit depth (owner):** follow multi-variant picks to the product page — tag the
  native add via the URL-propagated `_src` — rather than counting quick-adds only.
- **Upgrade scope (owner):** credit only the specific product opened *from* the upgrade
  pages and then bought (tightest; no session-wide stealing).
- **Both-feature orders (my call):** per-item revenue; hero shows "orders touched" per
  feature with an overlap note.
- **Demand/stock source (my call):** quiz's own mapping + collection; FPS approximate.
- **Upgrade feature identity (corrected 2026-10-23):** "Upgrade Your Blaster" is the UGB
  modal (`gbu-upgrade-blaster`), not the `by-part` grid / `gbu-learn-upgrades` carousel the
  first draft named. UGB is a quiz-twin modal with its own add-to-cart, so both features
  are instrumented symmetrically, and first-touch `_origin: upgrade` fires on **modal
  open** (not page view) — scarce and meaningful even though the snippet renders globally.

## First build step (load-bearing verification)
Before committing to the attribution model, verify against the live **2026-07** Admin
schema (via the shopify-admin skill) that underscore-prefixed **line-item properties
(`_src`)** and **cart attributes (`_origin`)** are returned on the Order through
`read_orders` (order `customAttributes` / line-item `customAttributes`). The underscore
only hides them from storefront/email display, so they should be present — but the whole
scheme rests on it, so prove it with one query first.

## Left to the builder (resolved in the plan)
- Final endpoint that hosts the beacon receiver (candidate: `api/unsubscribe.mjs`,
  already CORS-ready), confirmed against the live 12-function list.
- The exact Horizon product-form add-to-cart hook used to apply the `_src` line tag.
- `feature_stats` schema shape, bucket/retention caps, and beacon validation/rate-guard.
- Recommendation heuristics, thresholds, and impact-estimate formulas.
- Tests for the pure logic (attribution reducer, stats aggregation, recommendations).

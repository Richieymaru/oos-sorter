# OOS Sorter — project context

Pushes sold-out products to the end of Shopify collections and returns them to
their exact original position on restock. Single-store internal tool, not an App
Store product. No framework, no database, no hosting — a Node script on a cron.

Owner: Johny, Shopify developer. Target stores are his own/client stores
(currently testing on a dev store; GBU and GRI later).

---

## READ THIS FIRST: how the previous assistant got things wrong

Shopify changed substantially in 2026. Model training data on Shopify app
development is stale in ways that are *not obvious* — the old answers are
coherent, plausible, and wrong. Three real errors happened building this:

**1. Invented an auth flow that no longer exists.**
Wrote setup docs telling the user to go to Settings → Apps → Develop apps,
create a custom app, and copy a `shpat_` token. That flow was retired
1 Jan 2026. Sent the user hunting through the UI for a token that does not
exist anywhere, twice, and told him "neither" when he correctly asked whether
Client ID and Secret were what he needed. They were.
→ **Reality:** Dev Dashboard apps use the client credentials grant. You POST
client_id + client_secret to `/admin/oauth/access_token` and get a `shpca_`
token valid 24 hours. Nothing is copyable from the admin UI.

**2. Hardcoded a stale API version.**
Defaulted to `2025-10`. The store's actual supported list is
`2025-10, 2026-01, 2026-04, 2026-07`. Not fatal, but every version-dependent
assumption in the code inherited that staleness.

**3. Shipped a reorder algorithm that was elegant and wrong.**
See "Move calculation" below. Caught only because it was property-tested.

**The rule for this project:** before stating anything about Shopify's admin UI,
app creation, authentication, dashboards, or API surface — verify it against
current docs or ask the user to screenshot what he actually sees. Do not
reconstruct workflows from memory. If the user says the UI doesn't match your
description, he is right and you are wrong; ask for a screenshot rather than
repeating the instruction.

Corollary: when the user pushes back, re-check before defending. The "neither"
answer above cost him ~20 minutes of clicking through screens.

---

## Current state

Auth works. `check-setup.mjs` passes against the dev store:
scopes `read_products`, `write_products`, `read_inventory` all granted
(`write_inventory` also granted but unused — drop it on future apps).
`read_locations` is *not* granted — `locations { name }` returns ACCESS_DENIED,
though `locations { id }` works. Only matters if stock logic ever goes
per-location.

`SHOPIFY_API_VERSION=2026-07` is pinned in `.env` and every query the engine
issues has been checked against the store's own introspected schema (see
"Known rough edges" — one real bug was found and fixed). The whole read path
has been exercised live in DRY_RUN against an existing collection.

Move math is property-tested: `node moves.test.mjs`, 17k+ checks, no env or
network needed. Covers the restock-returns-to-base property and idempotence
(a settled collection emits 0 moves on rerun, so the cron doesn't churn).

**Steps 1–4 are DONE. The engine works end to end.** Verified 24 Jul 2026
against `frontpage` on the dev store (117 products, 56 sold out — the store's
own sample data, used instead of a purpose-seeded collection):

2. Dry run: 55 planned moves, no writes. ✓
3. Real run: `MOST_RELEVANT -> MANUAL`, metafield written (117 ids, 1873 bytes),
   all 56 sold-out products landed in exactly indices 61–116, none misplaced. ✓
   *This step failed the first time — see "the sequencing bug" below.*
4. **The restock test passed.** Restocked "Stainless Chef Knife" (base position
   47, parked at 85 while sold out). Predicted landing index **23** *before*
   writing anything — index 23 not 47 because 24 products ahead of it in base
   order are themselves sold out and pushed down. It landed at exactly 23,
   between its correct base neighbours, and the engine emitted **1 move**. ✓

Also confirmed live: rerunning on a settled collection emits 0 moves, so the
cron won't churn. In-stock and sold-out runs each preserve base relative order.

**Three features now exist, each with its own switch (built 24 Jul 2026).**
The engine is no longer sort-only. See "Feature toggles" below. Design doc:
`docs/superpowers/specs/2026-07-24-oos-sorter-toggle-features-design.md`.

- `FEATURE_SORT` — the push-to-bottom engine above (default on).
- `FEATURE_NOTIFY` — one Gmail digest per day (~4pm) of *newly* sold-out
  products, plus an on-demand `report.mjs`. Verified live: transition detection
  + shop-metafield state persist across runs (run 1 = 55 new, run 2 = 0 new).
  Real email send NOT yet tested — needs the owner's Gmail App Password.
- `FEATURE_DRAFT` — set sold-out products to Draft, restore to Active on
  restock. Verified live end-to-end through `main()` on one hydrogen product:
  sold out → drafted → restocked → restored. Reversible; store left clean.

Deployment is the only thing left.

---

## Files

| File | Purpose |
|---|---|
| `sort-oos.mjs` | the engine + feature orchestration (main entry point) |
| `shopify.mjs` | shared Admin GraphQL client (token, throttle, shop id) |
| `stock.mjs` | `isInStock()` — the one place stock is decided |
| `features.mjs` | pure decision logic for notify/draft (diff, plan, retain) |
| `state.mjs` | shop-level `oos_sort.state` metafield (notify/draft memory) |
| `draft.mjs` | set/restore product status; fetch-by-id for restock detection |
| `notify.mjs` | Gmail digest + report emails (only module that knows email) |
| `report.mjs` | on-demand "email me the sold-out list now" (the button) |
| `auth.mjs` | client credentials grant |
| `check-setup.mjs` | pre-flight: token, scopes, API version |
| `moves.test.mjs` | property test for the move math — pure, no env, no network |
| `features.test.mjs` | unit tests for notify/draft decision logic — pure |
| `inspect-collection.mjs` | read-only snapshot / diff of a collection's live order |
| `package.json` | one dependency: nodemailer (for Gmail). Run `npm install`. |
| `README.md` | setup + tradeoffs (auth section may still lag CLAUDE.md) |
| `.github/workflows/oos-sort.yml` | the cron: 5-min engine run + daily digest |
| `vercel.json` | routes `/` to the settings page |
| `api/*.mjs` | settings page (index/save/report), `_auth` guard, **`run`** (cron endpoint) |
| `settings.mjs` / `panel.mjs` | toggles metafield I/O / pure page render + auth |

Run with `npm install` once, then `node --env-file=.env sort-oos.mjs` (Node
20.6+). One dependency now (nodemailer). User is on Windows/PowerShell — `curl`
is aliased to `Invoke-WebRequest`, bash `\` continuations don't work, and
`Select-Object -First`/piping into a truncating consumer makes node exit 255
(SIGPIPE) — cosmetic, not a script failure. Prefer Node over shell one-liners.

---

## Feature toggles

Three independent switches (metafield `oos_sort.settings`, or env `"true"`/
`"false"` override), applied to the resolved collections. Default all off.

**Collections are auto-discovered.** `COLLECTION_HANDLES` empty (or `"all"`) =>
sort *every* collection in the store; `resolveHandles()` fetches them via
`fetchAllCollectionHandles()`. Set a comma-separated list to restrict to those.
Chosen by the owner 25 Jul 2026 — note this flips every collection to `MANUAL`
sort on first touch (same as Nada does; verified it's a hard Shopify rule that
reordering requires MANUAL — there is no way to reorder while keeping an
automatic sort, for us or Nada).

- `FEATURE_SORT` — push sold-out to the bottom (the original engine).
- `FEATURE_NOTIFY` — accumulate newly-sold-out across the day; send ONE Gmail
  digest at the ~4pm run (the run with `SEND_DIGEST=true`, set by a dedicated
  cron line). `report.mjs` emails the full current list on demand (the
  "button", wired to `workflow_dispatch`). Needs `GMAIL_USER`,
  `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL`.
- `FEATURE_DRAFT` — draft sold-out products (hidden store-wide), restore on
  restock. Only drafts ACTIVE products and only un-drafts ones it drafted
  itself (tracked in `oos_sort.state.drafted`).

**Feature memory lives in one shop metafield, `oos_sort.state`** (separate from
the per-collection `oos_sort.base_order`): `{ soldOut, drafted, pending,
lastDigest }`. First run establishes the sold-out baseline and sends no digest
by design — otherwise day one would email every currently-sold-out product. Use
`report.mjs` to get the full list any time.

**Owner still needs to provide:** a Gmail App Password for you@example.com
(that account is both sender and recipient; 2-step verification required). Real
email delivery is the one path not yet tested live — no app password on hand.
Timezone resolved: Philippines (UTC+8), so 4pm = 08:00 UTC, which is already the
digest `cron:` line — no edit needed.

**Scaling to many collections: webhook-driven, not full-scan.** A full run scans
every collection; at hundreds of collections that blows the Vercel 60s limit and
Shopify's rate limit. So `/api/webhook` (topic `INVENTORY_LEVELS_UPDATE`,
registered via `register-webhook.mjs`) fires on every inventory change and
re-sorts ONLY that product's collections (`collectionsForInventoryItem` →
`runEngine({ handles })`). Near-instant, and independent of total collection
count. Targeted runs skip the notify diff and don't overwrite the store-wide
`soldOut` state (partial scan) — the periodic `/api/run` full sweep maintains
those. Guarded by `WEBHOOK_TOKEN` in the callback URL.

**Scheduling: do NOT rely on GitHub's cron.** GitHub's free scheduled workflow
is unreliable — observed 1 run in 90 minutes on a `*/5` schedule, nowhere near
every 5 min. The reliable trigger is a free external cron service (cron-job.org)
hitting the Vercel endpoint `POST/GET /api/run?token=RUN_TOKEN` every 5 minutes;
that fires on time. `runEngine()` (exported from `sort-oos.mjs`) is the shared
entry point for the CLI, the GitHub workflow, and the endpoint. GitHub Actions
stays as a manual "Run workflow" backup. `/api/run` sets `maxDuration: 60`;
fine for this store (~15s runs) — a very large store could need Vercel Pro.

**Architecture note:** `sort-oos.mjs` was refactored from one file into small
modules (`shopify`, `stock`, `features`, `state`, `draft`, `notify`). The pure
move math and pure feature logic stay import-only and property-tested offline
(`npm test` = `moves.test.mjs` + `features.test.mjs`).

---

## Decisions already made — don't re-litigate

**State lives in a Shopify metafield**, `oos_sort.base_order` on each collection:
a JSON array of short numeric product IDs. Deliberate — no external database to
host or back up. Short IDs keep it under the metafield size limit.

**Reordering requires `sortOrder: MANUAL`.** Shopify rejects
`collectionReorderProducts` otherwise. This is why the first run must happen
*before* anyone changes sort order by hand — run one captures the collection's
current order and freezes it as the base.

**Move calculation is the subtle part.** `collectionReorderProducts` applies
moves sequentially, each `newPosition` evaluated against the array state at that
moment (remove, then insert). A longest-increasing-subsequence approach was
tried first and is **wrong** — it fails ~78% of random reorders, because a
"kept" item can be displaced by a later move. The shipped version runs an
ascending greedy (locks a correct prefix) and a descending greedy (locks a
correct suffix) against a simulation, then keeps whichever produced fewer moves.
Verified on 5,000 random permutations. On 500 products with 68 sold out it emits
68 moves, not 500.

If you touch `computeMoves` or `greedyMoves`: the functions are pure, so
property-test them against a local simulation of remove-then-insert semantics
before trusting anything. No store or API calls needed. That is exactly how the
LIS bug was caught, and it would have shipped silently otherwise.

**The sequencing bug — the second elegant-and-wrong thing this project has hit.**
Setting `sortOrder: MANUAL` does *not* preserve the order you were just reading
under the collection's previous sort. Shopify stores a **separate manual
position list**, and flipping to MANUAL swaps the live order over to it.
Measured on an 8-product automated collection: the flip changed all 8 positions.

The engine used to read products, compute moves, *then* flip to MANUAL, then
apply. So the moves were computed against an array that no longer existed.
Property-tested after the fact: computing against the stale array produces the
wrong order in **498 of 500** random cases.

It only lost 2 products out of 117 in the live run, which is exactly what made
it dangerous — the workload emits an explicit "put X at index N" for nearly
every sold-out product, and those are self-correcting whatever the starting
array. The casualties were the products that needed *no* move under the old
order: no move emitted, so they sat wherever the manual list had them. A
sold-out Gift Card stranded at index 6 of 117.

Fix: flip to MANUAL **first**, re-read the collection, then compute moves
against what is actually there. `processCollection()` does this now and logs
`re-read order after MANUAL switch`. `alignDesired()` guards the second read in
case membership drifted.

Consequence for dry runs: on a not-yet-MANUAL collection the dry-run plan is
*indicative only* — the real order isn't knowable without performing the flip.
The engine says so in its output. Don't "fix" that by trusting the dry-run count.

**"Sold out" = no inventory at ONLINE-fulfilling locations, not zero total.**
`isInStock()` counts each variant's available quantity only at locations where
`fulfillsOnlineOrders = true` (`variant.onlineAvailable`, computed in
`catalog.mjs`). This matches the storefront: a product stocked only at a
third-party/warehouse location (e.g. Shopify's "3p Fulfilled" demo product,
20 units at "Snow City Warehouse") shows "Sold out" online, and the engine now
agrees — `totalInventory` and `sellableOnlineQuantity` both wrongly counted it.
Needs the `read_locations` scope (added 25 Jul 2026). All product fetches go
through `catalog.mjs` so every path (sort, report, draft-restore, inspect) uses
the same online-availability definition — a product fetched without it has no
`onlineAvailable` and would look sold out, so never bypass `catalog.mjs`.

**Stock logic is isolated in `isInStock()`.** Untracked inventory and
oversell-enabled variants count as in stock. Multi-location or Markets rules go
in that function and nowhere else.

---

## Auth model

Dev Dashboard app + custom distribution. One app per store, permanently bound —
distribution method cannot be changed after it's set, and GBU/GRI each need
their own app.

`auth.mjs` resolves a token in this order:
1. `ADMIN_TOKEN` if set (legacy custom app, or an offline token from the
   authorization code grant) — used as-is, doesn't expire
2. otherwise `CLIENT_ID` + `CLIENT_SECRET` → client credentials grant → `shpca_`
   token, 24h, cached in-process

**Known limit that will bite on GBU:** client credentials only works when the
app and store are in the *same Dev Dashboard organization*. Owning the store or
having the app installed is not sufficient. GBU is a client store and probably
isn't in the org → expect `shop_not_permitted`. `auth.mjs` catches that error
specifically and explains it. The fix is a one-time authorization code grant,
which yields a non-expiring offline token that goes in `ADMIN_TOKEN`. Not built
yet.

Env: `SHOP_DOMAIN`, `CLIENT_ID`, `CLIENT_SECRET`, `COLLECTION_HANDLES`.
Optional: `SHOPIFY_API_VERSION` (pin to `2026-07`), `PIN_TAG`, `IGNORE_TAG`,
`DRY_RUN`, `ADMIN_TOKEN`.

Security: `.env` holds credentials with product write access. It's gitignored,
but the project folder is under OneDrive and syncs to the cloud. Fine for a
throwaway dev store; move it outside OneDrive before doing the GBU one.

---

## Known rough edges

- ~~`collectionUpdate` input shape and the `productsCount` field~~ — resolved by
  introspecting the store's own 2026-07 schema, 24 Jul 2026:
  - **`collectionUpdate` was genuinely broken.** In 2026-07 the argument is
    `collection: CollectionUpdateInput`, *not* `input: CollectionInput!`. The
    old shape would have failed on the first non-dry run, at the exact moment
    the collection gets flipped to MANUAL. Fixed, with a comment on the
    mutation so nobody "restores" the old shape from memory.
  - `productsCount { count }` is correct — `Collection.productsCount` is type
    `Count`. No change needed.
  - `MoveInput.newPosition` is `UnsignedInt64!`, which serialises as a string,
    so the existing `String(k)` is right.
  - Also note `CollectionCreateInput` no longer takes `products` or `ruleSet`;
    rule-based collections now go through `sources`. Irrelevant to this tool,
    relevant if anything ever creates collections.

  The introspection scripts are in the scratchpad, not the repo. Rerun the same
  check before moving to a newer API version — it takes a minute and it caught
  a guaranteed production failure.
- **Automated (rule-based) collections CAN be set to MANUAL.** I expected
  Shopify to refuse this and it does not — `collectionUpdate` accepted it with
  no userErrors and `collectionReorderProducts` then worked normally. Tested,
  not assumed. `frontpage` on the dev store is automated
  (`VARIANT_INVENTORY GREATER_THAN -1`) and is now MANUAL with a base_order.
- **`product.totalInventory` lags inventory writes.** Right after an
  `inventorySetQuantities` the engine still read the old value and reported the
  product as sold out; a rerun moments later saw it. Irrelevant for an hourly
  cron, but don't debug a "restock didn't work" report without re-reading first.
- **Inventory mutations now need `@idempotent`.** Not used by this tool (it only
  reorders), but if anything here ever writes inventory:
  `inventorySetQuantities(input: $input) @idempotent(key: "<uuid>")`. Optional
  as of 2026-01, **required** as of 2026-04. `InventoryQuantityInput` also
  requires `changeFromQuantity` (compare-and-set) and has no
  `ignoreCompareQuantity` field.
- **Query cost ceiling is 1000.** `products(first: 250)` with
  `variants(first: 100)` and anything nested under the inventory item blew past
  it at 1323. The engine's current query is fine at this shape, but adding
  fields under `variants` is the thing that will break it on a big collection.
- **`productUpdate` argument is `product: ProductUpdateInput`, not `input`** —
  same trap `collectionUpdate` had. Verified against the store's 2026-07 schema
  before writing `draft.mjs`. Status enum: ACTIVE / ARCHIVED / DRAFT / UNLISTED.
- **Drafted products still appear in Admin API collection reads.** Tested live:
  drafting a frontpage product kept the collection count at 117 and the product
  at its position with `status: DRAFT`. So base-order position memory survives
  a draft naturally — `retainBaseOrder` is belt-and-suspenders on top of that.
  (Draft only hides from the *storefront*, not from admin membership.)
- **`totalInventory` lags inventory writes** (reconfirmed while testing draft).
  Right after `inventorySetQuantities` the product still reads the old
  `totalInventory`, so `isInStock` sees the stale value for a few seconds. Fine
  for a 15-min cron; only bites rapid-fire scripts (poll before asserting).
- **`inventorySetQuantities` needs `@idempotent(key: "<uuid>")`** (required as
  of 2026-04) and `InventoryQuantityInput.changeFromQuantity` (compare-and-set).
  Only the test scripts write inventory; the engine itself never does.
- New products are appended to the base order. Change `base.push` to
  `base.unshift` in `processCollection()` if new arrivals should lead.
- Search & Discovery filtered pages ignore manual collection order. Platform
  limitation; affects every competing app too. Not fixable here.
- A harmless `Assertion failed: ... src\win\async.c, line 76` appears on Windows
  when the process exits with a socket open. Cosmetic. Worth cleaning up but
  it's not an error in the logic.

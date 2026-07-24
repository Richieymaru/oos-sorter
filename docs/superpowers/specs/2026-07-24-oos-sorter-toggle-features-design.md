# OOS Sorter — Notify, Draft, and feature toggles

**Date:** 2026-07-24
**Status:** design, awaiting review
**Builds on:** the existing sort engine (`sort-oos.mjs`), which is verified working
against the dev store (see `CLAUDE.md`).

---

## Goal

Turn OOS Sorter from a single-purpose sort script into three independently
switchable features, without changing its fundamental shape: still a Node
script on a timer (GitHub Actions cron), still no hosting, still no database.
State continues to live in Shopify metafields.

Three features, each with its own on/off switch:

1. **Sort** — push sold-out products to the bottom / last page of a collection.
   *(This is the existing engine; unchanged in behaviour.)*
2. **Notify** — send **one digest email per day** (around 4pm) listing every
   product that **newly** sold out during that day. Plus an **on-demand report**
   (manual trigger / local command) that emails the current full sold-out list
   whenever asked.
3. **Draft** — set sold-out products to **Draft** status (hidden store-wide),
   and back to **Active** when they restock.

The switches are independent: any combination is valid. The common case is
Sort + Notify on, Draft off (products stay visible, just pushed down). Draft is
for merchants who want a storefront with no sold-out products visible at all.

---

## Non-goals (explicitly out of scope for this spec)

- **No hosted app / no admin UI.** Switches are config values, not clickable
  checkboxes. (Decided with the owner: stay on the timer model.)
- **No instant/webhook reaction.** Reaction is bounded by the cron interval
  (near-real-time, not real-time). A product that sells out mid-interval is
  handled on the next run.
- **No in-app UI button.** The on-demand "give me the sold-out list now" action
  is delivered as a GitHub Actions manual trigger (`workflow_dispatch`) and a
  local `report.mjs` command — not a button inside a hosted app screen. A real
  in-app button is the hosted-app path, deliberately deferred.
- **No per-collection switches** in this version. Switches are global, applied
  to every collection in `COLLECTION_HANDLES`. Per-collection control is a
  possible later iteration.

---

## Configuration

New environment variables (in `.env`, and as GitHub Actions secrets for the
cron). All booleans are `"true"`/`"false"` strings, matching the existing
`DRY_RUN` convention.

| Var | Default | Meaning |
|---|---|---|
| `FEATURE_SORT` | `true` | Push sold-out products to the bottom |
| `FEATURE_NOTIFY` | `false` | Email on newly sold-out products |
| `FEATURE_DRAFT` | `false` | Set sold-out products to Draft status |
| `NOTIFY_EMAIL` | — | Recipient for alerts. For testing: `stainesrinand@gmail.com` |
| `GMAIL_USER` | — | The Gmail address the mail is sent *from* |
| `GMAIL_APP_PASSWORD` | — | 16-char Gmail App Password (needs 2-step verification on the account) |
| `SEND_DIGEST` | `false` | Set by the daily 4pm cron entry — send the accumulated digest this run |

The on-demand report is a separate entry point, `report.mjs` (run directly or
via the `workflow_dispatch` "report" mode), not a flag on the main run.

Existing vars (`SHOP_DOMAIN`, `CLIENT_ID`, `CLIENT_SECRET`,
`COLLECTION_HANDLES`, `SHOPIFY_API_VERSION`, `PIN_TAG`, `IGNORE_TAG`,
`DRY_RUN`, `ADMIN_TOKEN`) are unchanged.

If `FEATURE_NOTIFY` is on but the three email vars are missing, the run fails
fast with a clear message rather than silently not emailing.

---

## State model

Metafields under the existing `oos_sort` namespace.

| Key | Owner | Type | Purpose | Status |
|---|---|---|---|---|
| `base_order` | each collection | json (array of short IDs) | merchant's intended order | **existing** |
| `state` | **shop** | json (object, below) | everything the new features need to remember | **new** |

The shop-level `oos_sort.state` blob:

```jsonc
{
  "soldOut":  ["123", ...],        // ids sold out as of last run (transition detection)
  "drafted":  ["456", ...],        // ids the app itself set to Draft (safe restore)
  "pending":  [                     // newly-sold-out accumulated since last digest email
    { "id": "789", "title": "Woven Belt", "collections": ["frontpage"] }
  ],
  "lastDigest": "2026-07-24"       // date the last digest email was sent (dedupe per day)
}
```

`soldOut`, `drafted`, and `pending` are product-global facts (a product is sold
out / drafted or not, regardless of collection), so they live once at the
**shop** level. This also dedupes email when a product sits in several managed
collections. `base_order` stays per-collection because order is inherently
per-collection. One blob = one metafield read + one write per run.

`metafieldsSet` accepts `ownerId` = the shop's GID; no new scope needed.

---

## Per-run algorithm

Pseudocode for one cron run. `isInStock()` is the existing, unchanged stock
decision.

```
state = loadShopState()          // { soldOutPrev: Set, drafted: Set }
soldOutNow = new Set()           // ids, accumulated across all collections (for the diff)
soldOutInfo = new Map()          // id -> { title, collections[] } (for the email body)

// --- Phase 1: restore restocked drafts (global, only if FEATURE_DRAFT) ---
if FEATURE_DRAFT and state.drafted.size:
    products = fetchProductsById(state.drafted)      // by ID, not via collection
    restored = products.filter(isInStock)            // back in stock
    setStatus(restored, ACTIVE)                       // un-hide
    state.drafted = state.drafted - restored.ids

// --- Phase 2: per collection ---
for handle in COLLECTION_HANDLES:
    products = fetchProducts(collection)              // existing path
    soldOut  = products.filter(not isInStock)
    soldOutNow.add(soldOut.ids)
    for p in soldOut: soldOutInfo[p.id].collections += handle   // for the email

    if FEATURE_SORT:
        // existing engine, including the MANUAL-flip + re-read fix.
        // base_order retains drafted IDs (see "Sort + Draft" below) so a
        // product keeps its slot across a draft/restore cycle.
        reorderToDesired(collection, products, base_order)

    if FEATURE_DRAFT:
        toDraft = soldOut.filter(status == ACTIVE)
        setStatus(toDraft, DRAFT)
        state.drafted.add(toDraft.ids)

// --- Phase 3: accumulate newly-sold-out into the pending digest ---
newlySoldOut = soldOutNow - state.soldOutPrev
state.pending = mergePending(state.pending, newlySoldOut, soldOutInfo)   // dedupe by id

// --- Phase 4: send the digest, but only at the daily slot ---
// SEND_DIGEST is set by the dedicated ~4pm cron entry (or REPORT_NOW for the
// on-demand button). ON_DEMAND emails the current full sold-out list instead.
if FEATURE_NOTIFY and ON_DEMAND:
    sendReportEmail(soldOutNow, soldOutInfo)          // full current list, now
else if FEATURE_NOTIFY and SEND_DIGEST and state.pending.size and state.lastDigest != today:
    sendDigestEmail(state.pending)                    // the day's newly-sold-out
    state.pending = []
    state.lastDigest = today

// --- Phase 5: persist ---
saveShopState({ soldOut: soldOutNow, drafted: state.drafted,
                pending: state.pending, lastDigest: state.lastDigest })
```

Ordering rationale: restore-before-draft so a product that sold out and
restocked within the same interval nets out correctly; notify last so it
reflects the full run; state saved last so a mid-run crash doesn't record work
that didn't happen.

---

## Feature interactions (the subtle parts)

**Sort + Draft together.** A drafted product is hidden on the storefront but may
still be a collection member in the Admin API. Two consequences:

1. The reorder only ever emits moves for products present in the live read
   (`alignDesired` already drops absent IDs), so a drafted product that isn't
   returned simply isn't moved — no error.
2. **Position memory must survive drafting.** `base_order` is filtered to
   "present" products each run; if a drafted product drops out of the read it
   would be lost from `base_order` and, on restore, treated as a brand-new
   product appended at the end — losing its original slot. Fix: when filtering
   `base_order`, keep any ID that is present **or** in the `drafted` set. The
   drafted product holds its slot until it restocks and reappears.

**Draft replaces Sort's effect per product.** Once hidden, a product's position
is moot. Sort and Draft don't fight — Sort orders whatever is visible, Draft
removes sold-out from view. Enabling both = clean storefront + preserved
ordering for when products come back.

**Restock detection for drafts does not depend on collection reads.** Phase 1
re-queries the `drafted` IDs **directly by product ID**, so restore works
regardless of whether Admin collection reads include draft-status products.
This sidesteps the one behaviour we're unsure of. *(We'll still confirm the
Admin-read behaviour during build, because it affects Sort+Draft position
memory above — but restore itself is robust either way.)*

**Notify never double-fires.** A product still sold out on the next run is in
both `soldOutPrev` and `soldOutNow`, so it's not "new." Only fresh transitions
into sold-out are emailed.

---

## Email

Sent via Gmail SMTP using **nodemailer** (`smtp.gmail.com`, port 465, TLS),
authenticated with `GMAIL_USER` + `GMAIL_APP_PASSWORD`.

- **This adds the project's first dependency** and therefore a `package.json`
  and an `npm install` step (locally and in the GitHub Actions workflow). Noted
  and accepted by the owner in exchange for not signing up for a mail API.
- **Two email shapes, one module (`notify.mjs`):**
  - **Daily digest** — sent once per day at the ~4pm slot, listing every product
    that newly sold out that day. Subject e.g. `OOS Sorter: 3 products sold out today`.
  - **On-demand report** — the full current sold-out list, sent immediately when
    the manual trigger / `report.mjs` runs. Subject e.g. `OOS Sorter: sold-out report`.
- Both list product titles and the collection(s) each is in.
- Transport is isolated so a future switch to an email API touches only this module.

### Scheduling the daily 4pm email

GitHub Actions cron runs in **UTC**, so "4pm" is set by choosing the right UTC
time for the owner's timezone. Two schedules in one workflow:

- frequent run (e.g. `*/15 * * * *`) → sort + draft + accumulate pending; no email.
- daily run at the owner's 4pm (one `cron:` line in UTC) → same, but with
  `SEND_DIGEST=true`, so it also sends the digest.

The workflow branches on `github.event.schedule` to set `SEND_DIGEST`. The
`lastDigest` date guard means even if the daily slot fires more than once, only
one email goes out per day. The on-demand button is `workflow_dispatch` with
`REPORT_NOW=true`.

**Timezone (resolved):** Philippines, UTC+8 (no DST). 4pm local = 08:00 UTC,
which is already the digest cron line — no edit needed.

---

## Testing

Same discipline as the sort engine (pure functions, property/unit tested
offline before touching the store).

New pure functions to test:
- `diffNewlySoldOut(prevSet, currentSoldOutSet)` → the newly-sold-out IDs.
- `planDraftActions(soldOutNow, statusById, appDraftedSet)` → `{ toDraft, toRestore }`.
- `retainBaseOrder(storedBase, presentIds, draftedSet)` → base order that keeps
  drafted ghosts (the Sort+Draft position-memory rule).

Integration checks:
- **Dry-run** (`DRY_RUN=true`) prints what it *would* do — which email (and to
  whom), which products would be drafted/restored, which moves — and writes
  nothing.
- Live verification on the `frontpage` dev-store collection, feature by feature:
  Notify alone, then Draft alone (confirm draft→restore round-trips and the
  product returns to its base slot), then all three together.

---

## Things to verify during build (not assume)

- **Does the Admin API `collection.products` include Draft-status products?**
  Affects Sort+Draft position memory (handled defensively regardless). Verify by
  introspection/test against the store, per the project's standing rule.
- **Exact mutation for status change** (`productUpdate` vs `productSet`) and its
  2026-07 input shape — introspect the store's schema, don't reconstruct from
  memory. `write_products` is already granted; no new scope.
- **Gmail App Password** actually authenticates from the GitHub Actions runner
  (some Google accounts need the app password + no extra security block).

---

## User setup tasks (outside the code)

1. Generate a **Gmail App Password** for `GMAIL_USER` (needs 2-step verification
   enabled) and put it in `.env` / GitHub secrets.
2. Add `NOTIFY_EMAIL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and the three
   `FEATURE_*` flags to `.env` and to the GitHub Actions secrets.
3. Add an `npm install` step to the workflow (created as part of the build).

---

## Summary of files (planned)

| File | Change |
|---|---|
| `sort-oos.mjs` | orchestrate the three phases; read feature flags; retain-base-order rule |
| `notify.mjs` | **new** — Gmail summary email, isolated transport |
| `state.mjs` | **new** — load/save shop-level `sold_out` + `drafted` metafields |
| `draft.mjs` | **new** — plan + apply Draft/Active status changes |
| `*.test.mjs` | **new** — offline tests for the pure functions above |
| `package.json` | **new** — declares the one dependency (nodemailer) |
| `github-actions-workflow.yml` | add `npm install`; add new secrets |
| `.env.example` | document the new vars |
| `check-setup.mjs` | optionally verify email creds + status-change permission |

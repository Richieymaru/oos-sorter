# Waitlist Notified Log + Engagement Tracking — design

**Date:** 2026-09-25
**App:** GBU Store Ops (OOS Sorter), the back-in-stock waitlist feature
**Status:** Approved in chat; spec for review before planning.

## Goal

Give the merchant visibility into what happens *after* a back-in-stock email is
sent — who was notified, which products came back, whether the shopper came back
to the product — and the ability to re-nudge shoppers who didn't act. Today all
of this is impossible because notifying a shopper **deletes** their record.

## Intent (agreed understanding)

Johny (Shopify dev, GBU) asked, on the Waitlists page of GBU Store Ops, to be
able to:

1. know who was notified,
2. know which products got restocked,
3. know whether notified shoppers engaged (added to cart / ordered),
4. resend / send a fresh email to shoppers who missed the first one.

Decisions made during brainstorming:

- **Engagement, phased:** ship **email click-through** ("did they come back to
  the product from our email") now — cheap, no new Shopify permissions. **True
  order attribution is Phase 2** (deferred): it needs orders / protected-customer
  -data access. Add-to-cart is *not* tracked directly (no reliable server signal
  without a Web Pixel identifying the shopper); click-through is the proxy.
- **Resend:** manual **Resend** button **plus** a one-time automatic **nudge**
  after N days (default 2) if the shopper hasn't clicked/ordered and the product
  is still in stock. Capped at exactly one nudge; honors unsubscribe.
- **History:** a **rolling recent window** (~most-recent 1000) kept in a shop
  metafield. No database, no Google Sheet — matches the app's design.

## Global constraints (carry into every task)

- **Vercel Hobby caps the deploy at 12 serverless functions and the app is AT 12**
  (`api/*.mjs` files not prefixed `_`). **This build adds ZERO new `api/` files.**
  New behavior folds into existing endpoints (click + unsub-flag → `api/unsubscribe.mjs`;
  resend → `api/waitlists.mjs` POST; auto-nudge → the `/api/run` engine pass).
- **Shopify metafield JSON value cap = 131072 bytes** (see `state.mjs`). The
  notified log must trim-to-fit under that, same pattern as `saveState`.
- **No new Shopify scopes in Phase 1.** Orders access is Phase 2 only.
- **No hosting / no database.** State lives in shop metafields.
- **Pure core + offline tests.** Decision logic is pure and unit-tested with no
  env/network, matching `waitlist.test.mjs` / `features.test.mjs`.
- **Sold-out / in-stock is decided only by `isInStock` / `isVariantInStock`**
  (online-availability), never re-derived.
- **Windows/PowerShell dev env.** Prefer Node over shell one-liners.

## Architecture overview

One new module, `notified.mjs`, owns a new shop metafield `oos_sort.notified`
(separate from `oos_sort.state`, `oos_sort.settings`, `oos_sort.monitor`). It has
a pure core (list transforms, nudge selection, stats) and thin metafield I/O,
exactly like `waitlist.mjs`. Everything else is small edits wiring it in:

- `restock.mjs` — after a successful back-in-stock send, **record** a log row
  (in addition to the existing waitlist prune). Adds a `nudgeUnengaged()` pass.
- `notify.mjs` — the back-in-stock email's links become **tracked redirect URLs**;
  add a `buildNudge` / `sendNudge` "still available" email.
- `api/unsubscribe.mjs` — gains a **click** branch (mark clicked → 302 to the
  storefront) and also flags matching log rows unsubscribed on unsubscribe.
- `api/waitlists.mjs` — GET renders the log (stats + "Recently notified" table +
  Resend buttons); POST gains a **`resend`** action.
- `sort-oos.mjs` (`runEngine`) — calls `nudgeUnengaged()` in the full pass.
- `settings.mjs` + settings page — optional `nudgeDays` (default 2).

## Data model

Shop metafield `oos_sort.notified`, `type: json`, a JSON array **newest-first**,
capped so the serialized value stays under 131072 bytes (target cap ~1000 rows;
trim oldest until it fits, like `saveState`). Keys kept short to fit more rows;
all ids are **numeric** (not gids):

```
{
  e:  string,        // shopper email (lowercased)
  p:  string,        // product numeric id
  t:  string,        // product title (stored so the dashboard needs no lookup)
  v:  string|null,   // variant numeric id, or null (product-level)
  vt: string|null,   // variant title, or null
  ts: string,        // notifiedAt, ISO
  c:  string|null,   // clickedAt, ISO — set by the tracked redirect
  n:  string|null,   // nudgedAt, ISO — the one auto/manual follow-up (null = not yet)
  u:  boolean,       // unsubscribed — set when they hit the unsubscribe link
  o:  string|null    // orderedAt, ISO — reserved for Phase 2, always null now
}
```

**Row identity for updates** is `(e, p)` — the most-recent row matching that
email+product is the one a click / nudge / unsubscribe / resend touches. A shopper
re-notified for the same product later gets a new row (newest-first, so "most
recent" is the first match). **All markers normalize product ids to numeric**
(`String(id).replace(/\D/g,'')`) on both sides, so callers may pass a gid or a
numeric short id interchangeably.

## Components

### 1. `notified.mjs` (new)

**Pure:**

- `appendNotified(log, row, cap = 1000)` → new array, row prepended, deduped by
  `(e,p,ts)` (idempotent re-record within a run), capped to `cap` (drop oldest).
- `markClicked(log, email, productId, whenISO)` → sets `c` on the newest matching
  `(e,p)` row if unset; returns new array (no-op if none / already clicked).
- `markUnsubscribed(log, email, productId)` → sets `u=true` on all matching
  `(e,p)` rows; returns new array.
- `markNudged(log, email, productId, whenISO)` → sets `n` on the newest matching
  `(e,p)` row; returns new array. (Manual resend and auto-nudge both consume this
  one slot, so a shopper is never double-followed-up.)
- `selectNudges(log, nowISO, days, isInStockByProduct)` → the rows due for the
  one nudge: `c == null && o == null && n == null && u !== true` **and**
  `notifiedAt <= now - days` **and** `isInStockByProduct(p) === true`. Pure; stock
  is injected as a `productId → boolean` predicate.
- `deriveStats(log)` → `{ notified, clicked, nudged, ordered, clickRate }` for the
  dashboard cards (counts over the retained window).

**Metafield I/O (mirrors `state.mjs` / `waitlist.mjs`):**

- `loadNotified()` → array (empty if unset/unparsable).
- `saveNotified(log)` → trim-to-fit under 131072 bytes (drop oldest first),
  `metafieldsSet` on the shop.
- `recordNotified(rows)` → load, `appendNotified` each, save once (one metafield
  write per product batch, not per email).
- `applyClicked / applyUnsubscribed / applyNudged(email, productId, ...)` →
  load-modify-save wrappers over the pure markers.

### 2. Click-through tracking

The back-in-stock email links (Add to Cart permalink + View product) are wrapped
as **tracked redirects** through the existing signed endpoint:

```
/api/unsubscribe?click=1&product=<shortId>&email=<email>&sig=<hmac>&to=<relPath>
```

- Reuses the **existing** `signUnsub`/`verifyUnsub` HMAC of `product:email` — no
  new signing code, no per-row token.
- `to` is a **relative storefront path only** (`/cart/<variantId>:1` or
  `/products/<handle>`). The endpoint rejects anything not starting with a single
  `/` (no `//`, no scheme) — closes any open-redirect. It then 302s to
  `https://<SHOP_DOMAIN><to>`. No product lookup needed.
- On a valid click: `applyClicked(email, product, now)` (`product` is the numeric
  short id; best-effort — a logging failure must never block the redirect), then
  redirect.
- `notify.mjs buildBackInStock` gains optional `product.clickCartUrl` /
  `product.clickProductUrl`; when present they replace the raw storefront URLs,
  else it falls back to today's direct links (keeps the builder pure and testable).
  `restock.mjs` builds these tracked URLs (it already has base, product id, email,
  variant, handle) via a small `trackUrl(base, productShortId, email, relPath)` helper
  in `waitlist.mjs` next to `unsubUrl`.

### 3. Recording on send

In `restock.mjs emailAndPrune`, after each successful `sendBackInStock`, collect a
row `{e,p,t,v,vt,ts,c:null,n:null,u:false,o:null}`. After the product's send loop,
`recordNotified(rows)` once (best-effort, wrapped so it never breaks emailing or
the waitlist prune). The existing `bumpNotified` counter stays as a cheap
fallback; dashboard stats prefer the log.

### 4. Resend (manual) + auto-nudge

**Manual** — `api/waitlists.mjs` POST `{ action:'resend', email, productId, variantId? }`,
auth-gated like the other actions. Re-sends the **same** back-in-stock email
(tracked links regenerated) to that one shopper. It does **not** touch the
waitlist (they're already off it). It calls `applyNudged(email, productId, now)`
so the auto-nudge won't also fire for them. Returns `{ ok, sent }`.

**Auto-nudge** — `nudgeUnengaged({ dryRun, base })` in `restock.mjs`, called from
`runEngine`'s **full** pass only (not the targeted webhook, not chunked sweeps):

1. `loadNotified()`; candidates = rows with `c==null && n==null && o==null && !u`
   and `notifiedAt <= now - nudgeDays`. If none, return `{ nudged: 0 }`.
2. Fetch current stock for the candidates' distinct products (`fetchProductsByIds`),
   build `isInStockByProduct` from `isInStock`.
3. `selectNudges(log, now, nudgeDays, isInStockByProduct)` → due rows.
4. For each due row, `sendNudge(email, {title,handle,image,variantId,variantTitle,
   clickCartUrl,clickProductUrl}, unsubUrl, {dryRun})`; on success
   `applyNudged(email, longId(p), now)`.
5. Naturally idempotent: once `n` is set the row never re-qualifies.

`sendNudge` uses `buildNudge` (new pure builder in `notify.mjs`): a "Still
available — don't miss it" variant of `buildBackInStock`, same tracked links and
unsubscribe footer, different subject/lead.

`nudgeDays` resolution: `loadSettings().nudgeDays` if set, else env `NUDGE_DAYS`,
else `2`; clamped to 1–14.

### 5. Unsubscribe safety

`api/unsubscribe.mjs`, on a valid unsubscribe, additionally calls
`applyUnsubscribed(email, product)` so nudges skip opted-out shoppers.
(The waitlist prune already removed them from the waitlist; the log is separate,
hence this flag.) Best-effort; unsubscribe still succeeds if the flag write fails.

### 6. Dashboard (extends the Waitlists page — no new page)

`api/waitlists.mjs` GET additionally `loadNotified()`:

- **Stat cards:** add/repurpose — Notified, Clicked-through (+ click rate),
  Nudged. Keep "Shoppers waiting" / "Products with a waitlist" as-is.
- **"Recently notified" section:** a table below the waitlist cards — shopper
  email · product · variant · when notified · **status chip** · Resend button.
  Status chip precedence: **Ordered** (Phase 2) > **Clicked** > **Nudged** >
  **Notified**. Unsubscribed rows show a muted "Unsubscribed" chip and no Resend.
- Chip styles live in `ui.mjs` (reuse existing chip/`faint`/tone classes; add only
  what's missing).
- **Resend button** → POST `{action:'resend', email, productId, variantId}` using
  the page's existing auth plumbing (session token when embedded, panel password
  otherwise); on success, refresh the row/section.

## Data flow

```
Storefront "Notify me"  ──► api/subscribe ──► waitlist metafield (unchanged)

Restock (webhook or /api/run):
  restock.notifyRestocks / …ForProducts
    └─ emailAndPrune
         ├─ sendBackInStock (tracked links)     ──► shopper
         ├─ prune from waitlist metafield        (unchanged)
         └─ recordNotified(rows)                 ──► oos_sort.notified

Shopper clicks email link:
  api/unsubscribe?click=1&…  ── verify sig ─► applyClicked ─► 302 to storefront

/api/run full pass:
  runEngine ─► nudgeUnengaged ─► selectNudges (in-stock, past window, one-shot)
                              ─► sendNudge ─► applyNudged

Merchant on Waitlists page:
  GET  ─► loadNotified ─► stats + "Recently notified" table
  POST {resend} ─► sendBackInStock + applyNudged
  Unsubscribe link ─► applyUnsubscribed (nudge suppression)
```

## Error handling

- All notified-log writes are **best-effort** and wrapped: they must never break
  emailing, the waitlist prune, the redirect, or unsubscribe. On failure, log and
  continue (same stance as `bumpNotified`).
- `saveNotified` trims oldest rows until under the byte cap; a parse failure on
  load returns `[]` (fresh), never throws.
- The click redirect validates `to` is a safe relative path; an invalid/forged
  link still redirects to the shop home rather than erroring, and does not record.
- `nudgeUnengaged` is skipped silently if there are no candidates (no stock fetch).

## Testing

`notified.test.mjs` (pure, offline, Node's built-in runner like the others):

- `appendNotified`: prepends newest-first, dedupes `(e,p,ts)`, caps oldest-out.
- `markClicked` / `markNudged`: set only the newest matching row, only if unset,
  no-op when absent.
- `markUnsubscribed`: flags all matching rows.
- `selectNudges`: excludes clicked/ordered/nudged/unsubscribed, excludes rows
  inside the window, excludes out-of-stock products, includes exactly the due
  ones; property-style over generated logs where cheap.
- `deriveStats`: counts + click rate over a mixed log.
- Redirect-path guard (pure helper): accepts `/products/x` & `/cart/1:1`, rejects
  `//evil`, `https://evil`, `/\evil`.

Existing `waitlist.test.mjs` stays green (its helpers are untouched).

## Phase 2 (deferred — not built now)

Order attribution: a reconciliation pass in `runEngine` matches log rows with
`o==null && ts` within a recent window against real orders by `email` + product
placed after `ts`, setting `o`. Requires the app be granted **orders /
protected-customer-data access** (one-time approval + reinstall). The `o` field
and the "Ordered" chip precedence are already in place so Phase 2 is additive.
Before building it, verify the exact current Shopify steps for granting that
access (no reconstruction from memory).

## Out of scope (YAGNI)

- True add-to-cart tracking (Web Pixel + shopper identity).
- Google Sheet / permanent export mirror.
- Per-shopper nudge scheduling beyond the single one-shot follow-up.
- Multi-nudge sequences.

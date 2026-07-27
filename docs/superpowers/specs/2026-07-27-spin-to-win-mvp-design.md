# Spin-to-Win (CrazyRocket-style) — MVP Design

**Working title:** "Spin to Win" (`APP_NAME` env, brand-configurable like OOS Sorter — final name TBD).
**Date:** 2026-07-27
**Owner:** Johny. Target production store: GBU (gel-ball-undercover). Built + tested on the test-apps dev store first, pointed at GBU for production.

A gamified email-capture app, modeled on CrazyRocket: a spin-wheel popup on the
storefront collects a shopper's email, the shopper "wins" a weighted prize, and
the app issues a real Shopify discount code. A merchant admin configures the
wheel and views collected emails + basic stats.

---

## Goal

Ship a **lean MVP**: one storefront spin-wheel popup → email capture → server-decided
weighted outcome → unique Shopify discount code shown to the winner → stored in a
database → a small admin (configure the wheel, view signups, see basic stats).

## Non-goals (explicitly deferred to later phases)

ESP integrations (Klaviyo/Mailchimp/Brevo/Zapier), A/B testing, advanced targeting
(URL/country/referrer/UTM), anti-cheat beyond the basics below, reCAPTCHA,
translations, billing/quota, sales attribution via order webhooks, multiple layouts
(sidebar/notification), scheduling, multiple simultaneous campaigns. The data model
leaves room for these but the MVP does not build them.

---

## Architecture

**Stack (reuse the proven OOS Sorter base):**
- Vercel serverless functions (new project, own 12-function budget).
- New Shopify Dev Dashboard app (own client_id), custom distribution to GBU;
  developed against the dev store. Reuse client-credentials + authorization-code
  auth (`auth.mjs`), session-token admin auth (`session.mjs` / `_auth.mjs`), and
  the `ui.mjs` shell/design system.
- **Theme app extension** for the storefront wheel (same toolchain as
  `notify-when-available`: Shopify CLI + automation token deploy).
- **Database:** Vercel Postgres (Neon free tier). Fallback if limits are too low:
  Upstash Redis. Confirm free-tier limits at setup (a MVP open item).

**Why a DB (departure from OOS Sorter's no-DB rule):** this app collects thousands
of emails + per-event analytics; Shopify metafields can't hold that volume safely.
The DB is the deliberate, signed-off exception.

### Data model (Postgres)

```
campaigns
  id            text primary key            -- short id
  name          text not null
  enabled       boolean not null default false
  config        jsonb not null              -- wheel design, copy, colors, triggers
  created_at    timestamptz not null default now()

slices                                       -- wheel segments for a campaign
  id            bigserial primary key
  campaign_id   text not null references campaigns(id)
  label         text not null               -- shown on the wheel
  weight        integer not null default 0  -- 0 = never lands here (display-only)
  is_win        boolean not null default false
  discount      jsonb                        -- {type:'percentage'|'amount'|'free_shipping', value, prefix}
  position      integer not null            -- slice order on the wheel

signups
  id            bigserial primary key
  campaign_id   text not null references campaigns(id)
  email         text not null
  slice_id      bigint references slices(id)
  coupon_code   text                         -- the issued Shopify code (null if lost)
  referrer      text
  country       text
  created_at    timestamptz not null default now()
  unique (campaign_id, email)                -- one entry per email per campaign

events                                        -- for stats
  id            bigserial primary key
  campaign_id   text not null
  kind          text not null               -- 'view' | 'spin'
  created_at    timestamptz not null default now()
```

### Modules (mirrors OOS Sorter's small-module style)

| File | Purpose |
|---|---|
| `db.mjs` | Postgres client + typed query helpers (the only module that talks to the DB) |
| `wheel.mjs` | **pure** weighted-slice picker + coupon-code generator (unit-tested, no I/O) |
| `discounts.mjs` | create a unique Shopify discount code via Admin API (the only module that knows the discount mutation) |
| `campaign.mjs` | load/save a campaign + its slices |
| `shopify.mjs`, `auth.mjs`, `session.mjs`, `ui.mjs` | reused from OOS Sorter |
| `api/spin.mjs` | public: validate → pick slice server-side → issue code → store signup+event → return result |
| `api/config.mjs` | public (CORS): the wheel's **display** config + slice labels for a campaign — never returns weights or win/lose flags |
| `api/view.mjs` | public: record a popup view (analytics) |
| `api/index.mjs` | admin dashboard (stats) |
| `api/campaign.mjs` | admin: GET config page + POST save (session-token/password gated) |
| `api/signups.mjs` | admin: collected emails table + CSV export |
| `api/install,oauth-callback.mjs` | auth (reused) |
| `extensions/spin-to-win/` | theme app extension: the wheel widget + email form |

Function count budget (Vercel Hobby, max 12): spin, config, view, index, campaign,
signups, install, oauth-callback = 8. Headroom for later phases.

---

## Storefront widget (theme app extension)

- App block on any template (merchant places it; typically enabled site-wide via a
  launch icon, MVP = a launch button + on-load/after-delay trigger).
- Renders the wheel (CSS/Canvas), the email field, and the Play button. Display
  config (colors, labels, copy, slice labels) is fetched from **`/api/config`** by
  campaign id (a data-attribute on the block), so the merchant edits everything in
  the admin, not the theme editor. Weights and win/lose flags are never sent to the
  browser.
- **Outcome is server-authoritative.** On Play: POST `{email, campaignId, hp}` to
  `/api/spin`. The server returns `{ sliceIndex, label, couponCode, message }`. The
  wheel animates to `sliceIndex` and reveals the result. The browser never decides
  the prize or sees the weights → probabilities and coupons can't be tampered with.
- Honeypot field + basic client validation (mirrors notify-when-available).

---

## `/api/spin` flow (the core)

1. CORS + POST-only + read JSON. Honeypot filled → silently succeed (drop bot).
2. Validate email (shared regex). Invalid → `{ok:false, error}`.
3. Load campaign + slices. If disabled/not found → `{ok:false}`.
4. **Dedupe:** if `(campaign, email)` already signed up → return their prior result
   (idempotent; no duplicate code issued). Configurable "allow duplicates" is a
   later phase.
5. **Pick the winning slice server-side** via `wheel.pickSlice(slices, rand)` —
   weighted random over `weight`; `weight:0` slices are display-only and never win.
   `rand` is injected so the picker is pure and testable.
6. If the slice `is_win` and has a `discount`: `discounts.issueCode()` creates a
   unique Shopify code (see below) and returns it. Losing slice → no code.
7. Insert `signups` row (email, slice, coupon, referrer, country) + `events` spin row.
8. Return `{ ok:true, sliceIndex, label, couponCode, message }`.

Rate/abuse (MVP minimum): per-email-per-campaign uniqueness (step 4), honeypot,
email validation. IP/reCAPTCHA/disposable-domain rules are a later phase.

## Discount issuance (`discounts.mjs`) — verified against live 2026-07 schema

Mutation: **`discountCodeBasicCreate(basicCodeDiscount: DiscountCodeBasicInput!)`**
(arg is `basicCodeDiscount`, NOT `input` — verified by introspection 2026-07-27;
same trap as `collectionUpdate`/`productUpdate`).

`DiscountCodeBasicInput` fields used: `title`, `code`, `startsAt`,
`usageLimit: 1`, `appliesOncePerCustomer: true`, `customerGets` (percentage /
fixed amount), `combinesWith`. Free-shipping slices use
`discountCodeFreeShippingCreate` (later phase; MVP supports percentage + fixed
amount).

Unique code generation: `wheel.makeCode(prefix)` → `PREFIX-XXXXXXXX` (crypto-random,
uppercase, ambiguous chars removed). On the rare collision (userErrors), retry with
a new suffix. Code is stored on the signup row.

---

## Admin (reuse `ui.mjs` shell + session-token/password auth)

- **Dashboard** (`/`): stat cards — popup views, emails collected, opt-in rate
  (emails ÷ views), plus a simple recent-activity list. (Sales attribution is a
  later phase, so no revenue stat in the MVP.)
- **Campaign** (`/campaign`): edit the single MVP campaign — name, enabled toggle,
  slices (label, weight, win/lose, discount type+value), and design (colors, header
  text, button copy). Save is auth-gated (session token in the embedded admin, or
  panel password fallback — same hybrid as OOS Sorter).
- **Signups** (`/signups`): table of collected emails (email, coupon, date,
  referrer, country) with search + **CSV export**.

Not-connected state reuses `notConnectedBody()` so an unauthorized store shows a
"finish connecting" screen, never a 500 (the fix we just made in OOS Sorter).

---

## Error handling

- Public endpoints always return JSON `{ok:false,error}` on failure, never a 500 to
  the shopper; the widget shows a friendly message and lets them retry.
- Discount creation failure → the signup is still recorded, the shopper is shown a
  graceful "we'll email your code" fallback message, and the error is logged (so a
  Shopify hiccup never loses the email). MVP does not auto-retry issuance.
- DB unavailable → `/api/spin` returns a soft error; the widget asks the shopper to
  try again. (No email is silently lost because nothing is claimed as succeeded.)

## Testing

- `wheel.test.mjs` (pure, no env/network): weighted picker distributes proportional
  to weights over many seeded draws; `weight:0` never wins; single-slice degenerate
  case; `makeCode` format + charset + uniqueness across many draws.
- `session.test.mjs` reused. Discount + DB modules are I/O; covered by a live
  dry-run script during implementation, not unit tests.

---

## Phase roadmap (after MVP)

1. **Sales attribution** — order webhook matches the issued code → revenue per
   campaign (the "Sales over CrazyRocket" stat).
2. **ESP integrations** — push captured emails to Klaviyo/Mailchimp/Brevo/Zapier.
3. **Targeting** — URL/country/referrer/UTM show-hide rules.
4. **Anti-cheat** — IP rate limits, disposable-domain blocking, reCAPTCHA.
5. **A/B testing** — multiple campaign variants rotated to equal views.
6. **Translations, multiple layouts, scheduling, billing/quota.**

## Open items to resolve during implementation

1. Confirm Vercel Postgres (Neon) free-tier limits suffice; else Upstash.
2. Final app name / branding (working title "Spin to Win").
3. Wheel rendering approach in the extension (CSS-transform wheel vs Canvas) — pick
   during the widget task; must be lightweight (no heavy libs) to keep the storefront
   fast, same constraint as the notify widget.

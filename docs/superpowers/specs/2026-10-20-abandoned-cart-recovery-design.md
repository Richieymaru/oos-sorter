# Abandoned-cart recovery — design

**Date:** 2026-10-20
**Status:** awaiting owner approval

## Goal

Help recover abandoned carts from inside the app, owner-controlled. Sends are
intended around **big Australian sale days** (Black Friday, Christmas, EOFY…),
prompted by an in-app reminder banner — not a constant automation.

**1. Sale-event reminder banner (Phase 1).** An AU sales calendar drives a
dismissible banner on the Dashboard + Funnels that lights up **14 days before**
a **Tier 1 + Tier 2** event, saying it's a good time to recover abandoned carts
and linking to the abandoned-carts section.

**2. Manual "Recover" button (Phase 2).** Per abandoned cart — sends the shopper
an email that restores their exact cart, with a **free-shipping note** incentive.
**Preview-first** (modal), like our Resend/Offer flow.

### AU sales calendar (Tier 1 + Tier 2, the banner's triggers)

Pure, year-aware (`sales-calendar.mjs`). Tier 1: Black Friday (4th Fri Nov),
Cyber Monday (+3d), Christmas (Dec 25), Boxing Day (Dec 26), EOFY (Jun 30),
Father's Day (1st Sun Sep). Tier 2: Click Frenzy (~Nov, approx), Click Frenzy
Mayhem (~May, approx), Afterpay Day (~Mar & ~Aug, approx), Mother's Day (2nd Sun
May), Amazon Prime Day (~Jul, approx). `activeSaleReminder(now, {leadDays:14,
tiers:[1,2]})` returns the soonest qualifying event (or active one) + daysUntil;
approximate promos are flagged so the banner says "(approx)".

**Explicitly out of scope:**
- Automatic recovery emails to all abandoners — Shopify's native automation
  covers that; we won't duplicate it and risk double-sends.
- **Sold-out → waitlist routing** — dropped at the owner's request (2026-10-20).
- No discount-code generation — free-shipping *note* only.

## Why this (not generic recovery)

Shopify's native abandoned-cart automation already does timed, branded
auto-recovery for free — the "Where to focus" insight recommends turning it on.
Our value here is owner-controlled, targeted nudges with a preview before send.

## Data layer — `orders.mjs`

Extend `fetchAbandonedCheckouts` (and `normalizeAbandoned`) to add, per cart:
- `id` — the abandoned checkout id (to re-fetch at action time).
- `email` — customer email (**Level-2 protected**; may be redacted → then the
  cart can't be recovered: show the button disabled with a short note).
- `recoveryUrl` — `abandonedCheckoutUrl` (restores the exact cart).
- line items already carry `title`/`qty`; optionally add `productId` so the
  recovery email can show item thumbnails (reusing `fetchProductImages`).

Add `fetchAbandonedCheckout(id)` to re-fetch ONE cart (email + recoveryUrl +
items) at send time, so customer emails are **not** embedded in page source.

> **Must validate** the new fields (`abandonedCheckoutUrl`, `customer`/`email`)
> against the store's 2026-07 schema with the `shopify-admin` skill before
> shipping — same rule that caught the `collectionUpdate` trap. Email and
> recoveryUrl are protected customer data; if redacted, degrade gracefully.

## Email — `notify.mjs`

`buildRecoveryEmail(cart, { recoveryUrl, freeShipping })` reusing the existing
template: eyebrow "Still thinking it over?", the cart's items (title, optional
image), a prominent **"Complete your order"** CTA → `recoveryUrl`, and the
free-shipping line when enabled. `sendRecovery(cart, opts)` sends it.
`previewRecoveryEmail(cart, opts)` returns the rendered HTML (no send).

## Endpoints — `api/index.mjs` POST (reused; 12-fn cap)

Both `requireAuth`-gated, referencing a cart by its checkout `id`:
- `action: 'previewRecover'` → `fetchAbandonedCheckout(id)` →
  `previewRecoveryEmail` → `{ ok, html }`.
- `action: 'recoverCart'` → fetch by id, require `email`, `sendRecovery` →
  `{ ok, sent }` (or `{ ok:false, redacted:true }` when no email).

## UI — `ui.mjs` funnelsBody (abandoned carts card)

Each cart row gains **Recover** + **Preview** buttons (reusing the email-preview
modal pattern — an iframe, as on Waitlists). Add a small client script on the
Funnels page (auth via session token / panel password, same as Waitlists)
wiring the two actions and the modal. Recover is disabled with a note when the
email is redacted.

## Consent & safety

- Recovery emails go out only on an explicit owner click, after preview.
- The recovery email carries a working unsubscribe link (as our other emails do).
- **Before any real customer send:** DRY-run the recovery path to the owner's
  own email (the `force`/owner-email pattern we already use for test resends).

## Verification

- `shopify-admin` skill: validate the extended abandoned query.
- Pure-logic unit tests: `buildRecoveryEmail` renders the recovery URL + items +
  free-shipping line.
- Full `npm test` green; render smoke of the abandoned-carts buttons/modal.

## Files touched

`orders.mjs` (query + normalize + fetch-one), `notify.mjs` (recovery email),
`api/index.mjs` (2 POST actions), `ui.mjs` (buttons + modal + script in the
abandoned-carts card). Tests in `notify.test.mjs` (or a new `recovery.test.mjs`).

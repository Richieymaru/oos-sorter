# Abandoned-cart recovery — design

**Date:** 2026-10-20
**Status:** awaiting owner approval

## Goal

Help recover abandoned carts from inside the app, in two owner-controlled ways
(chosen 2026-10-20):

1. **Manual "Recover" button** per abandoned cart — sends the shopper an email
   that restores their exact cart, with a **free-shipping note** incentive.
   **Preview-first** (modal), like our Resend/Offer flow.
2. **Sold-out → waitlist routing** — when an abandoned cart's item is sold out
   now, an **owner-approved** "Add to back-in-stock list" button adds that
   shopper (+ variant) to our waitlist, so they're auto-emailed on restock.

**Explicitly out of scope** (not chosen): automatic recovery emails to all
abandoners (Shopify's native automation covers that; we won't duplicate and
risk double-sends). No discount-code generation — free-shipping *note* only.

## Why this (not generic recovery)

Shopify's native abandoned-cart automation already does timed, branded
auto-recovery for free — the "Where to focus" insight recommends turning it on.
Our unique value is owner-controlled, targeted nudges and the sold-out→waitlist
tie-in, which generic recovery can't do.

## Data layer — `orders.mjs`

Extend `fetchAbandonedCheckouts` (and `normalizeAbandoned`) to add, per cart:
- `id` — the abandoned checkout id (to re-fetch at action time).
- `email` — customer email (**Level-2 protected**; may be redacted → then the
  cart can't be recovered: show the button disabled with a short note).
- `recoveryUrl` — `abandonedCheckoutUrl` (restores the exact cart).
- line items: existing `title`/`qty` **plus** `variantId` and `productId`
  (for sold-out detection + the waitlist add).

Add `fetchAbandonedCheckout(id)` to re-fetch ONE cart (email + recoveryUrl +
items) at send time, so customer emails are **not** embedded in page source.

> **Must validate** the new fields (`abandonedCheckoutUrl`, `customer`/`email`,
> line-item `variant { id product { id } }`) against the store's 2026-07 schema
> with the `shopify-admin` skill before shipping — same rule that caught the
> `collectionUpdate` trap. Email/recoveryUrl are protected customer data; if
> redacted, degrade gracefully.

## Email — `notify.mjs`

`buildRecoveryEmail(cart, { recoveryUrl, freeShipping })` reusing the existing
template: eyebrow "Still thinking it over?", the cart's items (image + title),
a prominent **"Complete your order"** CTA → `recoveryUrl`, and the
free-shipping line when enabled. `sendRecovery(cart, opts)` sends it.
`previewRecoveryEmail(cart, opts)` returns the rendered HTML (no send).

## Endpoints — `api/index.mjs` POST (reused; 12-fn cap)

All `requireAuth`-gated, referencing a cart by its checkout `id`:
- `action: 'previewRecover'` → `fetchAbandonedCheckout(id)` →
  `previewRecoveryEmail` → `{ ok, html }`.
- `action: 'recoverCart'` → fetch by id, require `email`, `sendRecovery` →
  `{ ok, sent }` (or `{ ok:false, redacted:true }` when no email).
- `action: 'addAbandonToWaitlist'` → for the cart's sold-out line item(s),
  resolve variant and call `subscribe(productGid, email, now, {variantId,
  variantTitle})` (reuses `waitlist.mjs`). Owner-approved; returns `{ ok, added }`.

## Stock detection (for sold-out routing)

For the abandoned carts shown, resolve each line-item variant's availability
via `catalog.mjs` (`onlineAvailable`/`isInStock`), cached. A cart qualifies for
"Add to waitlist" when ≥1 item is sold out now. Computed server-side; the UI
only shows the button when it qualifies.

## UI — `ui.mjs` funnelsBody (abandoned carts card)

Each cart row gains **Recover** + **Preview** buttons (reusing the email-preview
modal pattern — an iframe, as on Waitlists). Carts with a sold-out item also get
**Add to waitlist**. Add a small client script on the Funnels page (auth via
session token / panel password, same as Waitlists) wiring the three actions and
the modal. Recover is disabled with a note when the email is redacted.

## Consent & safety

- Sold-out→waitlist is **owner-approved per cart**, never silent/automatic. The
  shopper had the item in their cart (implied interest), and every waitlist
  email carries a working unsubscribe link.
- Recovery emails go out only on an explicit owner click, after preview.
- **Before any real customer send:** DRY-run the recovery path to the owner's
  own email (the `force`/owner-email pattern we already use for test resends).

## Verification

- `shopify-admin` skill: validate the extended abandoned query.
- Pure-logic unit tests: `buildRecoveryEmail` renders the recovery URL + items +
  free-shipping line; the sold-out-cart selection logic.
- Full `npm test` green; render smoke of the abandoned-carts buttons/modal.

## Files touched

`orders.mjs` (query + normalize + fetch-one), `notify.mjs` (recovery email),
`api/index.mjs` (3 POST actions + stock resolve for the funnels view),
`ui.mjs` (buttons + modal + script in the abandoned-carts card),
reuse `waitlist.mjs` `subscribe()`. Tests in `notify.test.mjs` (or a new
`recovery.test.mjs`).

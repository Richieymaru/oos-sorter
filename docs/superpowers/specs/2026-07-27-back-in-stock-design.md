# Back-in-Stock ("Notify When Available") — Design

**Date:** 2026-07-27
**Status:** draft for review

## Overview

Add a **"Notify When Available"** flow to OOS Sorter. On a sold-out product page a
storefront button lets a shopper enter their email to be notified when the product
is back. OOS Sorter stores the waitlist, and when the product returns to stock it
emails everyone on that product's list and clears it. The merchant can also see the
lists in the admin and send manually.

**Email-only for v1** (SMS/phone is a later addition). No new database — the waitlist
lives in a Shopify **product metafield**, consistent with OOS Sorter's no-DB design.

## Goals (v1)

- Storefront button + email form on sold-out product pages (theme app extension).
- Public endpoint that saves a subscriber to that product's waitlist.
- Automatic email to a product's waitlist when it comes back in stock, then clear it.
- Manual **"Send now"** from an admin page, plus a view of current waitlists.
- One-click **unsubscribe** link in the email (basic compliance) + a consent line.

## Non-goals (deferred)

- SMS / phone notifications (Twilio) — v2.
- Per-variant waitlists (v1 is per **product**).
- A hosted database / analytics dashboard.

## Architecture

**Storage — product metafield** `oos_sort.waitlist` (type `json`) on each product:
```json
[ { "email": "a@x.com", "ts": "2026-07-27T10:00:00Z" } ]
```
Deduped by email, capped (e.g. 500 per product). No new service.

**Trigger — "in stock + non-empty waitlist → notify + clear".** We do NOT need to
diff previous state: a shopper only joins a waitlist while the product is sold out,
so a product that is **currently in stock AND has a non-empty waitlist** is exactly a
"just came back" event. The engine, on each run, for such products: sends the
back-in-stock email to the list, then sets the waitlist metafield to `[]` (so it
never re-notifies). Gated by a new toggle (`FEATURE_WAITLIST` / a `waitlist` setting).
The product query already run by the engine is extended to include the waitlist
metafield inline, so this adds **no extra per-product reads** on the hot path.

**Subscribe endpoint** `POST /api/subscribe` (public, called from the storefront):
- Body `{ email, productId, consent }`. Validates the email, requires `consent`,
  appends to the product's waitlist (dedupe), returns `{ ok, count }` or `{ ok, already }`.
- **CORS**: allow the storefront origin (`Access-Control-Allow-Origin`) + handle the
  `OPTIONS` preflight, since the theme calls cross-origin.
- Abuse: v1 does email validation + a per-product cap + a honeypot field. (Full rate
  limiting needs shared state; noted as a follow-up.)

**Unsubscribe endpoint** `GET /api/unsubscribe?product=<id>&email=<email>&sig=<hmac>`:
- Removes the email from that product's waitlist. The link is signed (HMAC of
  product+email with a secret) so it can't be forged, and shows a small confirmation
  page. Included in every back-in-stock email.

**Admin page** `/waitlists` (in the existing OOS Sorter UI, password-gated actions):
- Scans products for a non-empty `oos_sort.waitlist` metafield (one paginated query),
  lists product + subscriber count, with a **"Send now"** button per product
  (`POST /api/notify-waitlist` → emails + clears that product's list).

**Back-in-stock email** — a new builder in `notify.mjs` (`buildBackInStock`,
`sendBackInStock`): styled like the existing emails, addressed to the shopper (BCC or
individual sends), with the product title/link and an unsubscribe link. Sent from the
same Gmail transport.

**Storefront button — theme app extension (app block).** A lightweight app block the
merchant adds to the product template; renders the button + email form only on
sold-out products (checks `product.available`), and POSTs to `/api/subscribe`. Built
with the Shopify CLI extension toolchain; the exact 2026 approach is verified against
docs before building, and the merchant deploys it + adds the block (guided, hands-on).

## Files (planned)

| File | Responsibility |
|---|---|
| `waitlist.mjs` | pure list helpers + product-metafield read/add/remove/clear |
| `notify.mjs` (edit) | `buildBackInStock` / `sendBackInStock` + unsubscribe link |
| `api/subscribe.mjs` | public subscribe endpoint (+ CORS/OPTIONS) |
| `api/unsubscribe.mjs` | signed one-click unsubscribe |
| `api/notify-waitlist.mjs` | admin "Send now" for one product |
| `api/waitlists.mjs` | admin page: lists products with waitlists |
| `catalog.mjs` (edit) | include the `oos_sort.waitlist` metafield in product reads |
| `sort-oos.mjs` (edit) | restock pass: in-stock + non-empty waitlist → notify + clear |
| `settings.mjs` (edit) | add the `waitlist` toggle |
| `waitlist.test.mjs` | pure tests (dedupe, cap, add/remove, unsubscribe sig) |
| theme extension | app block (button + form) — separate Shopify CLI toolchain |

## Compliance / privacy

- **Consent** line + required checkbox on the form; store the consent timestamp.
- **Unsubscribe** link in every email (signed, one-click).
- Emails are the shopper's data on the merchant's store; kept only until notified,
  then cleared. (For GBU / production, revisit retention + a proper privacy note.)

## Risks / open items

- **Metafield write concurrency:** two shoppers subscribing to the same product at the
  same instant is a read-modify-write race (one could be lost). Low-volume acceptable
  for v1; a DB or optimistic retry fixes it later.
- **Metafield size:** a very popular product's list could approach the metafield size
  limit; the per-product cap guards this. Huge lists → move to a DB (v2).
- **Admin scan / per-run reads:** fine for this store; large catalogs may want a
  shop-level index of products-with-waitlists.
- **Theme extension** is a new toolchain (Shopify CLI) + a hands-on install step.

## Testing

- `waitlist.test.mjs`: pure `addEmail`/dedupe/cap/remove + unsubscribe HMAC sign/verify.
- Live: subscribe from the storefront button → see it in the admin → restock the
  product → confirm the email arrives and the list clears; test unsubscribe.

## Rollout

- Backend ships first (auto-deploy) and is testable via the admin + `/api/subscribe`
  directly. The theme extension (storefront button) is a guided hands-on step.

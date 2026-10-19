# Engagement monitoring Phase 2 — browsing (Web Pixel)

**Date:** 2026-10-20
**Status:** awaiting owner approval (Phase 1 already shipped)

## Goal

On the Notified page, show whether a notified shopper is **still exploring the
store** after clicking — which products they viewed, whether they added to
cart, or went quiet — on top of Phase 1's abandoned-cart ("In cart") signal.

Phase 1 (shipped) already covers **started a cart / ordered / stopped** from
Admin-API data (abandoned checkouts + orders). Phase 2 adds **live browsing**,
which the Admin API can't see — it needs a storefront **Web Pixel**.

## Approach

### 1. Web Pixel extension (new)
A Shopify **Web Pixel** app extension runs on the storefront and subscribes to
standard customer events: `product_viewed`, `product_added_to_cart`,
`checkout_started` (NOT every `page_viewed` — too noisy). It runs in Shopify's
sandbox and **respects the customer's analytics consent** (`init.customerPrivacy`
/ Shopify's consent gating) — we record nothing without consent.

### 2. Correlating browsing to a notified shopper
Waitlist shoppers are often anonymous, so we tag them via the email link:
- The tracked click redirect (`api/unsubscribe.mjs` `trackUrl`) already lands the
  shopper on the storefront. Append a short **signed token** to that landing URL:
  `?wl=<token>` where `token` = base64url(rowKey) + HMAC (reusing the unsub
  secret), identifying the notified (email, product) without exposing the email.
- On first event, the pixel reads `wl` from the landing URL, persists it in its
  sandbox storage, and includes it with each event it sends.

### 3. Events endpoint (12-fn cap)
The pixel POSTs events to our app. To stay at 12 functions, fold it into an
existing endpoint as an action (e.g. `api/unsubscribe.mjs` — it already owns the
tracking/redirect concern — with `?pixel=1`, or `api/webhook.mjs`). The endpoint:
- **Verifies the token's HMAC** (reject spoofed/forged posts), rate-limits.
- Sends permissive **CORS** headers (the pixel calls from the storefront origin).
- Records a browsing signal on the notified row: `br = { last: iso, viewed:
  [title…capped 10], cart: bool }`. Debounced; viewed list deduped + capped.

### 4. Notified page
Add a browsing line to the Status cell: **👀 Browsing · last seen 2h ago** and
**viewed: X, Y**, alongside the existing Clicked / In cart / Ordered status.
Priority stays: Ordered > In cart > Browsing > Clicked > Notified.

## Privacy & consent
- Only records for shoppers who clicked OUR email (they gave their email joining
  the waitlist; emails carry unsubscribe) AND whose analytics consent allows it.
- The token is a signed pointer, not the email, in the URL.
- Document this in the app's privacy notes; the Web Pixel honours Shopify's
  customer-privacy/consent signals (no tracking when consent is withheld).

## Deploy & activation
- `shopify app deploy -c gbu` releases the new Web Pixel extension (a new app
  version → reinstall/approve, same as the scope change).
- App-managed Web Pixels activate on install; confirm it's active in the store's
  customer-events settings.

## Verification
- Pure-logic tests: the signed-token build/verify, the browsing-signal merge
  (dedupe + cap), status precedence.
- Validate any new GraphQL vs the 2026-07 schema (shopify-admin skill).
- End-to-end: click a test email → browse as yourself → confirm the Notified row
  shows viewed products; withhold consent → confirm nothing is recorded.

## Risks / open questions
- **Correlation gaps:** only shoppers who land via the tracked link are tagged;
  a shopper who navigates away and returns without the link (new browser) won't
  carry the token. Acceptable — the signal is "best effort."
- **Event volume / cost:** debounce + cap; only the 3 meaningful events.
- **Consent regions:** in strict-consent regions the signal may be absent.

## Files touched (planned)
New Web Pixel extension (`extensions/…`); `api/unsubscribe.mjs` (append `wl`
token to the redirect + a pixel-events action); `notified.mjs` (signed token
helpers + a pure browsing-signal merge); `api/waitlists.mjs` (Notified status
line). Tests in `notified.test.mjs` / a new test.

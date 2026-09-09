# Product Change Monitor — setup

Logs **who** changes a product's status (Draft ↔ Active ↔ Archived ↔ Unlisted)
to Slack and a Google Sheet, in real time, via the `products/update` webhook.
Attribution comes from the product's timeline events (`BasicEvent.author`), which
names the staff member even after the store activity log is purged.

## 1. Turn it on (app Settings)

In the Sorter's **Settings** page:
- Toggle **Product change monitor** on.
- (Optional) paste a **Slack Incoming Webhook** URL in *Slack notifications*.
- (Optional) paste the **Google Apps Script** URL from step 3 in *Product-change log*.
- Save.

At least one of Slack / Sheet should be set, or the change is only logged to the
Vercel function logs.

## 2. Slack Incoming Webhook (optional)

Slack → your workspace → **Apps** → search **Incoming Webhooks** → **Add to Slack**
→ pick a channel (e.g. `#product-changes`) → copy the
`https://hooks.slack.com/services/…` URL → paste into Settings.

## 3. Google Sheet log (optional)

1. Create a Google Sheet. First row (headers, optional):
   `Timestamp | Product | URL | From | To | Who | Stock`
2. **Extensions → Apps Script**, replace the file with the script below, Save.
3. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, authorize, and copy the **Web app URL** (ends in `/exec`).
4. Paste that URL into Settings → *Product-change log*.

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var d = JSON.parse(e.postData.contents);
  sheet.appendRow([d.timestamp, d.product, d.url, d.from, d.to, d.who, d.stock]);
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 4. Register the webhook + seed the baseline (one time)

**Primary path — the button.** In Settings, click **Set up monitor on this
store**. Using the app's own credentials, it subscribes the `products/update`
webhook and records every product's current status as the baseline (so the NEXT
change is caught, not absorbed). It reports e.g. *"Monitor active ✓ webhook
created, 342 products baselined"*. Safe to click again — it's idempotent (an
existing webhook is reused, the baseline just refreshes). Re-run it after
changing the Sheet/Slack URL or the app's domain.

**Fallback — the CLI** (needs a local `.env` for that store):

```bash
node --env-file=.env register-webhook.mjs create-monitor https://sold-out-sorter.vercel.app
node --env-file=.env seed-monitor.mjs
```

`register-webhook.mjs list` shows all subscriptions.

> Note: Vercel Hobby caps a deployment at 12 serverless functions, so the setup
> action lives inside `/api/settings` (`{action:'setup-monitor'}`), not its own
> endpoint.

## What it logs

- **Product status change** (Draft↔Active↔Archived↔Unlisted) — with who.
- **Product added / deleted** — with who.
- **Collection added / deleted** — with who.

All five carry the staff name. Deletes are attributed via the **shop-level event
log** (`events` filtered by `subject_id … action:destroy`), which keeps the
destroy event with its author even after the item and its own timeline are gone.
Collection *sort-order* changes are intentionally not tracked (Shopify records no
timeline event for them, and our own sorter flips collections to MANUAL).

## Notes

- `products/update` is noisy (fires on any edit). Non-status edits short-circuit
  at "status unchanged" with no API calls and no writes — cheap at any volume.
- Last-known statuses live in their own shop metafield `oos_sort.monitor`, kept
  separate from `oos_sort.state` so the monitor and the sort/notify engine never
  clobber each other's writes.
- Stock in the alert is the sum of variant on-hand units from the webhook payload
  (free, no extra API call).

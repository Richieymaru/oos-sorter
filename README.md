# Out-of-stock push-down (own-store version)

Pushes sold-out products to the end of your Shopify collections and brings them
back to their original position when restocked. No app, no subscription, no
theme changes.

---

## 1. Create the app (Dev Dashboard)

The legacy "Settings → Apps → Develop apps" flow was retired on 1 Jan 2026.
Existing legacy apps keep working; new ones must come from the Dev Dashboard.

1. `dev.shopify.com/dashboard` → **Apps → Create app → Start from Dev Dashboard**
2. Name it (e.g. "OOS Sorter") and set **Admin API scopes**:

| Scope | Why |
|---|---|
| `read_products` | read collection contents and tags |
| `write_products` | reorder, set sort order, write the metafield |
| `read_inventory` | stock levels per variant |

3. **Release a version.** Scope and config changes are inert until you do.
4. **Distribution → Custom distribution**, enter the store domain, generate the
   install link. ⚠️ Distribution method cannot be changed later — do not pick
   Public, and note that custom distribution locks the app to one store, so
   each store needs its own app.
5. Open the install link while signed into that store's admin and install.
6. Back in the Dev Dashboard, open the app's API credentials / Settings page for
   the installed store and copy the **Admin API access token** (`shpat_...`).
   It's shown once — uninstall and reinstall to regenerate.

If the credentials section doesn't render (a known issue on some dev stores),
use the Client Credentials Grant instead: POST your `client_id` and
`client_secret` to `https://{shop}/admin/oauth/access_token`.

---

## 2. Configure

| Env var | Required | Notes |
|---|---|---|
| `SHOP_DOMAIN` | yes | `your-store.myshopify.com` |
| `ADMIN_TOKEN` | yes | the `shpat_...` token |
| `COLLECTION_HANDLES` | yes | comma-separated, e.g. `all,new-arrivals,sale` |
| `SHOPIFY_API_VERSION` | no | defaults to `2025-10` — set to your current stable version |
| `PIN_TAG` | no | default `pin-top`, always held at the front |
| `IGNORE_TAG` | no | default `oos-ignore`, never pushed down |
| `DRY_RUN` | no | `true` to print the plan without writing |

---

## 3. First run (important)

Run a dry run first:

```bash
SHOP_DOMAIN=your-store.myshopify.com \
ADMIN_TOKEN=shpat_xxx \
COLLECTION_HANDLES=all \
DRY_RUN=true \
node sort-oos.mjs
```

Then run it for real **while your collections are still on their normal sort
order**. The first run captures the current order into a metafield
(`oos_sort.base_order`) and uses that as the permanent base. If you switch a
collection to Manual by hand beforehand, you'll freeze whatever order the admin
happened to be showing.

---

## 4. Schedule it

Rename `github-actions-workflow.yml` to `.github/workflows/oos-sort.yml` in a
**private** repo, add `SHOP_DOMAIN` and `ADMIN_TOKEN` as repository secrets, and
`COLLECTION_HANDLES` as a repository variable. Every 15 minutes is plenty for
most catalogues.

Prefer real-time instead? Point an `inventory_levels/update` webhook at a small
endpoint that calls `processCollection()`, and debounce 15–30 seconds — a single
order fires many inventory events and you don't want overlapping reorder jobs.
The scheduled version avoids that whole class of problem, which is why it's the
default here.

---

## 5. Tradeoffs you're accepting

**Manual sort is permanent for these collections.** Shopify only accepts
reorders on collections with `sortOrder: MANUAL`, so a collection sorted by
"Best selling" stops updating itself once this runs. The base order is frozen at
whatever it was on first run. If you actually want a live best-selling sort,
you'd need to refresh the base order from sales data on a schedule too.

**New products are appended.** They land at the end of the base order. If you
want new arrivals up top, flip `base.push(id)` to `base.unshift(id)` in
`processCollection()`.

**Stock is decided in one place.** `isInStock()` treats untracked inventory and
oversell-enabled variants as available. Multi-location or Markets-specific rules
go in that function and nowhere else.

**Filtered pages ignore this.** Shopify's Search & Discovery filters re-query
and don't respect manual collection order. Known limitation across every app in
this category, including Nada.

**To undo:** set the collections back to your preferred sort order in admin and
delete the `oos_sort.base_order` metafields. Nothing else is touched — no theme
edits, no product changes.

---

## 6. Before you deploy

Check whether your admin already has an **"automatically arrange out-of-stock
products at the bottom"** toggle in collection settings. Some sources say
Shopify shipped this natively; community threads say otherwise. If it's there on
your store, use it and throw this away.

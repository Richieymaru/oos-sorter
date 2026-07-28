/**
 * Webhook receiver: Shopify calls this the instant an inventory level changes
 * (topic INVENTORY_LEVELS_UPDATE). We look up which collections the changed
 * product is in and re-sort ONLY those — never the whole store. This is what
 * makes the app scale to stores with hundreds of collections.
 *
 * Auth: the registered callback URL carries ?token=WEBHOOK_TOKEN, so only
 * Shopify (which we told that exact URL) can reach it. Runs return fast; a
 * targeted re-sort of a few collections is quick.
 */
import { runEngine } from '../sort-oos.mjs';
import { collectionsForInventoryItem, productsForInventoryItem } from '../catalog.mjs';
import { notifyRestocksForProducts, alertNewlySoldOut } from '../restock.mjs';
import { loadSettings } from '../settings.mjs';

export const config = { maxDuration: 60 };

/** env "true"/"false" overrides the saved setting; else the setting decides. */
const resolveFlag = (env, saved) => (env === 'true' ? true : env === 'false' ? false : !!saved);

function param(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try {
    return new URL(req.url, 'http://x').searchParams.get(name);
  } catch {
    return null;
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (!process.env.WEBHOOK_TOKEN || param(req, 'token') !== process.env.WEBHOOK_TOKEN) {
    res.statusCode = 401;
    res.end('unauthorized');
    return;
  }

  const body = await readJson(req);
  // inventory_levels/update payload: { inventory_item_id, location_id, available, ... }
  const itemId = body.inventory_item_id ?? body.admin_graphql_api_id?.split('/').pop();

  try {
    const handles = itemId ? await collectionsForInventoryItem(itemId) : [];
    if (handles.length) {
      await runEngine({ handles });
    } else {
      console.log('webhook: no collections for inventory item', itemId, '— nothing to sort');
    }

    // Back-in-stock is normally done by the full /api/run sweep — but that scans
    // the whole store and times out on big catalogs. So handle the just-changed
    // product(s) here: if the waitlist feature is on, email anyone waiting on a
    // product that's now back in stock. Targeted, so it stays fast at any scale.
    let restock = null;
    let soldOutAlert = null;
    if (itemId) {
      const settings = await loadSettings().catch(() => ({}));
      const waitlistOn = resolveFlag(process.env.FEATURE_WAITLIST, settings.waitlist);
      const notifyOn = resolveFlag(process.env.FEATURE_NOTIFY, settings.notify);
      if (waitlistOn || notifyOn) {
        const products = await productsForInventoryItem(itemId);
        const dryRun = process.env.DRY_RUN === 'true';
        if (waitlistOn) {
          restock = await notifyRestocksForProducts(products, {
            dryRun,
            base: `https://${req.headers['host'] || ''}`,
          });
        }
        // Real-time sold-out alert to the owner/team (works at any scale, unlike
        // the full-sweep digest which times out on big catalogs).
        if (notifyOn) {
          soldOutAlert = await alertNewlySoldOut(products, {
            recipients: settings.notifyEmails,
            dryRun,
          });
        }
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, inventoryItem: itemId ?? null, sorted: handles, restock, soldOutAlert }));
  } catch (err) {
    // 500 lets Shopify retry a transient failure (rate limit, cold start).
    console.error('webhook error:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(err.message) }));
  }
}

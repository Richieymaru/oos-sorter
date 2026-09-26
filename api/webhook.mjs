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
import { waitUntil } from '@vercel/functions';
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

/**
 * The actual work for one inventory change: re-sort the affected collections and
 * run the targeted back-in-stock / sold-out notify. Runs in the BACKGROUND (see
 * the handler) so it never delays the webhook response.
 */
async function processInventoryChange(itemId, host) {
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
  if (!itemId) return;
  const settings = await loadSettings().catch(() => ({}));
  const waitlistOn = resolveFlag(process.env.FEATURE_WAITLIST, settings.waitlist);
  const notifyOn = resolveFlag(process.env.FEATURE_NOTIFY, settings.notify);
  if (!waitlistOn && !notifyOn) return;

  const products = await productsForInventoryItem(itemId);
  const dryRun = process.env.DRY_RUN === 'true';
  if (waitlistOn) {
    await notifyRestocksForProducts(products, { dryRun, base: `https://${host || ''}` });
  }
  // Real-time sold-out alert to the owner/team (works at any scale, unlike the
  // full-sweep digest which times out on big catalogs).
  if (notifyOn) {
    await alertNewlySoldOut(products, { recipients: settings.notifyEmails, dryRun });
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
  const host = req.headers['host'] || '';

  // Shopify drops any webhook we don't answer within ~5s and, after 19 straight
  // failures, DELETES the subscription. Sorting a collection (flip to MANUAL +
  // reorder + waitForJob) takes far longer than that, so we ACK immediately and
  // do the work in the background (waitUntil keeps the function alive up to
  // maxDuration). The 5-min /api/run sweep is the backstop if a background run
  // is cut short.
  waitUntil(
    processInventoryChange(itemId, host).catch((err) => console.error('webhook bg error:', err.message))
  );

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, queued: itemId ?? null }));
}

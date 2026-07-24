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
import { collectionsForInventoryItem } from '../catalog.mjs';

export const config = { maxDuration: 60 };

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
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, inventoryItem: itemId ?? null, sorted: handles }));
  } catch (err) {
    // 500 lets Shopify retry a transient failure (rate limit, cold start).
    console.error('webhook error:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(err.message) }));
  }
}

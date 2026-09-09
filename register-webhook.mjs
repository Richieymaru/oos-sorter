#!/usr/bin/env node
/**
 * One-time setup: subscribe Shopify webhooks to the Vercel endpoints.
 *   - INVENTORY_LEVELS_UPDATE -> /api/webhook          (the sort/notify engine)
 *   - PRODUCTS_UPDATE         -> /api/product-webhook  (the change monitor)
 *
 *   node --env-file=.env register-webhook.mjs list
 *   node --env-file=.env register-webhook.mjs create https://your-app.vercel.app          # inventory
 *   node --env-file=.env register-webhook.mjs create-monitor https://your-app.vercel.app  # product changes
 *   node --env-file=.env register-webhook.mjs delete <subscriptionId>
 *
 * The callback URL is built as <base><path>?token=WEBHOOK_TOKEN so only Shopify
 * can trigger it. Set WEBHOOK_TOKEN in .env AND in Vercel (same value).
 */
import { listWebhooks, ensureWebhook, deleteWebhook } from './webhooks.mjs';

const [, , cmd, arg] = process.argv;

async function list() {
  const nodes = await listWebhooks();
  if (!nodes.length) return console.log('No webhook subscriptions.');
  for (const n of nodes) console.log(`${n.id}  ${n.topic}  ${n.endpoint?.callbackUrl ?? ''}`);
}

/** Subscribe one topic to <base><path>?token=… (idempotent). */
async function subscribe(base, topic, path) {
  if (!base) throw new Error(`Usage: register-webhook.mjs ${cmd} https://your-app.vercel.app`);
  if (!process.env.WEBHOOK_TOKEN) throw new Error('Set WEBHOOK_TOKEN in .env first');
  const r = await ensureWebhook({ base, topic, path, token: process.env.WEBHOOK_TOKEN });
  console.log(`${r.status === 'exists' ? 'Already present' : 'Created'}: ${r.id}  ${topic}  ${r.uri}`);
}

const create = (base) => subscribe(base, 'INVENTORY_LEVELS_UPDATE', '/api/webhook');
const createMonitor = (base) => subscribe(base, 'PRODUCTS_UPDATE', '/api/product-webhook');

async function del(id) {
  if (!id) throw new Error('Usage: register-webhook.mjs delete <subscriptionId>');
  console.log('Deleted', await deleteWebhook(id));
}

const run = {
  list,
  create: () => create(arg),
  'create-monitor': () => createMonitor(arg),
  delete: () => del(arg),
}[cmd];
if (!run) {
  console.error('Usage: register-webhook.mjs <list|create <baseUrl>|create-monitor <baseUrl>|delete <id>>');
  process.exit(1);
}
run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

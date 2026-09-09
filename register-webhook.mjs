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
import { gql, assertNoUserErrors } from './shopify.mjs';

const [, , cmd, arg] = process.argv;

async function list() {
  const d = await gql(
    `{ webhookSubscriptions(first: 50) {
         nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
       } }`
  );
  const nodes = d.webhookSubscriptions.nodes;
  if (!nodes.length) return console.log('No webhook subscriptions.');
  for (const n of nodes) console.log(`${n.id}  ${n.topic}  ${n.endpoint?.callbackUrl ?? ''}`);
}

/** Subscribe one topic to <base><path>?token=…. */
async function subscribe(base, topic, path) {
  if (!base) throw new Error(`Usage: register-webhook.mjs ${cmd} https://your-app.vercel.app`);
  if (!process.env.WEBHOOK_TOKEN) throw new Error('Set WEBHOOK_TOKEN in .env first');
  const uri = `${base.replace(/\/$/, '')}${path}?token=${process.env.WEBHOOK_TOKEN}`;
  const d = await gql(
    `mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
       webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
         webhookSubscription { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } }
         userErrors { field message }
       }
     }`,
    { topic, sub: { uri, format: 'JSON' } }
  );
  assertNoUserErrors('webhookSubscriptionCreate', d.webhookSubscriptionCreate);
  const s = d.webhookSubscriptionCreate.webhookSubscription;
  console.log(`Created: ${s.id}  ${s.topic}  ${s.endpoint.callbackUrl}`);
}

const create = (base) => subscribe(base, 'INVENTORY_LEVELS_UPDATE', '/api/webhook');
const createMonitor = (base) => subscribe(base, 'PRODUCTS_UPDATE', '/api/product-webhook');

async function del(id) {
  if (!id) throw new Error('Usage: register-webhook.mjs delete <subscriptionId>');
  const d = await gql(
    `mutation Del($id: ID!) {
       webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } }
     }`,
    { id }
  );
  assertNoUserErrors('webhookSubscriptionDelete', d.webhookSubscriptionDelete);
  console.log('Deleted', d.webhookSubscriptionDelete.deletedWebhookSubscriptionId);
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

#!/usr/bin/env node
/**
 * One-time setup: subscribe the INVENTORY_LEVELS_UPDATE webhook to the Vercel
 * /api/webhook endpoint, so Shopify pings us the moment inventory changes.
 *
 *   node --env-file=.env register-webhook.mjs list
 *   node --env-file=.env register-webhook.mjs create https://your-app.vercel.app
 *   node --env-file=.env register-webhook.mjs delete <subscriptionId>
 *
 * The callback URL is built as <base>/api/webhook?token=WEBHOOK_TOKEN so only
 * Shopify can trigger it. Set WEBHOOK_TOKEN in .env AND in Vercel (same value).
 */
import { gql, assertNoUserErrors } from './shopify.mjs';

const TOPIC = 'INVENTORY_LEVELS_UPDATE';
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

async function create(base) {
  if (!base) throw new Error('Usage: register-webhook.mjs create https://your-app.vercel.app');
  if (!process.env.WEBHOOK_TOKEN) throw new Error('Set WEBHOOK_TOKEN in .env first');
  const uri = `${base.replace(/\/$/, '')}/api/webhook?token=${process.env.WEBHOOK_TOKEN}`;
  const d = await gql(
    `mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
       webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
         webhookSubscription { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } }
         userErrors { field message }
       }
     }`,
    { topic: TOPIC, sub: { uri, format: 'JSON' } }
  );
  assertNoUserErrors('webhookSubscriptionCreate', d.webhookSubscriptionCreate);
  const s = d.webhookSubscriptionCreate.webhookSubscription;
  console.log(`Created: ${s.id}  ${s.topic}  ${s.endpoint.callbackUrl}`);
}

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

const run = { list, create: () => create(arg), delete: () => del(arg) }[cmd];
if (!run) {
  console.error('Usage: register-webhook.mjs <list|create <baseUrl>|delete <id>>');
  process.exit(1);
}
run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

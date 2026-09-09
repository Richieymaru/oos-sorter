/**
 * Shared webhook-subscription helpers, used by both the CLI (register-webhook.mjs)
 * and the in-app "Set up monitor" action (api/monitor-setup.mjs). One place that
 * knows how to list and idempotently create a subscription.
 */
import { gql, assertNoUserErrors } from './shopify.mjs';

export async function listWebhooks() {
  const d = await gql(
    `{ webhookSubscriptions(first: 100) {
         nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
       } }`
  );
  return d.webhookSubscriptions.nodes;
}

/**
 * Ensure exactly one subscription for `topic` pointing at <base><path>. Matches
 * an existing one by topic + callback path (ignoring the ?token= query, so a
 * rotated token doesn't create a duplicate). Returns {status:'exists'|'created', id, uri}.
 */
export async function ensureWebhook({ base, topic, path, token }) {
  if (!token) throw new Error('WEBHOOK_TOKEN is required to build the callback URL');
  const uri = `${base.replace(/\/$/, '')}${path}?token=${token}`;
  const pathOf = (u) => String(u || '').split('?')[0];
  const existing = (await listWebhooks()).find(
    (n) => n.topic === topic && pathOf(n.endpoint?.callbackUrl) === pathOf(uri)
  );
  if (existing) return { status: 'exists', id: existing.id, uri };
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
  return { status: 'created', id: d.webhookSubscriptionCreate.webhookSubscription.id, uri };
}

export async function deleteWebhook(id) {
  const d = await gql(
    `mutation Del($id: ID!) {
       webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } }
     }`,
    { id }
  );
  assertNoUserErrors('webhookSubscriptionDelete', d.webhookSubscriptionDelete);
  return d.webhookSubscriptionDelete.deletedWebhookSubscriptionId;
}

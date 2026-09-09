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

/** Every topic the Product Change Monitor listens to — all routed to the single
 *  /api/product-webhook endpoint (which branches on the X-Shopify-Topic header).
 *  Kept as one endpoint to stay under Vercel Hobby's 12-function cap. */
export const MONITOR_TOPICS = [
  'PRODUCTS_UPDATE',   // status changes (Draft/Active/Archived/Unlisted)
  'PRODUCTS_CREATE',   // product added
  'PRODUCTS_DELETE',   // product deleted (no author available)
  'COLLECTIONS_CREATE', // collection added
  'COLLECTIONS_DELETE', // collection deleted (no author available)
];

/** Ensure every monitor topic is subscribed to /api/product-webhook (idempotent).
 *  Returns [{topic, status:'created'|'exists'}]. */
export async function ensureMonitorWebhooks({ base, token }) {
  const out = [];
  for (const topic of MONITOR_TOPICS) {
    const r = await ensureWebhook({ base, topic, path: '/api/product-webhook', token });
    out.push({ topic, status: r.status });
  }
  return out;
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

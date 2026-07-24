/**
 * Shared Admin GraphQL client: token resolution, endpoint, throttle handling.
 *
 * Extracted from sort-oos.mjs so the engine and the feature modules (state,
 * draft, notify/report) all speak to Shopify the same way, with one place that
 * knows about retries and rate limits.
 */

import { getAccessToken } from './auth.mjs';

export const SHOP = process.env.SHOP_DOMAIN;
export const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
export const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

export const shortId = (gid) => String(gid).split('/').pop();
export const longId = (id) => `gid://shopify/Product/${id}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = null;
async function authHeader() {
  if (!token) token = await getAccessToken();
  return token;
}

/**
 * Run a GraphQL operation. Retries on 429 / 5xx and on THROTTLED with
 * exponential backoff, same policy the sort engine has always used.
 */
export async function gql(query, variables = {}, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': await authHeader(),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt > 6) throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
    await sleep(1000 * 2 ** attempt);
    return gql(query, variables, attempt + 1);
  }

  const body = await res.json();

  if (body.errors?.length) {
    const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt <= 6) {
      await sleep(1000 * 2 ** attempt);
      return gql(query, variables, attempt + 1);
    }
    throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  }

  return body.data;
}

export function assertNoUserErrors(label, payload) {
  const errs = payload?.userErrors ?? [];
  if (errs.length) throw new Error(`${label}: ${JSON.stringify(errs)}`);
}

let shopIdCache = null;
/** The shop's own GID — owner for the shop-level oos_sort.state metafield. */
export async function getShopId() {
  if (shopIdCache) return shopIdCache;
  const d = await gql(`{ shop { id } }`);
  shopIdCache = d.shop.id;
  return shopIdCache;
}

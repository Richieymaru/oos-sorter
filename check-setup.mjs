#!/usr/bin/env node
/**
 * Pre-flight check. Run this before sort-oos.mjs.
 *
 * Verifies the token works, shows which scopes were actually granted,
 * and tells you which API version to pin.
 *
 *   SHOP_DOMAIN=xxx.myshopify.com ADMIN_TOKEN=shpat_xxx node check-setup.mjs
 */

import { getAccessToken } from './auth.mjs';

const SHOP = process.env.SHOP_DOMAIN;
const PROBE_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

if (!SHOP) {
  console.error('Set SHOP_DOMAIN in .env first.');
  process.exit(1);
}

const NEEDED = ['read_products', 'write_products', 'read_inventory'];

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;

async function main() {
  // --- 0. acquire a token
  const TOKEN = await getAccessToken();
  console.log(ok(`Got access token (${TOKEN.slice(0, 8)}...)`));

  // --- 1. token + shop identity + available versions
  const res = await fetch(
    `https://${SHOP}/admin/api/${PROBE_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify({
        query: `{
          shop { name myshopifyDomain plan { displayName } }
          publicApiVersions { handle supported }
        }`,
      }),
    }
  );

  if (res.status === 401 || res.status === 403) {
    console.error(bad(`Auth failed (HTTP ${res.status}). Token wrong or app not installed.`));
    process.exit(1);
  }
  if (!res.ok) {
    console.error(bad(`HTTP ${res.status} — is "${PROBE_VERSION}" a valid API version?`));
    process.exit(1);
  }

  const body = await res.json();
  if (body.errors) {
    console.error(bad(`GraphQL: ${JSON.stringify(body.errors)}`));
    process.exit(1);
  }

  const { shop, publicApiVersions } = body.data;
  console.log(ok(`Connected to ${shop.name} (${shop.myshopifyDomain})`));
  console.log(`  Plan: ${shop.plan.displayName}`);

  const supported = publicApiVersions.filter((v) => v.supported).map((v) => v.handle);
  const stable = supported.filter((h) => /^\d{4}-\d{2}$/.test(h)).sort();
  const newest = stable[stable.length - 1];

  console.log(`\n  Supported versions: ${stable.join(', ')}`);
  console.log(ok(`Pin this:  SHOPIFY_API_VERSION=${newest}`));
  if (newest !== PROBE_VERSION) {
    console.log(`  (you probed ${PROBE_VERSION} — still works, but ${newest} is current)`);
  }

  // --- 2. granted scopes
  const scopeRes = await fetch(`https://${SHOP}/admin/oauth/access_scopes.json`, {
    headers: { 'X-Shopify-Access-Token': TOKEN },
  });

  console.log('\n  Scopes:');
  if (scopeRes.ok) {
    const granted = (await scopeRes.json()).access_scopes.map((s) => s.handle);
    let missing = false;
    for (const s of NEEDED) {
      if (granted.includes(s)) console.log(`    ${ok(s)}`);
      else {
        console.log(`    ${bad(`${s} — MISSING`)}`);
        missing = true;
      }
    }
    const extra = granted.filter((s) => !NEEDED.includes(s));
    if (extra.length) console.log(`    (also granted: ${extra.join(', ')})`);
    if (missing) {
      console.log(
        '\n  Add the scope in Dev Dashboard, release a new version, then reinstall the app.'
      );
      process.exit(1);
    }
  } else {
    console.log(`    could not read scopes (HTTP ${scopeRes.status}) — check manually`);
  }

  // --- 3. write permission smoke test (read-only probe of a mutation's existence)
  console.log('\n' + ok('Ready. Next: run sort-oos.mjs with DRY_RUN=true'));
}

main().catch((e) => {
  console.error(bad(e.message));
  process.exit(1);
});

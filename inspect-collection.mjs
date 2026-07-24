#!/usr/bin/env node
/**
 * Read-only snapshot of a collection: live order, per-product stock as the
 * engine sees it, sort order, and the stored base_order metafield.
 *
 * Writes nothing to the store, ever.
 *
 *   node --env-file=.env inspect-collection.mjs <handle>
 *   node --env-file=.env inspect-collection.mjs <handle> --save before.json
 *   node --env-file=.env inspect-collection.mjs <handle> --compare before.json
 *
 * The --save/--compare pair is the point: snapshot before the first run, then
 * compare after the restock run to prove a product returned to its original
 * position instead of landing at the top or the bottom.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { getAccessToken } from './auth.mjs';
import { isInStock } from './stock.mjs';
import { fetchCollectionProducts } from './catalog.mjs';

const SHOP = process.env.SHOP_DOMAIN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const savePath = flag('--save');
const comparePath = flag('--compare');

// first bare word that isn't a flag or a flag's value
const flagValues = new Set([savePath, comparePath].filter(Boolean));
const handle =
  args.find((a) => !a.startsWith('--') && !flagValues.has(a)) ||
  (process.env.COLLECTION_HANDLES || '').split(',')[0].trim();

if (!SHOP) {
  console.error('Set SHOP_DOMAIN in .env first.');
  process.exit(1);
}
if (!handle) {
  console.error('Usage: node --env-file=.env inspect-collection.mjs <handle>');
  process.exit(1);
}

const TOKEN = await getAccessToken();
const shortId = (gid) => gid.split('/').pop();

async function gql(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(JSON.stringify(body.errors, null, 2));
  return body.data;
}

const found = await gql(
  `query Col($q: String!) {
     collections(first: 1, query: $q) {
       nodes {
         id handle title sortOrder
         productsCount { count }
         metafield(namespace: "oos_sort", key: "base_order") { value updatedAt }
       }
     }
   }`,
  { q: `handle:'${handle}'` }
);

const col = found.collections.nodes[0];
if (!col) {
  console.error(`Collection "${handle}" not found.`);
  process.exit(1);
}

// Shared catalog fetch so "in stock" here matches the engine (online-availability based).
const products = await fetchCollectionProducts(col.id);

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n${col.title}  (${col.handle})`);
console.log(`  sortOrder: ${col.sortOrder === 'MANUAL' ? green('MANUAL') : col.sortOrder}`);
console.log(`  products:  ${products.length} (productsCount says ${col.productsCount?.count})`);

const stored = col.metafield?.value ? JSON.parse(col.metafield.value) : null;
console.log(
  `  base_order metafield: ${
    stored ? green(`${stored.length} ids`) + dim(` (updated ${col.metafield.updatedAt})`) : red('not set')
  }`
);

const rows = products.map((p, i) => {
  const id = shortId(p.id);
  const inStock = isInStock(p);
  return {
    pos: i,
    id,
    title: p.title,
    inStock,
    qty: p.totalInventory,
    tracked: p.tracksInventory,
    basePos: stored ? stored.indexOf(id) : -1,
  };
});

console.log('\n  live order:');
for (const r of rows) {
  const mark = r.inStock ? green('in ') : red('OUT');
  const base = r.basePos >= 0 ? dim(` base#${String(r.basePos).padStart(3)}`) : '';
  console.log(
    `   ${String(r.pos).padStart(3)}  ${mark}  ${dim(String(r.qty).padStart(4))}  ${r.title}${base}`
  );
}

const out = rows.filter((r) => !r.inStock);
console.log(`\n  ${rows.length - out.length} in stock / ${out.length} sold out`);

// Are all the sold-out ones already at the tail?
const tailStart = rows.length - out.length;
const settled = out.every((r) => r.pos >= tailStart);
console.log(`  sold-out contiguous at tail: ${settled ? green('yes') : red('no')}`);

if (savePath) {
  writeFileSync(savePath, JSON.stringify({ handle, sortOrder: col.sortOrder, rows }, null, 2));
  console.log(`\n  snapshot written to ${savePath}`);
}

if (comparePath) {
  const before = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\n  --- vs ${comparePath} ---`);
  const beforePos = new Map(before.rows.map((r) => [r.id, r]));
  let moved = 0;
  for (const r of rows) {
    const b = beforePos.get(r.id);
    if (!b) {
      console.log(`   ${green('NEW')}  ${r.title} @ ${r.pos}`);
      continue;
    }
    if (b.pos !== r.pos) {
      moved++;
      const arrow = r.pos > b.pos ? 'v' : '^';
      const stock = b.inStock === r.inStock ? '' : dim(b.inStock ? '  (went OUT)' : '  (restocked)');
      console.log(
        `   ${arrow} ${String(b.pos).padStart(3)} -> ${String(r.pos).padStart(3)}  ${r.title}${stock}`
      );
    }
  }
  for (const b of before.rows) if (!rows.some((r) => r.id === b.id)) console.log(`   ${red('GONE')} ${b.title}`);
  console.log(`   ${moved} of ${rows.length} products changed position`);
}

console.log('');

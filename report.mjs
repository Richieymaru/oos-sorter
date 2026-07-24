#!/usr/bin/env node
/**
 * On-demand sold-out report — the "give me the list now" action.
 *
 * Gathers every currently sold-out product across COLLECTION_HANDLES and emails
 * the list immediately. This is the no-hosting equivalent of a button: wire it
 * to a GitHub Actions "Run workflow" (workflow_dispatch) button, or run it
 * locally any time:
 *
 *   node --env-file=.env report.mjs            # emails the report
 *   node --env-file=.env report.mjs --print    # just prints, sends nothing
 *
 * Read-only against the store (never writes).
 */

import { findCollection, fetchProducts } from './sort-oos.mjs';
import { isInStock } from './stock.mjs';
import { shortId } from './shopify.mjs';
import { sendReport, buildReport } from './notify.mjs';

const HANDLES = (process.env.COLLECTION_HANDLES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PRINT_ONLY = process.argv.includes('--print');

async function main() {
  if (!process.env.SHOP_DOMAIN) {
    console.error('Set SHOP_DOMAIN in .env first.');
    process.exit(1);
  }
  if (!HANDLES.length) {
    console.error('COLLECTION_HANDLES is empty — nothing to report.');
    process.exit(1);
  }

  const byId = new Map(); // id -> { id, title, collections }
  for (const handle of HANDLES) {
    const col = await findCollection(handle);
    if (!col) {
      console.warn(`  ! collection "${handle}" not found, skipping`);
      continue;
    }
    const products = await fetchProducts(col.id);
    for (const p of products) {
      if (isInStock(p)) continue;
      const id = shortId(p.id);
      const info = byId.get(id) ?? { id, title: p.title, collections: [] };
      if (!info.collections.includes(handle)) info.collections.push(handle);
      byId.set(id, info);
    }
  }

  const items = [...byId.values()];
  console.log(`${items.length} product(s) currently sold out across ${HANDLES.length} collection(s).`);

  if (PRINT_ONLY) {
    const { subject, text } = buildReport(items);
    console.log(`\n${subject}\n${text}`);
    return;
  }

  await sendReport(items, {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

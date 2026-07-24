#!/usr/bin/env node
/**
 * On-demand sold-out report — the "give me the list now" action.
 *
 * Gathers every currently sold-out product across the resolved collections
 * (COLLECTION_HANDLES, or all collections if unset) and emails the list
 * immediately. This is the no-hosting equivalent of a button: wire it
 * to a GitHub Actions "Run workflow" (workflow_dispatch) button, or run it
 * locally any time:
 *
 *   node --env-file=.env report.mjs            # emails the report
 *   node --env-file=.env report.mjs --print    # just prints, sends nothing
 *
 * Read-only against the store (never writes).
 */

import { pathToFileURL } from 'node:url';
import { resolveHandles } from './sort-oos.mjs';
import { findCollection, fetchCollectionProducts } from './catalog.mjs';
import { isInStock } from './stock.mjs';
import { shortId } from './shopify.mjs';
import { sendReport, buildReport } from './notify.mjs';

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const PRINT_ONLY = process.argv.includes('--print');

/** Current sold-out products across the resolved collections, deduped by id. */
export async function gatherSoldOut() {
  const byId = new Map();
  const handles = await resolveHandles();
  for (const handle of handles) {
    const col = await findCollection(handle);
    if (!col) {
      console.warn(`  ! collection "${handle}" not found, skipping`);
      continue;
    }
    const products = await fetchCollectionProducts(col.id);
    for (const p of products) {
      if (isInStock(p)) continue;
      const id = shortId(p.id);
      const info = byId.get(id) ?? { id, title: p.title, collections: [] };
      if (!info.collections.includes(handle)) info.collections.push(handle);
      byId.set(id, info);
    }
  }
  return [...byId.values()];
}

async function main() {
  if (!process.env.SHOP_DOMAIN) {
    console.error('Set SHOP_DOMAIN in .env first.');
    process.exit(1);
  }

  const items = await gatherSoldOut();
  console.log(`${items.length} product(s) currently sold out.`);

  if (PRINT_ONLY) {
    const { subject, text } = buildReport(items);
    console.log(`\n${subject}\n${text}`);
    return;
  }

  await sendReport(items, {});
}

if (IS_MAIN) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

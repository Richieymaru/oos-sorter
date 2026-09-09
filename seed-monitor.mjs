#!/usr/bin/env node
/**
 * One-time baseline for the Product Change Monitor. Records every product's
 * CURRENT status into oos_sort.monitor, so the very next status change is seen
 * as a real transition (Draft→Active) instead of being silently absorbed as a
 * first-sight baseline.
 *
 * Run once after deploying + registering the products/update webhook:
 *   node --env-file=.env seed-monitor.mjs
 *
 * Idempotent: rerunning just refreshes the snapshot to the live statuses.
 */
import { gql } from './shopify.mjs';
import { codeOf } from './monitor.mjs';
import { saveMonitorState } from './monitor-state.mjs';

async function fetchAllStatuses() {
  const statuses = {};
  let cursor = null;
  let page = 0;
  for (;;) {
    const d = await gql(
      `query($cursor: String) {
         products(first: 250, after: $cursor) {
           pageInfo { hasNextPage endCursor }
           nodes { id status }
         }
       }`,
      { cursor }
    );
    const conn = d.products;
    for (const p of conn.nodes) {
      statuses[String(p.id).split('/').pop()] = codeOf(p.status);
    }
    page++;
    console.log(`  page ${page}: ${conn.nodes.length} products (total ${Object.keys(statuses).length})`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return statuses;
}

(async () => {
  console.log('Seeding product-change monitor baseline…');
  const statuses = await fetchAllStatuses();
  await saveMonitorState({ statuses });
  console.log(`Done. Baseline recorded for ${Object.keys(statuses).length} products.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

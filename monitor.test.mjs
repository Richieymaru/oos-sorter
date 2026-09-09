/**
 * Unit tests for the pure Product Change Monitor logic — no env, no network.
 *   node monitor.test.mjs
 */
import assert from 'node:assert';
import {
  codeOf, labelOf, detectStatusChange, totalStockFromPayload, buildSheetRow, STATUS_CODE,
} from './monitor.mjs';
import { buildProductChangeMessage, buildMonitorMessage } from './slack.mjs';

let pass = 0;
const eq = (name, got, want) => { assert.deepStrictEqual(got, want, name); console.log('  ✓', name); pass++; };
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓', name); pass++; };

console.log('--- codeOf / labelOf ---');
eq('active -> a', codeOf('active'), 'a');
eq('DRAFT (enum case) -> d', codeOf('DRAFT'), 'd');
eq('archived -> r', codeOf('archived'), 'r');
eq('unlisted -> u', codeOf('unlisted'), 'u');
eq('unknown -> ?', codeOf('weird'), '?');
eq('null -> ?', codeOf(null), '?');
eq('label a -> Active', labelOf('a'), 'Active');
eq('label d -> Draft', labelOf('d'), 'Draft');
eq('label unknown code passthrough', labelOf('x'), 'x');

console.log('\n--- detectStatusChange ---');
eq('first sight records baseline, no alert',
  detectStatusChange({}, '111', 'draft'),
  { firstSight: true, changed: false, fromCode: null, toCode: 'd' });
eq('same status -> no change',
  detectStatusChange({ '111': 'a' }, '111', 'active'),
  { firstSight: false, changed: false, fromCode: 'a', toCode: 'a' });
eq('draft -> active is the flagged transition',
  detectStatusChange({ '111': 'd' }, '111', 'active'),
  { firstSight: false, changed: true, fromCode: 'd', toCode: 'a' });
eq('active -> archived flagged',
  detectStatusChange({ '111': 'a' }, '111', 'archived'),
  { firstSight: false, changed: true, fromCode: 'a', toCode: 'r' });

console.log('\n--- totalStockFromPayload ---');
eq('sums variant inventory', totalStockFromPayload({ variants: [{ inventory_quantity: 3 }, { inventory_quantity: 5 }] }), 8);
eq('zero total is a real 0, not null', totalStockFromPayload({ variants: [{ inventory_quantity: 0 }] }), 0);
eq('no variants -> null', totalStockFromPayload({ variants: [] }), null);
eq('missing field -> null', totalStockFromPayload({}), null);

console.log('\n--- buildSheetRow ---');
const row = buildSheetRow({ at: '2026-09-09T00:00:00Z', title: 'Pistol', handle: 'pistol', fromLabel: 'Draft', toLabel: 'Active', who: 'Jane Cruz', stock: 12, shop: 's.myshopify.com' });
eq('sheet row shape', row, {
  timestamp: '2026-09-09T00:00:00Z', product: 'Pistol', url: 'https://s.myshopify.com/products/pistol',
  from: 'Draft', to: 'Active', who: 'Jane Cruz', stock: 12,
});
eq('unknown who defaults', buildSheetRow({ who: null }).who, 'unknown');

console.log('\n--- buildProductChangeMessage ---');
const msg = buildProductChangeMessage({ title: 'Pistol', handle: 'pistol', fromLabel: 'Draft', toLabel: 'Active', who: 'Jane Cruz', stock: 12, shop: 's.myshopify.com' });
ok('names the transition', msg.text.includes('Draft → Active'));
ok('names the actor', msg.text.includes('Jane Cruz'));
ok('links the product', msg.text.includes('https://s.myshopify.com/products/pistol'));
ok('shows stock', msg.text.includes('12'));
ok('unknown actor is graceful', /unknown/i.test(buildProductChangeMessage({ title: 'X', fromLabel: 'Active', toLabel: 'Archived', who: null }).text));

console.log('\n--- buildSheetRow path (collections) ---');
eq('collection row links to /collections/', buildSheetRow({ title: 'Sale', handle: 'sale', path: 'collections', shop: 's.myshopify.com' }).url, 'https://s.myshopify.com/collections/sale');
eq('default path is products', buildSheetRow({ title: 'X', handle: 'x', shop: 's.myshopify.com' }).url, 'https://s.myshopify.com/products/x');

console.log('\n--- buildMonitorMessage (add/delete) ---');
ok('product added names action', buildMonitorMessage({ title: 'Pistol', handle: 'pistol', action: 'was added', who: 'Jane', shop: 's.myshopify.com' }).text.includes('was added'));
ok('product added links to product path', buildMonitorMessage({ title: 'Pistol', handle: 'pistol', action: 'was added', who: 'Jane', shop: 's.myshopify.com' }).text.includes('/products/pistol'));
ok('collection added links to collection path', buildMonitorMessage({ title: 'Sale', handle: 'sale', action: 'collection was added', who: 'Jane', path: 'collections', shop: 's.myshopify.com' }).text.includes('/collections/sale'));
ok('delete with no who is graceful', /unknown/i.test(buildMonitorMessage({ title: 'Old', action: 'was deleted', who: null }).text));
ok('empty stock omitted', !buildMonitorMessage({ title: 'X', action: 'was added', who: 'J', stock: '' }).text.includes('stock'));

console.log('\n--- STATUS_CODE coverage ---');
ok('four statuses mapped', Object.keys(STATUS_CODE).length === 4);

console.log(`\n${pass} checks passed.`);

#!/usr/bin/env node
/**
 * Offline tests for the Notify/Draft decision logic. Pure functions, no env, no
 * network:  node features.test.mjs
 */

import {
  isAllHandles,
  resolveFlag,
  diffNewlySoldOut,
  mergePending,
  planDrafts,
  planRestores,
  retainBaseOrder,
} from './features.mjs';
import { isInStock, isVariantInStock } from './stock.mjs';

let failures = 0;
let checks = 0;

function eq(label, got, want) {
  checks++;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`);
  } else {
    console.log(`  ok  ${label}`);
  }
}

console.log('--- diffNewlySoldOut ---');
eq('new ones only', diffNewlySoldOut(['1', '2'], ['2', '3', '4']), ['3', '4']);
eq('nothing new', diffNewlySoldOut(['1', '2', '3'], ['1', '2']), []);
eq('empty prev = all new', diffNewlySoldOut([], ['5', '6']), ['5', '6']);
eq('dedupes now-list', diffNewlySoldOut(['1'], ['2', '2', '3']), ['2', '3']);
eq('preserves now order', diffNewlySoldOut([], ['9', '3', '7']), ['9', '3', '7']);

console.log('\n--- isInStock (online-availability based) ---');
const prod = (over) => ({
  tracksInventory: true,
  variants: { nodes: [{ inventoryPolicy: 'DENY', inventoryItem: { tracked: true }, onlineAvailable: 0, ...over }] },
});
eq('untracked product -> in stock', isInStock({ tracksInventory: false, variants: { nodes: [] } }), true);
eq('online available > 0 -> in stock', isInStock(prod({ onlineAvailable: 5 })), true);
eq('online available 0, DENY, tracked -> SOLD OUT (3p case)', isInStock(prod({ onlineAvailable: 0 })), false);
eq('oversell variant -> in stock even at 0', isInStock(prod({ inventoryPolicy: 'CONTINUE' })), true);
eq('untracked variant -> in stock even at 0', isInStock(prod({ inventoryItem: { tracked: false } })), true);
eq('missing onlineAvailable treated as 0 -> sold out', isInStock(prod({ onlineAvailable: undefined })), false);
eq(
  'multi-variant sums online availability',
  isInStock({
    tracksInventory: true,
    variants: {
      nodes: [
        { inventoryPolicy: 'DENY', inventoryItem: { tracked: true }, onlineAvailable: 0 },
        { inventoryPolicy: 'DENY', inventoryItem: { tracked: true }, onlineAvailable: 3 },
      ],
    },
  }),
  true
);

console.log('\n--- isVariantInStock (per-variant, for the waitlist) ---');
const twoVariants = {
  tracksInventory: true,
  variants: {
    nodes: [
      { id: 'gid://shopify/ProductVariant/99', inventoryPolicy: 'DENY', inventoryItem: { tracked: true }, onlineAvailable: 0 },
      { id: 'gid://shopify/ProductVariant/100', inventoryPolicy: 'DENY', inventoryItem: { tracked: true }, onlineAvailable: 4 },
    ],
  },
};
eq('sold-out variant -> false even though the product is in stock', isVariantInStock(twoVariants, '99'), false);
eq('restocked variant -> true', isVariantInStock(twoVariants, '100'), true);
eq('accepts a gid', isVariantInStock(twoVariants, 'gid://shopify/ProductVariant/100'), true);
eq('null variant falls back to product level', isVariantInStock(twoVariants, null), true);
eq('empty string falls back to product level', isVariantInStock(twoVariants, ''), true);
eq('unknown variant falls back rather than stranding them', isVariantInStock(twoVariants, '12345'), true);
eq('untracked product -> always true', isVariantInStock({ tracksInventory: false, variants: { nodes: [] } }, '99'), true);
eq(
  'oversell variant -> true at 0',
  isVariantInStock(
    { tracksInventory: true, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', inventoryPolicy: 'CONTINUE', inventoryItem: { tracked: true }, onlineAvailable: 0 }] } },
    '1'
  ),
  true
);
eq(
  'untracked variant -> true at 0',
  isVariantInStock(
    { tracksInventory: true, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', inventoryPolicy: 'DENY', inventoryItem: { tracked: false }, onlineAvailable: 0 }] } },
    '1'
  ),
  true
);

console.log('\n--- isAllHandles ---');
eq('empty -> all', isAllHandles([]), true);
eq('"all" keyword -> all', isAllHandles(['all']), true);
eq('"ALL" case-insensitive -> all', isAllHandles(['ALL']), true);
eq('explicit single -> not all', isAllHandles(['x']), false);
eq('explicit list -> not all', isAllHandles(['x', 'y']), false);

console.log('\n--- resolveFlag (env override vs metafield) ---');
eq('undefined env -> metafield true', resolveFlag(undefined, true), true);
eq('undefined env -> metafield false', resolveFlag(undefined, false), false);
eq('EMPTY env -> metafield true (the CI bug)', resolveFlag('', true), true);
eq('EMPTY env -> metafield false', resolveFlag('', false), false);
eq('env "true" overrides metafield false', resolveFlag('true', false), true);
eq('env "false" overrides metafield true', resolveFlag('false', true), false);
eq('env garbage -> false', resolveFlag('yes', true), false);

console.log('\n--- mergePending ---');
eq(
  'adds fresh',
  mergePending([], [{ id: '1', title: 'A', collections: ['c1'] }]),
  [{ id: '1', title: 'A', collections: ['c1'] }]
);
eq(
  'dedupes by id, unions collections',
  mergePending(
    [{ id: '1', title: 'A', collections: ['c1'] }],
    [{ id: '1', title: 'A', collections: ['c2'] }]
  ),
  [{ id: '1', title: 'A', collections: ['c1', 'c2'] }]
);
eq(
  'no dup collection',
  mergePending(
    [{ id: '1', title: 'A', collections: ['c1'] }],
    [{ id: '1', title: 'A', collections: ['c1'] }]
  ),
  [{ id: '1', title: 'A', collections: ['c1'] }]
);
// does not mutate the input
{
  const input = [{ id: '1', title: 'A', collections: ['c1'] }];
  mergePending(input, [{ id: '1', title: 'A', collections: ['c2'] }]);
  eq('input not mutated', input, [{ id: '1', title: 'A', collections: ['c1'] }]);
}

console.log('\n--- planDrafts ---');
{
  const status = new Map([
    ['1', 'ACTIVE'],
    ['2', 'ACTIVE'],
    ['3', 'DRAFT'],
    ['4', 'ARCHIVED'],
  ]);
  eq('drafts active sold-out only', planDrafts(['1', '2', '3', '4'], status, []), ['1', '2']);
  eq('skips already-drafted', planDrafts(['1', '2'], status, ['1']), ['2']);
  eq('never touches archived', planDrafts(['4'], status, []), []);
}

console.log('\n--- planRestores ---');
{
  const inStock = new Set(['1', '3']);
  eq(
    'restores back-in-stock drafted',
    planRestores(['1', '2', '3'], (id) => inStock.has(id)),
    ['1', '3']
  );
  eq('nothing back in stock', planRestores(['2'], (id) => inStock.has(id)), []);
}

console.log('\n--- retainBaseOrder ---');
eq(
  'keeps drafted ghost that fell out of the read',
  retainBaseOrder(['1', '2', '3'], ['1', '3'], ['2']),
  ['1', '2', '3']
);
eq(
  'drops a genuinely-gone product (not drafted, not present)',
  retainBaseOrder(['1', '2', '3'], ['1', '3'], []),
  ['1', '3']
);
eq(
  'appends genuinely-new product',
  retainBaseOrder(['1', '2'], ['1', '2', '9'], []),
  ['1', '2', '9']
);
eq(
  'drafted ghost keeps its exact position, new one appended',
  retainBaseOrder(['1', '2', '3'], ['1', '3', '9'], ['2']),
  ['1', '2', '3', '9']
);

// Property: a drafted product that later restocks must return to the SAME slot.
// Model a full draft -> hidden -> restore cycle through retainBaseOrder.
console.log('\n--- draft/restore round-trip preserves position ---');
{
  const base = ['a', 'b', 'c', 'd', 'e'];
  // 'c' sells out and is drafted; while hidden it drops out of the read
  const whileHidden = retainBaseOrder(base, ['a', 'b', 'd', 'e'], ['c']);
  eq('slot held while hidden', whileHidden, ['a', 'b', 'c', 'd', 'e']);
  // 'c' restocks, is restored, reappears in the read, no longer drafted
  const afterRestore = retainBaseOrder(whileHidden, ['a', 'b', 'c', 'd', 'e'], []);
  eq('back in original slot', afterRestore, ['a', 'b', 'c', 'd', 'e']);
  eq('c at index 2 throughout', afterRestore.indexOf('c'), 2);
}

console.log(
  `\n${failures ? '\x1b[31mFAILED\x1b[0m' : '\x1b[32mPASSED\x1b[0m'} — ${checks} checks, ${failures} failure(s)`
);
process.exit(failures ? 1 : 0);

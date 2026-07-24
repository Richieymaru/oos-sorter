#!/usr/bin/env node
/**
 * Property test for computeMoves / greedyMoves.
 *
 * These functions are pure — no store, no network, no .env needed:
 *   node moves.test.mjs
 *
 * WHY THIS FILE EXISTS: the first implementation used a longest-increasing-
 * subsequence approach. It was elegant, it passed review, and it was wrong on
 * ~78% of random reorders, because an item the LIS "keeps" can still be
 * displaced by a later move. Nothing but a simulation catches that.
 *
 * The simulation below is deliberately written independently of the engine:
 * it is the *specification* (remove the item, then splice it in at
 * newPosition, evaluated against the array as it stands at that moment), not
 * a copy of the implementation. If someone "optimises" computeMoves and this
 * still passes, the optimisation is sound.
 */

import { computeMoves, greedyMoves } from './sort-oos.mjs';

const shortId = (gid) => String(gid).split('/').pop();

/* ------------------------------------------------------------------ */
/* The spec: how Shopify says collectionReorderProducts behaves        */
/* ------------------------------------------------------------------ */

/**
 * Apply moves sequentially. Each newPosition is an index into the array as it
 * exists at that moment, AFTER the moved item has been removed from it.
 */
function applyMoves(start, moves) {
  const arr = [...start];
  for (const m of moves) {
    const id = shortId(m.id);
    const pos = Number(m.newPosition);
    const i = arr.indexOf(id);
    if (i === -1) throw new Error(`move references unknown id ${id}`);
    if (!Number.isInteger(pos) || pos < 0 || pos >= arr.length)
      throw new Error(`newPosition ${m.newPosition} out of range 0..${arr.length - 1}`);
    arr.splice(i, 1);
    arr.splice(pos, 0, id);
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* Deterministic RNG so failures are reproducible                      */
/* ------------------------------------------------------------------ */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

let failures = 0;
let checks = 0;

function check(label, current, desired) {
  checks++;
  let moves;
  try {
    moves = computeMoves(current, desired);
  } catch (e) {
    failures++;
    console.error(`FAIL ${label}: threw ${e.message}`);
    return;
  }

  let got;
  try {
    got = applyMoves(current, moves);
  } catch (e) {
    failures++;
    console.error(`FAIL ${label}: invalid move — ${e.message}`);
    console.error(`  current: ${current.join(',')}`);
    console.error(`  desired: ${desired.join(',')}`);
    console.error(`  moves:   ${JSON.stringify(moves)}`);
    return;
  }

  if (got.join(',') !== desired.join(',')) {
    failures++;
    console.error(`FAIL ${label}: wrong result after ${moves.length} move(s)`);
    console.error(`  current: ${current.join(',')}`);
    console.error(`  desired: ${desired.join(',')}`);
    console.error(`  got:     ${got.join(',')}`);
    console.error(`  moves:   ${JSON.stringify(moves)}`);
  }
  return moves;
}

const ids = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

console.log('--- fixed cases ---');

// already correct
{
  const a = ids(10);
  const m = check('identity', a, a);
  if (m && m.length !== 0) {
    failures++;
    console.error(`FAIL identity: expected 0 moves, got ${m.length}`);
  } else console.log('  identity: 0 moves');
}

// the actual shape of this project's workload: push k sold-out items to the tail
{
  const a = ids(20);
  const sold = new Set(['3', '7', '11', '14', '19']);
  const desired = [...a.filter((x) => !sold.has(x)), ...a.filter((x) => sold.has(x))];
  const m = check('push 5 of 20 sold-out to tail', a, desired);
  console.log(`  push 5 of 20 to tail: ${m?.length} moves`);
}

// THE TEST THAT MATTERS: a restocked item returns to its base position —
// not the top, not the bottom.
//
// Careful with what "its original position" means. If other products are still
// sold out and sitting at the tail, everything after them shifts up. So the
// invariant is not "back at base index 6", it is "back among its base
// neighbours, in base relative order". Asserting a hardcoded index here is how
// you write a test that fails on correct code.
{
  const base = ids(20);
  const sold = new Set(['3', '7', '11', '14', '19']);
  const afterSort = [...base.filter((x) => !sold.has(x)), ...base.filter((x) => sold.has(x))];
  sold.delete('7'); // '7' restocks
  const desired = [...base.filter((x) => !sold.has(x)), ...base.filter((x) => sold.has(x))];
  const m = check('restock one item', afterSort, desired);
  const landed = applyMoves(afterSort, m);

  const i7 = landed.indexOf('7');
  if (landed[i7 - 1] !== '6' || landed[i7 + 1] !== '8') {
    failures++;
    console.error(
      `FAIL restock: '7' landed between '${landed[i7 - 1]}' and '${landed[i7 + 1]}', expected '6' and '8'`
    );
  } else if (i7 === 0 || i7 === landed.length - 1) {
    failures++;
    console.error(`FAIL restock: '7' landed at an edge (index ${i7}) — top/bottom regression`);
  } else {
    console.log(`  restock one item: ${m.length} moves, '7' back between '6' and '8' (index ${i7})`);
  }
}

// With no other sold-out products in play, a restock must land on the exact
// base index — the strict form of the same property.
{
  const base = ids(20);
  const afterSort = [...base.filter((x) => x !== '7'), '7']; // only '7' was sold out
  const m = check('restock, nothing else sold out', afterSort, base);
  const landed = applyMoves(afterSort, m);
  if (landed[6] !== '7') {
    failures++;
    console.error(`FAIL strict restock: '7' landed at index ${landed.indexOf('7')}, expected 6`);
  } else {
    console.log(`  restock (sole sold-out): ${m.length} move(s), '7' back at exact base index 6`);
  }
}

// Idempotence: re-running against an already-sorted collection must be a no-op.
// If this ever regresses the cron would rewrite the collection every hour.
{
  const base = ids(30);
  const rand = rng(4242);
  for (let t = 0; t < 200; t++) {
    const current = shuffled(base, rand);
    const sold = new Set(base.filter(() => rand() < 0.3));
    const desired = [...base.filter((x) => !sold.has(x)), ...base.filter((x) => sold.has(x))];
    const settled = applyMoves(current, computeMoves(current, desired));
    checks++;
    const second = computeMoves(settled, desired);
    if (second.length !== 0) {
      failures++;
      console.error(`FAIL idempotence#${t}: second pass emitted ${second.length} move(s)`);
    }
  }
  console.log('  idempotence over 200 settled collections: 0 moves on rerun');
}

// scale sanity: 500 products, 68 sold out, should not emit 500 moves
{
  const a = ids(500);
  const rand = rng(99);
  const sold = new Set(shuffled(a, rand).slice(0, 68));
  const desired = [...a.filter((x) => !sold.has(x)), ...a.filter((x) => sold.has(x))];
  const m = check('500 products / 68 sold out', a, desired);
  console.log(`  500 products, 68 sold out: ${m?.length} moves`);
  if (m && m.length > 100) {
    failures++;
    console.error(`FAIL scale: ${m.length} moves is far more than the 68 expected`);
  }
}

// edge cases
check('empty', [], []);
check('single', ['1'], ['1']);
check('two swapped', ['1', '2'], ['2', '1']);
check('full reverse', ids(12), ids(12).reverse());
check('move head to tail', ids(8), [...ids(8).slice(1), '1']);
check('move tail to head', ids(8), ['8', ...ids(8).slice(0, 7)]);
console.log('  edge cases: ok');

/* ------------------------------------------------------------------ */
/* Regression: moves must be computed against the array they land on   */
/* ------------------------------------------------------------------ */

// Setting a collection's sortOrder to MANUAL does NOT preserve the order you
// were just reading under MOST_RELEVANT/ALPHA/etc. Shopify keeps a separate
// manual position list and switching to MANUAL reveals it — verified live on
// an 8-product automated collection where the flip changed all 8 positions.
//
// So the array you read BEFORE the flip is not the array your moves get
// applied to AFTER it. Compute against the stale one and any product that
// looked "already correct" gets no move emitted and is silently left wherever
// the manual list had it. That shipped once: it stranded a sold-out Gift Card
// at index 6 of 117.
console.log('\n--- sequencing regression (stale-array hazard) ---');
{
  const preFlip = ids(12); // order seen under the collection's old sort
  const manual = ['5', '1', '9', '3', '12', '7', '2', '11', '4', '8', '6', '10']; // order after flip
  const sold = new Set(['3', '9', '12']);
  const desired = [...preFlip.filter((x) => !sold.has(x)), ...preFlip.filter((x) => sold.has(x))];

  // What the buggy sequencing did: compute against preFlip, apply to manual.
  checks++;
  const stale = applyMoves(manual, computeMoves(preFlip, desired));
  if (stale.join(',') === desired.join(',')) {
    failures++;
    console.error(
      'FAIL: stale-array case now happens to succeed — this fixture no longer ' +
        'reproduces the hazard, pick a manual order that actually diverges'
    );
  } else {
    console.log('  stale array (pre-flip order) -> wrong result, as expected');
  }

  // What the fix does: re-read after the flip, compute against what's really there.
  checks++;
  const fresh = applyMoves(manual, computeMoves(manual, desired));
  if (fresh.join(',') !== desired.join(',')) {
    failures++;
    console.error(`FAIL: fresh-array case did not reach desired order`);
    console.error(`  desired: ${desired.join(',')}`);
    console.error(`  got:     ${fresh.join(',')}`);
  } else {
    console.log('  fresh array (post-flip order) -> correct result');
  }

  // Randomised: for any divergent post-flip order, computing against the fresh
  // array must always work.
  const rand = rng(31337);
  let staleFailures = 0;
  for (let t = 0; t < 500; t++) {
    const n = 6 + Math.floor(rand() * 30);
    const base = ids(n);
    const manualOrder = shuffled(base, rand);
    const soldSet = new Set(base.filter(() => rand() < 0.3));
    const want = [...base.filter((x) => !soldSet.has(x)), ...base.filter((x) => soldSet.has(x))];

    checks++;
    const good = applyMoves(manualOrder, computeMoves(manualOrder, want));
    if (good.join(',') !== want.join(',')) {
      failures++;
      console.error(`FAIL sequencing#${t}: fresh-array compute failed`);
    }
    if (applyMoves(manualOrder, computeMoves(base, want)).join(',') !== want.join(','))
      staleFailures++;
  }
  console.log(`  500 randomised: fresh always correct; stale wrong in ${staleFailures} of 500`);
}

console.log('\n--- randomised permutations ---');

// 5000 arbitrary permutations, both directions of greedy independently verified
{
  const rand = rng(20260724);
  let totalMoves = 0;
  let worst = 0;
  for (let t = 0; t < 5000; t++) {
    const n = 2 + Math.floor(rand() * 40);
    const current = ids(n);
    const desired = shuffled(current, rand);
    const m = check(`perm#${t} (n=${n})`, current, desired);
    if (m) {
      totalMoves += m.length;
      worst = Math.max(worst, m.length / n);
    }

    // both greedy directions must be individually correct, not just the winner
    for (const dir of ['asc', 'desc']) {
      checks++;
      const gm = greedyMoves(current, desired, dir);
      const got = applyMoves(current, gm);
      if (got.join(',') !== desired.join(',')) {
        failures++;
        console.error(`FAIL perm#${t} greedy(${dir}) produced the wrong order`);
      }
    }
  }
  console.log(`  5000 permutations, avg ${(totalMoves / 5000).toFixed(1)} moves`);
  console.log(`  worst case: ${(worst * 100).toFixed(0)}% of list length`);
}

// realistic workload: random base + random sold-out subset, i.e. what this
// engine actually emits on a real store
{
  const rand = rng(7);
  for (let t = 0; t < 2000; t++) {
    const n = 5 + Math.floor(rand() * 60);
    const base = ids(n);
    const current = shuffled(base, rand); // collection drifted from base
    const sold = new Set(base.filter(() => rand() < 0.25));
    const desired = [...base.filter((x) => !sold.has(x)), ...base.filter((x) => sold.has(x))];
    check(`workload#${t} (n=${n})`, current, desired);
  }
  console.log('  2000 realistic sold-out workloads: ok');
}

console.log(
  `\n${failures ? '\x1b[31mFAILED\x1b[0m' : '\x1b[32mPASSED\x1b[0m'} — ${checks} checks, ${failures} failure(s)`
);
process.exit(failures ? 1 : 0);

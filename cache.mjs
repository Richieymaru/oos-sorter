/**
 * Tiny per-process TTL memo. On Vercel a warm serverless instance reuses this
 * module memory between requests, so repeat page views skip the live Shopify
 * round trips entirely. Cold starts see an empty cache and fetch fresh, so
 * correctness never depends on it — it only ever makes things faster.
 *
 * Read-path only. Never wrap a mutation whose write must happen every call.
 */
export function ttlMemo(fn, ttlMs) {
  const store = new Map(); // key -> { at, val }
  return async (...args) => {
    const key = JSON.stringify(args);
    const hit = store.get(key);
    const now = Date.now();
    if (hit && now - hit.at < ttlMs) return hit.val;
    const val = await fn(...args);
    store.set(key, { at: now, val });
    // keep the map from growing unbounded across many distinct keys
    if (store.size > 32) for (const k of store.keys()) { if (now - store.get(k).at >= ttlMs) store.delete(k); }
    return val;
  };
}

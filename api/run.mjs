/**
 * Reliable trigger for the engine. A free external cron service (e.g.
 * cron-job.org) hits this every 5 minutes — that fires on time, unlike GitHub's
 * flaky scheduled workflow.
 *
 *   https://<your-app>.vercel.app/api/run?token=RUN_TOKEN            (sort/draft/notify-accumulate)
 *   https://<your-app>.vercel.app/api/run?token=RUN_TOKEN&digest=1   (also send the daily digest)
 *
 * Protected by RUN_TOKEN (Vercel env var). Reuses the same engine the CLI runs.
 */
import { runEngine } from '../sort-oos.mjs';
import { maybeRunAudit } from '../audit.mjs';
import { loadState } from '../state.mjs';

// Give the run room to finish (default is short).
export const config = { maxDuration: 60 };

// Throttle the heavy full sweep. The external cron (cron-job.org) may still ping
// every 5 min, but a full run only needs to happen every ~15 min — webhooks keep
// stock/status fresh in real time between sweeps, so this just caps Vercel Fluid
// Active-CPU usage regardless of ping rate. A ping inside the window returns a
// cheap "skipped" after one state read. Digest, ?force=1 and ?chunk runs bypass
// it. Set MIN_RUN_INTERVAL_MIN=0 to disable.
const _minRaw = process.env.MIN_RUN_INTERVAL_MIN;
const _minMin = _minRaw == null || _minRaw === '' ? 15 : Number(_minRaw); // unset/blank -> 15; explicit "0" disables
const MIN_RUN_INTERVAL_MS = (Number.isFinite(_minMin) ? _minMin : 15) * 60 * 1000;

function param(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try {
    return new URL(req.url, 'http://x').searchParams.get(name);
  } catch {
    return null;
  }
}

function authorized(req) {
  const expected = process.env.RUN_TOKEN;
  if (!expected) return false;
  const q = param(req, 'token');
  const header = req.headers?.['authorization'];
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return q === expected || bearer === expected;
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.statusCode = 401;
    res.end('unauthorized');
    return;
  }
  const sendDigest = ['1', 'true'].includes(param(req, 'digest'));
  // ?chunk=N => rotating mini-sweep: sort the next N collections (for big stores
  // where a full sweep would exceed the 60s limit).
  // Explicit ?chunk forces a rotating sweep of N collections; otherwise the
  // engine auto-enables one on large stores (see runEngine).
  const chunkN = parseInt(param(req, 'chunk') || '', 10);
  const chunk = Number.isFinite(chunkN) && chunkN > 0 ? chunkN : null;
  const force = ['1', 'true'].includes(param(req, 'force'));

  // Min-interval gate: skip the full sweep if one ran recently. Bypassed by a
  // digest run (must fire at its slot), an explicit rotating sweep (?chunk), or
  // ?force=1. A failed state read falls through and runs normally.
  if (MIN_RUN_INTERVAL_MS > 0 && !sendDigest && !chunk && !force) {
    try {
      const st = await loadState();
      const last = st.lastRun ? Date.parse(st.lastRun) : 0;
      const since = Date.now() - last;
      if (Number.isFinite(last) && last > 0 && since < MIN_RUN_INTERVAL_MS) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, skipped: 'min-interval', sinceLastMs: since, minIntervalMs: MIN_RUN_INTERVAL_MS }));
        return;
      }
    } catch { /* fall through and run */ }
  }

  try {
    const result = await runEngine({ sendDigest, chunk });
    // Self-gating: a full product-status audit runs here at most once every 3
    // days (see maybeRunAudit). It never throws, so it can't break the engine run.
    const audit = await maybeRunAudit();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, ...result, audit }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  }
}

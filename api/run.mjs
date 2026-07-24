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

// Give the run room to finish on the Vercel Hobby tier (default is short).
export const config = { maxDuration: 60 };

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
  try {
    const result = await runEngine({ sendDigest });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  }
}

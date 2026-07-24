import { requireAuth } from './_auth.mjs';
import { gatherSoldOut } from '../report.mjs';
import { sendReport } from '../notify.mjs';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('POST only');
    return;
  }
  const items = await gatherSoldOut();
  await sendReport(items, {});
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, count: items.length }));
}

/**
 * Product Change Monitor receiver: Shopify calls this on the `products/update`
 * topic the instant any product is edited. We cheaply detect a real STATUS
 * change (Draft ↔ Active ↔ Archived ↔ Unlisted) against the last-known status
 * (oos_sort.monitor metafield), and only then look up WHO did it and alert.
 *
 * `products/update` is noisy — it fires for price, tag, title, image edits too.
 * Almost all of those short-circuit at "status unchanged" with no API calls and
 * no writes, so this stays cheap at any edit volume.
 *
 * Auth: the registered callback carries ?token=WEBHOOK_TOKEN, same as the
 * inventory webhook, so only Shopify (which we told that exact URL) can reach it.
 */
import { loadSettings } from '../settings.mjs';
import { loadMonitorState, saveMonitorState } from '../monitor-state.mjs';
import {
  detectStatusChange, labelOf, totalStockFromPayload, buildSheetRow,
  whoChangedStatus, appendToSheet,
} from '../monitor.mjs';
import { notifySlackProductChange } from '../slack.mjs';

export const config = { maxDuration: 30 };

const resolveFlag = (env, saved) => (env === 'true' ? true : env === 'false' ? false : !!saved);

function param(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try { return new URL(req.url, 'http://x').searchParams.get(name); } catch { return null; }
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!process.env.WEBHOOK_TOKEN || param(req, 'token') !== process.env.WEBHOOK_TOKEN) {
    res.statusCode = 401; res.end(JSON.stringify({ ok: false, error: 'unauthorized' })); return;
  }

  const body = await readJson(req);
  // products/update payload: { id, handle, title, status, variants:[{inventory_quantity}], ... }
  const numId = body.id != null ? String(body.id) : (body.admin_graphql_api_id?.split('/').pop() || null);
  const status = body.status; // "active" | "draft" | "archived"

  try {
    if (!numId || !status) { res.end(JSON.stringify({ ok: true, skipped: 'no id/status' })); return; }

    const settings = await loadSettings().catch(() => ({}));
    const monitorOn = resolveFlag(process.env.FEATURE_MONITOR, settings.monitor);
    if (!monitorOn) { res.end(JSON.stringify({ ok: true, monitor: 'off' })); return; }

    const state = await loadMonitorState();
    const det = detectStatusChange(state.statuses, numId, status);

    // First time we've seen this product, or status unchanged: just record the
    // baseline (nothing to alert). Only write when the stored code actually moves.
    if (det.firstSight || det.changed) {
      state.statuses[numId] = det.toCode;
      await saveMonitorState(state);
    }
    if (!det.changed) { res.end(JSON.stringify({ ok: true, firstSight: det.firstSight, changed: false })); return; }

    // A genuine status change. Attribute it and fan out to Slack + the Sheet.
    const fromLabel = labelOf(det.fromCode);
    const toLabel = labelOf(det.toCode);
    const stock = totalStockFromPayload(body);
    const who = (await whoChangedStatus(numId)).author;

    const alert = {
      title: body.title, handle: body.handle, fromLabel, toLabel, who, stock,
    };
    // Monitor posts to its OWN Slack webhook (settings.monitorSlackWebhook), kept
    // separate from the back-in-stock waitlist channel. No env fallback here, so a
    // blank field means "no Slack for product changes" — never bleeds into the
    // waitlist channel (which uses settings.slackWebhook / SLACK_WEBHOOK_URL).
    const slack = settings.monitorSlackWebhook
      ? await notifySlackProductChange({ ...alert, webhookUrl: settings.monitorSlackWebhook })
      : { skipped: true };
    const sheet = await appendToSheet(
      settings.sheetWebhook,
      buildSheetRow({ ...alert, at: new Date().toISOString(), shop: process.env.SHOP_DOMAIN })
    );

    console.log(`monitor: ${body.title} ${fromLabel}→${toLabel} by ${who || 'unknown'} (stock ${stock ?? '?'})`);
    res.end(JSON.stringify({ ok: true, changed: true, from: fromLabel, to: toLabel, who, stock, slack, sheet }));
  } catch (err) {
    // 500 lets Shopify retry a transient failure (rate limit, cold start).
    console.error('product-webhook error:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err.message) }));
  }
}

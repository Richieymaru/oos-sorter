/**
 * Product Change Monitor receiver — the single endpoint for ALL monitor topics
 * (kept as one function to stay under Vercel Hobby's 12-function cap). Shopify
 * tells us which topic fired via the `X-Shopify-Topic` header, and we branch:
 *
 *   products/update    -> a real STATUS change (Draft/Active/Archived/Unlisted)?
 *   products/create    -> product added (with author)
 *   products/delete    -> product deleted (no author available; name from cache)
 *   collections/create -> collection added (with author)
 *   collections/delete -> collection deleted (no author available; name from cache)
 *
 * products/update is noisy (fires on any edit); non-status edits short-circuit
 * with no alert. "Who" comes from the resource's timeline (BasicEvent.author),
 * which survives an activity-log purge. Deletes carry no author in Shopify, so
 * those rows say "unknown".
 *
 * Auth: the registered callback carries ?token=WEBHOOK_TOKEN. Slack goes to the
 * monitor's OWN webhook (settings.monitorSlackWebhook); the Sheet to
 * settings.sheetWebhook. Both optional — a blank one is simply skipped.
 */
import { loadSettings } from '../settings.mjs';
import { loadMonitorState, saveMonitorState } from '../monitor-state.mjs';
import {
  detectStatusChange, labelOf, codeOf, totalStockFromPayload, buildSheetRow,
  whoFromProductEvents, whoFromCollectionEvents, whoDeleted, appendToSheet,
} from '../monitor.mjs';
import { notifySlackMonitorEvent } from '../slack.mjs';

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

const numIdOf = (body) => (body.id != null ? String(body.id) : (body.admin_graphql_api_id?.split('/').pop() || null));

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!process.env.WEBHOOK_TOKEN || param(req, 'token') !== process.env.WEBHOOK_TOKEN) {
    res.statusCode = 401; res.end(JSON.stringify({ ok: false, error: 'unauthorized' })); return;
  }

  const topic = String(req.headers['x-shopify-topic'] || 'products/update').toLowerCase();
  const body = await readJson(req);
  const numId = numIdOf(body);

  try {
    if (!numId) { res.end(JSON.stringify({ ok: true, skipped: 'no id' })); return; }

    const settings = await loadSettings().catch(() => ({}));
    if (!resolveFlag(process.env.FEATURE_MONITOR, settings.monitor)) {
      res.end(JSON.stringify({ ok: true, monitor: 'off' })); return;
    }

    // Fan-out helper: post to the monitor's Slack + the Sheet (each optional).
    const emit = async ({ title, handle, path, fromLabel, toLabel, action, who, stock }) => {
      const slack = await notifySlackMonitorEvent({
        webhookUrl: settings.monitorSlackWebhook, title, handle, path, action, who, stock,
      });
      const sheet = await appendToSheet(
        settings.sheetWebhook,
        buildSheetRow({ at: new Date().toISOString(), title, handle, path, fromLabel, toLabel, who, stock, shop: process.env.SHOP_DOMAIN })
      );
      return { slack, sheet };
    };

    // ---- COLLECTIONS ----
    if (topic === 'collections/create' || topic === 'collections/delete') {
      const state = await loadMonitorState();
      const cacheKey = 'c' + numId;
      const title = body.title || state.titles[cacheKey] || `#${numId}`;
      const handle = body.handle || null;

      if (topic === 'collections/create') {
        state.titles[cacheKey] = body.title || title;
        await saveMonitorState(state);
        const who = (await whoFromCollectionEvents(numId)).author;
        const r = await emit({ title, handle, path: 'collections', fromLabel: '—', toLabel: 'Collection added', action: 'collection was added', who, stock: '' });
        console.log(`monitor: collection added "${title}" by ${who || 'unknown'}`);
        res.end(JSON.stringify({ ok: true, topic, who, ...r })); return;
      }
      // collections/delete — author from the shop-level destroy event
      delete state.titles[cacheKey];
      await saveMonitorState(state);
      const who = (await whoDeleted(numId, 'COLLECTION')).author;
      const r = await emit({ title, handle: null, path: 'collections', fromLabel: 'existed', toLabel: 'Collection deleted', action: 'collection was deleted', who, stock: '' });
      console.log(`monitor: collection deleted "${title}" by ${who || 'unknown'}`);
      res.end(JSON.stringify({ ok: true, topic, who, ...r })); return;
    }

    // ---- PRODUCTS ----
    const state = await loadMonitorState();
    const cacheKey = 'p' + numId;

    if (topic === 'products/delete') {
      // Payload is id-only; name from cache (miss -> #id). No author available.
      const title = body.title || state.titles[cacheKey] || `#${numId}`;
      delete state.statuses[numId];
      delete state.titles[cacheKey];
      await saveMonitorState(state);
      const who = (await whoDeleted(numId, 'PRODUCT')).author;
      const r = await emit({ title, handle: null, path: 'products', fromLabel: 'existed', toLabel: 'Deleted', action: 'was deleted', who, stock: '' });
      console.log(`monitor: product deleted "${title}" by ${who || 'unknown'}`);
      res.end(JSON.stringify({ ok: true, topic, who, ...r })); return;
    }

    const status = body.status;
    if (!status) { res.end(JSON.stringify({ ok: true, skipped: 'no status' })); return; }
    if (body.title) state.titles[cacheKey] = body.title;

    if (topic === 'products/create') {
      state.statuses[numId] = codeOf(status);
      await saveMonitorState(state);
      const who = (await whoFromProductEvents(numId, /creat|add/i)).author;
      const stock = totalStockFromPayload(body);
      const r = await emit({ title: body.title, handle: body.handle, path: 'products', fromLabel: '—', toLabel: 'Added (' + labelOf(codeOf(status)) + ')', action: 'was added', who, stock });
      console.log(`monitor: product added "${body.title}" by ${who || 'unknown'}`);
      res.end(JSON.stringify({ ok: true, topic, who, ...r })); return;
    }

    // ---- products/update: STATUS change only ----
    const det = detectStatusChange(state.statuses, numId, status);
    if (det.firstSight || det.changed) {
      state.statuses[numId] = det.toCode;
      await saveMonitorState(state);
    }
    if (!det.changed) { res.end(JSON.stringify({ ok: true, topic, firstSight: det.firstSight, changed: false })); return; }

    const fromLabel = labelOf(det.fromCode);
    const toLabel = labelOf(det.toCode);
    const stock = totalStockFromPayload(body);
    const who = (await whoFromProductEvents(numId)).author;
    const r = await emit({ title: body.title, handle: body.handle, path: 'products', fromLabel, toLabel, action: `status changed ${fromLabel} → ${toLabel}`, who, stock });
    console.log(`monitor: ${body.title} ${fromLabel}→${toLabel} by ${who || 'unknown'} (stock ${stock ?? '?'})`);
    res.end(JSON.stringify({ ok: true, topic, changed: true, from: fromLabel, to: toLabel, who, stock, ...r }));
  } catch (err) {
    // 500 lets Shopify retry a transient failure (rate limit, cold start).
    console.error('product-webhook error:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err.message) }));
  }
}

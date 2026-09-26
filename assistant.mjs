/**
 * The in-app AI assistant: gives Gemini (1) knowledge of what this app does and
 * (2) a live snapshot of the store's current data, then answers the owner's
 * questions. Read-only — it advises, it doesn't change the store.
 */
import { loadSettings } from './settings.mjs';
import { loadState } from './state.mjs';
import { productsWithWaitlist } from './restock.mjs';
import { loadNotified, deriveStats } from './notified.mjs';
import { loadMonitorLog, monitorTag } from './monitor-log.mjs';
import { fetchAllCollectionHandles } from './sort-oos.mjs';
import { askGemini } from './gemini.mjs';

const SHOP = process.env.SHOP_DOMAIN;

const APP_KNOWLEDGE = `You are the built-in AI assistant for "GBU Store Ops" (also called OOS Sorter), a Shopify operations app for a gel-blaster store. Your job is to help the store owner understand their store and get the most out of the app. You advise; you do NOT change anything in the store yourself.

What the app does:
- Sorting: automatically pushes SOLD-OUT products to the bottom of every collection and keeps in-stock ones up top. "Sold out" = not available at the store's online-fulfilling locations (matches what the storefront shows).
- Back-in-stock waitlist: on a sold-out product page, shoppers can ask to be notified. When it restocks they get an email (with price, compare-at, image, add-to-cart). The app tracks who was notified, who clicked through, offers a manual Resend and one automatic nudge, and gracefully handles a product selling out again.
- Sold-out email alerts + a daily digest to the owner.
- Draft sold-out products (optional): hides them from the storefront until they're back in stock.
- Product change monitor: logs WHO changes a product's status (Active / Draft / Unlisted / Archived) and who adds or deletes products and collections — to Slack, a Google Sheet, and the dashboard.`;

/** A compact, live snapshot of the store the assistant can reason over.
 *  Best-effort: any single lookup that fails is simply left out. */
export async function gatherContext() {
  const [settings, state, collections, waitlist, notified, monitor] = await Promise.all([
    loadSettings().catch(() => ({})),
    loadState().catch(() => ({})),
    fetchAllCollectionHandles().catch(() => []),
    productsWithWaitlist().catch(() => []),
    loadNotified().catch(() => []),
    loadMonitorLog().catch(() => []),
  ]);
  const on = (b) => (b ? 'ON' : 'off');
  const stats = deriveStats(notified);
  const shoppersWaiting = waitlist.reduce((n, w) => n + (w.list?.length || 0), 0);
  const recentChanges = monitor.slice(0, 12).map((r) => {
    const { label } = monitorTag(r.f, r.to);
    const when = String(r.ts || '').slice(0, 16).replace('T', ' ');
    return `- ${r.t || 'item'} · ${label}${r.s != null ? ` · stock ${r.s}` : ''} · by ${r.w || 'unknown'} · ${when}`;
  }).join('\n');

  return [
    `Store: ${SHOP}`,
    `Features: sorting ${on(settings.sort)}, sold-out email alerts ${on(settings.notify)}, back-in-stock waitlist ${on(settings.waitlist)}, draft sold-out ${on(settings.draft)}, product-change monitor ${on(settings.monitor)}.`,
    `Collections in store: ${collections.length}.`,
    `Products currently sold out (kept at the bottom): ${(state.soldOut || []).length}.`,
    `Engine last run: ${state.lastRun || 'unknown'}.`,
    `Waitlist: ${waitlist.length} product(s) have a waitlist, ${shoppersWaiting} shopper(s) waiting. Notified recently: ${stats.notified}; clicked through: ${stats.clicked} (${stats.clickRate}%); nudged: ${stats.nudged}.`,
    recentChanges ? `Recent product/collection changes (who did what):\n${recentChanges}` : `No recent product/collection changes recorded yet.`,
  ].join('\n');
}

/** Answer the conversation (an array of { role:'user'|'assistant', text }). */
export async function assistantReply(messages) {
  const context = await gatherContext().catch(() => 'Live store data is unavailable right now.');
  const system = `${APP_KNOWLEDGE}

=== LIVE STORE DATA (as of now) ===
${context}

=== HOW TO ANSWER ===
Answer as the store's practical ops assistant. Be concise and specific. Use the live data above when it's relevant; if it doesn't cover the question, say what you'd need to answer. NEVER invent numbers or facts. When asked what to focus on, give 2–4 concrete, prioritised suggestions grounded in the data above. Plain language, no fluff.`;
  return askGemini(system, messages);
}

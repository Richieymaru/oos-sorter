/**
 * Back-in-stock restock pass. Finds every product that has a non-empty waitlist
 * AND is now in stock, emails the shoppers whose variant is back, and drops them
 * from the list.
 *
 * "In stock + non-empty waitlist" is exactly a just-came-back event, because a
 * shopper only joins a waitlist while the product is sold out. Uses the same
 * online-availability stock definition (catalog.mjs / stock.mjs) as the sorter,
 * so it matches what the storefront actually shows.
 *
 * Emails are per variant: restocking "Black" emails the people who asked about
 * Black and leaves the ones waiting on "Tan" on the list. Entries with no
 * recorded variant (signed up before variants were tracked) keep the old
 * product-level behaviour.
 */
import { gql, shortId, getShopContext } from './shopify.mjs';
import { fetchProductsByIds } from './catalog.mjs';
import { isInStock, isVariantInStock } from './stock.mjs';
import { readWaitlist, clearWaitlist, setWaitlist, unsubUrl, trackUrl, partitionByStock } from './waitlist.mjs';
import { sendBackInStock, sendSoldOutAlert, sendNudge, formatMoney } from './notify.mjs';
import { notifiedRow, recordNotified, applyNudged, loadNotified, selectNudges } from './notified.mjs';
import { loadState, saveState } from './state.mjs';

/** Bump the cumulative "notified so far" counters after a real send. Best-effort:
 *  a failure here must never break the actual emailing. */
/** Map numeric variant id -> the fetched variant node (has price/compareAtPrice). */
function variantsById(sp) {
  return new Map((sp?.variants?.nodes || []).map((v) => [shortId(v.id), v]));
}

/** Formatted price + (sale) compare-at text for one variant, in the shop
 *  currency. Compare-at only shows when it's higher than price (a real sale). */
function priceTextFor(variant, currency) {
  const v = variant || {};
  const onSale = v.compareAtPrice != null && Number(v.compareAtPrice) > Number(v.price);
  return {
    priceText: formatMoney(v.price, currency) || null,
    compareAtText: onSale ? (formatMoney(v.compareAtPrice, currency) || null) : null,
  };
}

async function bumpNotified(shoppers) {
  if (!shoppers) return;
  try {
    const st = await loadState();
    st.waitlistNotified = (st.waitlistNotified || 0) + shoppers;
    st.waitlistProducts = (st.waitlistProducts || 0) + 1;
    await saveState(st);
  } catch (e) {
    console.error('  ! waitlist counter update failed:', e.message);
  }
}

/**
 * Email one product's due subscribers and write back whoever still waits.
 * Shared by the scheduled pass, the webhook pass, and the manual "Send now".
 *
 * @param {object} args
 * @param {string} args.gid - product gid
 * @param {Array} args.list - the full waitlist for that product
 * @param {Array} args.due - the subset to email now
 * @param {Array} args.waiting - the subset to keep (still sold out)
 * @param {{title?:string, handle?:string, image?:string|null}} args.product
 * @param {string|null} args.fallbackVariantId - variant to link when an entry has none
 * @returns {Promise<number>} how many emails actually sent
 */
async function emailAndPrune({ gid, list, due, waiting, product, fallbackVariantId, variants = new Map(), ctx = {}, dryRun, base }) {
  let sent = 0;
  const failed = [];
  const rows = [];
  const short = shortId(gid);

  for (const sub of due) {
    const variantId = sub.variantId || fallbackVariantId;
    // Deep-link the email to the variant the shopper asked about, through the
    // tracked redirect so a click-through is recorded on the log row.
    const relCart = variantId ? `/cart/${variantId}:1` : (product.handle ? `/products/${product.handle}` : '/');
    const relProduct = product.handle ? `/products/${product.handle}` : '/';
    const { priceText, compareAtText } = priceTextFor(variants.get(String(variantId)), ctx.currency);
    const payload = {
      ...product,
      variantId,
      variantTitle: sub.variantTitle || null,
      storeHost: ctx.host,
      priceText,
      compareAtText,
      clickCartUrl: trackUrl(base, short, sub.email, relCart),
      clickProductUrl: trackUrl(base, short, sub.email, relProduct),
    };
    try {
      await sendBackInStock(sub.email, payload, unsubUrl(base, short, sub.email), { dryRun });
      sent++;
      rows.push(notifiedRow({ email: sub.email, productId: short, title: product.title, variantId, variantTitle: sub.variantTitle || null }));
    } catch (e) {
      console.error(`  ! back-in-stock email to ${sub.email} failed: ${e.message}`);
      failed.push(sub); // keep them so they retry next run
    }
  }

  if (!dryRun) {
    const keep = [...waiting, ...failed];
    if (keep.length === list.length) {
      /* nothing changed — skip the write */
    } else if (keep.length) {
      await setWaitlist(gid, keep);
    } else {
      await clearWaitlist(gid);
    }
    await bumpNotified(sent); // cumulative "notified so far" stat (no-op when sent === 0)
    try {
      await recordNotified(rows); // detailed log; best-effort, never breaks the send/prune
    } catch (e) {
      console.error(`  ! notified-log write failed: ${e.message}`);
    }
  }

  return sent;
}

/** Every product that currently has at least one waitlist subscriber. */
export async function productsWithWaitlist() {
  const out = [];
  let cursor = null;
  do {
    const d = await gql(
      `query($c: String) { products(first: 250, after: $c) {
         pageInfo { hasNextPage endCursor }
         nodes { id title handle featuredImage { url } metafield(namespace: "oos_sort", key: "waitlist") { value } }
       } }`,
      { c: cursor }
    );
    for (const p of d.products.nodes) {
      let list = [];
      try { list = JSON.parse(p.metafield?.value || '[]'); } catch { list = []; }
      if (Array.isArray(list) && list.length) out.push({ id: p.id, title: p.title, handle: p.handle, image: p.featuredImage?.url || null, list });
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

/**
 * Email the waitlist of any waitlisted product that is back in stock, then clear
 * that product's list so nobody is emailed twice.
 * @returns {Promise<{waitlisted:number, productsNotified:number, emailsSent:number}>}
 */
export async function notifyRestocks({ dryRun = false, base = null } = {}) {
  const waited = await productsWithWaitlist();
  if (!waited.length) return { waitlisted: 0, productsNotified: 0, emailsSent: 0 };

  const stock = await fetchProductsByIds(waited.map((w) => shortId(w.id)));
  const byId = new Map(stock.map((p) => [p.id, p]));
  const ctx = await getShopContext();

  let productsNotified = 0;
  let emailsSent = 0;
  for (const w of waited) {
    const sp = byId.get(w.id);
    if (!sp || !isInStock(sp)) continue; // every variant still sold out — keep the whole list

    const { notify, waiting } = partitionByStock(w.list, (variantId) => isVariantInStock(sp, variantId));
    if (!notify.length) continue; // the product is back, but not the variants these people want

    const first = sp.variants?.nodes?.[0];
    emailsSent += await emailAndPrune({
      gid: w.id,
      list: w.list,
      due: notify,
      waiting,
      product: { title: w.title, handle: w.handle, image: sp.featuredImage?.url || null },
      fallbackVariantId: first?.id ? shortId(first.id) : null,
      variants: variantsById(sp),
      ctx,
      dryRun,
      base,
    });
    productsNotified++;
  }
  return { waitlisted: waited.length, productsNotified, emailsSent };
}

/**
 * Targeted back-in-stock for specific products (used by the webhook, which can't
 * afford a full-store scan). Reads each product's waitlist first — cheap, and a
 * no-op for products without one — then emails only those that are back in stock,
 * clearing successes (keeping failures for retry). Same "in stock + non-empty
 * waitlist" rule as notifyRestocks.
 * @returns {Promise<{productsNotified:number, emailsSent:number}>}
 */
export async function notifyRestocksForProducts(productGids, { dryRun = false, base = null } = {}) {
  const withLists = [];
  for (const gid of productGids || []) {
    const list = await readWaitlist(gid);
    if (Array.isArray(list) && list.length) withLists.push({ gid, list });
  }
  if (!withLists.length) return { productsNotified: 0, emailsSent: 0 };

  const stock = await fetchProductsByIds(withLists.map((w) => shortId(w.gid)));
  const byId = new Map(stock.map((p) => [p.id, p]));
  const ctx = await getShopContext();

  let productsNotified = 0;
  let emailsSent = 0;
  for (const { gid, list } of withLists) {
    const sp = byId.get(gid);
    if (!sp || !isInStock(sp)) continue; // every variant still sold out — keep the whole list

    const { notify, waiting } = partitionByStock(list, (variantId) => isVariantInStock(sp, variantId));
    if (!notify.length) continue; // the product is back, but not the variants these people want

    const first = sp.variants?.nodes?.[0];
    emailsSent += await emailAndPrune({
      gid,
      list,
      due: notify,
      waiting,
      product: { title: sp.title, handle: sp.handle, image: sp.featuredImage?.url || null },
      fallbackVariantId: first?.id ? shortId(first.id) : null,
      variants: variantsById(sp),
      ctx,
      dryRun,
      base,
    });
    productsNotified++;
  }
  return { productsNotified, emailsSent };
}

/* ---- Real-time sold-out alerts to the owner/team ---- */

const ALERT_NS = 'oos_sort';
const ALERT_KEY = 'sold_out_alerted';

/** Has this product already had a sold-out alert sent for the current episode? */
async function readAlerted(productGid) {
  const d = await gql(
    `query($id: ID!) { product(id: $id) { metafield(namespace: "${ALERT_NS}", key: "${ALERT_KEY}") { value } } }`,
    { id: productGid }
  );
  return d.product?.metafield?.value === 'true';
}

/** Mark (or clear) a product's sold-out-alerted flag. */
async function setAlerted(productGid, on) {
  await gql(
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: productGid, namespace: ALERT_NS, key: ALERT_KEY, type: 'boolean', value: on ? 'true' : 'false' }] }
  );
}

/**
 * Email the owner + recipients the moment a product transitions to sold out.
 * Fires once per sold-out episode (tracked in a per-product metafield, so no
 * shop-state size limit and no repeat spam); resets when the product restocks.
 * Called from the webhook — targeted, no full-store scan. @returns {{alerted:number}}
 */
export async function alertNewlySoldOut(productGids, { recipients = [], dryRun = false } = {}) {
  if (!productGids || !productGids.length) return { alerted: 0 };
  const stock = await fetchProductsByIds(productGids.map((g) => shortId(g)));
  const byId = new Map(stock.map((p) => [p.id, p]));

  const newly = [];
  for (const gid of productGids) {
    const sp = byId.get(gid);
    if (!sp) continue;
    const soldOut = !isInStock(sp);
    const alerted = await readAlerted(gid);
    if (soldOut && !alerted) {
      newly.push({ title: sp.title, handle: sp.handle, image: sp.featuredImage?.url || null });
      if (!dryRun) await setAlerted(gid, true);
    } else if (!soldOut && alerted) {
      if (!dryRun) await setAlerted(gid, false); // back in stock — reset for next episode
    }
  }

  if (newly.length) {
    try {
      await sendSoldOutAlert(newly, { dryRun, recipients });
    } catch (e) {
      console.error('sold-out alert email failed:', e.message);
    }
  }
  return { alerted: newly.length };
}

/**
 * Manually email ONE product's waitlist (admin "Send now"), regardless of stock —
 * the merchant is deciding it's back.
 *
 * Pass `variantId` to email only the shoppers waiting on that variant and leave
 * the rest on the list; without it every subscriber is emailed, which is the
 * original behaviour and the right one for a single-variant product.
 *
 * @returns {Promise<{sent:number, title:string, total:number}>}
 */
export async function notifyOneProduct(productGid, { dryRun = false, base = null, variantId = null } = {}) {
  const d = await gql(
    `query($id: ID!) { product(id: $id) {
       title handle featuredImage { url }
       variants(first: 100) { nodes { id price compareAtPrice } }
     } }`,
    { id: productGid }
  );
  const p = d.product || {};
  const first = p.variants?.nodes?.[0];
  const list = await readWaitlist(productGid);
  const ctx = await getShopContext();

  const want = variantId == null ? null : String(variantId).replace(/\D/g, '');
  const { notify, waiting } = partitionByStock(list, (entryVariant) =>
    want === null ? true : String(entryVariant ?? '') === want
  );

  const sent = await emailAndPrune({
    gid: productGid,
    list,
    due: notify,
    waiting,
    product: { title: p.title, handle: p.handle, image: p.featuredImage?.url || null },
    fallbackVariantId: first?.id ? shortId(first.id) : null,
    variants: variantsById(p),
    ctx,
    dryRun,
    base,
  });

  return { sent, title: p.title, total: list.length };
}

/**
 * Manually re-send the back-in-stock email to ONE shopper (dashboard "Resend").
 * Guarded on current stock: if the product (or the shopper's variant) is sold out
 * again it sends nothing and reports soldOut, so we never tell a shopper "it's
 * back" when it isn't. Consumes the row's one nudge slot so the auto-nudge won't
 * also fire. @returns {{sent:number, soldOut:boolean}}
 */
export async function resendOne(productGid, email, { variantId = null, base = null, dryRun = false } = {}) {
  const short = shortId(productGid);
  const [sp] = await fetchProductsByIds([short]);
  if (!sp) return { sent: 0, soldOut: true };

  const vWant = variantId ? String(variantId).replace(/\D/g, '') : null;
  const inStock = vWant ? isVariantInStock(sp, vWant) : isInStock(sp);
  if (!inStock) return { sent: 0, soldOut: true };

  const first = sp.variants?.nodes?.[0];
  const vId = vWant || (first?.id ? shortId(first.id) : null);
  const ctx = await getShopContext();
  const { priceText, compareAtText } = priceTextFor(variantsById(sp).get(String(vId)), ctx.currency);
  const relCart = vId ? `/cart/${vId}:1` : (sp.handle ? `/products/${sp.handle}` : '/');
  const relProduct = sp.handle ? `/products/${sp.handle}` : '/';
  const payload = {
    title: sp.title,
    handle: sp.handle,
    image: sp.featuredImage?.url || null,
    variantId: vId,
    variantTitle: null,
    storeHost: ctx.host,
    priceText,
    compareAtText,
    clickCartUrl: trackUrl(base, short, email, relCart),
    clickProductUrl: trackUrl(base, short, email, relProduct),
  };

  if (!dryRun) {
    await sendBackInStock(email, payload, unsubUrl(base, short, email), { dryRun: false });
    try { await applyNudged(email, short); } catch (e) { console.error('resend nudge-flag failed:', e.message); }
  }
  return { sent: 1, soldOut: false };
}

/**
 * One-shot follow-up: nudge shoppers who were notified >= `days` ago but haven't
 * clicked/ordered and haven't already been nudged, for products still in stock.
 * Full runs only (scans the whole log). Idempotent — once a row's nudge slot is
 * set it never re-qualifies. @returns {{nudged:number}}
 */
export async function nudgeUnengaged({ dryRun = false, base = null, days = 2 } = {}) {
  const log = await loadNotified();
  const now = new Date().toISOString();
  // Cheap pre-filter (state + window) before spending a stock fetch.
  const windowed = selectNudges(log, now, days, () => true);
  if (!windowed.length) return { nudged: 0 };

  const ids = [...new Set(windowed.map((x) => x.p))];
  const stock = await fetchProductsByIds(ids);
  const spById = new Map(stock.map((p) => [shortId(p.id), p]));
  const ctx = await getShopContext();
  const due = selectNudges(log, now, days, (p) => {
    const sp = spById.get(p);
    return sp ? isInStock(sp) : false;
  });

  let nudged = 0;
  for (const row of due) {
    const sp = spById.get(row.p);
    // Price for the shopper's variant, or the first variant for a product-level signup.
    const vNode = row.v ? variantsById(sp).get(String(row.v)) : sp?.variants?.nodes?.[0];
    const { priceText, compareAtText } = priceTextFor(vNode, ctx.currency);
    const relCart = row.v ? `/cart/${row.v}:1` : (sp?.handle ? `/products/${sp.handle}` : '/');
    const relProduct = sp?.handle ? `/products/${sp.handle}` : '/';
    const payload = {
      title: row.t,
      handle: sp?.handle,
      image: sp?.featuredImage?.url || null,
      variantId: row.v,
      variantTitle: row.vt,
      storeHost: ctx.host,
      priceText,
      compareAtText,
      clickCartUrl: trackUrl(base, row.p, row.e, relCart),
      clickProductUrl: trackUrl(base, row.p, row.e, relProduct),
    };
    try {
      await sendNudge(row.e, payload, unsubUrl(base, row.p, row.e), { dryRun });
      if (!dryRun) await applyNudged(row.e, row.p, now);
      nudged++;
    } catch (e) {
      console.error(`  ! nudge email to ${row.e} failed: ${e.message}`);
    }
  }
  return { nudged };
}

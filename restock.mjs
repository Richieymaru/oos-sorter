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
import { gql, shortId } from './shopify.mjs';
import { fetchProductsByIds } from './catalog.mjs';
import { isInStock, isVariantInStock } from './stock.mjs';
import { readWaitlist, clearWaitlist, setWaitlist, unsubUrl, partitionByStock } from './waitlist.mjs';
import { sendBackInStock, sendSoldOutAlert } from './notify.mjs';

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
async function emailAndPrune({ gid, list, due, waiting, product, fallbackVariantId, dryRun, base }) {
  let sent = 0;
  const failed = [];

  for (const sub of due) {
    // Deep-link the email to the variant the shopper actually asked about.
    const payload = {
      ...product,
      variantId: sub.variantId || fallbackVariantId,
      variantTitle: sub.variantTitle || null,
    };
    try {
      await sendBackInStock(sub.email, payload, unsubUrl(base, shortId(gid), sub.email), { dryRun });
      sent++;
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
      newly.push({ title: sp.title, handle: sp.handle });
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
       title handle featuredImage { url } variants(first: 1) { nodes { id } }
     } }`,
    { id: productGid }
  );
  const p = d.product || {};
  const first = p.variants?.nodes?.[0];
  const list = await readWaitlist(productGid);

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
    dryRun,
    base,
  });

  return { sent, title: p.title, total: list.length };
}

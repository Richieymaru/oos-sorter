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
import { sendBackInStock, sendSoldOutAlert, sendNudge, sendAltVariant, formatMoney, buildBackInStock, buildAltVariant } from './notify.mjs';
import { notifiedRow, recordNotified, applyNudged, loadNotified, selectNudges } from './notified.mjs';
import { loadState, saveState } from './state.mjs';
import { loadSettings, incentiveFor } from './settings.mjs';

/** Bump the cumulative "notified so far" counters after a real send. Best-effort:
 *  a failure here must never break the actual emailing. */
/** Map numeric variant id -> the fetched variant node (has price/compareAtPrice). */
function variantsById(sp) {
  return new Map((sp?.variants?.nodes || []).map((v) => [shortId(v.id), v]));
}

/** Every in-stock, real (non-"Default Title") variant of a product, as
 *  { id, title, priceText }. These are the alternatives we can offer a shopper
 *  whose own waited variant is still sold out. Empty for single-variant products. */
function inStockVariantInfos(sp, ctx) {
  const nodes = sp?.variants?.nodes || [];
  if (nodes.length < 2) return [];
  const out = [];
  for (const v of nodes) {
    const vid = shortId(v.id);
    if (!v.title || v.title === 'Default Title') continue;
    if (!isVariantInStock(sp, vid)) continue;
    const { priceText } = priceTextFor(v, ctx.currency);
    out.push({ id: vid, title: v.title, priceText, price: v.price });
  }
  return out;
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

/** Resolve gift product NAMES (free text the merchant typed) to real product
 *  images, best-effort, so the emails can show a photo. Returns { lowerName: url }.
 *  Only attaches an image from a product whose title shares a meaningful word with
 *  the gift name, so a loose search never pins a wildly wrong photo; otherwise the
 *  email falls back to a gift-icon tile. */
async function resolveGiftImages(names) {
  const out = {};
  const uniq = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => norm(s).split(' ').filter((w) => w.length >= 3);
  for (const name of uniq) {
    const q = norm(name);
    if (!q) continue;
    try {
      const d = await gql(
        `query($q: String!) { products(first: 5, query: $q) { nodes { title featuredImage { url } } } }`,
        { q }
      );
      const nodes = (d.products?.nodes || []).filter((p) => p.featuredImage?.url);
      const nameWords = new Set(words(name));
      const hit = nodes.find((p) => words(p.title).some((w) => nameWords.has(w)));
      if (hit) out[name.toLowerCase()] = hit.featuredImage.url;
    } catch (e) {
      console.error(`  ! gift image lookup for "${name}" failed: ${e.message}`);
    }
  }
  return out;
}

/** Map of gift name -> image for the current settings (free-gift + perk gifts).
 *  Uses the image the merchant PICKED (exact, stored in settings) when present,
 *  and only falls back to a title lookup for gifts that were typed by hand.
 *  {} when nothing applies (no extra API calls). Exported so the Email preview
 *  page can show the same photos. */
export async function giftImagesFor(settings) {
  if (!settings) return {};
  const map = {};
  const toResolve = [];
  const add = (name, image) => {
    if (!name) return;
    if (image) map[name.toLowerCase()] = image;
    else toResolve.push(name);
  };
  if (settings.freeGiftEnabled) add(settings.freeGiftProduct, settings.freeGiftImage);
  if (settings.incentivesEnabled) {
    add(settings.incentiveMinorGift, settings.incentiveMinorGiftImage);
    add(settings.incentiveMajorGift, settings.incentiveMajorGiftImage);
  }
  if (toResolve.length) Object.assign(map, await resolveGiftImages(toResolve));
  return map;
}

/** Resolve gift NAMES to their first variant id (for gifts the merchant typed
 *  rather than picked), so they can still be added to the cart. Only runs when
 *  "Add gifts to cart" is on and there are names without a stored variant id. */
async function resolveGiftVariants(names) {
  const out = {};
  const uniq = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))];
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => norm(s).split(' ').filter((w) => w.length >= 3);
  for (const name of uniq) {
    const q = norm(name);
    if (!q) continue;
    try {
      const d = await gql(
        `query($q: String!) { products(first: 5, query: $q) { nodes { title variants(first: 1) { nodes { id } } } } }`,
        { q }
      );
      const nameWords = new Set(words(name));
      const hit = (d.products?.nodes || []).find((p) => p.variants?.nodes?.[0]?.id && words(p.title).some((w) => nameWords.has(w)));
      if (hit) out[name.toLowerCase()] = String(hit.variants.nodes[0].id).replace(/\D/g, '');
    } catch (e) {
      console.error(`  ! gift variant lookup for "${name}" failed: ${e.message}`);
    }
  }
  return out;
}

/** Map gift name -> variant id for gifts that have NO stored variant (typed, not
 *  picked), so they can still be added to the cart. {} unless "Add gifts to cart"
 *  is on and some gift lacks a variant. */
export async function giftVariantsFor(settings) {
  if (!settings || !settings.addGiftsToCart) return {};
  const need = [];
  if (settings.freeGiftEnabled && settings.freeGiftProduct && !settings.freeGiftVariantId) need.push(settings.freeGiftProduct);
  if (settings.incentivesEnabled) {
    if (settings.incentiveMinorGift && !settings.incentiveMinorGiftVariantId) need.push(settings.incentiveMinorGift);
    if (settings.incentiveMajorGift && !settings.incentiveMajorGiftVariantId) need.push(settings.incentiveMajorGift);
  }
  if (!need.length) return {};
  return resolveGiftVariants(need);
}

/** Extra cart-permalink segments that add the free gift(s) to the cart, so they
 *  check out free ($0 gift products, or a Buy-X-Get-Y automatic discount). Empty
 *  unless the owner turned "Add gifts to cart" on. Uses the PICKED variant id
 *  (stored in settings) or, for typed gifts, the one resolved by name in
 *  `giftVariants`. `incentives` = incentiveFor(...)'s result; `includeFreeGift`
 *  adds the nudge/resend free gift too (not on the first back-in-stock email). */
function cartGiftSuffix(settings, incentives, includeFreeGift, giftVariants = {}) {
  if (!settings || !settings.addGiftsToCart) return '';
  const pick = (name, storedId) => storedId || (name ? giftVariants[String(name).toLowerCase()] : '') || '';
  const ids = [];
  if (includeFreeGift && settings.freeGiftEnabled) {
    const v = pick(settings.freeGiftProduct, settings.freeGiftVariantId);
    if (v) ids.push(v);
  }
  if (incentives && incentives.gift && incentives.gift.length) {
    const v = pick(incentives.gift[0], incentives.giftVariantId);
    if (v) ids.push(v);
  }
  return ids.map((id) => `,${id}:1`).join('');
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
async function emailAndPrune({ gid, list, due, waiting, product, fallbackVariantId, variants = new Map(), ctx = {}, dryRun, base, settings = null, giftImages = {}, giftVariants = {} }) {
  let sent = 0;
  const failed = [];
  const rows = [];
  const short = shortId(gid);

  for (const sub of due) {
    const variantId = sub.variantId || fallbackVariantId;
    const variantNode = variants.get(String(variantId));
    const incentives = incentiveFor(variantNode?.price, settings);
    // Deep-link the email to the variant the shopper asked about, through the
    // tracked redirect so a click-through is recorded on the log row. The first
    // back-in-stock email carries only the perks gift (no free-gift offer).
    const relCart = variantId ? `/cart/${variantId}:1${cartGiftSuffix(settings, incentives, false, giftVariants)}` : (product.handle ? `/products/${product.handle}` : '/');
    const relProduct = product.handle ? `/products/${product.handle}` : '/';
    const { priceText, compareAtText } = priceTextFor(variantNode, ctx.currency);
    const payload = {
      ...product,
      variantId,
      variantTitle: sub.variantTitle || null,
      storeHost: ctx.host,
      priceText,
      compareAtText,
      incentives,
      giftImages,
      brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
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
  // Opt-in cross-variant offer (default OFF): email people whose variant is still
  // out when a DIFFERENT variant of the same product is back in stock.
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));

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
      settings,
      giftImages,
      giftVariants,
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
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));

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
      settings,
      giftImages,
      giftVariants,
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
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));

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
    settings,
    giftImages,
  });

  return { sent, title: p.title, total: list.length };
}

/**
 * Manually offer ONE in-stock variant as an alternative to everyone still waiting
 * on a product (the Waitlists "Offer this option" buttons). The merchant picks the
 * variant to push (e.g. "we have plenty of Black"); it's sent as the headline of
 * the same alternative-variant email, with any other in-stock options listed below.
 *
 * Recipients = shoppers whose OWN waited variant is still sold out and isn't the
 * offered one (someone waiting for exactly this variant gets a normal "Send now"
 * instead). Nobody is removed from the list — they're still waiting for their own
 * option — but each is stamped `altTs` so the automatic offer won't double up.
 *
 * @returns {Promise<{sent:number, title:string, option:string}|{sent:0, error:string}>}
 */
export async function offerAltForProduct(productGid, { offerVariantId, base = null, dryRun = false } = {}) {
  const short = shortId(productGid);
  const [sp] = await fetchProductsByIds([short]);
  if (!sp) return { sent: 0, error: 'Product not found.' };
  const ctx = await getShopContext();
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));
  const freeGift = settings && settings.freeGiftEnabled && settings.freeGiftProduct
    ? { products: [settings.freeGiftProduct] }
    : null;
  const inStock = inStockVariantInfos(sp, ctx); // [{id,title,priceText,price}]
  const want = String(offerVariantId || '').replace(/\D/g, '');
  const offered = inStock.find((v) => String(v.id) === want) || null;
  if (!offered) return { sent: 0, error: 'That option isn’t in stock right now.' };
  const incOffered = incentiveFor(offered.price, settings);

  const list = await readWaitlist(productGid);
  let sent = 0;
  let stamped = false;
  const rows = []; // notified-log rows so these offers show + count on the Notified page
  for (const sub of list) {
    const subVar = sub.variantId ? String(sub.variantId).replace(/\D/g, '') : null;
    if (subVar && subVar === String(offered.id)) continue; // their own option IS the offered one — that's a normal restock
    if (subVar && isVariantInStock(sp, subVar)) continue;  // their own option is already back — no need to offer an alternative
    const payload = {
      title: sp.title,
      handle: sp.handle,
      image: sp.featuredImage?.url || null,
      variantId: offered.id,
      variantTitle: offered.title,
      storeHost: ctx.host,
      priceText: offered.priceText,
      incentives: incOffered,
      giftImages,
      freeGift,
      brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
      clickCartUrl: trackUrl(base, short, sub.email, `/cart/${offered.id}:1${cartGiftSuffix(settings, incOffered, true, giftVariants)}`),
      clickProductUrl: trackUrl(base, short, sub.email, sp.handle ? `/products/${sp.handle}` : '/'),
    };
    try {
      await sendAltVariant(sub.email, payload, unsubUrl(base, short, sub.email), { dryRun });
      sent++;
      if (!dryRun) {
        sub.altTs = new Date().toISOString();
        stamped = true;
        rows.push(notifiedRow({ email: sub.email, productId: short, title: sp.title, variantId: offered.id, variantTitle: offered.title, kind: 'alt' }));
      }
    } catch (e) {
      console.error(`  ! manual alternative offer to ${sub.email} failed: ${e.message}`);
    }
  }
  if (stamped && !dryRun) await setWaitlist(productGid, list);
  if (rows.length) {
    try { await recordNotified(rows); } catch (e) { console.error(`  ! offer log write failed: ${e.message}`); }
  }
  return { sent, title: sp.title, option: offered.title };
}

/** Render (don't send) the exact back-in-stock email a Resend would produce for
 *  this shopper + product + variant, so the owner can preview it. @returns
 *  {{subject, html, soldOut}} or {{error}}. */
export async function previewResendEmail(productGid, email, { variantId = null, base = null } = {}) {
  const short = shortId(productGid);
  const [sp] = await fetchProductsByIds([short]);
  if (!sp) return { error: 'Product not found.' };
  const ctx = await getShopContext();
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));
  const freeGift = settings && settings.freeGiftEnabled && settings.freeGiftProduct ? { products: [settings.freeGiftProduct] } : null;
  const vWant = variantId ? String(variantId).replace(/\D/g, '') : null;
  const first = sp.variants?.nodes?.[0];
  const vId = vWant || (first?.id ? shortId(first.id) : null);
  const vNode = variantsById(sp).get(String(vId));
  const { priceText, compareAtText } = priceTextFor(vNode, ctx.currency);
  const incentives = incentiveFor(vNode?.price, settings);
  const relCart = vId ? `/cart/${vId}:1${cartGiftSuffix(settings, incentives, true, giftVariants)}` : (sp.handle ? `/products/${sp.handle}` : '/');
  const relProduct = sp.handle ? `/products/${sp.handle}` : '/';
  const payload = {
    title: sp.title, handle: sp.handle, image: sp.featuredImage?.url || null,
    variantId: vId, variantTitle: vNode?.title && vNode.title !== 'Default Title' ? vNode.title : null,
    storeHost: ctx.host, priceText, compareAtText,
    incentives, giftImages, freeGift,
    brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
    clickCartUrl: trackUrl(base, short, email, relCart),
    clickProductUrl: trackUrl(base, short, email, relProduct),
  };
  const { subject, html } = buildBackInStock(payload, unsubUrl(base, short, email));
  return { subject, html, soldOut: vId ? !isVariantInStock(sp, vId) : !isInStock(sp), cart: relCart };
}

/** Render (don't send) the exact "a different option is in stock" email that an
 *  Offer would produce for this product + offered variant. @returns
 *  {{subject, html, option}} or {{error}}. */
export async function previewOfferEmail(productGid, { offerVariantId, email = 'preview@example.com', base = null } = {}) {
  const short = shortId(productGid);
  const [sp] = await fetchProductsByIds([short]);
  if (!sp) return { error: 'Product not found.' };
  const ctx = await getShopContext();
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));
  const freeGift = settings && settings.freeGiftEnabled && settings.freeGiftProduct ? { products: [settings.freeGiftProduct] } : null;
  const inStock = inStockVariantInfos(sp, ctx);
  const want = String(offerVariantId || '').replace(/\D/g, '');
  const offered = inStock.find((v) => String(v.id) === want) || null;
  if (!offered) return { error: 'That option isn’t in stock right now.' };
  const incOffered = incentiveFor(offered.price, settings);
  const payload = {
    title: sp.title, handle: sp.handle, image: sp.featuredImage?.url || null,
    variantId: offered.id, variantTitle: offered.title, storeHost: ctx.host, priceText: offered.priceText,
    incentives: incOffered, giftImages, freeGift,
    brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
    clickCartUrl: trackUrl(base, short, email, `/cart/${offered.id}:1${cartGiftSuffix(settings, incOffered, true, giftVariants)}`),
    clickProductUrl: trackUrl(base, short, email, sp.handle ? `/products/${sp.handle}` : '/'),
  };
  const { subject, html } = buildAltVariant(payload, unsubUrl(base, short, email));
  return { subject, html, option: offered.title, cart: `/cart/${offered.id}:1${cartGiftSuffix(settings, incOffered, true, giftVariants)}` };
}

/**
 * Manually re-send the back-in-stock email to ONE shopper (dashboard "Resend").
 * Guarded on current stock: if the product (or the shopper's variant) is sold out
 * again it sends nothing and reports soldOut, so we never tell a shopper "it's
 * back" when it isn't. Consumes the row's one nudge slot so the auto-nudge won't
 * also fire. @returns {{sent:number, soldOut:boolean}}
 */
export async function resendOne(productGid, email, { variantId = null, base = null, dryRun = false, force = false } = {}) {
  const short = shortId(productGid);
  const [sp] = await fetchProductsByIds([short]);
  if (!sp) return { sent: 0, soldOut: true };

  const vWant = variantId ? String(variantId).replace(/\D/g, '') : null;
  const inStock = vWant ? isVariantInStock(sp, vWant) : isInStock(sp);
  // `force` lets the admin re-send to themselves even when it's sold out (a test).
  if (!inStock && !force) return { sent: 0, soldOut: true };

  const first = sp.variants?.nodes?.[0];
  const vId = vWant || (first?.id ? shortId(first.id) : null);
  const ctx = await getShopContext();
  const settings = await loadSettings().catch(() => null);
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));
  // Resend is a re-engagement send (to someone who didn't convert), so it carries
  // the same free-gift offer as the 2-day nudge — not just the first email.
  const freeGift = settings && settings.freeGiftEnabled && settings.freeGiftProduct
    ? { products: [settings.freeGiftProduct] }
    : null;
  const vNode = variantsById(sp).get(String(vId));
  const { priceText, compareAtText } = priceTextFor(vNode, ctx.currency);
  const incentives = incentiveFor(vNode?.price, settings);
  const relCart = vId ? `/cart/${vId}:1${cartGiftSuffix(settings, incentives, true, giftVariants)}` : (sp.handle ? `/products/${sp.handle}` : '/');
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
    incentives,
    giftImages,
    freeGift,
    brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
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
  const settings = await loadSettings().catch(() => null);
  // 2-day nudge free-gift offer (OFF by default; owner sets up fulfilment + enables it).
  const freeGift = settings && settings.freeGiftEnabled && settings.freeGiftProduct
    ? { products: [settings.freeGiftProduct] }
    : null;
  const giftImages = await giftImagesFor(settings).catch(() => ({}));
  const giftVariants = await giftVariantsFor(settings).catch(() => ({}));
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
    const incentives = incentiveFor(vNode?.price, settings);
    const relCart = row.v ? `/cart/${row.v}:1${cartGiftSuffix(settings, incentives, true, giftVariants)}` : (sp?.handle ? `/products/${sp.handle}` : '/');
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
      incentives,
      giftImages,
      brandLogo: settings?.emailLogoUrl || ctx.brandLogo || null,
      clickCartUrl: trackUrl(base, row.p, row.e, relCart),
      clickProductUrl: trackUrl(base, row.p, row.e, relProduct),
    };
    try {
      await sendNudge(row.e, payload, unsubUrl(base, row.p, row.e), { dryRun, freeGift });
      if (!dryRun) await applyNudged(row.e, row.p, now);
      nudged++;
    } catch (e) {
      console.error(`  ! nudge email to ${row.e} failed: ${e.message}`);
    }
  }
  return { nudged };
}

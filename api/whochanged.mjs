/**
 * TEMPORARY diagnostic (remove after use). Reads a product's change history and
 * returns the `author` (who performed each action) so we can find who flipped a
 * product's status. Read-only, guarded by RUN_TOKEN.
 *   /api/whochanged?token=RUN_TOKEN                 -> recent active products
 *   /api/whochanged?token=RUN_TOKEN&handle=my-prod  -> one product by handle
 *   /api/whochanged?token=RUN_TOKEN&q=title:Pistol  -> products matching a search
 */
import { gql } from '../shopify.mjs';

function param(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try { return new URL(req.url, 'http://x').searchParams.get(name); } catch { return null; }
}
function authorized(req) {
  const e = process.env.RUN_TOKEN; if (!e) return false;
  const q = param(req, 'token');
  const h = req.headers?.authorization;
  const b = h?.startsWith('Bearer ') ? h.slice(7) : null;
  return q === e || b === e;
}

export default async function handler(req, res) {
  if (!authorized(req)) { res.statusCode = 401; res.end('unauthorized'); return; }
  const handle = param(req, 'handle');
  const n = Math.min(50, parseInt(param(req, 'n') || '25', 10) || 25);
  const q = handle ? `handle:${handle}` : (param(req, 'q') || 'status:active');
  try {
    const d = await gql(
      `query($n:Int!,$q:String){
         products(first:$n, sortKey:UPDATED_AT, reverse:true, query:$q){
           nodes{
             handle title status updatedAt
             events(first:15, sortKey:CREATED_AT, reverse:true){
               nodes{ __typename ... on BasicEvent { action message author appTitle attributeToApp attributeToUser createdAt } }
             }
           }
         }
       }`,
      { n, q });
    const out = d.products.nodes.map((p) => ({
      handle: p.handle, title: p.title, status: p.status, updatedAt: p.updatedAt,
      events: p.events.nodes
        .filter((e) => e.__typename === 'BasicEvent')
        .map((e) => ({
          at: e.createdAt,
          author: e.author,
          by: e.attributeToApp ? ('app:' + (e.appTitle || '?')) : (e.attributeToUser ? 'user' : 'system'),
          action: e.action,
          msg: (e.message || '').replace(/<[^>]+>/g, '').slice(0, 140),
        })),
    }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, count: out.length, products: out }, null, 2));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

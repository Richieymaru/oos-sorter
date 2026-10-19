import { fetchAllCollections } from '../catalog.mjs';
import { loadSettings } from '../settings.mjs';
import { shell, setPageHeaders, statCard, badge, esc, APP_NAME } from '../ui.mjs';
import { ttlMemo } from '../cache.mjs';

// The full collection list changes rarely — cache it per instance so repeat
// opens and dashboard navigation are near-instant. Cold starts fetch fresh.
const cachedCollections = ttlMemo(fetchAllCollections, 300000);

const SORT_LABELS = {
  MANUAL: 'Manual',
  BEST_SELLING: 'Best selling',
  ALPHA_ASC: 'A–Z',
  ALPHA_DESC: 'Z–A',
  PRICE_ASC: 'Price ↑',
  PRICE_DESC: 'Price ↓',
  CREATED: 'Oldest',
  CREATED_DESC: 'Newest',
  MOST_RELEVANT: 'Most relevant',
};

// A collection thumbnail (Shopify CDN, asked at 80px), or a neutral placeholder
// tile with a small "image" glyph when the collection has no image set.
const PLACEHOLDER = `<span class="cthumb ph" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.6" stroke="currentColor" stroke-width="1.6"/><path d="m5 17 4.5-4.5L13 16l2.5-2.5L20 18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`;
function colThumb(url) {
  if (!url) return PLACEHOLDER;
  const src = url + (url.includes('?') ? '&' : '?') + 'width=80';
  // If the image 404s, hide it so the neutral tile background shows through
  // (robust without injecting markup into the attribute).
  return `<img class="cthumb" src="${esc(src)}" alt="" width="36" height="36" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

export default async function handler(req, res) {
  const [cols, settings] = await Promise.all([
    cachedCollections().catch(() => []),
    loadSettings().catch(() => ({ sort: false })),
  ]);
  cols.sort((a, b) => a.title.localeCompare(b.title));
  const managed = cols.filter((c) => c.sortOrder === 'MANUAL').length;

  const rows = cols
    .map((c) => {
      const isManaged = c.sortOrder === 'MANUAL';
      const status = settings.sort
        ? isManaged
          ? badge('Auto-sorting active', 'ok')
          : badge('Waiting to sort', 'idle')
        : badge('Sorting off', 'idle');
      return `<tr data-name="${esc(c.title.toLowerCase())}">
        <td class="cname"><span class="cwrap">${colThumb(c.image && c.image.url)}<span>${esc(c.title)}</span></span></td>
        <td>${status}</td>
        <td class="muted">${esc(SORT_LABELS[c.sortOrder] || c.sortOrder)}</td>
        <td class="num">${c.productsCount?.count ?? '—'}</td>
      </tr>`;
    })
    .join('');

  const table = cols.length
    ? `<div class="card">
        <div class="toolbar"><input id="q" type="search" placeholder="Search ${cols.length} collections" autocomplete="off"></div>
        <table>
          <thead><tr><th>Collection</th><th>Status</th><th>Product sort</th><th style="text-align:right">Products</th></tr></thead>
          <tbody id="tb">${rows}</tbody>
        </table>
        <div class="empty" id="none" style="display:none">No collections match that search.</div>
        <div class="cpager" id="pager"><span class="faint" id="pcount"></span><button class="ghost" id="more" type="button">Show more</button></div>
      </div>
      <style>
        .cwrap{display:flex;align-items:center;gap:12px;min-width:0}
        .cthumb{width:36px;height:36px;border-radius:9px;object-fit:cover;flex:none;border:1px solid var(--line);background:var(--surface-2)}
        .cthumb.ph{display:grid;place-items:center;color:var(--faint)}
        .cpager{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-top:1px solid var(--line-2)}
        .cpager .faint{font-size:12.5px}
      </style>
      <script>
        (function(){
          var PAGE=20;
          var q=document.getElementById('q'), tb=document.getElementById('tb'), none=document.getElementById('none'),
              pager=document.getElementById('pager'), pcount=document.getElementById('pcount'), more=document.getElementById('more');
          var all=[].slice.call(tb.rows), total=all.length, shownCount=PAGE;
          function render(){
            var v=q.value.trim().toLowerCase();
            if(v){ // searching: show every match, hide the pager
              var n=0;
              all.forEach(function(r){ var m=r.dataset.name.indexOf(v)>-1; r.style.display=m?'':'none'; if(m)n++; });
              none.style.display=n?'none':'block'; pager.style.display='none';
              return;
            }
            none.style.display='none';
            var i=0;
            all.forEach(function(r){ r.style.display=(i<shownCount)?'':'none'; i++; });
            var showing=Math.min(shownCount,total);
            pcount.textContent='Showing '+showing+' of '+total;
            more.style.display=(showing<total)?'':'none';
            pager.style.display=(total>PAGE)?'flex':'none';
          }
          more.addEventListener('click', function(){ shownCount+=PAGE; render(); });
          q.addEventListener('input', render);
          render();
        })();
      </script>`
    : `<div class="card empty">No collections found on this store.</div>`;

  const body = `
  <div class="pagehead">
    <h1>Collections</h1>
    <p>Every collection ${esc(APP_NAME)} watches. Sold-out products are kept at the bottom of each.</p>
  </div>
  <div class="grid c3" style="margin-bottom:18px">
    ${statCard({ value: cols.length || '—', label: 'Collections' })}
    ${statCard({ value: managed || 0, label: 'Auto-sorting', sub: 'set to manual order' })}
    ${statCard({ value: settings.sort ? 'On' : 'Off', label: 'Sorting', mono: false })}
  </div>
  ${table}`;

  setPageHeaders(res);
  res.end(shell({ title: 'Collections', active: 'collections', body }));
}

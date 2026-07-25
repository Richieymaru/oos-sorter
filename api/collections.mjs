import { fetchAllCollections } from '../catalog.mjs';
import { loadSettings } from '../settings.mjs';
import { shell, setPageHeaders, statCard, badge, esc } from '../ui.mjs';

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

export default async function handler(req, res) {
  const [cols, settings] = await Promise.all([
    fetchAllCollections().catch(() => []),
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
        <td class="cname">${esc(c.title)}</td>
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
      </div>
      <script>
        var q=document.getElementById('q'), tb=document.getElementById('tb'), none=document.getElementById('none');
        q.addEventListener('input', function(){
          var v=q.value.trim().toLowerCase(), shown=0;
          [].forEach.call(tb.rows, function(r){ var m=!v||r.dataset.name.indexOf(v)>-1; r.style.display=m?'':'none'; if(m) shown++; });
          none.style.display=shown?'none':'block';
        });
      </script>`
    : `<div class="card empty">No collections found on this store.</div>`;

  const body = `
  <div class="pagehead">
    <h1>Collections</h1>
    <p>Every collection OOS Sorter watches. Sold-out products are kept at the bottom of each.</p>
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

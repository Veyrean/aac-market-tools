import { h, mount, debounce, select, notice } from '../lib/dom.js';
import { loadMarket } from '../lib/data.js';
import { money, pct, count, saleBreakdown } from '../lib/format.js';
import { get as settings, watchEntry } from '../lib/store.js';

const COLUMNS = [
  { key: 'name', label: 'Item', cls: 'l', get: (r) => r.name.toLowerCase() },
  { key: 'catLabel', label: 'Category', cls: 'l hide-sm', get: (r) => r.catLabel },
  { key: 'latest', label: 'Last 24h', get: (r) => r.latest },
  { key: 'avg7', label: '7-day avg', get: (r) => r.avg7 },
  { key: 'avg30', label: '30-day avg', cls: 'hide-sm', get: (r) => r.avg30 },
  { key: 'change', label: '7d vs 30d', get: (r) => change(r) },
  { key: 'vol7', label: 'Sold (7d)', get: (r) => r.vol7 },
  { key: 'net', label: 'You receive', cls: 'hide-sm', get: (r) => r.latest },
];

function change(r) { return r.avg7 != null && r.avg30 ? r.avg7 / r.avg30 - 1 : null; }

export async function render(root) {
  const market = await loadMarket();
  const st = { q: '', cat: '', sort: 'vol7', dir: -1, limit: 100 };
  const patron = settings().patron;

  const tbody = h('tbody');
  const info = h('div', { class: 'muted small' });
  const more = h('button', { class: 'btn', on: { click: () => { st.limit += 200; draw(); } } }, 'Show more');
  const headRow = h('tr');

  const search = h('input', { type: 'search', placeholder: 'Search items…', 'aria-label': 'Search items', autocomplete: 'off' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); st.limit = 100; draw(); }));
  const catSel = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'));
  const grouped = new Set();
  for (const g of market.groups) {
    catSel.appendChild(h('optgroup', { label: g.label }, g.subs.map((id) => { grouped.add(String(id)); return h('option', { value: id }, market.categories[String(id)]); })));
  }
  const rest = Object.entries(market.categories).filter(([id]) => !grouped.has(id)).sort((a, b) => a[1].localeCompare(b[1]));
  const restOptions = rest.map(([id, label]) => h('option', { value: id }, label));
  if (rest.length && grouped.size) catSel.appendChild(h('optgroup', { label: 'Other' }, restOptions));
  else for (const o of restOptions) catSel.appendChild(o);
  catSel.addEventListener('change', () => { st.cat = catSel.value; st.limit = 100; draw(); });

  function drawHead() {
    mount(headRow, COLUMNS.map((c) => h('th', {
      class: `${c.cls || ''} sortable ${st.sort === c.key ? 'sorted' : ''}`, scope: 'col', tabindex: 0,
      'aria-sort': st.sort === c.key ? (st.dir > 0 ? 'ascending' : 'descending') : 'none',
      on: {
        click: () => sortBy(c.key),
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c.key); } },
      },
    }, c.label, st.sort === c.key ? (st.dir > 0 ? ' ▲' : ' ▼') : '')));
  }
  function sortBy(key) {
    if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = key === 'name' || key === 'catLabel' ? 1 : -1; }
    draw();
  }

  function draw() {
    drawHead();
    const col = COLUMNS.find((c) => c.key === st.sort);
    let rows = market.rows;
    if (st.cat) rows = rows.filter((r) => String(r.cat) === st.cat);
    if (st.q) rows = rows.filter((r) => r.name.toLowerCase().includes(st.q));
    rows = rows.slice().sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
    });
    const shown = rows.slice(0, st.limit);
    mount(tbody, shown.length ? shown.map((r) => {
      const ch = change(r);
      const watched = watchEntry(r.id);
      return h('tr', null,
        h('td', { class: 'l' }, h('a', { href: `#/item/${r.id}` }, r.name), watched ? h('span', { class: 'chip gold', title: 'On your watchlist' }, '★') : null),
        h('td', { class: 'l hide-sm muted' }, r.catLabel),
        h('td', null, money(r.latest)),
        h('td', null, money(r.avg7)),
        h('td', { class: 'hide-sm' }, money(r.avg30)),
        h('td', { class: ch == null ? 'dim' : ch > 0.02 ? 'good' : ch < -0.02 ? 'bad' : 'muted' }, ch == null ? '—' : `${ch > 0 ? '+' : ''}${pct(ch, 1)}`),
        h('td', null, count(r.vol7)),
        h('td', { class: 'hide-sm' }, r.latest != null ? money(saleBreakdown(r.latest, patron).net) : '—'));
    }) : h('tr', null, h('td', { class: 'empty', colspan: COLUMNS.length }, 'No items match your search.')));
    info.textContent = `${rows.length.toLocaleString('en-US')} items${rows.length > shown.length ? ` · showing ${shown.length}` : ''}`;
    more.classList.toggle('hidden', rows.length <= shown.length);
  }

  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Market'),
        h('p', { class: 'sub' }, `Every item traded on the Auction House in the last 30 days (${market.rows.length.toLocaleString('en-US')} items), with 24-hour, 7-day and 30-day average prices${market.sheetDate ? ` as of ${market.sheetDate}` : ''}. Click an item for its history, buy and sell targets and a sale calculator.`)),
      h('div', { class: 'row' }, search, catSel)),
    notice('info', `"You receive" is the 24-hour average minus the ${patron ? '5% Patron' : '10%'} trade fee. The 1% listing deposit is refunded when the item sells. Change Patron status in `, h('a', { href: '#/settings' }, 'Settings'), '.'),
    h('div', { class: 'card', style: { marginTop: '12px' } },
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, headRow), tbody)),
      h('div', { class: 'row spread', style: { marginTop: '10px' } }, info, more)));
  draw();
  search.focus();
}

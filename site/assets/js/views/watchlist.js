import { h, mount, notice } from '../lib/dom.js';
import { loadMarket, basisPrice } from '../lib/data.js';
import { money, pct } from '../lib/format.js';
import { get as settings, update } from '../lib/store.js';

export async function render(root) {
  const market = await loadMarket();
  const body = h('div');

  function draw() {
    const list = settings().watchlist;
    if (!list.length) {
      mount(body, h('div', { class: 'empty' },
        h('p', null, 'Your watchlist is empty.'),
        h('p', { class: 'small' }, 'Open any item from the ', h('a', { href: '#/market' }, 'Market'), ' and add it with your own buy and sell prices.')));
      return;
    }
    const rows = list.map((w) => {
      const row = market.byId.get(w.id);
      const price = basisPrice(row);
      const buy = w.buyBelow != null && price != null && price <= w.buyBelow;
      const sell = w.sellAbove != null && price != null && price >= w.sellAbove;
      return { w, row, price, buy, sell };
    }).sort((a, b) => Number(b.buy || b.sell) - Number(a.buy || a.sell) || a.w.name.localeCompare(b.w.name));
    const hits = rows.filter((r) => r.buy || r.sell).length;
    mount(body,
      hits ? notice('good', `${hits} of your items ${hits === 1 ? 'is' : 'are'} at your target price right now.`) : null,
      h('div', { class: 'tablewrap', style: { marginTop: '10px' } }, h('table', null,
        h('thead', null, h('tr', null, ...['Item', 'Price now', 'Buy below', 'Sell above', '7d vs 30d', 'Status', ''].map((t, i) => h('th', { class: i === 0 || i === 5 ? 'l' : '' }, t)))),
        h('tbody', null, rows.map(({ w, row, price, buy, sell }) => {
          const ch = row?.avg7 != null && row?.avg30 ? row.avg7 / row.avg30 - 1 : null;
          return h('tr', null,
            h('td', { class: 'l' }, h('a', { href: `#/item/${w.id}` }, w.name)),
            h('td', null, money(price)),
            h('td', { class: buy ? 'good' : '' }, money(w.buyBelow)),
            h('td', { class: sell ? 'bad' : '' }, money(w.sellAbove)),
            h('td', { class: ch == null ? 'dim' : ch > 0 ? 'good' : 'bad' }, ch == null ? '—' : `${ch > 0 ? '+' : ''}${pct(ch, 1)}`),
            h('td', { class: 'l' },
              buy ? h('span', { class: 'chip green' }, 'BUY') : null,
              sell ? h('span', { class: 'chip red' }, 'SELL') : null,
              !row ? h('span', { class: 'chip grey' }, 'no recent trades') : null,
              !buy && !sell && row ? h('span', { class: 'muted small' }, 'waiting') : null),
            h('td', null, h('button', { class: 'btn small bad', on: { click: () => { update((s) => { s.watchlist = s.watchlist.filter((x) => x.id !== w.id); }); draw(); } } }, 'Remove')));
        })))));
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, 'Watchlist'),
      h('p', { class: 'sub' }, `Your items and target prices, compared with the current ${settings().priceBasis === 'latest' ? 'latest' : settings().priceBasis === 'avg7' ? '7-day average' : '30-day average'} price. Saved only in this browser.`))),
    h('div', { class: 'card' }, body),
    h('p', { class: 'small muted' }, 'Discord alerts for a shared guild watchlist are planned for a later update.'));
  draw();
}

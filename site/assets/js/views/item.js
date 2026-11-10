import { h, mount, kpi, notice, field } from '../lib/dom.js';
import { itemIcon } from '../lib/icons.js';
import { loadMarket, priceHistory, historyStart, quantile } from '../lib/data.js';
import { money, pct, count, saleBreakdown, toCopper, toGold } from '../lib/format.js';
import { priceChart } from '../lib/chart.js';
import { get as settings, update, watchEntry } from '../lib/store.js';

function thin(row) {
  return (row?.vol7 ?? 0) < 20 ? notice('warn', 'Thinly traded: fewer than 20 sold in the last 7 days. Prices can jump and orders may take long to fill.') : null;
}

export async function render(root, params, ctx) {
  const id = Number(params[0]);
  if (!Number.isInteger(id) || id <= 0) { mount(root, notice('bad', 'Unknown item.')); return; }
  const market = await loadMarket();
  const row = market.byId.get(id) || null;
  const name = row ? row.name : `Item #${id}`;
  const patron = settings().patron;

  const canvas = h('canvas', { role: 'img', 'aria-label': `Daily price chart for ${name}` });
  const readout = h('div', { class: 'readout' }, 'Loading price history…');
  const targetsBox = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const receiptBox = h('div');
  const watchBox = h('div');

  mount(root,
    h('div', { class: 'page-head' },
      h('div', null,
        h('a', { href: '#/market', class: 'small' }, '← Market'),
        h('h1', null, itemIcon(id, 32), name),
        h('p', { class: 'sub' }, row ? row.catLabel : 'Not traded in the last 30 days', ' · ',
          h('a', { href: `https://aa-classic.com/database/item/${id}` }, 'Item database ↗')))),
    h('div', { class: 'kpis' },
      kpi('Last 24 hours', money(row?.latest), row ? `average · ${count(row.vol1)} sold` : 'no trades', 'warn'),
      kpi('7-day average', money(row?.avg7)),
      kpi('30-day average', money(row?.avg30)),
      kpi('Sold (7 days)', count(row?.vol7 ?? NaN), `${count(row?.vol30 ?? NaN)} in 30 days`, 'blue')),
    h('div', { class: 'grid2', style: { marginTop: '12px' } },
      h('div', { class: 'card' }, h('h2', null, 'Price history'),
        h('div', { class: 'chartbox' }, canvas),
        h('div', { class: 'legend' }, h('span', null, h('i', { class: 'c-gold' }), 'daily average'), h('span', null, h('i', { class: 'c-blue' }), 'units sold'),
          h('span', null, h('i', { class: 'c-green' }), 'buy target'), h('span', null, h('i', { class: 'c-red' }), 'sell target')),
        readout),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', null, 'Buy & sell targets'), targetsBox),
        h('div', { class: 'card' }, h('h2', null, 'Sale calculator'), h('p', { class: 'sub' }, 'Matches the in-game sale receipt.'), receiptBox),
        h('div', { class: 'card' }, h('h2', null, 'Watchlist'), watchBox))));

  // --- sale calculator --------------------------------------------------
  const priceInput = h('input', { type: 'number', min: 0, step: 0.01, value: toGold(row?.latest ?? 0), inputmode: 'decimal' });
  const receipt = h('tbody');
  function drawReceipt() {
    const p = Math.max(0, toCopper(priceInput.value || 0));
    const b = saleBreakdown(p, patron);
    mount(receipt,
      h('tr', null, h('td', null, 'Trade price'), h('td', null, money(b.price))),
      h('tr', null, h('td', null, 'Listing deposit refunded (1%)'), h('td', { class: 'good' }, money(b.deposit, { signed: true }))),
      h('tr', null, h('td', null, `Trade fee (${patron ? '5%, Patron' : '10%'})`), h('td', { class: 'bad' }, money(-b.tradeFee))),
      h('tr', { class: 'total' }, h('td', null, 'Profit shown on the receipt'), h('td', { class: 'gold' }, money(b.profit))),
      h('tr', null, h('td', { class: 'muted small' }, 'Real gain (deposit was paid when listing)'), h('td', { class: 'muted small' }, money(b.net))));
  }
  priceInput.addEventListener('input', drawReceipt);
  mount(receiptBox, field('Sale price (gold)', priceInput), h('div', { class: 'tablewrap', style: { marginTop: '8px' } }, h('table', { class: 'receipt' }, receipt)),
    h('p', { class: 'small muted' }, 'If the item does not sell, the 1% deposit is lost.'));
  drawReceipt();

  // --- watchlist -------------------------------------------------------------
  function drawWatch() {
    const w = watchEntry(id);
    const buy = h('input', { type: 'number', min: 0, step: 0.01, value: w?.buyBelow ? toGold(w.buyBelow) : '', placeholder: 'e.g. 12.5' });
    const sell = h('input', { type: 'number', min: 0, step: 0.01, value: w?.sellAbove ? toGold(w.sellAbove) : '', placeholder: 'e.g. 15' });
    const save = () => update((s) => {
      const entry = { id, name, buyBelow: buy.value ? toCopper(buy.value) : null, sellAbove: sell.value ? toCopper(sell.value) : null, added: w?.added || new Date().toISOString().slice(0, 10) };
      const i = s.watchlist.findIndex((x) => x.id === id);
      if (i >= 0) s.watchlist[i] = entry; else s.watchlist.push(entry);
    });
    mount(watchBox,
      h('p', { class: 'sub' }, 'Get highlighted on the Watchlist page when the price drops below your buy price or rises above your sell price. Stored only in this browser.'),
      h('div', { class: 'form' }, field('Buy below (gold)', buy), field('Sell above (gold)', sell)),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn primary', on: { click: () => { save(); drawWatch(); } } }, w ? 'Update' : 'Add to watchlist'),
        w ? h('button', { class: 'btn bad', on: { click: () => { update((s) => { s.watchlist = s.watchlist.filter((x) => x.id !== id); }); drawWatch(); } } }, 'Remove') : null,
        w ? h('span', { class: 'chip gold' }, '★ watching') : null));
  }
  drawWatch();

  // --- history + targets -----------------------------------------------------
  let hit = () => -1, points = [];
  const onMove = (e) => {
    const i = hit(e.clientX);
    if (i >= 0 && points[i]) readout.textContent = `${points[i].date}: average ${money(points[i].avg)}, ${count(points[i].volume)} sold`;
  };
  canvas.addEventListener('mousemove', onMove);

  let targets = null;
  const MIN_DAYS = 7;
  const redraw = () => {
    hit = priceChart(canvas, points, targets ? [
      { value: targets.buy, color: '#7ee2a6', label: 'buy' },
      { value: targets.sell, color: '#ef7373', label: 'sell' }] : []);
  };
  let since = null;
  try {
    [points, since] = await Promise.all([priceHistory(id), historyStart(id)]);
    if (!ctx.isCurrent()) return undefined;
    const sorted = points.map((p) => p.avg).sort((a, b) => a - b);
    if (sorted.length >= MIN_DAYS) {
      targets = { buy: Math.round(quantile(sorted, 0.25)), sell: Math.round(quantile(sorted, 0.75)), lo: sorted[0], hi: sorted[sorted.length - 1] };
    }
    readout.textContent = points.length
      ? `${points.length} day${points.length === 1 ? '' : 's'} recorded since ${since}. Hover the chart for details.`
      : `No daily trades recorded for this item since this site started collecting history${since ? ` (${since})` : ''}.`;
  } catch (err) {
    readout.textContent = `Price history unavailable right now (${err.message}).`;
  }
  redraw();

  if (targets) {
    const b = saleBreakdown(targets.sell, patron);
    const margin = b.net - targets.buy;
    mount(targetsBox,
      h('p', { class: 'sub' }, `Based on ${points.length} daily averages: buy near the cheaper quarter of recent days, sell near the dearer quarter. Ignore short-term undercuts.`),
      h('div', { class: 'kpis' },
        kpi('Buy target', money(targets.buy), `lowest day ${money(targets.lo)}`, 'good'),
        kpi('Sell target', money(targets.sell), `highest day ${money(targets.hi)}`, 'bad'),
        kpi('Flip margin', money(margin, { signed: true }), `${pct(targets.buy ? margin / targets.buy : NaN, 1)} after ${patron ? '5%' : '10%'} fee`, margin > 0 ? 'good' : 'bad')),
      thin(row));
  } else if (row) {
    // Not enough recorded days yet: compare the sheet's 24h / 7d / 30d averages instead.
    const avgs = [['24 hours', row.latest], ['7 days', row.avg7], ['30 days', row.avg30]].filter(([, v]) => v != null);
    const lo = Math.min(...avgs.map(([, v]) => v)), hi = Math.max(...avgs.map(([, v]) => v));
    const now = row.latest ?? row.avg7;
    mount(targetsBox,
      h('p', { class: 'sub' }, `Targets need at least ${MIN_DAYS} days of recorded history (${points.length} so far). Until then, compare the averages:`),
      h('div', { class: 'tablewrap' }, h('table', null, h('tbody', null, avgs.map(([label, v]) =>
        h('tr', null, h('td', { class: 'l' }, `Average over ${label}`), h('td', { class: v === lo ? 'good' : v === hi ? 'bad' : '' }, money(v))))))),
      h('p', { class: 'small muted' }, now != null && row.avg30 != null
        ? (now < row.avg30 * 0.97 ? 'The last 24 hours are cheaper than the 30-day average: a decent time to buy.'
          : now > row.avg30 * 1.03 ? 'The last 24 hours are dearer than the 30-day average: a decent time to sell.'
            : 'The last 24 hours are close to the 30-day average.')
        : ''),
      thin(row));
  } else {
    mount(targetsBox, h('p', { class: 'muted' }, 'This item has not traded in the last 30 days.'));
  }

  const onResize = () => redraw();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

import { h, mount, debounce, select, notice, field } from '../lib/dom.js';
import { loadMarket, loadPacks, loadRegrade, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt, toCopper, toGold } from '../lib/format.js';
import { get as settings, update } from '../lib/store.js';
import * as setup from '../lib/setup.js';
import { makePackCalc, vehicleCost, routeKey, COIN_ID, GILDA_STAR_DUST, DEMAND_MIN, DEMAND_MAX } from '../lib/packcalc.js';

const ON_FOOT = { id: '', name: 'On foot (1 pack)', capacity: 1, tripMinutes: null, consumables: [], riskPct: 0 };

const PACK_COLUMNS = [
  { key: 'name', label: 'Pack', cls: 'l', get: (r) => r.pack.name.toLowerCase() },
  { key: 'origin', label: 'From', cls: 'l hide-sm', get: (r) => r.pack.origin || '' },
  { key: 'to', label: 'To', cls: 'l', get: (r) => r.to },
  { key: 'payout', label: 'Turnover', get: (r) => r.payout },
  { key: 'demand', label: 'Demand', cls: 'hide-sm', get: (r) => r.demand },
  { key: 'cost', label: 'Craft cost', get: (r) => r.cost.copper },
  { key: 'profit', label: 'Profit', get: (r) => r.profit },
  { key: 'labor', label: 'Labor', cls: 'hide-sm', get: (r) => r.labor },
  { key: 'spl', label: 's/l', get: (r) => r.spl },
];

const ROUTE_COLUMNS = [
  { key: 'route', label: 'Route', cls: 'l', get: (r) => `${r.from} ${r.to}`.toLowerCase() },
  { key: 'pack', label: 'Best pack', cls: 'l hide-sm', get: (r) => r.best.pack.name.toLowerCase() },
  { key: 'demand', label: 'Demand', get: (r) => r.best.demand },
  { key: 'turnoverPack', label: 'Turnover / pack', get: (r) => r.turnoverPack },
  { key: 'turnoverTrip', label: 'Turnover / trip', cls: 'hide-sm', get: (r) => r.turnoverTrip },
  { key: 'costTrip', label: 'Craft cost / trip', cls: 'hide-sm', get: (r) => r.costTrip },
  { key: 'profitTrip', label: 'Profit / trip', get: (r) => r.profitTrip },
  { key: 'spl', label: 's/l', get: (r) => r.spl },
  { key: 'perHour', label: 'Profit / hour', cls: 'hide-sm', get: (r) => r.perHour },
];

export async function render(root, params) {
  const tab = params[0] === 'routes' ? 'routes' : 'packs';
  const [data, market, { rules }] = await Promise.all([loadPacks(), loadMarket(), loadRegrade()]);
  const priceInfo = priceResolver(market, rules, regradeItemNames(rules));
  const idOfName = (name) => market.byName.get(String(name || '').toLowerCase())?.id ?? null;

  function calc() {
    const s = settings(), ps = s.packs;
    return makePackCalc({
      data, priceOfId: priceInfo, idOfName,
      opts: {
        defaultDemand: ps.defaultDemand, routeDemand: ps.favRoutes, feeRate: s.patron ? 0.05 : 0.10,
        gildaStarCopper: ps.gildaStarGold != null ? toCopper(ps.gildaStarGold) : null,
        lordsPenceCopper: ps.lordsPenceGold != null ? toCopper(ps.lordsPenceGold) : null,
        laborFactor: setup.laborFactor('Commerce'),
      },
    });
  }

  const origins = [...new Set(data.packs.map((p) => p.origin).filter(Boolean))].sort();
  const dests = [...new Set(data.packs.flatMap((p) => [...p.gold, ...p.resources].map((d) => d.to)))].sort();
  const st = { q: '', origin: '', to: '', reward: 'all', bestOnly: true, limit: 150, open: new Set(), favOnly: false, sort: tab === 'routes' ? 'profitTrip' : 'profit', dir: -1 };

  // ------------------------------------------------------------------ shared controls
  const notices = h('div', { class: 'notices' });
  const controlsBox = h('div');
  const tbody = h('tbody');
  const headRow = h('tr');
  const info = h('div', { class: 'muted small' });
  const more = h('button', { class: 'btn', on: { click: () => { st.limit += 200; draw(); } } }, 'Show more');

  const search = h('input', { type: 'search', placeholder: tab === 'routes' ? 'Search packs or zones…' : 'Search packs…', 'aria-label': 'Search', autocomplete: 'off' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); st.limit = 150; draw(); }));
  const originSel = select([['', 'All origins'], ...origins.map((o) => [o, o])], '', (v) => { st.origin = v; draw(); }, { 'aria-label': 'Origin zone' });
  const destSel = select([['', 'All destinations'], ...dests.map((d) => [d, d])], '', (v) => { st.to = v; draw(); }, { 'aria-label': 'Destination' });
  const rewardSel = select([['all', 'Gold and resources'], ['gold', 'Gold only'], ['resources', 'Resources only']], 'all', (v) => { st.reward = v; draw(); }, { 'aria-label': 'Reward type' });
  const bestBox = h('input', { type: 'checkbox', checked: true });
  bestBox.addEventListener('change', () => { st.bestOnly = bestBox.checked; draw(); });
  const favBox = h('input', { type: 'checkbox' });
  favBox.addEventListener('change', () => { st.favOnly = favBox.checked; draw(); });
  const isFav = (from, to) => from && settings().packs.favRoutes[routeKey(from, to)] != null;
  function toggleFav(from, to) {
    const key = routeKey(from, to);
    update((s) => { if (s.packs.favRoutes[key] != null) delete s.packs.favRoutes[key]; else s.packs.favRoutes[key] = s.packs.defaultDemand; });
    draw();
  }
  function setRouteDemand(from, to, pct) {
    update((s) => { s.packs.favRoutes[routeKey(from, to)] = Math.max(DEMAND_MIN, Math.min(DEMAND_MAX, Math.round(pct))); });
    draw();
  }
  const seaBox = h('input', { type: 'checkbox', checked: settings().packs.excludeSea });
  seaBox.addEventListener('change', () => { update((s) => { s.packs.excludeSea = seaBox.checked; }); draw(); });

  function vehicles() { return [ON_FOOT, ...setup.active().vehicles]; }
  function currentVehicle() {
    const id = settings().packs.vehicleId || '';
    return vehicles().find((v) => v.id === id) || ON_FOOT;
  }

  function settingsPanel() {
    const ps = settings().packs;
    const c = calc();
    const fixed = h('input', { type: 'number', min: DEMAND_MIN, max: DEMAND_MAX, step: 1, value: ps.defaultDemand, inputmode: 'numeric', 'aria-label': 'Default demand %' });
    fixed.addEventListener('input', debounce(() => { const v = Number(fixed.value); if (Number.isFinite(v) && v >= DEMAND_MIN && v <= DEMAND_MAX) { update((s) => { s.packs.defaultDemand = v; }); draw(); } }, 300));
    const favCount = Object.keys(ps.favRoutes).length;
    const rank = setup.rankOf('Commerce');
    const lf = setup.laborFactor('Commerce');
    const goldInput = (key, placeholder) => {
      const el = h('input', { type: 'number', min: 0, step: 0.01, value: ps[key] ?? '', placeholder, inputmode: 'decimal' });
      el.addEventListener('input', debounce(() => { const v = el.value === '' ? null : Number(el.value); if (v === null || (Number.isFinite(v) && v >= 0)) { update((s) => { s.packs[key] = v; }); draw(); } }, 300));
      return el;
    };
    const dust = c.priceByName('Gilda Dust');
    const fields = [
      field(`Default demand % (${DEMAND_MIN}–${DEMAND_MAX})`, fixed),
      field('Favourite routes', h('div', { class: 'small' }, favCount ? `${favCount} starred, each with its own demand %. ` : 'None yet. ',
        tab === 'routes' ? 'Click ☆ on a route to star it and set its own %.' : h('a', { href: '#/packs/routes' }, 'Star routes on the Routes tab'))),
      field('Commerce proficiency', h('div', { class: 'small' }, h('b', null, rank.name), ` · labor −${fmt((1 - lf) * 100, 0)}%. `, h('a', { href: '#/setup' }, 'Change in My Setup'))),
    ];
    if (tab === 'routes') {
      const v = currentVehicle();
      const fuel = vehicleCost(v, c.priceByName);
      fields.push(field('Vehicle', select(vehicles().map((x) => [x.id, x.id ? `${x.name} (${x.capacity} packs)` : x.name]), v.id,
        (val) => { update((s) => { s.packs.vehicleId = val || null; }); mount(controlsBox, settingsPanel()); draw(); })));
      fields.push(field('Per trip', h('div', { class: 'small' },
        `${v.capacity} pack${v.capacity === 1 ? '' : 's'} · fuel & consumables ${money(fuel.copper)}${fuel.missing.length ? ' + ?' : ''}`,
        ` · loss risk ${fmt(v.riskPct || 0, 0)}%`, v.tripMinutes ? ` · ${fmt(v.tripMinutes, 0)} min round trip` : '',
        '. ', h('a', { href: '#/setup/vehicles' }, setup.active().vehicles.length ? 'Edit vehicles' : 'Add your vehicle'))));
    }
    fields.push(field('Gilda Star value (gold)', goldInput('gildaStarGold', dust != null ? `auto: ${toGold(dust * GILDA_STAR_DUST)} (4 × Gilda Dust)` : 'no Gilda Dust price')));
    fields.push(field("Lord's Pence value (gold)", goldInput('lordsPenceGold', 'not traded: enter yours')));
    return h('div', { class: 'form' }, fields);
  }

  // ------------------------------------------------------------------ table plumbing
  const columns = tab === 'routes' ? ROUTE_COLUMNS : PACK_COLUMNS;
  function drawHead() {
    mount(headRow, columns.map((c) => h('th', {
      class: `${c.cls || ''} sortable ${st.sort === c.key ? 'sorted' : ''}`, scope: 'col', tabindex: 0,
      'aria-sort': st.sort === c.key ? (st.dir > 0 ? 'ascending' : 'descending') : 'none',
      on: { click: () => sortBy(c.key), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c.key); } } },
    }, c.label, st.sort === c.key ? (st.dir > 0 ? ' ▲' : ' ▼') : '')));
  }
  function sortBy(key) {
    if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = ['name', 'origin', 'to', 'route', 'pack'].includes(key) ? 1 : -1; }
    draw();
  }
  function sortRows(rows) {
    const col = columns.find((c) => c.key === st.sort) || columns[0];
    return rows.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
    });
  }
  const toggle = (key) => { st.open.has(key) ? st.open.delete(key) : st.open.add(key); draw(); };
  const signedCell = (v, d = null) => h('td', { class: v == null ? 'dim' : v >= 0 ? 'good' : 'bad' }, v == null ? '—' : d == null ? money(v, { signed: true }) : fmt(v, d));
  function demandCell(o, from, editable = false) {
    if (editable && isFav(from, o.to)) {
      const box = h('input', { type: 'number', class: 'narrow', min: DEMAND_MIN, max: DEMAND_MAX, step: 1, value: o.demand, inputmode: 'numeric', 'aria-label': `Demand % for ${from} → ${o.to}`, title: `Your demand % for this route (${DEMAND_MIN}–${DEMAND_MAX})` });
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => { const v = Number(box.value); if (Number.isFinite(v)) setRouteDemand(from, o.to, v); });
      return h('td', { class: 'demand-edit' }, box, '%');
    }
    return h('td', { class: 'hide-sm' }, `${fmt(o.demand, 0)}%`, o.custom ? h('span', { class: 'chip gold', title: 'Your own % for this favourite route' }, '★') : null);
  }
  function starButton(from, to) {
    const on = isFav(from, to);
    return h('button', { type: 'button', class: `star ${on ? 'on' : ''}`, title: on ? 'Remove from favourites' : 'Add to favourites and set its own demand %', 'aria-pressed': String(on), 'aria-label': on ? 'Unstar route' : 'Star route',
      on: { click: (e) => { e.stopPropagation(); toggleFav(from, to); } } }, on ? '★' : '☆');
  }
  const rewardLabel = (o) => (o.reward === 'Gold' ? null : h('div', { class: 'small muted' }, `${fmt(o.qty, 1)} × ${o.reward}`));

  function materialTable(cost, times = 1, title = null) {
    const lines = cost.lines.map(({ m, unit, total }) => h('tr', null,
      h('td', { class: 'l' }, m.id === COIN_ID ? 'Coins (gold fee)' : h('a', { href: `#/item/${m.id}` }, m.name)),
      h('td', null, m.id === COIN_ID ? '—' : fmt((m.qty * times) / (cost.yield || 1), 0)),
      h('td', { class: unit == null ? 'warn' : '' }, m.id === COIN_ID ? '—' : unit == null ? 'no price' : money(unit)),
      h('td', null, m.id === COIN_ID ? money((m.qty * times) / (cost.yield || 1)) : total == null ? '—' : money((total * times) / (cost.yield || 1)))));
    return [
      title ? h('h3', null, title) : null,
      cost.own ? h('p', { class: 'small muted' }, 'Craft cost is your own price for this pack (Settings).') : null,
      lines.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Material'), h('th', null, 'Qty'), h('th', null, 'Each'), h('th', null, 'Total'))),
        h('tbody', null, lines))) : null,
      cost.missing.length ? h('p', { class: 'small warn' }, `Missing prices: ${cost.missing.join(', ')}. Add them under Settings → Your prices.`) : null,
    ];
  }

  // ------------------------------------------------------------------ Packs tab
  function drawPacks(c) {
    let rows = [];
    for (const pack of data.packs) {
      if (st.origin && pack.origin !== st.origin) continue;
      if (st.q && !pack.name.toLowerCase().includes(st.q)) continue;
      let list = c.options(pack, st.reward).filter((o) => (!st.to || o.to === st.to) && (!st.favOnly || isFav(pack.origin, o.to))).map((o) => c.evaluate(pack, o));
      if (st.bestOnly && list.length) {
        list.sort((a, b) => (b.payout ?? -Infinity) - (a.payout ?? -Infinity));
        list = [list[0]];
      }
      rows.push(...list);
    }
    rows = sortRows(rows);
    const shown = rows.slice(0, st.limit), out = [];
    for (const r of shown) {
      const key = `${r.pack.id}|${r.to}|${r.reward}`;
      out.push(h('tr', { class: 'clickable', title: 'Click for the material breakdown', on: { click: () => toggle(key) } },
        h('td', { class: 'l' }, h('b', null, r.pack.name)),
        h('td', { class: 'l hide-sm muted' }, r.pack.origin || '—'),
        h('td', { class: 'l' }, r.to),
        h('td', null, r.payout != null ? money(r.payout) : '—', rewardLabel(r)),
        demandCell(r, r.pack.origin),
        h('td', { class: r.cost.copper == null ? 'warn' : '' }, r.cost.copper != null ? money(r.cost.copper) : r.cost.lines.length ? 'incomplete' : 'unknown'),
        signedCell(r.profit),
        h('td', { class: 'hide-sm' }, fmt(r.labor, 0)),
        signedCell(r.spl, 1)));
      if (st.open.has(key)) {
        out.push(h('tr', { class: 'detail' }, h('td', { colspan: columns.length, class: 'l wrap' },
          materialTable(r.cost),
          h('p', { class: 'small muted' }, `Labor: ${fmt(r.pack.craftLabor, 0)} to craft + ${fmt(r.pack.turnInLabor, 0)} to turn in, −${fmt((1 - setup.laborFactor('Commerce')) * 100, 0)}% Commerce = ${fmt(r.labor, 0)}.`))));
      }
    }
    mount(tbody, out.length ? out : h('tr', null, h('td', { class: 'empty', colspan: columns.length }, 'No packs match.')));
    const unpriced = rows.filter((r) => r.profit == null).length;
    info.textContent = `${rows.length.toLocaleString('en-US')} ${st.bestOnly ? 'packs (best destination each)' : 'pack × destination options'}${rows.length > shown.length ? ` · showing ${shown.length}` : ''}${unpriced ? ` · ${unpriced} without a full price` : ''}`;
    more.classList.toggle('hidden', rows.length <= shown.length);
  }

  // ------------------------------------------------------------------ Routes tab
  function drawRoutes(c) {
    const v = currentVehicle();
    const fuel = vehicleCost(v, c.priceByName);
    let rows = c.routes({ reward: st.reward, excludeSea: settings().packs.excludeSea, vehicle: { capacity: v.capacity, fuelCopper: fuel.copper, fuelMissing: fuel.missing, riskPct: v.riskPct, tripMinutes: v.tripMinutes } });
    if (st.origin) rows = rows.filter((r) => r.from === st.origin);
    if (st.to) rows = rows.filter((r) => r.to === st.to);
    if (st.favOnly) rows = rows.filter((r) => isFav(r.from, r.to));
    if (st.q) rows = rows.filter((r) => `${r.from} ${r.to} ${r.candidates.map((x) => x.pack.name).join(' ')}`.toLowerCase().includes(st.q));
    rows = sortRows(rows);
    const shown = rows.slice(0, st.limit), out = [];
    for (const r of shown) {
      const key = `${r.from}→${r.to}`;
      out.push(h('tr', { class: 'clickable', title: 'Click for every pack on this route and the shopping list', on: { click: () => toggle(key) } },
        h('td', { class: 'l' }, starButton(r.from, r.to), h('b', null, r.from), h('span', { class: 'muted' }, ' → '), h('b', null, r.to)),
        h('td', { class: 'l hide-sm' }, r.best.pack.name, rewardLabel(r.best)),
        demandCell(r.best, r.from, true),
        h('td', null, money(r.turnoverPack)),
        h('td', { class: 'hide-sm' }, money(r.turnoverTrip)),
        h('td', { class: `hide-sm ${r.costTrip == null ? 'warn' : ''}` }, r.costTrip != null ? money(r.costTrip) : 'incomplete'),
        signedCell(r.profitTrip),
        signedCell(r.spl, 1),
        h('td', { class: 'hide-sm' }, r.perHour == null ? h('span', { class: 'dim', title: 'Set a round-trip time for your vehicle in My Setup' }, '—') : money(r.perHour, { signed: true }))));
      if (st.open.has(key)) {
        const cand = r.candidates.map((x) => h('tr', null,
          h('td', { class: 'l' }, x === r.best ? h('b', null, x.pack.name) : x.pack.name, rewardLabel(x)),
          h('td', null, x.payout != null ? money(x.payout) : '—'),
          h('td', { class: x.cost.copper == null ? 'warn' : '' }, x.cost.copper != null ? money(x.cost.copper) : 'incomplete'),
          signedCell(x.profit),
          h('td', null, fmt(x.labor, 0)),
          signedCell(x.spl, 1)));
        out.push(h('tr', { class: 'detail' }, h('td', { colspan: columns.length, class: 'l wrap' },
          h('div', { class: 'grid2' },
            h('div', null,
              h('h3', null, `Every pack on this route (${r.candidates.length})`),
              h('div', { class: 'tablewrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Pack'), h('th', null, 'Turnover / pack'), h('th', null, 'Craft cost'), h('th', null, 'Profit / pack'), h('th', null, 'Labor'), h('th', null, 's/l'))),
                h('tbody', null, cand)))),
            h('div', null,
              materialTable(r.best.cost, r.n, `Shopping list: ${r.n} × ${r.best.pack.name}`),
              h('div', { class: 'tablewrap', style: { marginTop: '8px' } }, h('table', { class: 'receipt' }, h('tbody', null,
                h('tr', null, h('td', null, `Turnover (${r.n} × ${money(r.turnoverPack)})`), h('td', { class: 'good' }, money(r.turnoverTrip))),
                r.lossTrip ? h('tr', null, h('td', null, `Expected loss (${fmt(v.riskPct, 0)}% risk)`), h('td', { class: 'bad' }, money(-r.lossTrip))) : null,
                h('tr', null, h('td', null, 'Craft cost of the load'), h('td', { class: 'bad' }, r.costTrip != null ? money(-r.costTrip) : 'incomplete')),
                h('tr', null, h('td', null, `Fuel & consumables${r.fuelMissing.length ? ` (no price: ${r.fuelMissing.join(', ')})` : ''}`), h('td', { class: 'bad' }, money(-r.fuel))),
                h('tr', { class: 'total' }, h('td', null, 'Profit per trip'), h('td', { class: r.profitTrip >= 0 ? 'good' : 'bad' }, r.profitTrip != null ? money(r.profitTrip, { signed: true }) : '—')),
                h('tr', null, h('td', { class: 'muted small' }, `Labor: ${fmt(r.laborTrip, 0)} (${r.n} × ${fmt(r.best.labor, 0)})`), h('td', { class: 'muted small' }, r.spl != null ? `${fmt(r.spl, 1)} s/l` : ''))))))))));
      }
    }
    mount(tbody, out.length ? out : h('tr', null, h('td', { class: 'empty', colspan: columns.length }, 'No routes match.')));
    const incomplete = rows.filter((r) => !r.complete).length;
    info.textContent = `${rows.length.toLocaleString('en-US')} routes · load: ${v.capacity} × best pack${rows.length > shown.length ? ` · showing ${shown.length}` : ''}${incomplete ? ` · ${incomplete} without a full price` : ''}`;
    more.classList.toggle('hidden', rows.length <= shown.length);
  }

  function draw() {
    drawHead();
    const c = calc();
    if (tab === 'routes') drawRoutes(c); else drawPacks(c);
  }

  // ------------------------------------------------------------------ page
  const c0 = calc();
  const missingMats = new Set();
  for (const p of data.packs) for (const m of c0.craftCost(p).missing) if (!m.startsWith('no recipe')) missingMats.add(m);
  mount(notices,
    notice('info', tab === 'routes'
      ? `Each route is filled with a full load of its most profitable pack. Profit per trip = turnover − expected loss − craft cost of the load − fuel & consumables. Your vehicle, risk and trip time come from My Setup. Every route uses the default demand % (${settings().packs.defaultDemand}%); star a route (☆) to set its own % between ${DEMAND_MIN} and ${DEMAND_MAX}. Click a route for every pack it accepts and a shopping list.`
      : `Turnover scales with the demand %: the default (${settings().packs.defaultDemand}%) or the own % of a starred route (★). Resource rewards are valued at market price minus the ${settings().patron ? '5%' : '10%'} AH fee. Click a row for the material breakdown.`),
    missingMats.size ? notice('warn', `Some materials are never traded, so packs that need them show "incomplete": ${[...missingMats].sort().join(', ')}. Give them a price under `, h('a', { href: '#/settings' }, 'Settings → Your prices'), '.') : null);

  const filters = [search, originSel, destSel, rewardSel,
    h('div', { class: 'row' },
      h('label', { class: 'check small' }, favBox, '★ Favourites only'),
      tab === 'packs' ? h('label', { class: 'check small' }, bestBox, 'Best destination only')
        : h('label', { class: 'check small', title: 'Diamond Shores, Freedich Island, Sunspeck Sea' }, seaBox, 'No sea destinations'))];

  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Trade Packs'),
        h('p', { class: 'sub' }, `${data.packs.length} packs and every route, with turnover, craft cost, profit and silver per labor (s/l). Payouts: Ser Meatball's trade pack prices (snapshot ${data.snapshotTakenAt || ''}); pack routes: in-game export (${data.demandExportedOn || 'n/a'}).`))),
    h('nav', { class: 'subtabs top', 'aria-label': 'Trade pack views' },
      h('a', { href: '#/packs', class: tab === 'packs' ? 'active' : '' }, 'Packs'),
      h('a', { href: '#/packs/routes', class: tab === 'routes' ? 'active' : '' }, 'Routes')),
    h('div', { class: 'filters' }, filters),
    notices,
    h('div', { class: 'card', style: { marginTop: '12px' } }, controlsBox),
    h('div', { class: 'card', style: { marginTop: '12px' } },
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, headRow), tbody)),
      h('div', { class: 'row spread', style: { marginTop: '10px' } }, info, more)));
  mount(controlsBox, settingsPanel());
  draw();
  return undefined;
}

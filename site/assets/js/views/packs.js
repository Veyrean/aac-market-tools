import { h, mount, debounce, select, notice, field } from '../lib/dom.js';
import { loadMarket, loadPacks, loadRegrade, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt, toCopper, toGold } from '../lib/format.js';
import { get as settings, update } from '../lib/store.js';
import * as setup from '../lib/setup.js';

const COIN_ID = 500; // "Coin" in recipes: the amount is in copper
const GILDA_STAR_DUST = 4; // 1 Gilda Star is valued as 4 Gilda Dust

const COLUMNS = [
  { key: 'name', label: 'Pack', cls: 'l', get: (r) => r.pack.name.toLowerCase() },
  { key: 'origin', label: 'From', cls: 'l hide-sm', get: (r) => r.pack.origin || '' },
  { key: 'to', label: 'To', cls: 'l', get: (r) => r.to },
  { key: 'payout', label: 'Pays', get: (r) => r.payout },
  { key: 'demand', label: 'Demand', cls: 'hide-sm', get: (r) => r.demand },
  { key: 'cost', label: 'Craft cost', get: (r) => r.cost.copper },
  { key: 'profit', label: 'Profit', get: (r) => r.profit },
  { key: 'labor', label: 'Labor', cls: 'hide-sm', get: (r) => r.labor },
  { key: 'spl', label: 'Silver / labor', get: (r) => r.spl },
];

export async function render(root) {
  const [data, market, { rules }] = await Promise.all([loadPacks(), loadMarket(), loadRegrade()]);
  const priceInfo = priceResolver(market, rules, regradeItemNames(rules));
  const st = { q: '', origin: '', to: '', reward: 'all', bestOnly: true, sort: 'profit', dir: -1, limit: 150, open: new Set() };

  const origins = [...new Set(data.packs.map((p) => p.origin).filter(Boolean))].sort();
  const dests = [...new Set(data.packs.flatMap((p) => [...p.gold, ...p.resources].map((d) => d.to)))].sort();

  // ---------------------------------------------------------------- pricing
  function priceByName(name) {
    const row = market.byName.get(name.toLowerCase());
    return row ? priceInfo(row.id).copper : null;
  }
  function rewardUnitPrice(name) {
    const ps = settings().packs;
    if (name === 'Gilda Star') {
      if (ps.gildaStarGold != null) return toCopper(ps.gildaStarGold);
      const dust = priceByName('Gilda Dust');
      return dust == null ? null : dust * GILDA_STAR_DUST;
    }
    if (name === "Lord's Pence") return ps.lordsPenceGold != null ? toCopper(ps.lordsPenceGold) : null;
    return priceByName(name);
  }
  function craftCost(pack) {
    if (!pack.materials.length) {
      const own = priceInfo(pack.id);
      return own.source === 'your price'
        ? { copper: own.copper, missing: [], lines: [], own: true }
        : { copper: null, missing: ['no recipe (larder): set your own price for this pack in Settings'], lines: [] };
    }
    let total = 0;
    const missing = [], lines = [];
    for (const m of pack.materials) {
      const unit = m.id === COIN_ID ? 1 : priceInfo(m.id).copper ?? priceByName(m.name);
      if (unit == null) { missing.push(m.name); lines.push({ m, unit: null, total: null }); continue; }
      total += unit * m.qty;
      lines.push({ m, unit, total: unit * m.qty });
    }
    const perPack = total / (pack.yield || 1);
    return { copper: missing.length ? null : perPack, partial: perPack, missing, lines };
  }

  function buildRows() {
    const s = settings(), ps = s.packs, fee = s.patron ? 0.05 : 0.10;
    const rows = [];
    for (const pack of data.packs) {
      const cost = craftCost(pack);
      const labor = (pack.craftLabor + pack.turnInLabor) * setup.laborFactor('Commerce');
      const options = [];
      const demandFor = (to) => (ps.demandMode === 'game' ? (pack.demand[to] ?? ps.fixedDemand) : ps.fixedDemand);
      if (st.reward !== 'resources') {
        for (const d of pack.gold) {
          const demand = demandFor(d.to);
          options.push({ to: d.to, demand, payout: d.copper * demand / data.payoutDemand, reward: 'Gold', qty: null, live: ps.demandMode === 'game' && pack.demand[d.to] != null });
        }
      }
      if (st.reward !== 'gold') {
        for (const d of pack.resources) {
          const demand = demandFor(d.to);
          const unit = rewardUnitPrice(d.reward);
          const qty = d.qty * demand / data.payoutDemand;
          options.push({ to: d.to, demand, payout: unit == null ? null : qty * unit * (1 - fee), reward: d.reward, qty, unit, live: ps.demandMode === 'game' && pack.demand[d.to] != null });
        }
      }
      let list = options.filter((o) => (!st.to || o.to === st.to));
      if (st.bestOnly && list.length) {
        const priced = list.filter((o) => o.payout != null);
        list = priced.length ? [priced.reduce((a, b) => (b.payout > a.payout ? b : a))] : [list[0]];
      }
      for (const o of list) {
        const profit = o.payout != null && cost.copper != null ? o.payout - cost.copper : null;
        rows.push({ pack, ...o, cost, labor, profit, spl: profit != null && labor > 0 ? profit / 100 / labor : null });
      }
    }
    return rows;
  }

  // ---------------------------------------------------------------- UI
  const tbody = h('tbody');
  const headRow = h('tr');
  const info = h('div', { class: 'muted small' });
  const more = h('button', { class: 'btn', on: { click: () => { st.limit += 200; draw(); } } }, 'Show more');
  const notices = h('div', { class: 'notices' });

  const search = h('input', { type: 'search', placeholder: 'Search packs…', 'aria-label': 'Search packs', autocomplete: 'off' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); st.limit = 150; draw(); }));
  const originSel = select([['', 'All origins'], ...origins.map((o) => [o, o])], '', (v) => { st.origin = v; draw(); }, { 'aria-label': 'Origin zone' });
  const destSel = select([['', 'All destinations'], ...dests.map((d) => [d, d])], '', (v) => { st.to = v; draw(); }, { 'aria-label': 'Destination' });
  const rewardSel = select([['all', 'Gold and resources'], ['gold', 'Gold only'], ['resources', 'Resources only']], 'all', (v) => { st.reward = v; draw(); }, { 'aria-label': 'Reward type' });
  const bestBox = h('input', { type: 'checkbox', checked: true });
  bestBox.addEventListener('change', () => { st.bestOnly = bestBox.checked; draw(); });

  function settingsPanel() {
    const ps = settings().packs;
    const demandMode = select([['game', `Live % from the game (${data.demandExportedOn || 'export'})`], ['fixed', 'Fixed %']], ps.demandMode,
      (v) => { update((s) => { s.packs.demandMode = v; }); mount(controlsBox, settingsPanel()); draw(); });
    const fixed = h('input', { type: 'number', min: 0, max: 130, step: 1, value: ps.fixedDemand, inputmode: 'numeric' });
    fixed.addEventListener('input', debounce(() => { const v = Number(fixed.value); if (Number.isFinite(v) && v >= 0 && v <= 200) { update((s) => { s.packs.fixedDemand = v; }); draw(); } }, 300));
    const rank = setup.rankOf('Commerce');
    const lf = setup.laborFactor('Commerce');
    const tier = h('div', { class: 'small' }, h('b', null, `${rank.name}`), ` · labor −${fmt((1 - lf) * 100, 0)}% (rank${lf < 1 - rank.labor / 100 - 1e-9 ? ' + tools' : ''}). `, h('a', { href: '#/setup' }, 'Change in My Setup'));
    const goldInput = (key, placeholder) => {
      const el = h('input', { type: 'number', min: 0, step: 0.01, value: ps[key] ?? '', placeholder, inputmode: 'decimal' });
      el.addEventListener('input', debounce(() => { const v = el.value === '' ? null : Number(el.value); if (v === null || (Number.isFinite(v) && v >= 0)) { update((s) => { s.packs[key] = v; }); draw(); } }, 300));
      return el;
    };
    const dust = priceByName('Gilda Dust');
    return h('div', { class: 'form' },
      field('Demand', demandMode),
      field(ps.demandMode === 'fixed' ? 'Demand % for all routes' : 'Demand % where the export has none', fixed),
      field('Commerce proficiency', tier),
      field('Gilda Star value (gold)', goldInput('gildaStarGold', dust != null ? `auto: ${toGold(dust * GILDA_STAR_DUST)} (4 × Gilda Dust)` : 'no Gilda Dust price')),
      field("Lord's Pence value (gold)", goldInput('lordsPenceGold', 'not traded: enter yours')));
  }
  const controlsBox = h('div');

  function drawHead() {
    mount(headRow, COLUMNS.map((c) => h('th', {
      class: `${c.cls || ''} sortable ${st.sort === c.key ? 'sorted' : ''}`, scope: 'col', tabindex: 0,
      'aria-sort': st.sort === c.key ? (st.dir > 0 ? 'ascending' : 'descending') : 'none',
      on: { click: () => sortBy(c.key), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c.key); } } },
    }, c.label, st.sort === c.key ? (st.dir > 0 ? ' ▲' : ' ▼') : '')));
  }
  function sortBy(key) {
    if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = ['name', 'origin', 'to'].includes(key) ? 1 : -1; }
    draw();
  }

  function payCell(r) {
    if (r.reward === 'Gold') return h('td', null, money(r.payout));
    const label = `${fmt(r.qty, 1)} × ${r.reward}`;
    return h('td', { title: r.unit != null ? `${money(r.unit)} each, after the AH fee` : 'No price for this reward' },
      r.payout != null ? money(r.payout) : '—', h('div', { class: 'small muted' }, label));
  }

  function detailRow(r) {
    const c = r.cost;
    const lines = c.lines.map(({ m, unit, total }) => h('tr', null,
      h('td', { class: 'l' }, m.id === COIN_ID ? 'Coins (gold fee)' : h('a', { href: `#/item/${m.id}` }, m.name)),
      h('td', null, m.id === COIN_ID ? '—' : fmt(m.qty, 0)),
      h('td', { class: unit == null ? 'warn' : '' }, m.id === COIN_ID ? '—' : unit == null ? 'no price' : money(unit)),
      h('td', null, m.id === COIN_ID ? money(m.qty) : total == null ? '—' : money(total))));
    return h('tr', { class: 'detail' }, h('td', { colspan: COLUMNS.length, class: 'l wrap' },
      c.own ? h('p', { class: 'small muted' }, 'Craft cost is your own price for this pack (Settings).') : null,
      lines.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Material'), h('th', null, 'Qty'), h('th', null, 'Each'), h('th', null, 'Total'))),
        h('tbody', null, lines))) : null,
      c.missing.length ? h('p', { class: 'small warn' }, `Missing prices: ${c.missing.join(', ')}. Add them under Settings → Your prices.`) : null,
      h('p', { class: 'small muted' }, `Labor: ${fmt(r.pack.craftLabor, 0)} to craft + ${fmt(r.pack.turnInLabor, 0)} to turn in, −${fmt((1 - setup.laborFactor('Commerce')) * 100, 0)}% Commerce = ${fmt(r.labor, 0)}.`)));
  }

  function draw() {
    drawHead();
    let rows = buildRows();
    if (st.origin) rows = rows.filter((r) => r.pack.origin === st.origin);
    if (st.q) rows = rows.filter((r) => r.pack.name.toLowerCase().includes(st.q));
    const col = COLUMNS.find((c) => c.key === st.sort);
    rows.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
    });
    const shown = rows.slice(0, st.limit);
    const out = [];
    for (const r of shown) {
      const key = `${r.pack.id}|${r.to}|${r.reward}`;
      out.push(h('tr', { class: 'clickable', title: 'Click for the material breakdown', on: { click: () => { st.open.has(key) ? st.open.delete(key) : st.open.add(key); draw(); } } },
        h('td', { class: 'l' }, h('b', null, r.pack.name)),
        h('td', { class: 'l hide-sm muted' }, r.pack.origin || '—'),
        h('td', { class: 'l' }, r.to),
        payCell(r),
        h('td', { class: 'hide-sm' }, `${fmt(r.demand, 0)}%`, r.live ? null : h('span', { class: 'chip grey', title: 'Not in the game export: fixed % used' }, 'est.')),
        h('td', { class: r.cost.copper == null ? 'warn' : '' }, r.cost.copper != null ? money(r.cost.copper) : r.cost.lines.length ? 'incomplete' : 'unknown'),
        h('td', { class: r.profit == null ? 'dim' : r.profit >= 0 ? 'good' : 'bad' }, r.profit == null ? '—' : money(r.profit, { signed: true })),
        h('td', { class: 'hide-sm' }, fmt(r.labor, 0)),
        h('td', { class: r.spl == null ? 'dim' : r.spl >= 0 ? 'good' : 'bad' }, r.spl == null ? '—' : fmt(r.spl, 1))));
      if (st.open.has(key)) out.push(detailRow(r));
    }
    mount(tbody, out.length ? out : h('tr', null, h('td', { class: 'empty', colspan: COLUMNS.length }, 'No packs match.')));
    const unpriced = rows.filter((r) => r.profit == null).length;
    info.textContent = `${rows.length.toLocaleString('en-US')} ${st.bestOnly ? 'packs (best destination each)' : 'pack × destination options'}${rows.length > shown.length ? ` · showing ${shown.length}` : ''}${unpriced ? ` · ${unpriced} without a full price` : ''}`;
    more.classList.toggle('hidden', rows.length <= shown.length);
  }

  const missingMats = new Set();
  for (const p of data.packs) for (const m of craftCost(p).missing) if (!m.startsWith('no recipe')) missingMats.add(m);
  mount(notices,
    notice('info', `Payouts are at ${data.payoutDemand}% demand and scale with the demand %. Gold rewards are paid directly; resource rewards are valued at the market price minus the ${settings().patron ? '5%' : '10%'} AH fee. Craft cost uses your price sheet. Click a row for the material breakdown.`),
    missingMats.size ? notice('warn', `Some materials are never traded, so packs that need them show "incomplete": ${[...missingMats].sort().join(', ')}. Give them a price under `, h('a', { href: '#/settings' }, 'Settings → Your prices'), '.') : null);

  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Trade Packs'),
        h('p', { class: 'sub' }, `${data.packs.length} packs, every destination, with craft cost, profit and silver per labor. Payout data: Ser Meatball's trade pack prices (snapshot ${data.snapshotTakenAt || ''}); routes and live demand: in-game export (${data.demandExportedOn || 'n/a'}).`)),
      h('div', { class: 'row' }, search, originSel, destSel, rewardSel,
        h('label', { class: 'check small' }, bestBox, 'Best destination only'))),
    notices,
    h('div', { class: 'card', style: { marginTop: '12px' } }, controlsBox),
    h('div', { class: 'card', style: { marginTop: '12px' } },
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, headRow), tbody)),
      h('div', { class: 'row spread', style: { marginTop: '10px' } }, info, more)));
  mount(controlsBox, settingsPanel());
  draw();
  search.focus();
  return undefined;
}


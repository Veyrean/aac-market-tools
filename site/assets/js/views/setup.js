import { h, mount, notice, field, select, debounce } from '../lib/dom.js';
import { loadMarket, loadRegrade, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt } from '../lib/format.js';
import * as setup from '../lib/setup.js';

const TABS = [
  ['proficiencies', 'Proficiencies'],
  ['land', 'Land'],
  ['tools', 'Tools & bonuses'],
  ['vehicles', 'Vehicles'],
];
const LAND_TYPES = ['Scarecrow Garden (8x8)', 'Scarecrow Farm (16x16)', 'Ranch', 'Aquafarm', 'Tradesman Manor', 'Thatched Farmhouse', 'House', 'Other'];
const DATALIST_ID = 'aacmt-item-names';

export async function render(root, params) {
  const tab = TABS.some(([k]) => k === params[0]) ? params[0] : 'proficiencies';
  const [market, { rules }] = await Promise.all([loadMarket(), loadRegrade()]);
  const priceInfo = priceResolver(market, rules, regradeItemNames(rules));
  const priceByName = (name) => {
    const row = market.byName.get(String(name || '').toLowerCase());
    return row ? priceInfo(row.id) : { copper: null, source: 'missing' };
  };

  const bar = h('div', { class: 'card setup-bar' });
  const body = h('div', { class: 'card' });
  const msg = h('div', { class: 'notices' });
  const datalist = h('datalist', { id: DATALIST_ID }, market.rows.map((r) => h('option', { value: r.name })));

  // ------------------------------------------------------------- setup manager
  function drawBar() {
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      if (f.size > 512 * 1024) { mount(msg, notice('bad', 'That file is too large to be a setup.')); return; }
      const rd = new FileReader();
      rd.onload = () => {
        try { const n = setup.importFile(String(rd.result)); mount(msg, notice('good', `Loaded "${n}". It is now your active setup.`)); redraw(); }
        catch (err) { mount(msg, notice('bad', err.message)); }
      };
      rd.readAsText(f);
    });
    const download = () => {
      const blob = new Blob([setup.exportActive()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aacmt-setup-${setup.activeName().replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const act = (fn) => () => { try { fn(); redraw(); } catch (err) { mount(msg, notice('bad', err.message)); } };
    mount(bar,
      h('div', { class: 'row spread' },
        h('div', { class: 'row' },
          h('span', { class: 'label' }, 'Active setup'),
          select(setup.names().map((n) => [n, n]), setup.activeName(), (v) => { setup.switchTo(v); redraw(); }, { 'aria-label': 'Active setup' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', on: { click: act(() => { const n = window.prompt('Name for the new setup:', 'New setup'); if (n) setup.create(n); }) } }, 'New'),
          h('button', { class: 'btn small', on: { click: act(() => setup.create(`${setup.activeName()} copy`, setup.activeName())) } }, 'Duplicate'),
          h('button', { class: 'btn small', on: { click: act(() => { const n = window.prompt('Rename setup to:', setup.activeName()); if (n) setup.rename(n); }) } }, 'Rename'),
          h('button', { class: 'btn small bad', on: { click: act(() => { if (window.confirm(`Delete the setup "${setup.activeName()}"?`)) setup.remove(setup.activeName()); }) } }, 'Delete'),
          h('button', { class: 'btn small good', on: { click: download } }, 'Download'),
          h('button', { class: 'btn small', on: { click: () => fileInput.click() } }, 'Load file'), fileInput)),
      h('nav', { class: 'subtabs', 'aria-label': 'Setup sections' },
        TABS.map(([k, label]) => h('a', { href: k === 'proficiencies' ? '#/setup' : `#/setup/${k}`, class: k === tab ? 'active' : '' }, label))));
  }

  // ------------------------------------------------------------- small inputs
  const numIn = (value, onValue, attrs = {}) => {
    const el = h('input', { type: 'number', value: value ?? '', inputmode: 'decimal', ...attrs });
    el.addEventListener('input', debounce(() => {
      const v = el.value === '' ? null : Number(el.value);
      if (v === null || Number.isFinite(v)) onValue(v);
    }, 200));
    return el;
  };
  const textIn = (value, onValue, attrs = {}) => {
    const el = h('input', { type: 'text', value: value ?? '', ...attrs });
    el.addEventListener('input', debounce(() => onValue(el.value), 250));
    return el;
  };

  // ------------------------------------------------------------- proficiencies
  function drawProficiencies() {
    const s = setup.active();
    const effect = new Map();
    const labor = numIn(s.laborSilver, (v) => setup.edit((d) => { d.laborSilver = v ?? 0; }), { min: 0, step: 1, 'aria-label': 'Labor value in silver' });
    const groups = Object.entries(setup.VOCATIONS).map(([group, list]) => h('div', { class: 'card inner' },
      h('h3', null, group),
      h('div', { class: 'tablewrap' }, h('table', { class: 'prof-table' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Proficiency'), h('th', { class: 'l' }, 'Rank'), h('th', null, 'Points'), h('th', null, 'Labor'), h('th', null, 'Time'))),
        h('tbody', null, list.map((v) => {
          const p = s.proficiencies[v];
          const cell = h('td'), tcell = h('td');
          effect.set(v, [cell, tcell]);
          return h('tr', null,
            h('td', { class: 'l' }, h('b', null, v)),
            h('td', { class: 'l' }, select(setup.RANKS.map((r) => [r.id, `${setup.rankIcon(r)} · ${r.name}`]), p.rank,
              (val) => { setup.edit((d) => { d.proficiencies[v].rank = Number(val); }); refresh(); }, { 'aria-label': `${v} rank` })),
            h('td', null, numIn(p.points, (val) => setup.edit((d) => { d.proficiencies[v].points = val; }), { min: 0, step: 1, class: 'mid', 'aria-label': `${v} points`, placeholder: 'pts' })),
            cell, tcell);
        }))))));
    function refresh() {
      for (const [v, [cell, tcell]] of effect) {
        const lf = setup.laborFactor(v), tf = setup.timeFactor(v);
        cell.textContent = lf < 1 ? `−${fmt((1 - lf) * 100, 0)}%` : '—';
        tcell.textContent = tf < 1 ? `−${fmt((1 - tf) * 100, 0)}%` : '—';
        cell.className = lf < 1 ? 'good' : 'dim';
        tcell.className = tf < 1 ? 'good' : 'dim';
      }
    }
    mount(body,
      h('h2', null, 'Proficiencies'),
      h('p', { class: 'sub' }, 'Your rank in each vocation, as in the in-game Proficiency window (the number on the rank icon: 1 Novice … 10 Celebrity, ★ Famed). The rank lowers the labor and production time of actions in that vocation (rank bonuses apply at max proficiency for each rank). "Labor" and "Time" show the total effect including your active tools.'),
      h('div', { class: 'form', style: { maxWidth: '520px', marginBottom: '12px' } },
        field('What is 1 labor worth to you? (silver)', labor),
        h('p', { class: 'small muted', style: { alignSelf: 'end' } }, 'Used as the cost of labor in the calculators. 0 = ignore labor.')),
      h('div', { class: 'grid3' }, groups),
      h('details', { class: 'small muted', style: { marginTop: '10px' } }, h('summary', null, 'Rank bonuses'),
        h('div', { class: 'tablewrap', style: { marginTop: '6px', maxWidth: '520px' } }, h('table', null,
          h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Rank'), h('th', null, 'Labor cost'), h('th', null, 'Production time'))),
          h('tbody', null, setup.RANKS.map((r) => h('tr', null, h('td', { class: 'l' }, `${setup.rankIcon(r)} · ${r.name}`), h('td', null, `−${r.labor}%`), h('td', null, `−${r.time}%`))))))));
    refresh();
  }

  // ------------------------------------------------------------- land
  function drawLand() {
    const s = setup.active();
    const cert = priceInfo(setup.TAX_CERTIFICATE_ID);
    const computed = [];
    const totalCell = h('td'), totalDay = h('td');
    const rowsEls = s.land.map((l) => {
      const per = h('td'), day = h('td'), slot = h('td');
      computed.push({ id: l.id, per, day, slot });
      const upd = (fn) => { setup.edit((d) => { const x = d.land.find((y) => y.id === l.id); if (x) fn(x); }); refresh(); };
      const typeIn = textIn(l.type, (v) => upd((x) => { x.type = v; }), { list: 'aacmt-land-types', class: 'wide', 'aria-label': 'Property type' });
      return h('tr', null,
        h('td', { class: 'l' }, textIn(l.name, (v) => upd((x) => { x.name = v; }), { class: 'wide', 'aria-label': 'Name' })),
        h('td', { class: 'l' }, typeIn),
        h('td', null, numIn(l.count, (v) => upd((x) => { x.count = v ?? 1; }), { min: 1, step: 1, class: 'narrow', 'aria-label': 'How many' })),
        h('td', null, numIn(l.slots, (v) => upd((x) => { x.slots = v; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Slots each' })),
        h('td', null, numIn(l.taxCerts, (v) => upd((x) => { x.taxCerts = v ?? 0; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Tax certificates per cycle' })),
        h('td', null, numIn(l.extraGold, (v) => upd((x) => { x.extraGold = v ?? 0; }), { min: 0, step: 0.01, class: 'narrow', 'aria-label': 'Extra gold per cycle' })),
        h('td', null, numIn(l.cycleDays, (v) => upd((x) => { x.cycleDays = v ?? 7; }), { min: 1, step: 1, class: 'narrow', 'aria-label': 'Cycle days' })),
        per, day, slot,
        h('td', null, h('button', { class: 'btn small bad', on: { click: () => { setup.edit((d) => { d.land = d.land.filter((y) => y.id !== l.id); }); drawLand(); } } }, '✕')));
    });
    function refresh() {
      const cur = setup.active();
      let total = 0, totalPerDay = 0;
      for (const c of computed) {
        const l = cur.land.find((y) => y.id === c.id);
        if (!l) continue;
        const certCost = cert.copper == null ? null : l.taxCerts * cert.copper;
        const perCycle = certCost == null && l.taxCerts > 0 ? null : ((certCost || 0) + l.extraGold * 10000) * l.count;
        c.per.textContent = money(perCycle);
        c.day.textContent = perCycle == null ? '—' : money(perCycle / l.cycleDays);
        c.slot.textContent = perCycle == null || !l.slots ? '—' : money(perCycle / l.cycleDays / (l.slots * l.count));
        if (perCycle != null) { total += perCycle * (7 / l.cycleDays); totalPerDay += perCycle / l.cycleDays; }
      }
      totalCell.textContent = money(total);
      totalDay.textContent = money(totalPerDay);
    }
    mount(body,
      h('h2', null, 'Owned land'),
      h('p', { class: 'sub' }, 'Your properties and what they cost. Taxes are paid in Tax Certificates; their gold value uses the market price', cert.copper != null ? ` (${money(cert.copper)} each, ${cert.source})` : '', '. Add any other upkeep in gold. The Pack Planner will charge production for the slot-days it uses.'),
      cert.copper == null ? notice('warn', 'No market price for Tax Certificates right now. Set one under Settings → Your prices.') : null,
      h('datalist', { id: 'aacmt-land-types' }, LAND_TYPES.map((t) => h('option', { value: t }))),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['Name', 'Type', 'How many', 'Slots each', 'Tax certs / cycle', 'Extra gold / cycle', 'Cycle (days)', 'Cost / cycle', 'Per day', 'Per slot / day', ''].map((t, i) => h('th', { class: i < 2 ? 'l' : '' }, t)))),
        h('tbody', null, rowsEls.length ? rowsEls : h('tr', null, h('td', { class: 'empty', colspan: 11 }, 'No land yet. Add your properties below.'))),
        rowsEls.length ? h('tfoot', null, h('tr', null, h('td', { class: 'l', colspan: 8 }, h('b', null, 'Total per week')), totalCell, h('td', { class: 'muted small' }, 'per day:'), totalDay)) : null)),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn primary', on: { click: () => { setup.edit((d) => { d.land.push({ id: setup.newId(), name: `Property ${d.land.length + 1}`, type: '', count: 1, slots: null, taxCerts: 0, extraGold: 0, cycleDays: 7 }); }); drawLand(); } } }, '+ Add property')));
    refresh();
  }

  // ------------------------------------------------------------- tools
  function drawTools() {
    const s = setup.active();
    const vocations = [['All', 'All vocations'], ...setup.ALL_VOCATIONS.map((v) => [v, v])];
    const rowsEls = s.tools.map((t) => {
      const upd = (fn) => setup.edit((d) => { const x = d.tools.find((y) => y.id === t.id); if (x) fn(x); });
      const activeBox = h('input', { type: 'checkbox', checked: t.active, 'aria-label': 'Active' });
      activeBox.addEventListener('change', () => upd((x) => { x.active = activeBox.checked; }));
      return h('tr', null,
        h('td', { class: 'c' }, activeBox),
        h('td', { class: 'l' }, textIn(t.name, (v) => upd((x) => { x.name = v; }), { class: 'wide', 'aria-label': 'Tool name' })),
        h('td', { class: 'l' }, select(vocations, t.appliesTo, (v) => upd((x) => { x.appliesTo = v; }), { 'aria-label': 'Applies to' })),
        h('td', null, numIn(t.outputPct, (v) => upd((x) => { x.outputPct = v ?? 0; }), { step: 1, class: 'narrow', 'aria-label': 'Output %' })),
        h('td', null, numIn(t.laborPct, (v) => upd((x) => { x.laborPct = v ?? 0; }), { step: 1, class: 'narrow', 'aria-label': 'Labor reduction %' })),
        h('td', null, numIn(t.timePct, (v) => upd((x) => { x.timePct = v ?? 0; }), { step: 1, class: 'narrow', 'aria-label': 'Time reduction %' })),
        h('td', { class: 'l' }, textIn(t.notes, (v) => upd((x) => { x.notes = v; }), { class: 'wide', 'aria-label': 'Notes' })),
        h('td', null, h('button', { class: 'btn small bad', on: { click: () => { setup.edit((d) => { d.tools = d.tools.filter((y) => y.id !== t.id); }); drawTools(); } } }, '✕')));
    });
    mount(body,
      h('h2', null, 'Tools & bonuses'),
      h('p', { class: 'sub' }, 'Gear, buffs and items that change how much you produce or how much labor and time it takes, e.g. a farming pitchfork that raises harvest output. Effects stack with your proficiency rank. Untick to switch one off without deleting it.'),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['On', 'Name', 'Applies to', 'Output +%', 'Labor −%', 'Time −%', 'Notes', ''].map((t, i) => h('th', { class: [1, 2, 6].includes(i) ? 'l' : '' }, t)))),
        h('tbody', null, rowsEls.length ? rowsEls : h('tr', null, h('td', { class: 'empty', colspan: 8 }, 'No tools yet.'))))),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn primary', on: { click: () => { setup.edit((d) => { d.tools.push({ id: setup.newId(), name: 'New tool', appliesTo: 'Farming', outputPct: 0, laborPct: 0, timePct: 0, active: true, notes: '' }); }); drawTools(); } } }, '+ Add tool or bonus')));
  }

  // ------------------------------------------------------------- vehicles
  function drawVehicles() {
    const s = setup.active();
    const costCells = [];
    const rowsEls = s.vehicles.map((v) => {
      const upd = (fn, redrawAll = false) => { setup.edit((d) => { const x = d.vehicles.find((y) => y.id === v.id); if (x) fn(x); }); redrawAll ? drawVehicles() : refresh(); };
      const cost = h('td');
      costCells.push({ id: v.id, cost });
      const consumables = h('div', { class: 'consumables' },
        v.consumables.map((c, i) => h('div', { class: 'row' },
          textIn(c.name, (val) => upd((x) => { x.consumables[i].name = val; }), { list: DATALIST_ID, class: 'wide', placeholder: 'Item, e.g. Eco-Friendly Fuel', 'aria-label': 'Consumable item' }),
          numIn(c.qty, (val) => upd((x) => { x.consumables[i].qty = val ?? 1; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Quantity' }),
          h('button', { class: 'btn small', title: 'Remove', on: { click: () => upd((x) => { x.consumables.splice(i, 1); }, true) } }, '✕'))),
        h('button', { class: 'btn small', on: { click: () => upd((x) => { x.consumables.push({ name: '', qty: 1 }); }, true) } }, '+ consumable'));
      return h('tr', null,
        h('td', { class: 'l' }, textIn(v.name, (val) => upd((x) => { x.name = val; }), { class: 'wide', 'aria-label': 'Vehicle name' })),
        h('td', null, numIn(v.capacity, (val) => upd((x) => { x.capacity = val ?? 1; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Packs per trip' })),
        h('td', null, numIn(v.tripMinutes, (val) => upd((x) => { x.tripMinutes = val; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Round trip minutes' })),
        h('td', { class: 'l' }, consumables),
        h('td', null, numIn(v.riskPct, (val) => upd((x) => { x.riskPct = val ?? 0; }), { min: 0, max: 100, step: 1, class: 'narrow', 'aria-label': 'Loss risk %' })),
        cost,
        h('td', null, h('button', { class: 'btn small bad', on: { click: () => { setup.edit((d) => { d.vehicles = d.vehicles.filter((y) => y.id !== v.id); }); drawVehicles(); } } }, '✕')));
    });
    function refresh() {
      const cur = setup.active();
      for (const c of costCells) {
        const v = cur.vehicles.find((y) => y.id === c.id);
        if (!v) continue;
        let total = 0, missing = [];
        for (const it of v.consumables) {
          if (!it.name) continue;
          const p = priceByName(it.name).copper;
          if (p == null) missing.push(it.name); else total += p * it.qty;
        }
        c.cost.textContent = missing.length ? `${money(total)} + ?` : money(total);
        c.cost.title = missing.length ? `No market price for: ${missing.join(', ')}` : 'Consumables per trip at market prices';
        c.cost.className = missing.length ? 'warn' : '';
      }
    }
    mount(body,
      h('h2', null, 'Vehicles'),
      h('p', { class: 'sub' }, 'How you move packs: capacity, round-trip time, everything used up per trip (fuel, repairs…) and the chance you lose the cargo (PvP, pirates). Consumables are priced from the market.'),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['Vehicle', 'Packs / trip', 'Round trip (min)', 'Consumables per trip', 'Loss risk %', 'Cost / trip', ''].map((t, i) => h('th', { class: i === 0 || i === 3 ? 'l' : '' }, t)))),
        h('tbody', null, rowsEls.length ? rowsEls : h('tr', null, h('td', { class: 'empty', colspan: 7 }, 'No vehicles yet.'))))),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn primary', on: { click: () => { setup.edit((d) => { d.vehicles.push({ id: setup.newId(), name: `Vehicle ${d.vehicles.length + 1}`, capacity: 1, tripMinutes: null, consumables: [], riskPct: 0 }); }); drawVehicles(); } } }, '+ Add vehicle')));
    refresh();
  }

  function redraw() {
    drawBar();
    ({ proficiencies: drawProficiencies, land: drawLand, tools: drawTools, vehicles: drawVehicles })[tab]();
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, 'My Setup'),
      h('p', { class: 'sub' }, 'Your proficiencies, land, tools and vehicles. Every calculator uses them. Saved only in this browser; download a setup to back it up, move it to another device or share it with your guild.'))),
    msg, bar, h('div', { style: { marginTop: '12px' } }, body), datalist);
  redraw();
}

import { h, mount, notice, field, select, debounce } from '../lib/dom.js';
import { loadMarket, loadRegrade, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt } from '../lib/format.js';
import * as setup from '../lib/setup.js';
import { landWeek } from '../lib/land.js';

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
  // Inputs save while typing (debounced) and immediately when the field is left, so a click on a
  // button right after typing (which redraws the section) never loses what was just typed.
  const numIn = (value, onValue, attrs = {}) => {
    const el = h('input', { type: 'number', value: value ?? '', inputmode: 'decimal', ...attrs });
    const commit = () => {
      const v = el.value === '' ? null : Number(el.value);
      if (v === null || Number.isFinite(v)) onValue(v);
    };
    el.addEventListener('input', debounce(commit, 200));
    el.addEventListener('change', commit);
    return el;
  };
  const textIn = (value, onValue, attrs = {}) => {
    const el = h('input', { type: 'text', value: value ?? '', ...attrs });
    el.addEventListener('input', debounce(() => onValue(el.value), 250));
    el.addEventListener('change', () => onValue(el.value));
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
    const ctx = {
      priceByName: (n) => priceByName(n).copper,
      certCopper: cert.copper,
      outputFactor: (v) => setup.outputFactor(v),
      laborFactor: (v) => setup.laborFactor(v),
    };
    const vocations = setup.ALL_VOCATIONS.map((v) => [v, v]);
    const totals = h('div', { class: 'kpis' });
    const refreshers = [];

    const updProp = (pid, fn) => setup.edit((d) => { const x = d.land.find((y) => y.id === pid); if (x) fn(x); });
    const updPl = (pid, plid, fn) => updProp(pid, (x) => { const p = x.plantings.find((y) => y.id === plid); if (p) fn(p); });

    function refreshTotals() {
      let cost = 0, value = 0, labor = 0, missing = new Set(), anyOut = false;
      for (const prop of setup.active().land) {
        const w = landWeek(prop, ctx);
        cost += w.cost; value += w.outputValue; labor += w.labor; anyOut ||= w.hasOutputs;
        w.missing.forEach((m) => missing.add(m));
      }
      const net = value - cost;
      mount(totals,
        kpiBox('Cost per week', money(cost), 'tax + upkeep + saplings & seeds', 'bad'),
        kpiBox('Output per week', anyOut ? money(value) : '—', anyOut ? 'market value' : 'add what your plantings produce', 'good'),
        kpiBox('Net per week', anyOut ? money(net, { signed: true }) : '—', labor ? `${fmt(labor, 0)} labor` : '', net >= 0 ? 'good' : 'bad'),
        kpiBox('s/l', anyOut && labor ? fmt(net / 100 / labor, 1) : '—', 'net silver per labor', 'blue'));
      if (missing.size) mount(missingBox, notice('warn', `No market price for: ${[...missing].sort().join(', ')}. They count as 0 until you set a price under `, h('a', { href: '#/settings' }, 'Settings → Your prices'), '.'));
      else mount(missingBox);
    }
    const missingBox = h('div');

    function propertyCard(prop) {
      const summary = h('div', { class: 'land-summary' });
      const refresh = () => {
        const cur = setup.active().land.find((y) => y.id === prop.id);
        if (!cur) return;
        const w = landWeek(cur, ctx);
        lineCells.forEach(({ plid, cost, out, labor }) => {
          const l = w.lines.find((x) => x.planting.id === plid);
          if (!l) return;
          cost.textContent = l.input == null ? (l.planting.item ? '?' : '—') : money(l.input);
          mount(out, l.outs.length ? l.outs.map((o) => h('div', { class: 'small' }, `${fmt(o.qty, o.qty < 100 ? 1 : 0)} × ${o.name}`, h('span', { class: 'muted' }, ` · ${o.value == null ? '?' : money(o.value)}`))) : h('span', { class: 'dim small' }, '—'));
          labor.textContent = l.labor ? fmt(l.labor, 0) : '—';
        });
        mount(summary,
          h('span', null, 'Tax ', h('b', null, w.tax == null ? '?' : money(w.tax))),
          h('span', null, ' · upkeep ', h('b', null, money(w.upkeep))),
          h('span', null, ' · saplings & seeds ', h('b', null, money(w.inputs))),
          h('span', null, ' · cost ', h('b', { class: 'bad' }, money(w.cost))),
          w.hasOutputs ? h('span', null, ' · output ', h('b', { class: 'good' }, money(w.outputValue)), ' · net ', h('b', { class: w.net >= 0 ? 'good' : 'bad' }, money(w.net, { signed: true })), w.spl != null ? ` · ${fmt(w.spl, 1)} s/l` : '') : null,
          h('span', { class: 'muted' }, ' per week'));
        refreshTotals();
      };
      refreshers.push(refresh);
      const lineCells = [];
      const rowsEls = prop.plantings.map((pl) => {
        const cost = h('td'), out = h('td', { class: 'l' }), labor = h('td');
        lineCells.push({ plid: pl.id, cost, out, labor });
        const u = (fn, redraw = false) => { updPl(prop.id, pl.id, fn); redraw ? drawLand() : refresh(); };
        const outputs = h('div', { class: 'consumables' },
          pl.outputs.map((o, i) => h('div', { class: 'row' },
            textIn(o.name, (v) => u((x) => { x.outputs[i].name = v; }), { list: DATALIST_ID, class: 'wide', placeholder: 'e.g. Lumber', 'aria-label': 'Produces item' }),
            numIn(o.qty, (v) => u((x) => { x.outputs[i].qty = v ?? 0; }), { min: 0, step: 0.1, class: 'narrow', 'aria-label': 'Average per plant per harvest', title: 'Average per plant per harvest' }),
            h('button', { class: 'btn small', title: 'Remove', on: { click: () => u((x) => { x.outputs.splice(i, 1); }, true) } }, '✕'))),
          h('button', { class: 'btn small', on: { click: () => u((x) => { x.outputs.push({ name: '', qty: 1 }); }, true) } }, '+ produces'));
        return h('tr', null,
          h('td', { class: 'l' }, textIn(pl.item, (v) => u((x) => { x.item = v; }), { list: DATALIST_ID, class: 'wide', placeholder: 'e.g. Cedar Sapling', 'aria-label': 'Planted item' })),
          h('td', null, numIn(pl.qty, (v) => u((x) => { x.qty = v ?? 0; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Quantity' })),
          h('td', null, numIn(pl.cyclesPerWeek, (v) => u((x) => { x.cyclesPerWeek = v ?? 0; }), { min: 0, step: 0.5, class: 'narrow', 'aria-label': 'Cycles per week', title: 'How many times per week you plant and harvest this' })),
          cost,
          h('td', { class: 'l' }, select(vocations, pl.vocation, (v) => u((x) => { x.vocation = v; }), { 'aria-label': 'Vocation' })),
          h('td', null, numIn(pl.laborEach, (v) => u((x) => { x.laborEach = v ?? 0; }), { min: 0, step: 1, class: 'narrow', 'aria-label': 'Labor per harvest each', title: 'Labor to harvest one plant or animal once (before your rank)' })),
          labor,
          h('td', { class: 'l' }, outputs),
          out,
          h('td', null, h('button', { class: 'btn small bad', title: 'Remove planting', on: { click: () => { updProp(prop.id, (x) => { x.plantings = x.plantings.filter((y) => y.id !== pl.id); }); drawLand(); } } }, '✕')));
      });
      const card = h('div', { class: 'card inner land-card' },
        h('div', { class: 'land-head' },
          field('Property', textIn(prop.name, (v) => { updProp(prop.id, (x) => { x.name = v; }); }, { 'aria-label': 'Property name' })),
          field('Type', textIn(prop.type, (v) => { updProp(prop.id, (x) => { x.type = v; }); }, { list: 'aacmt-land-types', 'aria-label': 'Property type' })),
          field('Tax certificates / week', numIn(prop.taxCerts, (v) => { updProp(prop.id, (x) => { x.taxCerts = v ?? 0; }); refresh(); }, { min: 0, step: 1, 'aria-label': 'Tax certificates per week' })),
          field('Other upkeep (gold / week)', numIn(prop.extraGold, (v) => { updProp(prop.id, (x) => { x.extraGold = v ?? 0; }); refresh(); }, { min: 0, step: 0.01, 'aria-label': 'Other upkeep gold per week' })),
          h('div', { class: 'row land-actions' },
            h('button', { class: 'btn small', on: { click: () => { setup.edit((d) => { const src = d.land.find((y) => y.id === prop.id); if (src) d.land.push({ ...JSON.parse(JSON.stringify(src)), id: setup.newId(), name: `${src.name} (copy)`, plantings: src.plantings.map((p) => ({ ...p, id: setup.newId() })) }); }); drawLand(); } } }, 'Duplicate'),
            h('button', { class: 'btn small bad', on: { click: () => { if (window.confirm(`Delete "${prop.name}"?`)) { setup.edit((d) => { d.land = d.land.filter((y) => y.id !== prop.id); }); drawLand(); } } } }, 'Delete'))),
        h('div', { class: 'tablewrap' }, h('table', null,
          h('thead', null, h('tr', null, ...['Planted / raised', 'Qty', 'Cycles / week', 'Cost / week', 'Vocation', 'Labor each', 'Labor / week', 'Produces (avg per plant per harvest)', 'Output / week', ''].map((t, i) => h('th', { class: [0, 4, 7, 8].includes(i) ? 'l' : '' }, t)))),
          h('tbody', null, rowsEls.length ? rowsEls : h('tr', null, h('td', { class: 'empty', colspan: 10 }, 'Nothing planted yet.'))))),
        h('div', { class: 'row spread', style: { marginTop: '8px' } },
          h('button', { class: 'btn', on: { click: () => { updProp(prop.id, (x) => { x.plantings.push({ id: setup.newId(), item: '', qty: 1, cyclesPerWeek: 1, vocation: 'Farming', laborEach: 0, outputs: [] }); }); drawLand(); } } }, '+ Add planting'),
          summary));
      return card;
    }

    const cards = s.land.map(propertyCard);
    mount(body,
      h('h2', null, 'Owned land'),
      h('p', { class: 'sub' }, 'Each property with what you put on it. One week is one tax cycle. Taxes are paid in Tax Certificates, priced at the market', cert.copper != null ? ` (${money(cert.copper)} each)` : '', '. The planted item (sapling, seed, animal…) is bought each cycle at market price. Add what a planting produces to see output and net per week; tool bonuses for its vocation are applied.'),
      h('datalist', { id: 'aacmt-land-types' }, LAND_TYPES.map((t) => h('option', { value: t }))),
      missingBox,
      s.land.length ? totals : null,
      h('div', { class: 'stack', style: { marginTop: '12px' } }, cards.length ? cards : h('p', { class: 'empty' }, 'No land yet. Add your first property below.')),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn primary', on: { click: () => { setup.edit((d) => { d.land.push({ id: setup.newId(), name: `Property ${d.land.length + 1}`, type: '', taxCerts: 0, extraGold: 0, notes: '', plantings: [] }); }); drawLand(); } } }, '+ Add property')));
    refreshers.forEach((r) => r());
    refreshTotals();
  }

  function kpiBox(label, value, hint, kind) {
    return h('div', { class: `kpi ${kind || ''}` }, h('div', { class: 'k-label' }, label), h('div', { class: 'k-val' }, value), hint ? h('div', { class: 'k-hint' }, hint) : null);
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

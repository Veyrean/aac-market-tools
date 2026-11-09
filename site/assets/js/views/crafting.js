// Crafting: craft-or-buy trees for one item, and a list of every recipe worth crafting to sell.
import { h, mount, debounce, select, notice, field, kpi } from '../lib/dom.js';
import { loadMarket, loadRegrade, loadCrafts, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt, count } from '../lib/format.js';
import { get as settings, update } from '../lib/store.js';
import * as setup from '../lib/setup.js';
import { makeCraftCalc, COIN_ID, CATEGORY_VOCATION } from '../lib/craft.js';

const CRAFT_VOCATIONS = [...setup.VOCATIONS.Crafting, 'Construction', 'Commerce', 'Artistry', ...setup.VOCATIONS.Harvesting];
const DATALIST_ID = 'aacmt-craftables';
const qtyText = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? fmt(Math.round(n), 0) : fmt(n, n < 10 ? 2 : 1));
const OPP_COLUMNS = [
  { key: 'name', label: 'Item', cls: 'l', get: (r) => r.name.toLowerCase() },
  { key: 'cat', label: 'Category', cls: 'l hide-sm', get: (r) => r.cat },
  { key: 'sell', label: 'Sells for', get: (r) => r.sell },
  { key: 'cost', label: 'Materials', get: (r) => r.mats },
  { key: 'labor', label: 'Labor', cls: 'hide-sm', get: (r) => r.labor },
  { key: 'profit', label: 'Profit', get: (r) => r.profit },
  { key: 'spl', label: 's/l', get: (r) => r.spl },
  { key: 'vol', label: 'Sold / day', cls: 'hide-sm', get: (r) => r.vol },
];

export async function render(root, params) {
  const [market, { rules }, crafts] = await Promise.all([loadMarket(), loadRegrade(), loadCrafts()]);
  const priceInfo = priceResolver(market, rules, regradeItemNames(rules));
  const itemParam = params[0] === 'item' ? Number(params[1]) : null;
  const tab = itemParam ? 'item' : 'list';

  function calc() {
    const c = settings().crafting;
    return makeCraftCalc({
      recipes: crafts.recipes,
      buyPrice: (id) => priceInfo(id).copper,
      laborFactor: (v) => (v ? setup.laborFactor(v) : 1),
      laborCopper: (setup.active().laborSilver || 0) * 100,
      vocationOf: (r) => c.vocation[String(r.id)] ?? null,
      choiceOf: (id) => c.choice[String(id)] || 'auto',
      recipeOf: (id) => c.recipe[String(id)] ?? null,
    });
  }
  const feeRate = () => (settings().patron ? 0.05 : 0.10);
  const marketRow = (id) => market.byId.get(id);
  const sellPrice = (id) => { const p = priceInfo(id).copper; return p == null ? null : p * (1 - feeRate()); };

  // every craftable item, traded ones first, for the search box
  const c0 = calc();
  const craftable = c0.craftable().map((id) => ({ id, name: c0.nameOf(id) || String(id), traded: !!marketRow(id) }))
    .sort((a, b) => (b.traded - a.traded) || a.name.localeCompare(b.name));
  const byName = new Map(craftable.map((x) => [x.name.toLowerCase(), x.id]));
  const datalist = h('datalist', { id: DATALIST_ID }, craftable.map((x) => h('option', { value: x.name })));

  const laborNote = () => {
    const ls = setup.active().laborSilver || 0;
    return ls ? `Labor is counted at ${fmt(ls, 1)} silver each (My Setup).` : 'Labor is free in these numbers: set what 1 labor is worth to you in My Setup to weigh crafting against buying.';
  };

  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Crafting'),
        h('p', { class: 'sub' }, `${count(crafts.recipes.length)} recipes from the game's craft data (snapshot ${crafts.snapshotTakenAt || ''}). Every material is bought or crafted, whichever is cheaper at today's prices; crafting labor is reduced by your proficiency ranks.`))),
    h('nav', { class: 'subtabs top', 'aria-label': 'Crafting views' },
      h('a', { href: '#/crafting', class: tab === 'list' ? 'active' : '' }, 'What to craft'),
      h('a', { href: itemParam ? `#/crafting/item/${itemParam}` : '#/crafting/item', class: tab === 'item' ? 'active' : '' }, 'Craft or buy')),
    tab === 'item' || params[0] === 'item' ? itemView() : listView(),
    datalist);
  return undefined;

  // ================================================================ one item: the tree
  function itemView() {
    const box = h('div');
    const search = h('input', { type: 'search', list: DATALIST_ID, placeholder: 'Item to craft, e.g. Lumber', 'aria-label': 'Item to craft', value: itemParam ? c0.nameOf(itemParam) || '' : '' });
    search.addEventListener('change', () => { const id = byName.get(search.value.trim().toLowerCase()); if (id) location.hash = `#/crafting/item/${id}`; });
    const qtyIn = h('input', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric', 'aria-label': 'How many to make' });
    qtyIn.addEventListener('input', debounce(() => draw(), 250));
    const open = new Set();

    function draw() {
      if (!itemParam || !c0.recipesOf(itemParam).length) {
        mount(box, h('p', { class: 'empty' }, itemParam ? 'No recipe found for this item.' : 'Pick an item to see its craft-or-buy tree.'));
        return;
      }
      const c = calc(), qty = Math.max(1, Number(qtyIn.value) || 1);
      const top = c.best(itemParam), craft = top.craft;
      // the tree of the item itself is always "craft"; materials follow their own choice
      const t = c.tree(itemParam, qty, 0, new Set(), true); // the item itself is crafted; materials follow their own choice
      const list = c.shoppingList(t), byVoc = c.laborByVocation(t);
      const mats = list.reduce((a, x) => a + (x.total || 0), 0);
      const missing = list.filter((x) => x.total == null).map((x) => x.name);
      const labor = byVoc.reduce((a, x) => a + x.labor, 0);
      const laborCost = labor * (setup.active().laborSilver || 0) * 100;
      const sell = sellPrice(itemParam), buy = priceInfo(itemParam).copper;
      const revenue = sell == null ? null : sell * qty;
      const profit = revenue == null || missing.length ? null : revenue - mats;
      mount(box,
        h('div', { class: 'kpis' },
          kpi('Materials', missing.length ? `${money(mats)} + ?` : money(mats), `for ${fmt(qty, 0)} × ${t.name}`, 'bad'),
          kpi('Labor', fmt(labor, 0), laborCost ? `worth ${money(laborCost)}` : 'after your ranks', 'blue'),
          kpi('Sells for', revenue == null ? '—' : money(revenue), buy == null ? 'not traded' : `${money(buy)} each, minus ${fmt(feeRate() * 100, 0)}% fee`, 'good'),
          kpi('Profit', profit == null ? '—' : money(profit - laborCost, { signed: true }), profit == null ? '' : `${labor ? `${fmt((profit / 100) / labor, 1)} s/l · ` : ''}${laborCost ? 'after labor value' : 'labor not priced'}`, profit != null && profit - laborCost >= 0 ? 'good' : 'bad')),
        top.decision === 'buy' && craft?.unit != null ? notice('info', `Buying ${t.name} (${money(top.buyPrice)}) is cheaper than crafting it (${money(craft.unit)} each, incl. labor value). The tree shows how crafting would go.`) : null,
        missing.length ? notice('warn', `No price for: ${missing.join(', ')}. Give them a price under `, h('a', { href: '#/settings' }, 'Settings → Your prices'), ' or craft them.') : null,
        h('div', { class: 'grid2 craft-grid', style: { marginTop: '12px', alignItems: 'start' } },
          h('div', { class: 'card inner' }, h('h3', null, 'Tree'), h('p', { class: 'small muted' }, 'Choose Buy or Craft per material (Auto = cheapest). ', laborNote()),
            h('div', { class: 'tablewrap' }, h('table', { class: 'craft-tree' },
              h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Qty'), h('th', { class: 'l' }, 'Get by'), h('th', null, 'Buy each'), h('th', null, 'Craft each'), h('th', null, 'Total'), h('th', null, 'Labor'))),
              h('tbody', null, rows(t, 0, true))))),
          h('div', null,
            h('div', { class: 'card inner' }, h('h3', null, 'Shopping list'),
              h('div', { class: 'tablewrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Qty'), h('th', null, 'Each'), h('th', null, 'Total'))),
                h('tbody', null, list.map((x) => h('tr', null,
                  h('td', { class: 'l' }, x.id === COIN_ID ? 'Coins' : h('a', { href: `#/item/${x.id}` }, x.name)),
                  h('td', null, x.id === COIN_ID ? '—' : qtyText(x.qty)),
                  h('td', { class: x.unit == null ? 'warn' : '' }, x.id === COIN_ID ? '—' : x.unit == null ? 'no price' : money(x.unit)),
                  h('td', null, x.total == null ? '—' : money(x.total)))))))),
            h('div', { class: 'card inner', style: { marginTop: '12px' } }, h('h3', null, 'Labor by vocation'),
              byVoc.length ? h('table', null, h('tbody', null, byVoc.map((x) => h('tr', null,
                h('td', { class: 'l' }, x.vocation, h('span', { class: 'muted small' }, x.vocation !== 'Unknown' ? ` · ${setup.rankOf(x.vocation).name}` : ' · no rank applied')),
                h('td', null, fmt(x.labor, 0)))))) : h('p', { class: 'muted small' }, 'Nothing is crafted.')))));
    }

    /** Tree rows, indented; nodes deeper than level 1 start folded. */
    function rows(n, depth, isRoot = false, path = '') {
      const key = `${path}/${n.id}`;
      const expanded = isRoot || depth < 1 || open.has(key);
      const hasKids = n.children.length > 0;
      const st = settings().crafting;
      const choice = st.choice[String(n.id)] || 'auto';
      const getBy = isRoot ? h('span', { class: 'muted' }, 'Craft') : n.id === COIN_ID ? h('span', { class: 'muted' }, '—')
        : n.recipes.length ? select([['auto', `Auto (${n.decision === 'craft' ? 'craft' : 'buy'})`], ['buy', 'Buy'], ['craft', 'Craft']], choice,
          (v) => { update((s) => { if (v === 'auto') delete s.crafting.choice[String(n.id)]; else s.crafting.choice[String(n.id)] = v; }); draw(); }, { 'aria-label': `How to get ${n.name}` })
          : h('span', { class: 'muted' }, 'Buy');
      const vocSel = n.recipe ? select(CRAFT_VOCATIONS.map((v) => [v, v]), n.vocation || '', (v) => {
        update((s) => { s.crafting.vocation[String(n.recipe.id)] = v; }); draw();
      }, { 'aria-label': `Vocation for ${n.name}`, title: CATEGORY_VOCATION[n.recipe.category] ? `Suggested from its category (${n.recipe.category})` : 'Choose the vocation that crafts this' }) : null;
      if (vocSel && !n.vocation) vocSel.prepend(h('option', { value: '', selected: true }, '— choose —'));
      const recipeSel = n.recipe && n.recipes.length > 1 ? select(n.recipes.map((r) => [r.id, `Recipe ${n.recipes.indexOf(r) + 1}: ${r.materials.map((m) => `${m.qty} ${m.name}`).join(', ')}`]), n.recipe.id,
        (v) => { update((s) => { s.crafting.recipe[String(n.id)] = Number(v); }); draw(); }, { 'aria-label': `Recipe for ${n.name}`, class: 'recipe-pick' }) : null;
      const label = n.id === COIN_ID ? 'Coins (fee)' : h('a', { href: `#/item/${n.id}` }, n.name);
      const toggle = hasKids && !isRoot && depth >= 1 ? h('button', { type: 'button', class: 'btn small tree-toggle', 'aria-expanded': String(expanded), title: expanded ? 'Fold' : 'Unfold',
        on: { click: () => { expanded ? open.delete(key) : open.add(key); draw(); } } }, expanded ? '−' : '+') : null;
      const row = h('tr', { class: isRoot ? 'tree-root' : '' },
        h('td', { class: 'l', style: { paddingLeft: `${8 + depth * 18}px` } }, toggle, label,
          recipeSel ? h('div', null, recipeSel) : null, vocSel ? h('div', { class: 'voc-pick' }, vocSel) : null),
        h('td', null, n.id === COIN_ID ? money(n.qty) : qtyText(n.qty)),
        h('td', { class: 'l' }, getBy),
        h('td', { class: n.buyPrice == null ? 'dim' : '' }, n.id === COIN_ID ? '—' : n.buyPrice == null ? '—' : money(n.buyPrice)),
        h('td', { class: n.craftUnit == null ? 'dim' : '' }, n.craftUnit == null ? '—' : money(n.craftUnit)),
        h('td', { class: n.total == null ? 'warn' : '' }, n.total == null ? 'no price' : money(n.total)),
        h('td', null, n.ownLabor ? fmt(n.ownLabor, 0) : '—'));
      const out = [row];
      if (expanded) n.children.forEach((ch) => out.push(...rows(ch, depth + 1, false, key)));
      return out;
    }

    draw();
    return h('div', null,
      h('div', { class: 'card' }, h('div', { class: 'form' }, field('Item', search), field('How many', qtyIn))),
      h('div', { class: 'card', style: { marginTop: '12px' } }, box));
  }

  // ================================================================ every recipe worth crafting
  function listView() {
    const st = { q: '', cat: '', profitable: true, sort: 'spl', dir: -1, limit: 150 };
    const tbody = h('tbody'), headRow = h('tr'), info = h('span', { class: 'small muted' });
    const more = h('button', { class: 'btn', on: { click: () => { st.limit += 150; draw(); } } }, 'Show more');
    const search = h('input', { type: 'search', placeholder: 'Search items…', 'aria-label': 'Search items' });
    search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); st.limit = 150; draw(); }, 200));
    const vol = h('input', { type: 'number', min: 0, step: 1, value: settings().crafting.minVolume, inputmode: 'numeric', 'aria-label': 'Minimum sold per day' });
    vol.addEventListener('input', debounce(() => { const v = Number(vol.value); if (Number.isFinite(v) && v >= 0) { update((s) => { s.crafting.minVolume = v; }); draw(); } }, 300));
    const profBox = h('input', { type: 'checkbox', checked: st.profitable });
    profBox.addEventListener('change', () => { st.profitable = profBox.checked; draw(); });

    let all = [];
    function compute() {
      const c = calc(), laborCopper = (setup.active().laborSilver || 0) * 100;
      all = [];
      for (const id of c.craftable()) {
        const row = marketRow(id);
        if (!row) continue;
        const b = c.best(id), craft = b.craft;
        if (!craft || craft.mats == null) continue;
        const sell = sellPrice(id);
        if (sell == null) continue;
        const profit = sell - craft.mats - craft.labor * laborCopper;
        all.push({ id, name: row.name, cat: row.catLabel, sell, mats: craft.mats, labor: craft.labor, profit,
          spl: craft.labor > 0 ? (sell - craft.mats) / 100 / craft.labor : null, vol: row.vol7 != null ? row.vol7 / 7 : null });
      }
    }
    const cats = () => [...new Set(all.map((r) => r.cat))].sort();
    const catSel = h('select', { 'aria-label': 'Category' });
    catSel.addEventListener('change', () => { st.cat = catSel.value; draw(); });

    function draw() {
      mount(headRow, OPP_COLUMNS.map((col) => h('th', {
        class: `${col.cls || ''} sortable ${st.sort === col.key ? 'sorted' : ''}`, scope: 'col', tabindex: 0,
        'aria-sort': st.sort === col.key ? (st.dir > 0 ? 'ascending' : 'descending') : 'none',
        on: { click: () => sortBy(col.key), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(col.key); } } },
      }, col.label, st.sort === col.key ? (st.dir > 0 ? ' ▲' : ' ▼') : '')));
      const minVol = settings().crafting.minVolume;
      let rows = all.filter((r) => (!st.q || r.name.toLowerCase().includes(st.q)) && (!st.cat || r.cat === st.cat)
        && (!st.profitable || r.profit > 0) && (r.vol ?? 0) >= minVol);
      const col = OPP_COLUMNS.find((x) => x.key === st.sort);
      rows.sort((a, b) => { const x = col.get(a), y = col.get(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * st.dir; });
      const shown = rows.slice(0, st.limit);
      mount(tbody, shown.length ? shown.map((r) => h('tr', { class: 'clickable', title: 'Open its craft-or-buy tree', on: { click: () => { location.hash = `#/crafting/item/${r.id}`; } } },
        h('td', { class: 'l' }, h('b', null, r.name)),
        h('td', { class: 'l hide-sm muted' }, r.cat),
        h('td', null, money(r.sell)),
        h('td', null, money(r.mats)),
        h('td', { class: 'hide-sm' }, fmt(r.labor, 0)),
        h('td', { class: r.profit >= 0 ? 'good' : 'bad' }, money(r.profit, { signed: true })),
        h('td', { class: r.spl == null ? 'dim' : r.spl >= 0 ? 'good' : 'bad' }, r.spl == null ? '—' : fmt(r.spl, 1)),
        h('td', { class: 'hide-sm' }, r.vol == null ? '—' : fmt(r.vol, r.vol < 10 ? 1 : 0))))
        : h('tr', null, h('td', { class: 'empty', colspan: OPP_COLUMNS.length }, 'Nothing matches.')));
      info.textContent = `${rows.length.toLocaleString('en-US')} recipes${rows.length > shown.length ? ` · showing ${shown.length}` : ''}`;
      more.classList.toggle('hidden', rows.length <= shown.length);
    }
    function sortBy(key) { if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = ['name', 'cat'].includes(key) ? 1 : -1; } draw(); }

    compute();
    mount(catSel, h('option', { value: '' }, 'All categories'), cats().map((c) => h('option', { value: c }, c)));
    draw();
    return h('div', null,
      notice('info', `Profit = sale price minus the ${fmt(feeRate() * 100, 0)}% AH fee, minus materials (each bought or crafted, whichever is cheaper)${(setup.active().laborSilver || 0) ? ', minus labor at your labor value' : ''}. s/l = silver earned per labor before labor value. Click a recipe for its tree and shopping list. `, laborNote()),
      h('div', { class: 'filters' }, search, catSel, field('Min. sold / day', vol), h('label', { class: 'check small' }, profBox, 'Profitable only')),
      h('div', { class: 'card', style: { marginTop: '12px' } },
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, headRow), tbody)),
        h('div', { class: 'row spread', style: { marginTop: '10px' } }, info, more)));
  }
}


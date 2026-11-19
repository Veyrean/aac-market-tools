// Crafting: every recipe worth crafting to sell, a craft-or-buy tree per item, and a multi-item craft plan.
import { h, mount, debounce, select, notice, field, kpi } from '../lib/dom.js';
import { loadMarket, loadRegrade, loadCrafts, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt, count } from '../lib/format.js';
import { get as settings, update } from '../lib/store.js';
import * as setup from '../lib/setup.js';
import { itemIcon } from '../lib/icons.js';
import { makeCraftCalc, COIN_ID, CATEGORY_VOCATION, isGear, isMainRecipe } from '../lib/craft.js';
import { levelingRows, isNamedRecipe } from '../lib/leveling.js';

const CRAFT_VOCATIONS = [...setup.VOCATIONS.Crafting, 'Construction', 'Commerce', 'Artistry', ...setup.VOCATIONS.Harvesting];
const DATALIST_ID = 'aacmt-craftables';
const THIN_TEXT = 'Hardly sold on the AH: less than one craft\'s worth a day (see "Buy materials selling"), so it is crafted when it can be, or has no price. Choose Buy to buy it anyway, or give it your own price.';
const qtyText = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? fmt(Math.round(n), 0) : fmt(n, n < 10 ? 2 : 1));
const OPP_COLUMNS = [
  { key: 'name', label: 'Item', cls: 'l', get: (r) => r.name.toLowerCase() },
  { key: 'cat', label: 'Category', cls: 'l hide-sm', get: (r) => r.cat },
  { key: 'sell', label: 'Sells for', get: (r) => r.sell },
  { key: 'cost', label: 'Materials', get: (r) => r.mats },
  { key: 'labor', label: 'Labor', cls: 'hide-sm', get: (r) => r.labor },
  { key: 'total', label: 'Total cost', cls: 'hide-sm', get: (r) => r.total },
  { key: 'profit', label: 'Profit', get: (r) => r.profit },
  { key: 'spl', label: 's/l', get: (r) => r.spl },
  { key: 'vol', label: 'Sold / day', cls: 'hide-sm', get: (r) => r.vol },
];

export async function render(root, params) {
  const [market, { rules, items: regradeItems }, crafts] = await Promise.all([loadMarket(), loadRegrade(), loadCrafts()]);
  // everything in the regrade data is regradable gear, whatever its category (propellants, pet gear…)
  const regradable = new Set(regradeItems.map((x) => x.id));
  const priceInfo = priceResolver(market, rules, regradeItemNames(rules));
  const tab = ['item', 'plan', 'level'].includes(params[0]) ? params[0] : 'list';
  const itemParam = tab === 'item' && Number(params[1]) > 0 ? Number(params[1]) : null;

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
      perDay: (id) => priceInfo(id).perDay ?? null,
      minCrafts: c.minBuyCrafts,
    });
  }
  const feeRate = () => (settings().patron ? 0.05 : 0.10);
  const marketRow = (id) => market.byId.get(id);
  const c0 = calc();
  // regradable gear: the market price mixes all grades, so it only counts with the player's own sell price
  const gearHidden = (id) => (isGear(c0.categoryOf(id)) || regradable.has(id)) && priceInfo(id).source !== 'your price';
  const sellPrice = (id) => {
    if (gearHidden(id)) return null;
    const p = priceInfo(id).copper;
    return p == null ? null : p * (1 - feeRate());
  };

  /** Why an item has no sale price: 'gear' (price depends on grade) or 'untraded'; null when it has one. */
  const noSaleReason = (id) => (gearHidden(id) ? 'gear' : sellPrice(id) == null ? 'untraded' : null);
  const NO_SALE_TEXT = { gear: 'gear: its price depends on the grade', untraded: 'not traded on the Auction House' };

  // every craftable item, traded ones first, for the search boxes
  // some items share a name (different game items, e.g. two "Cloaked Brimstone Axe"): those get their item number
  const nameCount = new Map();
  for (const id of c0.craftable()) { const n = c0.nameOf(id) || String(id); nameCount.set(n, (nameCount.get(n) || 0) + 1); }
  const label = (id) => { const n = c0.nameOf(id) || String(id); return nameCount.get(n) > 1 ? `${n} (#${id})` : n; };
  const craftable = c0.craftable().map((id) => ({ id, name: label(id), traded: !!marketRow(id) }))
    .sort((a, b) => (b.traded - a.traded) || a.name.localeCompare(b.name));
  const byName = new Map(craftable.map((x) => [x.name.toLowerCase(), x.id]));
  const datalist = h('datalist', { id: DATALIST_ID }, craftable.map((x) => h('option', { value: x.name })));

  /** "Buy materials selling ≥ N crafts a day": cheap materials that hardly sell are not bought. */
  function minBuyField(redraw) {
    const el = h('input', { type: 'number', min: 0, step: 1, value: settings().crafting.minBuyCrafts, inputmode: 'numeric', class: 'narrow',
      'aria-label': 'Buy a material only when the AH sells this many crafts worth a day',
      title: 'A material is bought only when the AH sells at least this many crafts\' worth of it a day (last 7 days); otherwise it is crafted, or has no price. 0 = always buy. Your own prices and materials set to Buy are not limited.' });
    el.addEventListener('input', debounce(() => { const v = Number(el.value); if (Number.isFinite(v) && v >= 0 && v <= 1000) { update((s) => { s.crafting.minBuyCrafts = v; }); redraw(); } }, 300));
    return field('Buy materials selling ≥ crafts/day', el);
  }

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
      h('a', { href: itemParam ? `#/crafting/item/${itemParam}` : '#/crafting/item', class: tab === 'item' ? 'active' : '' }, 'Craft or buy'),
      h('a', { href: '#/crafting/plan', class: tab === 'plan' ? 'active' : '' }, `Plan${settings().crafting.plan.length ? ` (${settings().crafting.plan.length})` : ''}`),
      h('a', { href: '#/crafting/level', class: tab === 'level' ? 'active' : '' }, 'Level up')),
    tab === 'item' ? itemView() : tab === 'plan' ? planView() : tab === 'level' ? levelView() : listView(),
    datalist);
  return undefined;

  // ================================================================ one item: the tree
  function itemView() {
    const box = h('div');
    const search = h('input', { type: 'search', list: DATALIST_ID, placeholder: 'Item to craft, e.g. Lumber', 'aria-label': 'Item to craft', value: itemParam ? label(itemParam) : '' });
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
      const missing = list.filter((x) => x.total == null).map((x) => (x.thin ? `${x.name} (rarely sold)` : x.name));
      const labor = byVoc.reduce((a, x) => a + x.labor, 0);
      const laborCost = labor * (setup.active().laborSilver || 0) * 100;
      const sell = sellPrice(itemParam), buy = priceInfo(itemParam).copper;
      const revenue = sell == null ? null : sell * qty;
      const profit = revenue == null || missing.length ? null : revenue - mats;
      const reason = noSaleReason(itemParam);
      const total = missing.length ? null : mats + laborCost;
      mount(box,
        h('div', { class: 'kpis' },
          kpi('Materials', missing.length ? `${money(mats)} + ?` : money(mats), `for ${fmt(qty, 0)} × ${t.name}`, 'bad'),
          kpi('Labor', fmt(labor, 0), laborCost ? `worth ${money(laborCost)}` : 'after your ranks', 'blue'),
          reason
            ? kpi('Total cost', total == null ? `${money(mats + laborCost)} + ?` : money(total), laborCost ? 'materials + labor value' : 'materials (labor not priced)', 'bad')
            : kpi('Sells for', revenue == null ? '—' : money(revenue), `${money(buy)} each, minus ${fmt(feeRate() * 100, 0)}% fee`, 'good'),
          reason
            ? kpi('Cost per item', total == null ? '—' : money(total / qty), NO_SALE_TEXT[reason], 'blue')
            : kpi('Profit', profit == null ? '—' : money(profit - laborCost, { signed: true }), profit == null ? '' : `${labor ? `${fmt((profit / 100) / labor, 1)} s/l · ` : ''}${laborCost ? 'after labor value' : 'labor not priced'}`, profit != null && profit - laborCost >= 0 ? 'good' : 'bad')),
        reason === 'gear' ? notice('info', 'Regradable gear: the market price mixes every grade (one Epic sale lifts the price of a fresh Basic item), so only the cost is shown. Set your own sell price for it under ', h('a', { href: '#/settings' }, 'Settings → Your prices'), ' to see a profit.') : null,
        reason === 'untraded' ? notice('info', 'Not traded on the Auction House, so only the cost is shown. Set your own sell price under ', h('a', { href: '#/settings' }, 'Settings → Your prices'), ' to see a profit.') : null,
        top.decision === 'buy' && craft?.unit != null ? notice('info', `Buying ${t.name} (${money(top.buyPrice)}) is cheaper than crafting it (${money(craft.unit)} each, incl. labor value). The tree shows how crafting would go.`) : null,
        missing.length ? notice('warn', `No price for: ${missing.join(', ')}. Give them a price under `, h('a', { href: '#/settings' }, 'Settings → Your prices'), ' or craft them.',
          list.some((x) => x.thin) ? ' "Rarely sold": the AH sells less than one craft\'s worth a day, so the price is not one you can buy at; choose Buy for it to use it anyway.' : '') : null,
        h('div', { class: 'grid2 craft-grid', style: { marginTop: '12px', alignItems: 'start' } },
          h('div', { class: 'card inner' }, h('h3', null, 'Tree'), h('p', { class: 'small muted' }, 'Choose Buy or Craft per material (Auto = cheapest). Auto uses each item\'s main recipe (named after the item); mass production, exchanges and other recipes can be picked in the recipe list. ', laborNote()),
            h('div', { class: 'tablewrap' }, h('table', { class: 'craft-tree' },
              h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Qty'), h('th', { class: 'l' }, 'Get by'), h('th', null, 'Buy each'), h('th', null, 'Craft each'), h('th', null, 'Total'), h('th', null, 'Labor'))),
              h('tbody', null, rows(t, 0, true))))),
          h('div', null,
            h('div', { class: 'card inner' }, h('h3', null, 'Shopping list'),
              h('div', { class: 'tablewrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Qty'), h('th', null, 'Each'), h('th', null, 'Total'))),
                h('tbody', null, list.map((x) => h('tr', null,
                  h('td', { class: 'l' }, x.id === COIN_ID ? 'Coins' : [itemIcon(x.id), h('a', { href: `#/item/${x.id}` }, x.name)]),
                  h('td', null, x.id === COIN_ID ? '—' : qtyText(x.qty)),
                  h('td', { class: x.unit == null ? 'warn' : '' }, x.id === COIN_ID ? '—' : x.thin ? h('span', { title: THIN_TEXT }, 'rarely sold') : x.unit == null ? 'no price' : money(x.unit)),
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
      const recipeLabel = (r) => `${r.title || r.name}${isMainRecipe(r) ? '' : ' (other)'} · ${r.materials.map((m) => (m.id === COIN_ID ? `${m.qty}c` : `${m.qty} ${m.name}`)).join(', ')} · ${r.labor} labor${r.amount > 1 ? ` · makes ${r.amount}` : ''}`;
      const recipeSel = n.recipe && n.recipes.length > 1 ? select(n.recipes.map((r) => [r.id, recipeLabel(r)]), n.recipe.id,
        (v) => { update((s) => { s.crafting.recipe[String(n.id)] = Number(v); }); draw(); }, { 'aria-label': `Recipe for ${n.name}`, class: 'recipe-pick' }) : null;
      const label = n.id === COIN_ID ? 'Coins (fee)' : [itemIcon(n.id), h('a', { href: `#/item/${n.id}` }, n.name)];
      const toggle = hasKids && !isRoot && depth >= 1 ? h('button', { type: 'button', class: 'btn small tree-toggle', 'aria-expanded': String(expanded), title: expanded ? 'Fold' : 'Unfold',
        on: { click: () => { expanded ? open.delete(key) : open.add(key); draw(); } } }, expanded ? '−' : '+') : null;
      const row = h('tr', { class: isRoot ? 'tree-root' : '' },
        h('td', { class: 'l', style: { paddingLeft: `${8 + depth * 18}px` } }, toggle, label,
          recipeSel ? h('div', null, recipeSel) : null, vocSel ? h('div', { class: 'voc-pick' }, vocSel) : null),
        h('td', null, n.id === COIN_ID ? money(n.qty) : qtyText(n.qty)),
        h('td', { class: 'l' }, getBy),
        h('td', { class: n.buyPrice == null ? 'dim' : '' }, n.id === COIN_ID ? '—' : n.buyPrice == null ? '—' : money(n.buyPrice)),
        h('td', { class: n.craftUnit == null ? 'dim' : '' }, n.craftUnit == null ? '—' : money(n.craftUnit)),
        h('td', { class: n.total == null ? 'warn' : '' }, n.thin ? h('span', { title: THIN_TEXT }, 'rarely sold') : n.total == null ? 'no price' : money(n.total)),
        h('td', null, n.ownLabor ? fmt(n.ownLabor, 0) : '—'));
      const out = [row];
      if (expanded) n.children.forEach((ch) => out.push(...rows(ch, depth + 1, false, key)));
      return out;
    }

    const addBtn = h('button', { class: 'btn primary', on: { click: () => {
      if (!itemParam) return;
      const qty = Math.max(1, Number(qtyIn.value) || 1);
      update((st) => {
        const cur = st.crafting.plan.find((x) => x.id === itemParam);
        if (cur) cur.qty += qty; else st.crafting.plan.push({ id: itemParam, qty });
      });
      location.hash = '#/crafting/plan';
    } } }, 'Add to plan');
    draw();
    return h('div', null,
      h('div', { class: 'card' }, h('div', { class: 'form' }, field('Item', search), field('How many', qtyIn), minBuyField(() => draw()), h('div', { style: { alignSelf: 'end' } }, addBtn))),
      h('div', { class: 'card', style: { marginTop: '12px' } }, box));
  }

  // ================================================================ a plan of several items
  function planView() {
    const box = h('div');
    const search = h('input', { type: 'search', list: DATALIST_ID, placeholder: 'Add an item, e.g. Lumber', 'aria-label': 'Item to add' });
    const qtyIn = h('input', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric', 'aria-label': 'How many' });
    const add = () => {
      const id = byName.get(search.value.trim().toLowerCase());
      if (!id) { search.setCustomValidity('Pick an item from the list'); search.reportValidity(); return; }
      search.setCustomValidity('');
      const qty = Math.max(1, Number(qtyIn.value) || 1);
      update((st) => { const cur = st.crafting.plan.find((x) => x.id === id); if (cur) cur.qty += qty; else st.crafting.plan.push({ id, qty }); });
      search.value = ''; draw();
    };
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    function draw() {
      const plan = settings().crafting.plan;
      if (!plan.length) { mount(box, h('p', { class: 'empty' }, 'Your plan is empty. Add items above, or use "Add to plan" on the Craft or buy tab.')); return; }
      const c = calc(), laborCopper = (setup.active().laborSilver || 0) * 100;
      const shop = new Map(), voc = new Map();
      let mats = 0, labor = 0, revenue = 0, anyMissing = false, unsold = [];
      let soldMats = 0, soldLabor = 0, soldMissing = false; // profit only counts items that have a sale price
      const lines = plan.map((p) => {
        const t = c.tree(p.id, p.qty, 0, new Set(), true);
        const list = c.shoppingList(t), byVoc = c.laborByVocation(t);
        const m = list.reduce((a, x) => a + (x.total || 0), 0), missing = list.some((x) => x.total == null);
        const l = byVoc.reduce((a, x) => a + x.labor, 0);
        for (const x of list) {
          const cur = shop.get(x.id) || { ...x, qty: 0, total: 0 };
          cur.qty += x.qty; cur.total = x.total == null || cur.total == null ? null : cur.total + x.total;
          shop.set(x.id, cur);
        }
        for (const x of byVoc) voc.set(x.vocation, (voc.get(x.vocation) || 0) + x.labor);
        const sell = sellPrice(p.id), rev = sell == null ? null : sell * p.qty;
        mats += m; labor += l; anyMissing ||= missing;
        if (rev == null) unsold.push(t.name);
        else { revenue += rev; soldMats += m; soldLabor += l; soldMissing ||= missing; }
        return { p, name: t.name, mats: m, missing, labor: l, rev, profit: rev == null || missing ? null : rev - m - l * laborCopper };
      });
      const laborCost = labor * laborCopper;
      const sold = lines.length - unsold.length;
      const profit = !sold || soldMissing ? null : revenue - soldMats - soldLabor * laborCopper;
      const setQty = (id, v) => update((st) => { const cur = st.crafting.plan.find((x) => x.id === id); if (cur && v > 0) cur.qty = v; });
      mount(box,
        h('div', { class: 'kpis' },
          kpi('Materials', anyMissing ? `${money(mats)} + ?` : money(mats), `${plan.length} item${plan.length > 1 ? 's' : ''} in the plan`, 'bad'),
          kpi('Labor', fmt(labor, 0), laborCost ? `worth ${money(laborCost)}` : 'after your ranks', 'blue'),
          kpi('Sells for', sold ? money(revenue) : '—', unsold.length ? `no sale price: ${unsold.join(', ')}` : `after the ${fmt(feeRate() * 100, 0)}% fee`, 'good'),
          kpi('Profit', profit == null ? '—' : money(profit, { signed: true }),
            !sold ? 'nothing in the plan has a sale price' : profit == null ? 'some prices are missing'
              : `${unsold.length ? 'items with a sale price · ' : ''}${soldLabor ? `${fmt((revenue - soldMats) / 100 / soldLabor, 1)} s/l` : ''}${soldLabor * laborCopper ? ' · after labor value' : ''}`,
            profit != null && profit >= 0 ? 'good' : 'bad')),
        h('div', { class: 'card inner', style: { marginTop: '12px' } }, h('h3', null, 'Items'),
          h('div', { class: 'tablewrap' }, h('table', { class: 'crafting-plan' },
            h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Qty'), h('th', null, 'Materials'), h('th', null, 'Labor'), h('th', null, 'Sells for'), h('th', null, 'Profit'), h('th', null, ''))),
            h('tbody', null, lines.map((x) => {
              const q = h('input', { type: 'number', min: 1, step: 1, value: x.p.qty, class: 'narrow', inputmode: 'numeric', 'aria-label': `Quantity of ${x.name}` });
              q.addEventListener('change', () => { const v = Number(q.value); if (Number.isFinite(v) && v > 0) { setQty(x.p.id, v); draw(); } });
              return h('tr', null,
                h('td', { class: 'l' }, itemIcon(x.p.id), h('a', { href: `#/crafting/item/${x.p.id}` }, x.name)),
                h('td', null, q),
                h('td', { class: x.missing ? 'warn' : '' }, x.missing ? `${money(x.mats)} + ?` : money(x.mats)),
                h('td', null, fmt(x.labor, 0)),
                h('td', { class: x.rev == null ? 'dim' : '' }, x.rev == null ? '—' : money(x.rev)),
                h('td', { class: x.profit == null ? 'dim' : x.profit >= 0 ? 'good' : 'bad' }, x.profit == null ? '—' : money(x.profit, { signed: true })),
                h('td', null, h('button', { class: 'btn small bad', title: 'Remove from plan', on: { click: () => { update((st) => { st.crafting.plan = st.crafting.plan.filter((y) => y.id !== x.p.id); }); draw(); } } }, '✕')));
            }))))),
        h('div', { class: 'grid2', style: { marginTop: '12px', alignItems: 'start' } },
          h('div', { class: 'card inner' }, h('h3', null, 'Shopping list'),
            h('p', { class: 'small muted' }, 'Everything to buy for the whole plan, after the buy/craft choices of each material (change them on the Craft or buy tab).'),
            h('div', { class: 'tablewrap' }, h('table', null,
              h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Qty'), h('th', null, 'Each'), h('th', null, 'Total'))),
              h('tbody', null, [...shop.values()].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).map((x) => h('tr', null,
                h('td', { class: 'l' }, x.id === COIN_ID ? 'Coins' : [itemIcon(x.id), h('a', { href: `#/item/${x.id}` }, x.name)]),
                h('td', null, x.id === COIN_ID ? '—' : qtyText(x.qty)),
                h('td', { class: x.unit == null ? 'warn' : '' }, x.id === COIN_ID ? '—' : x.thin ? h('span', { title: THIN_TEXT }, 'rarely sold') : x.unit == null ? 'no price' : money(x.unit)),
                h('td', null, x.total == null ? '—' : money(x.total)))))))),
          h('div', { class: 'card inner' }, h('h3', null, 'Labor by vocation'),
            h('table', null, h('tbody', null, [...voc.entries()].sort((a, b) => b[1] - a[1]).map(([v, l]) => h('tr', null,
              h('td', { class: 'l' }, v, h('span', { class: 'muted small' }, v !== 'Unknown' ? ` · ${setup.rankOf(v).name}` : ' · no rank applied')),
              h('td', null, fmt(l, 0)))))),
            h('div', { class: 'row', style: { marginTop: '10px' } },
              h('button', { class: 'btn small bad', on: { click: () => { if (window.confirm('Clear the whole plan?')) { update((st) => { st.crafting.plan = []; }); draw(); } } } }, 'Clear plan')))));
    }
    draw();
    return h('div', null,
      h('div', { class: 'card' }, h('div', { class: 'form' }, field('Item', search), field('How many', qtyIn), minBuyField(() => draw()),
        h('div', { style: { alignSelf: 'end' } }, h('button', { class: 'btn primary', on: { click: add } }, 'Add')))),
      h('div', { class: 'card', style: { marginTop: '12px' } }, box));
  }

  // ================================================================ cheapest way to level a vocation
  function levelView() {
    const lv = () => settings().crafting.level;
    const setLv = (fn) => { update((s) => fn(s.crafting.level)); st.limit = 100; draw(); };
    const st = { limit: 100 };
    const box = h('div');
    // vocations that have recipes (using the suggestion from the category, or the player's own choice)
    const c0v = calc();
    const recipeCount = new Map();
    for (const id of c0v.craftable()) for (const r of c0v.recipesOf(id)) {
      const v = c0v.vocation(r);
      if (v && r.labor > 0) recipeCount.set(v, (recipeCount.get(v) || 0) + 1);
    }
    const vocs = CRAFT_VOCATIONS.filter((v) => recipeCount.has(v));
    if (!vocs.includes(lv().vocation)) update((s) => { s.crafting.level.vocation = vocs[0] || ''; });
    const vocSel = select(vocs.map((v) => [v, `${v} · ${setup.rankOf(v).name} · ${recipeCount.get(v)} recipes`]), lv().vocation, (v) => setLv((l) => { l.vocation = v; }), { 'aria-label': 'Vocation to level' });
    const target = h('input', { type: 'number', min: 0, step: 1000, value: lv().target, inputmode: 'numeric', 'aria-label': 'Proficiency points to gain' });
    target.addEventListener('input', debounce(() => { const v = Number(target.value); if (Number.isFinite(v) && v >= 0 && v <= 1e8) setLv((l) => { l.target = Math.round(v); }); }, 300));
    const pointsSel = select([['spent', 'Labor spent (after your rank)'], ['base', 'Listed labor (before rank)']], lv().points, (v) => setLv((l) => { l.points = v; }), { 'aria-label': 'Points per craft' });
    const sellBox = h('input', { type: 'checkbox', checked: lv().sell });
    sellBox.addEventListener('change', () => setLv((l) => { l.sell = sellBox.checked; }));
    const supply = h('input', { type: 'number', min: 0, step: 1, value: lv().minSupply, inputmode: 'numeric', 'aria-label': 'Minimum crafts per day the market supports' });
    supply.addEventListener('input', debounce(() => { const v = Number(supply.value); if (Number.isFinite(v) && v >= 0 && v <= 1e6) setLv((l) => { l.minSupply = v; }); }, 300));
    const othersBox = h('input', { type: 'checkbox', checked: lv().others });
    othersBox.addEventListener('change', () => setLv((l) => { l.others = othersBox.checked; }));
    const more = h('button', { class: 'btn', on: { click: () => { st.limit += 100; draw(); } } }, 'Show more');

    function draw() {
      const l = lv();
      if (!l.vocation) { mount(box, h('p', { class: 'empty' }, 'No recipes with a known vocation.')); return; }
      const all = levelingRows({
        calc: calc(), vocation: l.vocation, laborFactor: (v) => (v ? setup.laborFactor(v) : 1), points: l.points, sell: l.sell,
        sellPrice, volume: (id) => { const r = marketRow(id); return r?.vol7 != null ? r.vol7 / 7 : null; }, target: l.target, others: l.others,
      });
      // materials you price yourself (e.g. bought from a merchant or gathered) are not limited by AH volume
      const own = (id) => priceInfo(id).source === 'your price';
      // the market has to supply the materials and, when selling, buy what is made
      const supplied = (r) => !r.limit || own(r.limit.id) || r.limit.craftsPerDay >= l.minSupply;
      const bought = (r) => !r.sold || own(r.id) || r.demandCrafts >= l.minSupply;
      const rows = all.filter((r) => !l.minSupply || (supplied(r) && bought(r)));
      const hidden = all.length - rows.length;
      const shown = rows.slice(0, st.limit);
      const best = rows.find((r) => r.per1000 != null);
      const supplyText = (r) => {
        if (!r.limit) return h('span', { class: 'dim' }, 'nothing to buy');
        const n = r.limit.craftsPerDay;
        return h('span', { title: `Limited by ${r.limit.name}: about ${fmt(r.limit.perDay ?? 0, 0)} sold per day, ${qtyText(r.limit.perCraft)} needed per craft` },
          own(r.limit.id) ? 'your price' : n >= 1 ? `≈ ${fmt(n, n < 10 ? 1 : 0)}/day` : n > 0 ? '< 1/day' : 'no AH sales',
          h('div', { class: 'small muted' }, r.limit.name));
      };
      mount(box,
        h('div', { class: 'kpis' },
          kpi('Best per 1,000 points', best ? money(-best.per1000, { signed: true }) : '—', best ? `${best.recipe.title || best.name}${best.per1000 < 0 ? ' · earns while levelling' : ''}` : 'no recipe has a full price', best && best.per1000 < 0 ? 'good' : 'bad'),
          kpi('Crafts for the target', best?.crafts != null ? fmt(best.crafts, 0) : '—', best ? `${fmt(best.points, 0)} points each` : '', 'blue'),
          kpi('Gold for the target', best?.totalGold != null ? money(-best.totalGold, { signed: true }) : '—', best?.totalGold < 0 ? 'earned, at today\'s prices' : 'spent: materials minus sales', best?.totalGold < 0 ? 'good' : 'bad'),
          kpi('Labor for the target', best?.totalLabor != null ? fmt(best.totalLabor, 0) : '—', `${setup.rankOf(l.vocation).name} ${l.vocation}`, 'blue')),
        best && best.limit && best.crafts > best.limit.craftsPerDay * 7 ? notice('warn', `The market sells only about ${fmt(Math.floor(best.limit.craftsPerDay * 7), 0)} crafts' worth of ${best.limit.name} a week; the target takes ${fmt(best.crafts, 0)} crafts. Buying that much will push its price up: mix in the next recipes, or gather it yourself.`) : null,
        best && best.sold && best.crafts * best.recipe.amount > (best.productPerDay || 0) * 7 ? notice('warn', `The AH buys about ${fmt((best.productPerDay || 0) * 7, 0)} ${best.name} a week; the target makes ${fmt(best.crafts * best.recipe.amount, 0)}. Selling them all will take longer or push the price down.`) : null,
        h('div', { class: 'tablewrap', style: { marginTop: '12px' } }, h('table', null,
          h('thead', null, h('tr', null,
            h('th', { class: 'l' }, 'Recipe'), h('th', null, 'Points'), h('th', { class: 'hide-sm' }, 'Materials'), h('th', { class: 'hide-sm' }, 'Sale'),
            h('th', null, 'Net / craft'), h('th', null, 'Per 1,000 pts'), h('th', { class: 'hide-sm' }, 'Market supplies'), h('th', null, 'For the target'))),
          h('tbody', null, shown.length ? shown.map((r) => h('tr', { class: 'clickable', title: 'Open its craft-or-buy tree', on: { click: () => { location.hash = `#/crafting/item/${r.id}`; } } },
            h('td', { class: 'l' }, itemIcon(r.id), h('b', null, r.recipe.title || r.name),
              r.recipe.amount > 1 ? h('span', { class: 'muted small' }, ` · makes ${fmt(r.recipe.amount, 0)}`) : null,
              isNamedRecipe(r.recipe) ? null : h('span', { class: 'chip grey', title: 'Exchange, conversion or other special recipe' }, 'special')),
            h('td', null, fmt(r.points, 0)),
            h('td', { class: `hide-sm ${r.cost == null ? 'warn' : ''}`, title: r.missing.length ? `No price for ${r.missing.join(', ')}` : null }, r.cost == null ? 'incomplete' : money(r.cost),
              r.crafted.length ? h('div', { class: 'small muted', title: 'Not sold on the AH: crafted (its labor is not counted in the points)' }, `crafts ${r.crafted.join(', ')}`) : null),
            h('td', { class: `hide-sm ${r.sold ? '' : 'dim'}`, title: r.sold ? null : noSaleReason(r.id) ? NO_SALE_TEXT[noSaleReason(r.id)] : 'not counted' }, r.sold ? money(r.sale) : '—',
              r.sold ? h('div', { class: 'small muted' }, r.productPerDay ? `${fmt(r.productPerDay, r.productPerDay < 10 ? 1 : 0)} sold/day` : 'no AH sales') : null),
            h('td', { class: r.net == null ? 'dim' : r.net <= 0 ? 'good' : 'bad' }, r.net == null ? '—' : money(-r.net, { signed: true })),
            h('td', { class: r.per1000 == null ? 'dim' : r.per1000 <= 0 ? 'good' : 'bad' }, r.per1000 == null ? '—' : money(-r.per1000, { signed: true })),
            h('td', { class: 'hide-sm' }, supplyText(r)),
            h('td', null, r.crafts == null ? '—' : `${fmt(r.crafts, 0)} crafts`,
              h('div', { class: 'small muted' }, r.totalGold == null ? '' : money(-r.totalGold, { signed: true })))))
            : h('tr', null, h('td', { class: 'empty', colspan: 8 }, 'Nothing matches.'))))),
        h('div', { class: 'row spread', style: { marginTop: '10px' } },
          h('span', { class: 'small muted' }, `${rows.length.toLocaleString('en-US')} recipes${rows.length > shown.length ? ` · showing ${shown.length}` : ''}${hidden ? ` · ${hidden.toLocaleString('en-US')} hidden: the AH trades too little of their materials or result for ${fmt(l.minSupply, 0)} craft${l.minSupply === 1 ? '' : 's'} a day (set 0 to show them)` : ''}`),
          rows.length > shown.length ? more : null));
    }
    draw();
    return h('div', null,
      notice('info', 'Proficiency is gained from the labor a craft costs, so recipes are ranked by gold per 1,000 points: materials at their AH price (the same market whose supply is shown; a material is only crafted when it has no price) minus what the result sells for after the AH fee. Gold is shown as − spent / + earned; green = you earn while levelling. "Market supplies" is how many crafts a day the AH volume of the scarcest material you buy can cover; recipes below the minimum crafts a day (for the materials or, when selling, for the result) are hidden. Mass-production recipes give many points per craft. Special recipes (exchanges, conversions, event recipes) are left out unless you tick them in. A material you gave your own price (e.g. bought from a merchant or gathered yourself) is not limited by the AH. Recipes whose vocation is a guess from the category can be corrected on the Craft or buy tab. ', laborNote()),
      h('div', { class: 'card' }, h('div', { class: 'form' },
        field('Vocation', vocSel), field('Points to gain', target), field('Points per craft', pointsSel), field('Min. crafts / day the AH supports', supply), minBuyField(() => draw()),
        h('div', { class: 'row', style: { alignSelf: 'end' } },
          h('label', { class: 'check small' }, sellBox, 'Sell what I craft'),
          h('label', { class: 'check small', title: 'Exchanges, conversions and other recipes not named after the item they make' }, othersBox, 'Include special recipes')))),
      h('div', { class: 'card', style: { marginTop: '12px' } }, box));
  }

  // ================================================================ every recipe worth crafting
  function listView() {
    const st = { q: '', cat: '', profitable: true, sort: 'spl', dir: -1, limit: 150 };
    const noSaleBox = h('input', { type: 'checkbox', checked: settings().crafting.showNoSale });
    noSaleBox.addEventListener('change', () => { update((s) => { s.crafting.showNoSale = noSaleBox.checked; }); st.limit = 150; draw(); });
    const tbody = h('tbody'), headRow = h('tr'), info = h('span', { class: 'small muted' });
    const more = h('button', { class: 'btn', on: { click: () => { st.limit += 150; draw(); } } }, 'Show more');
    // recipes hidden by the volume / profit / sale-price filters can be shown on demand; a search always shows every match
    const hiddenBox = h('span', { class: 'small' });
    const toggleHidden = h('button', { class: 'btn small', on: { click: () => { st.showHidden = !st.showHidden; draw(); } } });
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
        const b = c.best(id), craft = b.craft;
        if (!craft) continue;
        const sell = sellPrice(id), reason = noSaleReason(id);
        if (craft.mats == null && !reason) continue; // a sellable item needs a full cost to show a profit
        const total = craft.mats == null ? null : craft.mats + craft.labor * laborCopper; // null: a material has no price
        const profit = sell == null || total == null ? null : sell - total;
        all.push({ id, name: label(id), cat: row?.catLabel || c.categoryOf(id) || 'Other', reason,
          sell, mats: craft.mats, labor: craft.labor, total, profit,
          spl: sell != null && craft.labor > 0 ? (sell - craft.mats) / 100 / craft.labor : null, vol: row?.vol7 != null ? row.vol7 / 7 : null });
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
      const showNoSale = settings().crafting.showNoSale;
      // items without a sale price skip the profit and volume filters: only their cost matters
      const bypass = !!st.q || st.showHidden;
      const matching = all.filter((r) => (!st.q || r.name.toLowerCase().includes(st.q)) && (!st.cat || r.cat === st.cat));
      let rows = matching.filter((r) => bypass
        || (r.reason ? showNoSale : (!st.profitable || r.profit > 0) && (r.vol ?? 0) >= minVol));
      const hidden = matching.length - matching.filter((r) => (r.reason ? showNoSale : (!st.profitable || r.profit > 0) && (r.vol ?? 0) >= minVol)).length;
      const col = OPP_COLUMNS.find((x) => x.key === st.sort);
      rows.sort((a, b) => { const x = col.get(a), y = col.get(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * st.dir; });
      const shown = rows.slice(0, st.limit);
      mount(tbody, shown.length ? shown.map((r) => h('tr', { class: 'clickable', title: 'Open its craft-or-buy tree', on: { click: () => { location.hash = `#/crafting/item/${r.id}`; } } },
        h('td', { class: 'l' }, itemIcon(r.id), h('b', null, r.name), r.reason ? h('span', { class: `chip ${r.reason === 'gear' ? 'blue' : 'grey'}`, title: NO_SALE_TEXT[r.reason] }, r.reason === 'gear' ? 'gear' : 'not traded') : null),
        h('td', { class: 'l hide-sm muted' }, r.cat),
        h('td', { class: r.sell == null ? 'dim' : '' }, r.sell == null ? '—' : money(r.sell)),
        h('td', { class: r.mats == null ? 'warn' : '', title: r.mats == null ? 'A material has no price: open the tree to see which' : null }, r.mats == null ? 'incomplete' : money(r.mats)),
        h('td', { class: 'hide-sm' }, fmt(r.labor, 0)),
        h('td', { class: `hide-sm ${r.total == null ? 'warn' : ''}` }, r.total == null ? 'incomplete' : money(r.total)),
        h('td', { class: r.profit == null ? 'dim' : r.profit >= 0 ? 'good' : 'bad' }, r.profit == null ? '—' : money(r.profit, { signed: true })),
        h('td', { class: r.spl == null ? 'dim' : r.spl >= 0 ? 'good' : 'bad' }, r.spl == null ? '—' : fmt(r.spl, 1)),
        h('td', { class: 'hide-sm' }, r.vol == null ? '—' : fmt(r.vol, r.vol < 10 ? 1 : 0))))
        : h('tr', null, h('td', { class: 'empty', colspan: OPP_COLUMNS.length }, 'Nothing matches.')));
      info.textContent = `${rows.length.toLocaleString('en-US')} recipes${rows.length > shown.length ? ` · showing ${shown.length}` : ''}`;
      if (st.q && hidden) mount(hiddenBox, h('span', { class: 'muted' }, `Searching shows every match: ${hidden} of them would be hidden by the filters (low volume, not profitable or no sale price).`));
      else if (hidden) {
        toggleHidden.textContent = st.showHidden ? 'Apply filters' : `Show ${hidden.toLocaleString('en-US')} hidden`;
        mount(hiddenBox, h('span', { class: 'muted' }, st.showHidden ? 'Showing everything, filters off. ' : `${hidden.toLocaleString('en-US')} recipes hidden by the filters (low volume, not profitable or no sale price). `), toggleHidden);
      } else mount(hiddenBox);
      more.classList.toggle('hidden', rows.length <= shown.length);
    }
    function sortBy(key) { if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = ['name', 'cat'].includes(key) ? 1 : -1; } draw(); }

    compute();
    mount(catSel, h('option', { value: '' }, 'All categories'), cats().map((c) => h('option', { value: c }, c)));
    draw();
    return h('div', null,
      notice('info', `Profit = sale price minus the ${fmt(feeRate() * 100, 0)}% AH fee, minus materials (each bought or crafted, whichever is cheaper)${(setup.active().laborSilver || 0) ? ', minus labor at your labor value' : ''}. s/l = silver earned per labor before labor value. A material is only bought when the AH sells at least one craft's worth of it a day ("Buy materials selling"), so cheap items that hardly sell (e.g. Archeum Motes) don't make a recipe look cheap. Items without a sale price (regradable gear, whose price depends on the grade, and items not traded on the AH) are hidden unless you tick "Include items without a sale price"; for those only the cost is shown. Click a recipe for its tree and shopping list. `, laborNote()),
      h('div', { class: 'filters' }, search, catSel, field('Min. sold / day', vol), minBuyField(() => { compute(); draw(); }),
        h('div', { class: 'row' }, h('label', { class: 'check small' }, profBox, 'Profitable only'),
          h('label', { class: 'check small', title: 'Regradable gear and items not traded on the AH: cost only' }, noSaleBox, 'Include items without a sale price'))),
      h('div', { class: 'card', style: { marginTop: '12px' } },
        h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, headRow), tbody)),
        h('div', { class: 'row spread', style: { marginTop: '10px' } }, h('div', null, info, h('div', null, hiddenBox)), more)));
  }
}


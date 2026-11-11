// Costume & undergarment builder: wanted stats → build order (keep / roll for at each grade) and the
// synthium stones needed, each priced at the cheaper of buying or crafting it.
import { h, mount, notice, field, select, kpi } from '../lib/dom.js';
import { itemIcon } from '../lib/icons.js';
import { loadMarket, loadRegrade, loadCrafts, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, fmt } from '../lib/format.js';
import { get as settings, update } from '../lib/store.js';
import * as setup from '../lib/setup.js';
import { makeCraftCalc } from '../lib/craft.js';
import {
  GRADES, SLOTS, STATS, KINDS, MAX_STATS, STONES, STONE_ITEM, SERENDIPITY_ID, stoneName, statValue, buildOrder, lockedAt, synthiumNeeded, rollEstimate,
} from '../lib/costume.js';

export async function render(root) {
  const [market, { rules }, crafts] = await Promise.all([loadMarket(), loadRegrade(), loadCrafts().catch(() => ({ recipes: [] }))]);
  const priceInfo = priceResolver(market, rules, regradeItemNames(rules));
  const box = h('div'), controls = h('div', { class: 'card' });

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
  const st = () => settings().costume;
  const set = (fn) => { update((s) => fn(s.costume)); drawControls(); draw(); };

  function drawControls() {
    const s = st(), kind = s.kind, list = STATS[kind], wanted = s.stats[kind];
    const gradeOpts = GRADES.map((g, i) => [i, `${g}${SLOTS[i] ? ` · ${SLOTS[i]} stat${SLOTS[i] > 1 ? 's' : ''}` : ''}`]);
    const statSelect = (i) => {
      const el = h('select', { 'aria-label': `Wanted stat ${i + 1}` },
        h('option', { value: '', selected: !wanted[i] }, '— none —'),
        GRADES.slice(1).map((g) => {
          const opts = list.filter((x) => x.unlock === g);
          return opts.length ? h('optgroup', { label: `Unlocks at ${g}` },
            opts.map((x) => h('option', { value: x.name, selected: wanted[i] === x.name, disabled: wanted.includes(x.name) && wanted[i] !== x.name }, x.name))) : null;
        }));
      el.addEventListener('change', () => set((c) => {
        const next = [...c.stats[kind]];
        next[i] = el.value;
        c.stats[kind] = next.filter(Boolean).slice(0, MAX_STATS);
      }));
      return el;
    };
    mount(controls,
      h('div', { class: 'form' },
        field('Item', select(Object.entries(KINDS), kind, (v) => set((c) => { c.kind = v; }), { 'aria-label': 'Costume or undergarment' })),
        field('Current grade', select(gradeOpts, s.from, (v) => set((c) => { c.from = Number(v); if (c.to <= c.from) c.to = Math.min(10, c.from + 1); }), { 'aria-label': 'Current grade' })),
        field('Target grade', select(gradeOpts.slice(1), s.to, (v) => set((c) => { c.to = Number(v); if (c.from >= c.to) c.from = c.to - 1; }), { 'aria-label': 'Target grade' }))),
      h('h3', { style: { marginTop: '12px' } }, `Wanted stats (up to ${MAX_STATS})`),
      h('p', { class: 'small muted' }, 'Stats that unlock at the same grade can be rolled interchangeably, so don\'t reroll one wanted stat for another of the same grade. Costumes and undergarments go up to Mythic in this version.'),
      h('div', { class: 'stat-picks' }, Array.from({ length: MAX_STATS }, (_, i) => statSelect(i))),
      h('details', { class: 'small', style: { marginTop: '10px' } }, h('summary', null, `Stat reference (${KINDS[kind].toLowerCase()})`),
        h('p', { class: 'muted' }, 'Values from the guide at Eternal 100%, a grade this version of the game does not have: useful to compare stats, not the value you will get at Mythic.'),
        h('div', { class: 'tablewrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Stat'), h('th', { class: 'l' }, 'Unlocks at'), h('th', null, 'Guide value'))),
          h('tbody', null, list.map((x) => h('tr', null, h('td', { class: 'l' }, x.name), h('td', { class: 'l' }, x.unlock), h('td', null, statValue(x)))))))));
  }

  function draw() {
    const s = st(), kind = s.kind, wanted = s.stats[kind];
    const order = buildOrder(kind, wanted, s.to);
    const rerolls = rollEstimate(kind, order) - order.filter((o) => o.gradeIndex <= s.from).reduce((a, o) => a + o.stones, 0);
    const locked = lockedAt(kind, wanted, s.to);
    const syn = synthiumNeeded(s.from, s.to);
    const c = calc();
    const stone = Object.fromEntries(STONES.map((name) => [name, c.best(STONE_ITEM[name])]));
    let total = 0, labor = 0, missing = [];
    for (const [name, qty] of Object.entries(syn.totals)) {
      const b = stone[name];
      if (b.unit == null) missing.push(stoneName(name)); else total += b.unit * qty;
      labor += (b.labor || 0) * qty;
    }
    const laborValue = (setup.active().laborSilver || 0) * 100 * labor;
    const seren = c.best(SERENDIPITY_ID);
    const rerollCost = seren.unit == null ? null : seren.unit * rerolls;
    if (rerolls > 0 && seren.unit == null) missing.push('Serendipity Stone');

    mount(box,
      h('div', { class: 'kpis' },
        kpi('Synthium stones', fmt(Object.values(syn.totals).reduce((a, b) => a + b, 0), 0), `${GRADES[s.from]} → ${GRADES[s.to]}`, 'blue'),
        kpi('Stone cost', missing.length ? `${money(total)} + ?` : money(total), laborValue ? `incl. ${money(laborValue)} labor value` : 'each stone bought or crafted, whichever is cheaper', 'bad'),
        kpi('Rerolls (estimate)', wanted.length ? `≈ ${fmt(rerolls, 0)}` : '—', wanted.length ? `Serendipity Stones${rerollCost != null ? ` · ${money(rerollCost)}` : ''}` : 'pick wanted stats', 'blue'),
        kpi('Total (estimate)', money(total + (rerollCost || 0)), `stones${rerollCost ? ' + rerolls' : ''}${labor ? ` · ${fmt(labor, 0)} crafting labor` : ''}`, 'bad')),
      locked.length ? notice('warn', `Not available at ${GRADES[s.to]}: ${locked.map((x) => `${x.name} (unlocks at ${x.unlock})`).join(', ')}.`) : null,
      missing.length ? notice('warn', `No price for ${missing.join(', ')}: set one under `, h('a', { href: '#/settings' }, 'Settings → Your prices'), '.') : null,
      h('div', { class: 'stack', style: { marginTop: '12px' } },
        h('div', { class: 'card inner' },
          h('h3', null, 'Build order'),
          wanted.length ? h('div', { class: 'tablewrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { class: 'l' }, 'At grade'), h('th', null, 'Stats'), h('th', { class: 'l' }, 'Keep'), h('th', { class: 'l' }, 'Roll for'), h('th', null, 'Other slots'), h('th', null, 'Serendipity (est.)'))),
            h('tbody', null, order.map((o) => h('tr', { class: o.gradeIndex <= s.from ? 'dim' : '' },
              h('td', { class: 'l' }, h('b', null, o.grade)),
              h('td', null, String(o.slots)),
              h('td', { class: 'l' }, o.keep.length ? o.keep.join(', ') : h('span', { class: 'dim' }, '—')),
              h('td', { class: 'l good' }, o.roll.length ? o.roll.join(', ') : h('span', { class: 'dim' }, '—')),
              h('td', null, o.free ? `${o.free} × any, keep upgrading` : '—'),
              h('td', null, o.stones ? `≈ ${fmt(o.stones, 1)}` : '—'))))))
            : h('p', { class: 'muted small' }, 'Pick the stats you want above to see when to keep and when to roll.'),
          h('p', { class: 'small muted' }, 'A wanted stat gets a slot as soon as it has unlocked and a slot is free, earliest-unlocking first. Slots: 1 at Grand and Rare, 2 at Arcane, 3 at Heroic, 4 from Unique to Epic, 5 from Legendary. Rerolling a stat costs one Serendipity Stone ',
            seren.unit != null ? `(${money(seren.unit)}, ${seren.decision === 'craft' ? 'crafted' : 'market'})` : '(no price)',
            '. The estimate assumes each roll gives a random stat, all equally likely, from the stats unlocked at that grade that the item does not have yet, and that the first stat of a newly opened slot is free; real luck varies a lot.')),
        h('div', { class: 'card inner' },
          h('h3', null, 'Synthium stones'),
          h('div', { class: 'tablewrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Upgrade'), h('th', null, 'Stones'), h('th', null, 'Cost'))),
            h('tbody', null, syn.steps.map((x) => {
              const b = stone[x.stone];
              return h('tr', null,
                h('td', { class: 'l' }, `${x.from} → ${x.to}`),
                h('td', null, `${x.qty} × ${x.stone}`),
                h('td', { class: b.unit == null ? 'warn' : '' }, b.unit == null ? 'no price' : money(b.unit * x.qty)));
            })))),
          h('h3', { style: { marginTop: '12px' } }, 'Shopping list'),
          h('div', { class: 'tablewrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Stone'), h('th', null, 'Qty'), h('th', null, 'Each'), h('th', { class: 'l' }, 'Get by'), h('th', null, 'Total'))),
            h('tbody', null, Object.entries(syn.totals).map(([name, qty]) => {
              const b = stone[name], id = STONE_ITEM[name];
              return h('tr', null,
                h('td', { class: 'l' }, itemIcon(id), h('a', { href: `#/item/${id}` }, stoneName(name))),
                h('td', null, fmt(qty, 0)),
                h('td', { class: b.unit == null ? 'warn' : '' }, b.unit == null ? 'no price' : money(b.unit)),
                h('td', { class: 'l' }, b.decision === 'craft' ? h('a', { href: `#/crafting/item/${id}`, title: 'Open its craft-or-buy tree' }, 'craft') : b.decision === 'buy' ? 'buy' : '—'),
                h('td', null, b.unit == null ? '—' : money(b.unit * qty)));
            })))),
          h('p', { class: 'small muted' }, 'Each stone is priced at the cheaper of the Auction House and crafting it from the stone below (e.g. Vivid = Clear + 10g + 20 Charcoal Stabilizer). "craft" opens its tree with the full material list.'))));
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Costume & undergarment builder'),
      h('p', { class: 'sub' }, 'Choose the stats you want and the grade to reach: get the order in which to keep and roll for them, and the synthium stones it takes. Stat tables and build order: "Costume and Undergarments Guide" by Raffin.'))),
    controls,
    h('div', { class: 'card', style: { marginTop: '12px' } }, box));
  drawControls();
  draw();
}

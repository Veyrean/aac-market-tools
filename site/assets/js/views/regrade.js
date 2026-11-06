import { h, mount, kpi, notice, field, select, debounce, bar } from '../lib/dom.js';
import { loadMarket, loadRegrade, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, pct, fmt, toCopper, toGold } from '../lib/format.js';
import { distributionChart, emptyChart } from '../lib/chart.js';
import { get as settings, update } from '../lib/store.js';
import {
  buildOptions, analyze, optimize, simulate, describeOption, doneQuantile, doneWithin, GRADE,
} from '../regrade/engine.js';

const TYPES = [['weapon', 'Weapon'], ['armor', 'Armor'], ['accessory', 'Accessory'], ['ship', 'Ship component']];
const LABOR_PER_ATTEMPT = 10;

function defaults() {
  return {
    itemId: null, custom: { type: 'weapon', group: 4, level: 50, slotCost: 3, maxGrade: 11 },
    start: GRADE.UNIQUE, target: GRADE.EPIC, mode: 'replace', restart: GRADE.UNIQUE,
    replacementGold: 1000, budgetGold: 10000, runs: 100000, strategy: 'auto', manual: {},
  };
}

export async function render(root, _params, ctx) {
  const [{ rules, items }, market] = await Promise.all([loadRegrade(), loadMarket()]);
  const names = regradeItemNames(rules);
  const gradeName = (g) => rules.grades.find((x) => x.id === g)?.name ?? `Grade ${g}`;
  const groupName = (id) => rules.groups[String(id)]?.name ?? `Group ${id}`;
  const itemById = new Map(items.map((i) => [i.id, i]));

  const st = Object.assign(defaults(), settings().regrade.last || {});
  if (st.itemId != null && !itemById.has(st.itemId)) st.itemId = null;
  let sim = null, simKey = null, lastPlan = null;

  const persist = () => update((s) => { s.regrade.last = st; });

  // ----------------------------------------------------------------- layout
  const itemBox = h('div');
  const setupBox = h('div');
  const notices = h('div', { class: 'notices' });
  const kpis = h('div', { class: 'kpis' });
  const ladderBox = h('div');
  const shopBox = h('div');
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Distribution of total regrade cost' });
  const readout = h('div', { class: 'readout' }, 'Run a simulation to see how much luck matters.');
  const stats = h('div', { class: 'kpis', style: { marginTop: '8px' } });
  const staleChip = h('span', { class: 'chip red hidden' }, 'settings changed – run again');
  const progress = h('div', { class: 'progress hidden' }, h('span'));
  const runBtn = h('button', { class: 'btn good', on: { click: runSim } }, 'Run simulation');

  mount(root,
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, 'Regrade Lab'),
      h('p', { class: 'sub' }, 'Exact expected cost and risk of a regrade, using the game\'s success, destruction and downgrade tables and current material prices. The optimizer picks the cheapest scroll, charm and anchoring emblem for every grade.'))),
    h('div', { class: 'grid-side' },
      h('aside', { class: 'card sticky' }, itemBox, h('hr', { class: 'divider' }), setupBox),
      h('div', { class: 'stack' },
        notices, kpis,
        h('div', { class: 'card' }, ladderBox),
        h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h2', null, 'Shopping list'), h('p', { class: 'sub' }, 'What you should expect to use on average over the whole run, including rebuilding after downgrades and breaks.'), shopBox),
          h('div', { class: 'card' },
            h('div', { class: 'row spread' }, h('h2', null, 'How lucky do you need to be?', staleChip), runBtn),
            h('p', { class: 'sub' }, 'Simulates the run many times. Bars: how often a run finished at that cost. Line: chance of being done within that much gold.'),
            h('div', { class: 'chartbox' }, canvas), progress,
            h('div', { class: 'legend' }, h('span', null, h('i', { class: 'c-blue' }), 'finished runs'), h('span', null, h('i', { class: 'c-gold' }), 'P(done ≤ x)'), h('span', null, h('i', { class: 'c-red' }), 'budget'), h('span', null, h('i', { class: 'c-green' }), 'exact mean')),
            readout, stats)))));

  // ----------------------------------------------------------------- item picker
  function currentItem() {
    if (st.itemId != null) {
      const it = itemById.get(st.itemId);
      return { name: it.name, type: it.type, group: it.group, level: it.level, slotCost: it.slotCost, maxGrade: Math.min(it.maxGrade, GRADE.MYTHIC), baseCost: it.baseCost };
    }
    return { name: null, ...st.custom, maxGrade: Math.min(st.custom.maxGrade ?? GRADE.MYTHIC, GRADE.MYTHIC), baseCost: null };
  }

  function drawItemBox() {
    const it = currentItem();
    const search = h('input', { type: 'search', placeholder: 'Search 5,900 gradable items…', 'aria-label': 'Search gradable items', autocomplete: 'off' });
    const results = h('div', { class: 'results', role: 'listbox' });
    search.addEventListener('input', debounce(() => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { mount(results); return; }
      const found = items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 40);
      mount(results, found.length ? found.map((i) => h('button', {
        type: 'button', role: 'option',
        on: { click: () => { st.itemId = i.id; st.manual = {}; clampGrades(); drawItemBox(); drawSetup(); recompute(); } },
      }, h('div', null, i.name), h('div', { class: 'small muted' }, `${cap(i.type)} · ${groupName(i.group)} · level ${i.level}`))) : h('div', { class: 'small muted' }, 'No gradable item matches.'));
    }));

    let body;
    if (st.itemId != null) {
      body = h('div', { class: 'selected-item' },
        h('div', { class: 'row spread' }, h('b', null, it.name),
          h('button', { class: 'btn small', on: { click: () => { st.itemId = null; drawItemBox(); drawSetup(); recompute(); } } }, 'Custom')),
        h('div', { class: 'small muted' }, `${cap(it.type)} · ${groupName(it.group)} difficulty · level ${it.level} · max ${gradeName(it.maxGrade)}`));
    } else {
      const c = st.custom;
      const groups = Object.entries(rules.groups).map(([id, g]) => [id, g.name]);
      body = h('div', { class: 'form' },
        field('Type', select(TYPES, c.type, (v) => { c.type = v; st.manual = {}; recompute(); })),
        field('Difficulty', select(groups, c.group, (v) => { c.group = Number(v); st.manual = {}; recompute(); })),
        field('Item level', numInput(c.level, (v) => { c.level = v; recompute(); }, { min: 1, max: 100, step: 1 })),
        field('Slot fee factor', numInput(c.slotCost, (v) => { c.slotCost = v; recompute(); }, { min: 0, max: 100, step: 1 })),
        h('p', { class: 'small muted full field' }, 'Custom item: pick a real item above for exact gold fees. Difficulty: Easy = dungeon drops, Normal = most gear, Difficult = crafted, obsidian and world-boss gear.'));
    }
    mount(itemBox, h('h2', null, 'Item'), search, results, h('div', { style: { marginTop: '8px' } }, body));
  }

  function clampGrades() {
    const max = currentItem().maxGrade;
    st.target = Math.min(st.target, max);
    if (st.start >= st.target) st.start = Math.max(0, st.target - 1);
    if (st.restart >= st.target) st.restart = st.start;
  }

  // ----------------------------------------------------------------- setup
  function drawSetup() {
    const it = currentItem();
    const grades = rules.grades.filter((g) => g.id <= it.maxGrade && g.id !== 1 /* Crude is not used for equipment */);
    const startOpts = grades.filter((g) => g.id < it.maxGrade).map((g) => [g.id, g.name]);
    const targetOpts = grades.filter((g) => g.id > st.start).map((g) => [g.id, g.name]);
    const restartOpts = grades.filter((g) => g.id < st.target).map((g) => [g.id, g.name]);
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Strategy' },
      ...[['auto', 'Cheapest (auto)'], ['manual', 'Manual']].map(([v, label]) => h('button', {
        type: 'button', class: st.strategy === v ? 'active' : '', 'aria-pressed': String(st.strategy === v),
        on: { click: () => { if (v === 'manual' && lastPlan) st.manual = Object.fromEntries(Object.entries(lastPlan.policy).map(([g, o]) => [g, o.key])); st.strategy = v; drawSetup(); recompute(); } },
      }, label)));
    mount(setupBox,
      h('h2', null, 'Run'),
      h('div', { class: 'form' },
        field('From grade', select(startOpts, st.start, (v) => { st.start = Number(v); if (st.target <= st.start) st.target = st.start + 1; if (st.restart >= st.target) st.restart = st.start; drawSetup(); recompute(); })),
        field('To grade', select(targetOpts, st.target, (v) => { st.target = Number(v); if (st.restart >= st.target) st.restart = st.start; drawSetup(); recompute(); })),
        field('If the item is destroyed', select([['replace', 'Replace it and keep going'], ['stop', 'Stop (item lost)']], st.mode, (v) => { st.mode = v; drawSetup(); recompute(); }), { full: true }),
        field(st.mode === 'replace' ? 'Replacement grade' : 'Item grade it restarts at', select(restartOpts, st.restart, (v) => { st.restart = Number(v); recompute(); })),
        field(st.mode === 'replace' ? 'Replacement cost (gold)' : 'Item value (gold)', numInput(st.replacementGold, (v) => { st.replacementGold = v; recompute(); }, { min: 0, step: 1 })),
        field('Budget (gold, 0 = none)', numInput(st.budgetGold, (v) => { st.budgetGold = v; recompute(false); }, { min: 0, step: 100 })),
        field('Simulated runs', select([[10000, '10,000'], [100000, '100,000'], [250000, '250,000']], st.runs, (v) => { st.runs = Number(v); persist(); }))),
      h('div', { style: { marginTop: '10px' } }, h('div', { class: 'label' }, 'Choices per grade'), seg),
      h('p', { class: 'small muted' }, st.mode === 'stop'
        ? 'Stop mode: "cheapest" counts a destroyed item as losing its value above, so protection is used when the item is worth protecting.'
        : 'Replacement mode: a destroyed item is replaced at the grade and cost above, and the climb continues.'),
      h('p', { class: 'small muted' }, 'Prices, Patron status, labor value and the Resplendent rule are in ', h('a', { href: '#/settings' }, 'Settings'), '.'));
  }

  function numInput(value, onChange, attrs = {}) {
    const el = h('input', { type: 'number', value, inputmode: 'decimal', ...attrs });
    el.addEventListener('input', debounce(() => { const v = Number(el.value); if (Number.isFinite(v) && v >= 0) onChange(v); }, 250));
    return el;
  }

  // ----------------------------------------------------------------- compute
  function compute() {
    const s = settings();
    const priceInfo = priceResolver(market, rules, names);
    const it = currentItem();
    const { options, missing } = buildOptions({
      rules, item: it, target: st.target, priceOf: (id) => priceInfo(id).copper,
      laborCopper: Math.round(s.laborSilver * 100 * LABOR_PER_ATTEMPT),
      emblemExtraCopper: toCopper(s.regrade.emblemExtraGold || 0),
      resplendentOnlyFrom: s.regrade.resplendentOnlyFromDivine ? GRADE.DIVINE : null,
    });
    const cfg = { start: st.start, target: st.target, mode: st.mode, restartGrade: st.restart, replacementCost: toCopper(st.replacementGold) };
    const costCfg = { ...cfg, mode: 'replace' }; // stop mode: optimise as if the lost item had to be bought back
    const opt = optimize(costCfg, options);
    let policy = opt.policy;
    if (st.strategy === 'manual') {
      policy = {};
      for (const [g, list] of Object.entries(options)) {
        policy[g] = list.find((o) => o.key === st.manual[g]) || opt.policy[g] || list[0];
      }
    }
    const res = analyze(cfg, policy);
    const plainPolicy = {};
    let plainMean = null;
    try {
      for (const [g, list] of Object.entries(options)) {
        const p = list.find((o) => !o.support && !o.scroll.resplendent) || list.find((o) => !o.support);
        if (p) plainPolicy[g] = p;
      }
      plainMean = analyze(costCfg, plainPolicy).mean;
    } catch { plainMean = null; }
    const optimalMean = analyze(costCfg, opt.policy).mean;
    return { cfg, options, missing, policy: Object.fromEntries(res.states.map((g) => [g, policy[g]])), res, plainMean, optimalMean, priceInfo, autoPolicy: opt.policy };
  }

  function recompute(clearSim = true) {
    persist();
    let plan;
    try { plan = compute(); } catch (err) {
      lastPlan = null;
      mount(notices, notice('bad', err.message));
      mount(kpis); mount(ladderBox); mount(shopBox);
      return;
    }
    lastPlan = plan;
    drawNotices(plan); drawKpis(plan); drawLadder(plan); drawShop(plan);
    const key = planKey(plan);
    if (clearSim && sim && key !== simKey) staleChip.classList.remove('hidden');
    else if (sim && key === simKey) staleChip.classList.add('hidden');
    drawSim();
  }

  const planKey = (p) => JSON.stringify([p.cfg, Object.entries(p.policy).map(([g, o]) => [g, o.key, o.cost])]);

  // ----------------------------------------------------------------- output
  function drawNotices(p) {
    const list = [];
    if (p.missing.size) {
      const items = [...p.missing.values()];
      list.push(notice('warn', `No market price for: ${items.join(', ')}. Choices that need these are left out. You can enter your own prices in `, h('a', { href: '#/settings' }, 'Settings'), '.'));
    }
    const s = settings();
    if (s.regrade.resplendentOnlyFromDivine && st.target > GRADE.DIVINE) {
      list.push(notice('info', 'From Divine upward only Resplendent scrolls are considered (as on Ser Meatball\'s calculator). Turn this off in Settings if regular scrolls can be used.'));
    }
    if (st.strategy === 'auto' && p.plainMean != null && p.plainMean > p.res.mean * 1.005 && st.mode === 'replace') {
      list.push(notice('good', `The cheapest plan costs ${money(p.res.mean)} on average, ${money(p.plainMean - p.res.mean)} less than plain regular scrolls with no charms or emblems (${money(p.plainMean)}).`));
    }
    if (st.strategy === 'manual' && st.mode === 'replace' && p.res.mean > p.optimalMean * 1.005) {
      list.push(notice('warn', `Your choices cost ${money(p.res.mean - p.optimalMean)} more on average than the cheapest plan (${money(p.optimalMean)}).`));
    }
    mount(notices, ...list);
  }

  function drawKpis(p) {
    const r = p.res, s = settings();
    const stop = st.mode === 'stop';
    mount(kpis,
      kpi(stop ? 'Expected spend' : 'Expected cost', money(r.mean), stop ? 'until done or destroyed' : 'including replacements', 'good'),
      kpi('Typical swing', money(r.sd), 'standard deviation'),
      kpi('Attempts', fmt(r.attempts, 1), `≈ ${fmt(r.attempts * LABOR_PER_ATTEMPT, 0)} labor${s.laborSilver ? '' : ' (not priced)'}`, 'blue'),
      kpi('Items destroyed', fmt(r.breaks, 2), `${fmt(r.downs, 2)} downgrades`, 'bad'),
      kpi('Reach the target', pct(r.pSuccess, stop ? 1 : 0), stop ? 'before the item is destroyed' : 'always, with replacements', stop ? 'warn' : ''));
  }

  function drawLadder(p) {
    const r = p.res, total = r.stages.reduce((a, s) => a + s.spend, 0) || 1;
    const rows = r.stages.map((stg) => {
      const g = stg.grade, o = stg.option, od = o.odds;
      const kind = g >= st.start ? 'path' : 'fallback';
      let choiceCell;
      if (st.strategy === 'manual') {
        const sel = select(p.options[g].map((x) => [x.key, `${describeOption(x)} · ${money(x.cost)}`]), o.key, (v) => { st.manual[g] = v; recompute(); }, { 'aria-label': `Choice at ${gradeName(g)}` });
        choiceCell = h('td', { class: 'l' }, sel);
      } else {
        choiceCell = h('td', { class: 'l wrap' }, describeOption(o));
      }
      return h('tr', { class: kind },
        h('td', { class: 'l' }, h('b', null, gradeName(g)), h('span', { class: 'muted' }, ` → ${gradeName(g + 1)}`), kind === 'fallback' ? h('span', { class: 'chip blue', title: 'Reached after a downgrade' }, 'rebuild') : null),
        choiceCell,
        h('td', null, pct(od.success, 1)),
        h('td', null, od.up2 ? pct(od.up2, 1) : '—'),
        h('td', { class: od.destroy ? 'bad' : 'dim' }, od.destroy ? pct(od.destroy, 1) : '—'),
        h('td', { class: od.degrade ? 'warn' : 'dim' }, od.degrade ? `${pct(od.degrade, 1)} → ${gradeName(od.dmin)}` : '—'),
        h('td', null, money(o.cost)),
        h('td', null, fmt(stg.visits, 2)),
        h('td', null, money(stg.spend)),
        h('td', { class: 'l' }, bar(stg.spend / total)));
    });
    mount(ladderBox,
      h('h2', null, st.strategy === 'auto' ? 'Cheapest plan, grade by grade' : 'Your plan, grade by grade'),
      h('p', { class: 'sub' }, 'Destroy and downgrade are chances per attempt. "Attempts" counts every try at that grade over the whole run, including rebuilding after downgrades (marked "rebuild").'),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['Grade', 'Use', 'Success', '+2 grades', 'Destroy', 'Downgrade', 'Cost / try', 'Attempts', 'Spend', 'Share'].map((t, i) => h('th', { class: i < 2 || i === 9 ? 'l' : '' }, t)))),
        h('tbody', null, rows))));
  }

  function drawShop(p) {
    const items = p.res.shop.slice().sort((a, b) => b.total - a.total);
    const total = items.reduce((a, s) => a + s.total, 0) || 1;
    mount(shopBox, h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'What'), h('th', null, 'Quantity'), h('th', null, 'Each'), h('th', null, 'Total'), h('th', { class: 'l' }, 'Share'))),
      h('tbody', null,
        items.map((s) => {
          const id = s.key.startsWith('item:') ? Number(s.key.slice(5)) : null;
          const src = id ? p.priceInfo(id).source : null;
          return h('tr', null,
            h('td', { class: 'l wrap' }, id ? h('a', { href: `#/item/${id}` }, s.label) : s.label, src && src !== 'market' ? h('span', { class: 'chip grey', title: 'Where this price comes from' }, src) : null),
            h('td', null, fmt(s.qty, s.qty < 100 ? 2 : 0)),
            h('td', null, money(s.price)),
            h('td', null, money(s.total)),
            h('td', { class: 'l' }, bar(s.total / total)));
        }),
        h('tr', null, h('td', { class: 'l' }, h('b', null, 'Total')), h('td'), h('td'), h('td', null, h('b', null, money(total))), h('td'))))));
  }

  // ----------------------------------------------------------------- simulation
  let hit = () => null;
  async function runSim() {
    if (!lastPlan) return;
    const plan = lastPlan;
    runBtn.disabled = true; runBtn.textContent = 'Simulating…';
    progress.classList.remove('hidden');
    const fill = progress.firstElementChild;
    try {
      sim = await simulate(plan.cfg, plan.policy, st.runs, {
        onProgress: (f) => { fill.style.width = `${(f * 100).toFixed(0)}%`; },
        yieldFn: () => new Promise((r) => setTimeout(r, 0)),
      });
      simKey = planKey(plan);
      if (!ctx.isCurrent()) return;
      staleChip.classList.add('hidden');
      drawSim();
    } catch (err) {
      readout.textContent = `Simulation failed: ${err.message}`;
    } finally {
      runBtn.disabled = false; runBtn.textContent = 'Run simulation';
      setTimeout(() => progress.classList.add('hidden'), 300);
    }
  }

  function drawSim() {
    if (!sim) { emptyChart(canvas, 'Press "Run simulation".'); mount(stats); return; }
    const budget = toCopper(st.budgetGold || 0);
    hit = distributionChart(canvas, sim, { doneWithin, budget, mean: st.mode === 'replace' && lastPlan ? lastPlan.res.mean : null });
    const q = (x) => { const v = doneQuantile(sim, x); return v === Infinity ? 'never' : money(v); };
    mount(stats,
      kpi('Lucky (25%)', q(0.25), 'done within'),
      kpi('Median', q(0.5), 'done within', 'warn'),
      kpi('Unlucky (90%)', q(0.9), 'done within', 'warn'),
      kpi('Very unlucky (99%)', q(0.99), 'done within', 'bad'),
      budget > 0 ? kpi('Within budget', pct(doneWithin(sim, budget), 1), `done for ≤ ${money(budget)}`, 'blue') : null);
    readout.textContent = `${sim.N.toLocaleString('en-US')} simulated runs · average ${money(sim.meanSpend)}${lastPlan ? ` (exact: ${money(lastPlan.res.mean)})` : ''}. Hover the chart to read it.`;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!sim) return;
    const v = hit(e.clientX);
    if (v != null) readout.textContent = `Chance to reach ${gradeName(st.target)} having spent at most ${money(v)}: ${pct(doneWithin(sim, v), 1)}`;
  });
  canvas.addEventListener('mouseleave', () => sim && drawSim());

  const onResize = debounce(() => drawSim(), 120);
  window.addEventListener('resize', onResize);

  clampGrades();
  drawItemBox(); drawSetup(); recompute();
  return () => window.removeEventListener('resize', onResize);
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// Regrade engine — pure functions, no DOM access.
//
// Grades use the game's 13-step index from the rules data:
//   0 Basic, 1 Crude, 2 Grand, 3 Rare, 4 Arcane, 5 Heroic, 6 Unique,
//   7 Celestial, 8 Divine, 9 Epic, 10 Legendary, 11 Mythic, 12 Eternal
//
// One attempt from grade g with chosen scroll (+ optional support item):
//   success  s  → +1 grade, or +2 with the "great" chance when the scroll is Resplendent
//   failure 1-s → destroyed with chance b; otherwise downgraded with chance d to a grade in
//                 [dmin, dmax]; otherwise nothing happens (stay)
// Support items modify s, b and d:  x' = clamp(x·(1+mul/100) + ratio/10000).
// Anchoring emblems use ratio −10000 for break and downgrade, i.e. a failed attempt just stays.
//
// The exact solver treats the run as an absorbing Markov chain over every grade the run can
// reach — including grades *below* the start after a downgrade — and solves linear systems for
// expected cost, its variance, expected visits per grade and the probability of success.

export const GRADE = { BASIC: 0, ARCANE: 4, HEROIC: 5, UNIQUE: 6, CELESTIAL: 7, DIVINE: 8, EPIC: 9, LEGENDARY: 10, MYTHIC: 11 };
export const DEFAULT_FEE_COPPER = 200000; // used when an item's slot cost is unknown (same as the source calculator)

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Gold fee for one attempt (copper). */
export function attemptFee(level, rowCost, slotCost, fee) {
  if (slotCost == null || level == null) return DEFAULT_FEE_COPPER;
  const a = Math.pow(level * fee.level_coef, fee.exponent);
  const b = Math.pow(rowCost, fee.exponent) * fee.grade_coef;
  const c = slotCost * fee.slot_coef;
  return Math.round(a * b * c) + fee.base_copper;
}

/** Outcome probabilities of one attempt. */
export function attemptOdds(row, support, resplendent) {
  let s = row.success / 1e4, b = row.break / 1e4, d = row.downgrade / 1e4;
  if (support) {
    s = s * (1 + support.success_mul / 100) + support.success_ratio / 1e4;
    b = b * (1 + support.break_mul / 100) + support.break_ratio / 1e4;
    d = d * (1 + support.downgrade_mul / 100) + support.downgrade_ratio / 1e4;
  }
  s = clamp01(s); b = clamp01(b); d = clamp01(d);
  const g = resplendent ? row.great / 1e4 : 0;
  const up2 = s * g, up1 = s * (1 - g), destroy = (1 - s) * b;
  let degrade = (1 - s) * (1 - b) * d, stay = (1 - s) * (1 - b) * (1 - d);
  let dmin = row.dmin, dmax = Math.max(row.dmin, row.dmax);
  if (degrade > 0 && dmin < 0) { stay += degrade; degrade = 0; dmin = dmax = -1; }
  return { success: s, up1, up2, destroy, degrade, stay, dmin, dmax };
}

export function supportFits(support, type, grade) {
  return support.applies_to.includes(type)
    && (support.grade_min === -1 || grade >= support.grade_min)
    && (support.grade_max === -1 || grade <= support.grade_max);
}

/**
 * Build every possible choice (scroll × support) for each grade below the target.
 * @param {object} ctx
 *   rules        regrade rules (fee, groups, scrolls, supports)
 *   item         {type, group, level, slotCost}
 *   target       target grade index
 *   priceOf      (itemId) => copper | null
 *   laborCopper  gold value of the labor spent per attempt (copper)
 *   emblemExtraCopper extra cost of crafting an emblem from shards (medals, labor…)
 *   resplendentOnlyFrom grade from which only Resplendent scrolls are allowed (or null)
 * @returns {{options: Object<number, object[]>, missing: Map<number,string>}}
 */
export function buildOptions(ctx) {
  const { rules, item, target, priceOf } = ctx;
  const group = rules.groups[String(item.group)];
  if (!group) throw new Error(`Unknown regrade group ${item.group}`);
  const missing = new Map();
  const price = (id, name) => {
    const p = priceOf(id);
    if (p == null) missing.set(id, name);
    return p;
  };
  const scrolls = rules.scrolls.filter((s) => s.type === item.type);
  const regular = scrolls.find((s) => !s.resplendent) || null;
  const scrollChoices = [];
  for (const s of scrolls) {
    if (!s.resplendent) {
      const p = price(s.item_id, s.name);
      if (p != null) scrollChoices.push({ scroll: s, cost: p, materials: [{ id: s.item_id, label: s.name, price: p }] });
      continue;
    }
    // Resplendent: buy it ready-made, or combine a regular scroll with the matching lucky point.
    const direct = priceOf(s.item_id);
    let combo = null;
    if (regular && s.lucky_point_item_id) {
      const pr = priceOf(regular.item_id), pp = priceOf(s.lucky_point_item_id);
      if (pr != null && pp != null) {
        combo = { cost: pr + pp, materials: [
          { id: regular.item_id, label: regular.name, price: pr },
          { id: s.lucky_point_item_id, label: luckyPointName(s), price: pp }] };
      } else {
        if (pr == null) missing.set(regular.item_id, regular.name);
        if (pp == null) missing.set(s.lucky_point_item_id, luckyPointName(s));
      }
    }
    if (direct != null && (combo == null || direct <= combo.cost)) {
      scrollChoices.push({ scroll: s, cost: direct, materials: [{ id: s.item_id, label: s.name, price: direct }] });
    } else if (combo) {
      scrollChoices.push({ scroll: s, cost: combo.cost, materials: combo.materials });
    } else if (direct == null) {
      missing.set(s.item_id, s.name);
    }
  }

  const options = {};
  for (let g = 0; g < target; g++) {
    const row = group.rows[String(g)];
    if (!row) continue;
    const fee = attemptFee(item.level, row.cost, item.slotCost, rules.fee);
    const labor = ctx.laborCopper || 0;
    let choices = scrollChoices;
    if (ctx.resplendentOnlyFrom != null && g >= ctx.resplendentOnlyFrom && choices.some((c) => c.scroll.resplendent)) {
      choices = choices.filter((c) => c.scroll.resplendent);
    }
    const supports = rules.supports.filter((s) => supportFits(s, item.type, g));
    const list = [];
    for (const sc of choices) {
      list.push(makeOption(g, row, sc, null, null, fee, labor));
      for (const sup of supports) {
        const sp = supportPrice(sup, priceOf, ctx.emblemExtraCopper || 0);
        if (sp == null) { missing.set(sup.item_id, sup.name); continue; }
        list.push(makeOption(g, row, sc, sup, sp, fee, labor));
      }
    }
    if (list.length) options[g] = list;
  }
  return { options, missing };
}

function luckyPointName(scroll) {
  const t = scroll.type;
  return t === 'weapon' ? 'Lucky Sunpoint' : t === 'armor' ? 'Lucky Moonpoint' : t === 'accessory' ? 'Lucky Starpoint' : 'Lucky point';
}

function supportPrice(sup, priceOf, emblemExtra) {
  const direct = priceOf(sup.item_id);
  let crafted = null;
  if (sup.kind === 'emblem' && sup.shard_item_id && sup.shard_multiplier) {
    const shard = priceOf(sup.shard_item_id);
    if (shard != null) crafted = shard * sup.shard_multiplier + emblemExtra;
  }
  if (direct != null && crafted != null) return Math.min(direct, crafted);
  return direct ?? crafted;
}

function makeOption(grade, row, sc, sup, supCost, fee, labor) {
  const materials = sc.materials.slice();
  if (sup) materials.push({ id: sup.item_id, label: sup.name, price: supCost });
  return {
    key: `${sc.scroll.item_id}:${sup ? sup.item_id : 0}`,
    grade,
    scroll: sc.scroll,
    support: sup,
    odds: attemptOdds(row, sup, sc.scroll.resplendent),
    fee, labor,
    materialCost: sc.cost + (supCost || 0),
    cost: fee + labor + sc.cost + (supCost || 0),
    materials,
  };
}

export function describeOption(o) {
  const parts = [o.scroll.resplendent ? 'Resplendent' : 'Regular'];
  if (o.support) parts.push(o.support.name);
  return parts.join(' + ');
}

// ---------------------------------------------------------------------------
// Markov chain
// ---------------------------------------------------------------------------
/** cfg: {start, target, mode:'replace'|'stop', restartGrade, replacementCost} */
export function outcomes(cfg, grade, opt) {
  const T = cfg.target, o = opt.odds, list = [];
  const add = (p, next, extra, type) => { if (p > 1e-15) list.push({ p, next, extra, type }); };
  add(o.up2, Math.min(T, grade + 2), 0, 'great');
  add(o.up1, Math.min(T, grade + 1), 0, 'success');
  add(o.stay, grade, 0, 'stay');
  if (o.degrade > 0) {
    const n = o.dmax - o.dmin + 1;
    for (let d = o.dmin; d <= o.dmax; d++) add(o.degrade / n, Math.min(d, grade), 0, 'down');
  }
  if (cfg.mode === 'replace') add(o.destroy, cfg.restartGrade, cfg.replacementCost, 'break');
  else add(o.destroy, -1, 0, 'break');
  return list;
}

function validateCfg(cfg) {
  if (!(cfg.target > cfg.start)) throw new Error('The target grade must be above the starting grade.');
  if (cfg.mode === 'replace' && !(cfg.restartGrade < cfg.target)) throw new Error('The replacement grade must be below the target grade.');
}

/** Grades reachable from the start under a policy (or under any option when policy is null). */
export function reachable(cfg, options, policy) {
  const seen = new Set([cfg.start]), queue = [cfg.start];
  while (queue.length) {
    const g = queue.pop();
    const opts = policy ? [policy[g]] : (options[g] || []);
    if (!opts.length || !opts[0]) throw new Error(`No usable regrade option at grade ${g} (missing prices or rules).`);
    for (const opt of opts) {
      for (const x of outcomes(cfg, g, opt)) {
        if (x.next >= 0 && x.next < cfg.target && !seen.has(x.next)) { seen.add(x.next); queue.push(x.next); }
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function gaussSolve(A, b) {
  const n = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-13) throw new Error('The target can never be reached with these choices (a grade has 0% success).');
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f) for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((r) => r[n]);
}

/**
 * Exact analysis of a policy.
 * E[g]  = c_g + Σ p·(extra + E[next])
 * M2[g] = Σ p·((c+extra)² + 2(c+extra)·E[next]) + Σ p·M2[next]
 * P[g]  = Σ p·[next ≥ target] + Σ p·P[next]
 * v     = e_start·(I−Q)⁻¹   (expected attempts at each grade)
 */
export function analyze(cfg, policy, states = null) {
  validateCfg(cfg);
  const T = cfg.target;
  const S = states || reachable(cfg, null, policy);
  const n = S.length, idx = new Map(S.map((g, k) => [g, k]));
  const O = S.map((g) => outcomes(cfg, g, policy[g]));
  const A = S.map((_, i) => S.map((_, j) => (i === j ? 1 : 0)));
  const bCost = new Array(n).fill(0), bSucc = new Array(n).fill(0);
  O.forEach((list, k) => {
    bCost[k] = policy[S[k]].cost;
    for (const x of list) {
      bCost[k] += x.p * x.extra;
      if (x.next >= 0 && x.next < T) A[k][idx.get(x.next)] -= x.p;
      else if (x.next >= T) bSucc[k] += x.p;
    }
  });
  const E = gaussSolve(A, bCost), P = gaussSolve(A, bSucc);
  const b2 = new Array(n).fill(0);
  O.forEach((list, k) => {
    const c = policy[S[k]].cost;
    for (const x of list) {
      const kc = c + x.extra, en = x.next >= 0 && x.next < T ? E[idx.get(x.next)] : 0;
      b2[k] += x.p * (kc * kc + 2 * kc * en);
    }
  });
  const M2 = gaussSolve(A, b2);
  const At = S.map((_, i) => S.map((_, j) => A[j][i]));
  const V = gaussSolve(At, S.map((g) => (g === cfg.start ? 1 : 0))).map((v) => Math.max(0, v));
  const k0 = idx.get(cfg.start), mean = E[k0];

  let attempts = 0, breaks = 0, downs = 0;
  const shop = new Map();
  const addShop = (key, label, qty, price) => {
    const e = shop.get(key) || { key, label, qty: 0, price, total: 0 };
    e.qty += qty; e.total += qty * price; shop.set(key, e);
  };
  const stages = S.map((g, k) => {
    const opt = policy[g], v = V[k];
    attempts += v; breaks += v * opt.odds.destroy; downs += v * opt.odds.degrade;
    for (const m of opt.materials) addShop(`item:${m.id}`, m.label, v, m.price);
    addShop('fee', 'Gold regrade fees', v, opt.fee);
    if (opt.labor > 0) addShop('labor', 'Labor (as gold)', v, opt.labor);
    const rep = cfg.mode === 'replace' ? v * opt.odds.destroy : 0;
    if (rep > 0) addShop('replacement', 'Replacement items', rep, cfg.replacementCost);
    return { grade: g, visits: v, option: opt, spend: v * opt.cost + rep * (cfg.replacementCost || 0) };
  });
  return {
    states: S, idx, E, P, mean, sd: Math.sqrt(Math.max(0, M2[k0] - mean * mean)),
    attempts, breaks, downs, pSuccess: P[k0], stages,
    shop: [...shop.values()].filter((s) => s.qty > 1e-12),
  };
}

/** Value of choosing `opt` at grade g, given expected costs E of the current policy. */
function optionValue(cfg, g, opt, res) {
  const T = cfg.target;
  let q = opt.cost;
  for (const x of outcomes(cfg, g, opt)) {
    const en = x.next >= 0 && x.next < T ? res.E[res.idx.get(x.next)] : 0;
    q += x.p * (x.extra + en);
  }
  return q;
}

/**
 * Policy iteration: the cheapest choice at every grade (replacement mode only).
 * Starts from `initial` (or the highest-success option) and improves until stable.
 */
export function optimize(cfg, options, initial = null, maxIter = 50) {
  validateCfg(cfg);
  if (cfg.mode !== 'replace') throw new Error('The optimizer needs replacement mode (otherwise cheaper simply means riskier).');
  const S = reachable(cfg, options, null);
  const policy = {};
  for (const g of S) {
    const list = options[g];
    policy[g] = (initial && initial[g] && list.find((o) => o.key === initial[g].key))
      || list.reduce((a, o) => (o.odds.up1 + o.odds.up2 > a.odds.up1 + a.odds.up2 ? o : a));
  }
  let res, iter = 0;
  for (; iter < maxIter; iter++) {
    res = analyze(cfg, policy, S);
    let changed = false;
    for (const g of S) {
      let best = policy[g], bestQ = optionValue(cfg, g, best, res);
      for (const o of options[g]) {
        const q = optionValue(cfg, g, o, res);
        if (q < bestQ - 1e-9 * (1 + Math.abs(bestQ))) { best = o; bestQ = q; }
      }
      if (best !== policy[g]) { policy[g] = best; changed = true; }
    }
    if (!changed) break;
  }
  return { policy, iterations: iter + 1, mean: res.E[res.idx.get(cfg.start)] };
}

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------
function sfc32(a, b, c, d) {
  return function rnd() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Simulate N runs. Returns sorted costs of runs that reached the target, plus summary numbers.
 * onProgress(fraction) is called between chunks; the function yields to the browser between chunks.
 */
export async function simulate(cfg, policy, N, { seed = (Math.random() * 2 ** 32) >>> 0, onProgress = null, yieldFn = null } = {}) {
  validateCfg(cfg);
  const T = cfg.target, tables = {};
  for (const g of Object.keys(policy).map(Number)) {
    const list = outcomes(cfg, g, policy[g]);
    let acc = 0;
    tables[g] = { cost: policy[g].cost, cum: list.map((x) => (acc += x.p)), list };
  }
  const rnd = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, seed);
  const succ = [], MAX = 2e6, CHUNK = Math.max(2000, Math.floor(N / 50));
  let spendSum = 0, attempts = 0, breaks = 0, capped = 0;
  for (let i0 = 0; i0 < N; i0 += CHUNK) {
    const end = Math.min(N, i0 + CHUNK);
    for (let i = i0; i < end; i++) {
      let g = cfg.start, cost = 0, a = 0;
      while (g >= 0 && g < T && a < MAX) {
        const t = tables[g];
        if (!t) throw new Error(`Simulation reached grade ${g} without a chosen option.`);
        cost += t.cost; a++;
        const x = rnd();
        let k = 0;
        while (k < t.cum.length - 1 && x >= t.cum[k]) k++;
        const o = t.list[k];
        cost += o.extra;
        if (o.type === 'break') breaks++;
        g = o.next;
      }
      if (a >= MAX) capped++;
      if (g >= T) succ.push(cost);
      spendSum += cost; attempts += a;
    }
    if (onProgress) onProgress(end / N);
    if (yieldFn) await yieldFn();
  }
  const sorted = Float64Array.from(succ).sort();
  return { N, succ: sorted, pSuccess: sorted.length / N, meanSpend: spendSum / N, meanAttempts: attempts / N, meanBreaks: breaks / N, capped };
}

/** Smallest spend x such that at least q of all runs finished within x (Infinity if never). */
export function doneQuantile(sim, q) {
  const need = Math.ceil(q * sim.N);
  if (need < 1) return 0;
  if (need > sim.succ.length) return Infinity;
  return sim.succ[need - 1];
}

/** Share of all runs that reached the target having spent at most x. */
export function doneWithin(sim, x) {
  let lo = 0, hi = sim.succ.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sim.succ[m] <= x) lo = m + 1; else hi = m; }
  return lo / sim.N;
}

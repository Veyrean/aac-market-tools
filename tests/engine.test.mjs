// Regrade engine tests. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attemptFee, attemptOdds, buildOptions, analyze, optimize, simulate, reachable, outcomes,
  doneQuantile, doneWithin, GRADE,
} from '../site/assets/js/regrade/engine.js';

const rules = JSON.parse(readFileSync(new URL('./fixtures/rules.json', import.meta.url)));
const G = 10000; // copper per gold
const PRICES = {
  28298: 35 * G,   // Weapon Regrade Scroll
  28296: 770 * G,  // Resplendent Weapon Regrade Scroll
  28300: 700 * G,  // Lucky Sunpoint
  31974: 230 * G,  // Unique charm
  34323: 80 * G,   // Dazzling Heroic
  34563: 55 * G,   // Dazzling Arcane
  38755: 620 * G,  // Celestial charm
  42096: 29 * G,   // Celestial Weapon Anchoring Shard
  42102: 72 * G,   // Divine Weapon Anchoring Shard
};
const priceOf = (id) => PRICES[id] ?? null;
const weapon = { type: 'weapon', group: 1, level: 50, slotCost: 3 };

function opts(target = GRADE.EPIC, extra = {}) {
  return buildOptions({ rules, item: weapon, target, priceOf, ...extra }).options;
}
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1), `${msg}: ${a} vs ${b}`);

test('fee formula matches the published coefficients', () => {
  const f = rules.fee;
  const expected = Math.round(Math.pow(50 * f.level_coef, f.exponent) * Math.pow(22, f.exponent) * f.grade_coef * 3 * f.slot_coef) + f.base_copper;
  assert.equal(attemptFee(50, 22, 3, f), expected);
  assert.equal(attemptFee(null, 22, null, f), 200000);
});

test('attempt odds always sum to 1, and emblems turn every failure into a stay', () => {
  const celestial = rules.groups['1'].rows['7'];
  const emblem = rules.supports.find((s) => s.kind === 'emblem' && s.grade_min === 7);
  for (const [sup, resp] of [[null, false], [null, true], [emblem, true]]) {
    const o = attemptOdds(celestial, sup, resp);
    close(o.up1 + o.up2 + o.destroy + o.degrade + o.stay, 1, 1e-12, 'sum');
  }
  const plain = attemptOdds(celestial, null, false);
  close(plain.destroy, 0.7 * 0.5, 1e-12, 'Celestial: half of failures destroy');
  close(plain.degrade, 0.7 * 0.5, 1e-12, 'Celestial: the other half downgrade');
  assert.equal(plain.dmin, GRADE.ARCANE);
  const anchored = attemptOdds(celestial, emblem, false);
  assert.equal(anchored.destroy, 0);
  assert.equal(anchored.degrade, 0);
  close(anchored.stay, 0.7, 1e-12, 'anchored failure stays');
});

test('charms multiply success and respect their grade limits', () => {
  const o = opts();
  const at = (g, name) => o[g].find((x) => x.support?.name === name && !x.scroll.resplendent);
  close(at(GRADE.ARCANE, 'Dazzling Arcane Regrade Charm').odds.success, 0.5 * 1.75, 1e-12, 'arcane ×1.75');
  close(at(GRADE.UNIQUE, 'Unique Regrade Charm').odds.success, 0.35 * 1.5, 1e-12, 'unique ×1.5');
  assert.equal(at(GRADE.CELESTIAL, 'Unique Regrade Charm'), undefined, 'Unique charm not allowed at Celestial');
  assert.ok(at(GRADE.CELESTIAL, 'Celestial Regrade Charm'));
});

test('Resplendent uses the cheaper of buying it or scroll + lucky point', () => {
  const r = opts()[GRADE.UNIQUE].find((x) => x.scroll.resplendent && !x.support);
  assert.equal(r.materialCost, 735 * G); // 35 + 700 < 770
  assert.equal(r.materials.length, 2);
  const r2 = buildOptions({ rules, item: weapon, target: GRADE.EPIC, priceOf: (id) => (id === 28296 ? 600 * G : priceOf(id)) })
    .options[GRADE.UNIQUE].find((x) => x.scroll.resplendent && !x.support);
  assert.equal(r2.materialCost, 600 * G);
});

test('single grade, no risk: expected cost is cost / success (geometric)', () => {
  const o = opts(GRADE.UNIQUE)[GRADE.HEROIC ?? 5].find((x) => !x.support && !x.scroll.resplendent);
  const cfg = { start: 5, target: 6, mode: 'replace', restartGrade: 5, replacementCost: 0 };
  const res = analyze(cfg, { 5: o });
  close(res.mean, o.cost / o.odds.success, 1e-9, 'mean');
  close(res.attempts, 1 / o.odds.success, 1e-9, 'attempts');
  close(res.sd, o.cost * Math.sqrt(1 - o.odds.success) / o.odds.success, 1e-9, 'sd');
});

test('downgrades below the start are followed (the climb back is paid for)', () => {
  const o = opts();
  const plain = (g) => o[g].find((x) => !x.support && !x.scroll.resplendent);
  const policy = {};
  for (let g = 0; g < GRADE.EPIC; g++) if (o[g]) policy[g] = plain(g);
  const cfg = { start: GRADE.CELESTIAL, target: GRADE.EPIC, mode: 'replace', restartGrade: GRADE.CELESTIAL, replacementCost: 5000 * G };
  const states = reachable(cfg, null, policy);
  assert.deepEqual(states, [GRADE.ARCANE, 5, GRADE.UNIQUE, GRADE.CELESTIAL, GRADE.DIVINE]);
  const res = analyze(cfg, policy);
  assert.ok(res.stages.find((s) => s.grade === GRADE.ARCANE).visits > 0.1, 'Arcane is visited after Celestial failures');
});

test('exact mean, sd and success probability agree with Monte Carlo', async () => {
  const o = opts();
  const policy = {};
  for (let g = 0; g < GRADE.EPIC; g++) if (o[g]) policy[g] = o[g].find((x) => x.scroll.resplendent && !x.support);
  for (const mode of ['replace', 'stop']) {
    const cfg = { start: GRADE.UNIQUE, target: GRADE.EPIC, mode, restartGrade: GRADE.UNIQUE, replacementCost: 3000 * G };
    const res = analyze(cfg, policy);
    const sim = await simulate(cfg, policy, 200000, { seed: 12345 });
    if (mode === 'replace') {
      assert.equal(sim.pSuccess, 1);
      close(sim.meanSpend, res.mean, 0.01, 'mean (replace)');
      let m = 0, m2 = 0;
      for (const v of sim.succ) { m += v; m2 += v * v; }
      m /= sim.N;
      close(Math.sqrt(m2 / sim.N - m * m), res.sd, 0.02, 'sd (replace)');
      close(sim.meanAttempts, res.attempts, 0.01, 'attempts');
    } else {
      close(sim.pSuccess, res.pSuccess, 0.03, 'P(success) (stop)');
      close(sim.meanSpend, res.mean, 0.01, 'mean spend (stop)');
    }
  }
});

test('optimizer finds the same cost as brute force over every policy', () => {
  const o = opts();
  const cfg = { start: GRADE.UNIQUE, target: GRADE.EPIC, mode: 'replace', restartGrade: GRADE.UNIQUE, replacementCost: 3000 * G };
  const best = optimize(cfg, o);
  const S = reachable(cfg, o, null);
  let brute = Infinity;
  const rec = (k, pol) => {
    if (k === S.length) { brute = Math.min(brute, analyze(cfg, pol, S).mean); return; }
    for (const x of o[S[k]]) { pol[S[k]] = x; rec(k + 1, pol); }
  };
  rec(0, {});
  close(best.mean, brute, 1e-9, 'optimum');
  assert.ok(Number.isFinite(best.mean) && best.mean > 0);
});

test('Resplendent-only rule removes regular scrolls from Divine upward', () => {
  const o = opts(GRADE.LEGENDARY, { resplendentOnlyFrom: GRADE.DIVINE });
  assert.ok(o[GRADE.CELESTIAL].some((x) => !x.scroll.resplendent));
  assert.ok(o[GRADE.DIVINE].every((x) => x.scroll.resplendent));
});

test('missing prices are reported and the option is skipped', () => {
  const { options, missing } = buildOptions({ rules, item: weapon, target: GRADE.EPIC, priceOf: (id) => (id === 38755 ? null : priceOf(id)) });
  assert.ok(missing.has(38755));
  assert.ok(!options[GRADE.CELESTIAL].some((x) => x.support?.item_id === 38755));
});

test('quantile helpers', () => {
  const sim = { N: 4, succ: Float64Array.from([10, 20, 30]) };
  assert.equal(doneQuantile(sim, 0.5), 20);
  assert.equal(doneQuantile(sim, 0.9), Infinity); // only 3 of 4 runs finished
  assert.equal(doneWithin(sim, 25), 0.5);
  assert.ok(outcomes);
});

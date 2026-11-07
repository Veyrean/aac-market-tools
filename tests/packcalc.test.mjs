// Trade pack maths tests. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePackCalc, vehicleCost, routeKey } from '../site/assets/js/lib/packcalc.js';

const G = 10000;
const data = {
  payoutDemand: 130,
  packs: [
    { id: 1, name: 'Oil', origin: 'Solis', craftLabor: 100, turnInLabor: 100, yield: 1,
      materials: [{ id: 500, name: 'Coin', qty: 5000 }, { id: 10, name: 'Powder', qty: 10 }],
      gold: [{ to: 'Arcum', copper: 30 * G }, { to: 'Diamond Shores', copper: 60 * G }],
      resources: [{ to: 'Two Crowns', reward: 'Gilda Star', qty: 13 }], demand: {} },
    { id: 2, name: 'Cheese', origin: 'Solis', craftLabor: 0, turnInLabor: 50, yield: 1, materials: [],
      gold: [{ to: 'Arcum', copper: 40 * G }], resources: [], demand: {} },
  ],
};
const prices = { 10: 1 * G, 20: 2 * G }; // Powder 1g, Gilda Dust 2g
const calc = (over = {}) => makePackCalc({
  data,
  priceOfId: (id) => (prices[id] != null ? { copper: prices[id], source: 'market' } : { copper: null, source: 'missing' }),
  idOfName: (n) => ({ Powder: 10, 'Gilda Dust': 20 })[n] ?? null,
  opts: { defaultDemand: 130, routeDemand: { [routeKey('Solis', 'Arcum')]: 100 }, feeRate: 0.05, gildaStarCopper: null, lordsPenceCopper: null, laborFactor: 0.7, ...over },
});

test('payout scales with demand: own % on a starred route, default % elsewhere', () => {
  const o = calc().options(data.packs[0], 'gold');
  assert.equal(o.find((x) => x.to === 'Arcum').payout, (30 * G * 100) / 130);
  assert.equal(o.find((x) => x.to === 'Arcum').custom, true);
  assert.equal(o.find((x) => x.to === 'Diamond Shores').payout, 60 * G);
  assert.equal(o.find((x) => x.to === 'Diamond Shores').custom, false);
  const lower = calc({ defaultDemand: 100, routeDemand: {} }).options(data.packs[0], 'gold');
  assert.equal(lower.find((x) => x.to === 'Diamond Shores').payout, (60 * G * 100) / 130);
});

test('resource rewards: Gilda Star = 4 × Gilda Dust, after the AH fee', () => {
  const r = calc().options(data.packs[0], 'resources')[0];
  assert.equal(r.unit, 8 * G);
  assert.ok(Math.abs(r.payout - 13 * 8 * G * 0.95) < 1e-6);
});

test('larder packs: crafting labor uses Husbandry, the turn-in uses Commerce', () => {
  const larder = { ...data.packs[0], craftLabor: 130, turnInLabor: 110, craftVocation: 'Husbandry' };
  const c = calc({ laborFactorOf: (v) => ({ Husbandry: 0.6, Commerce: 0.9 })[v] });
  const parts = c.laborParts(larder);
  assert.equal(parts.craftVocation, 'Husbandry');
  assert.ok(Math.abs(parts.total - (130 * 0.6 + 110 * 0.9)) < 1e-9);
  assert.ok(Math.abs(c.packLabor(data.packs[0]) - 200 * 0.9) < 1e-9); // no craftVocation: Commerce
});

test("craft cost includes coins as copper; packs without a recipe need the player's own price", () => {
  const c = calc();
  assert.equal(c.craftCost(data.packs[0]).copper, 5000 + 10 * G);
  assert.equal(c.craftCost(data.packs[1]).copper, null);
  assert.equal(c.packLabor(data.packs[0]), 140);
});

test('routes: best pack per route, full load, minus loss and fuel', () => {
  const rows = calc().routes({ vehicle: { capacity: 7, fuelCopper: 5 * G, riskPct: 10, tripMinutes: 30 } });
  const arcum = rows.find((r) => r.to === 'Arcum');
  assert.equal(arcum.best.pack.name, 'Oil'); // Cheese has no craft cost, so Oil (priced) wins
  const payout = (30 * G * 100) / 130, cost = 5000 + 10 * G;
  assert.ok(Math.abs(arcum.turnoverTrip - 7 * payout) < 1e-6);
  assert.ok(Math.abs(arcum.profitTrip - (7 * payout * 0.9 - 7 * cost - 5 * G)) < 1e-6);
  assert.ok(Math.abs(arcum.perHour - arcum.profitTrip * 2) < 1e-6);
  assert.ok(Math.abs(arcum.spl - arcum.profitTrip / 100 / (7 * 140)) < 1e-9);
  const noSea = calc().routes({ excludeSea: true, vehicle: { capacity: 1 } });
  assert.ok(!noSea.some((r) => r.to === 'Diamond Shores'));
});

test('vehicle consumables are priced by name, unknown items reported', () => {
  const v = vehicleCost({ consumables: [{ name: 'Powder', qty: 3 }, { name: 'Mystery', qty: 1 }, { name: '', qty: 9 }] }, (n) => (n === 'Powder' ? G : null));
  assert.deepEqual(v, { copper: 3 * G, missing: ['Mystery'] });
});

// Levelling ranking. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCraftCalc } from '../site/assets/js/lib/craft.js';
import { levelingRows } from '../site/assets/js/lib/leveling.js';

const recipes = [
  { id: 1, product: 10, name: 'Iron Ingot', title: 'Iron Ingot', category: 'Metal', amount: 1, labor: 50, materials: [{ id: 20, name: 'Iron Ore', qty: 3 }, { id: 500, name: 'Coin', qty: 10 }] },
  { id: 2, product: 10, name: 'Iron Ingot', title: 'Iron Ingot: Mass Production', category: 'Metal', amount: 10, labor: 500, materials: [{ id: 20, name: 'Iron Ore', qty: 30 }, { id: 500, name: 'Coin', qty: 100 }] },
  { id: 3, product: 11, name: 'Gear Bit', title: 'Gear Bit', category: 'Metal', amount: 1, labor: 100, materials: [{ id: 21, name: 'Rare Ore', qty: 1 }] },
  { id: 4, product: 12, name: 'Plank', title: 'Plank', category: 'Lumber', amount: 1, labor: 10, materials: [{ id: 22, name: 'Log', qty: 1 }] },
];
const price = { 10: 400, 20: 100, 21: null, 22: 5 };
const vol = { 10: 50, 20: 300, 21: 1 };
const calc = makeCraftCalc({ recipes, buyPrice: (id) => price[id] ?? null, laborFactor: (v) => (v === 'Metalwork' ? 0.6 : 1), laborCopper: 0 });
const run = (over = {}) => levelingRows({ calc, vocation: 'Metalwork', laborFactor: (v) => (v === 'Metalwork' ? 0.6 : 1), points: 'spent', sell: true,
  sellPrice: (id) => (price[id] == null ? null : price[id] * 0.95), volume: (id) => vol[id] ?? null, target: 1200, ...over });

test('only the vocation\'s recipes, points from labor after the rank, net of the sale', () => {
  const rows = run();
  assert.deepEqual(rows.map((r) => r.recipe.id), [2, 1, 3]); // same cost per point: more points per craft first
  const single = rows.find((r) => r.recipe.id === 1);
  assert.equal(single.points, 30);                 // 50 × 0.6
  assert.equal(single.cost, 310);                  // 3 × 100 + 10c
  assert.equal(single.net, 310 - 380);             // sells for 400 × 0.95
  assert.equal(single.crafts, 40);                 // 1,200 points / 30
  assert.equal(single.limit.craftsPerDay, 100);    // 300 ore a day / 3 per craft
});

test('incomplete costs sort last; base-labor points; no sale', () => {
  const rows = run({ points: 'base', sell: false });
  assert.equal(rows[rows.length - 1].recipe.id, 3);
  assert.equal(rows.find((r) => r.recipe.id === 2).points, 500);
  assert.equal(rows.find((r) => r.recipe.id === 1).net, 310);
});

test('demand: crafts a day the AH buys the output of', () => {
  const mass = run().find((r) => r.recipe.id === 2);
  assert.equal(mass.demandCrafts, 5); // 50 ingots a day / 10 per craft
});

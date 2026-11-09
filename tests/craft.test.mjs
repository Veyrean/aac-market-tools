// Craft-or-buy maths. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCraftCalc, CATEGORY_VOCATION } from '../site/assets/js/lib/craft.js';

// Lumber (Carpentry) from Logs; a Plank needs Lumber + Coins; Ore ↔ Ingot form a loop on purpose.
const recipes = [
  { id: 1, product: 10, name: 'Lumber', category: 'Lumber', amount: 1, chance: 100, labor: 10, materials: [{ id: 20, name: 'Log', qty: 10 }] },
  { id: 2, product: 11, name: 'Plank', category: 'Furniture', amount: 2, chance: 100, labor: 20, materials: [{ id: 10, name: 'Lumber', qty: 3 }, { id: 500, name: 'Coin', qty: 100 }] },
  { id: 3, product: 30, name: 'Ingot', category: 'Metal', amount: 1, chance: 100, labor: 5, materials: [{ id: 31, name: 'Ore', qty: 2 }] },
  { id: 4, product: 31, name: 'Ore', category: 'Ore', amount: 1, chance: 100, labor: 5, materials: [{ id: 30, name: 'Ingot', qty: 1 }] },
];
const prices = { 10: 1000, 11: 9000, 20: 60, 30: 500, 31: 100 };
const calc = (over = {}) => makeCraftCalc({
  recipes,
  buyPrice: (id) => prices[id] ?? null,
  laborFactor: (v) => (v === 'Carpentry' ? 0.5 : 1),
  laborCopper: 10, // 1 labor = 10 copper
  choiceOf: () => 'auto',
  ...over,
});

test('crafting wins when materials plus labor are cheaper than buying', () => {
  const b = calc().best(10);
  // 10 logs × 60c + 10 labor × 0.5 (Carpentry) × 10c = 650c < 1000c
  assert.equal(b.decision, 'craft');
  assert.equal(b.mats, 600);
  assert.equal(b.labor, 5);
  assert.equal(b.unit, 650);
});

test('nested trees use the cheapest sub-choice, coins are copper, amounts divide', () => {
  const b = calc().best(11);
  // 2 planks per craft: (3 × 650 + 100 + 20 labor × 0.5 × 10c) / 2
  assert.equal(b.decision, 'craft');
  assert.equal(b.unit, (3 * 650 + 100 + 100) / 2);
  assert.equal(b.labor, (3 * 5 + 10) / 2);
});

test('forcing "buy" and pricey labor flip the decision', () => {
  assert.equal(calc({ choiceOf: (id) => (id === 10 ? 'buy' : 'auto') }).best(10).decision, 'buy');
  assert.equal(calc({ laborCopper: 100 }).best(10).decision, 'buy'); // 600 + 5 × 100 = 1100 > 1000
});

test('a recipe loop does not hang and falls back to buying', () => {
  const b = calc().best(30);
  assert.ok(b.decision === 'buy' || b.decision === 'craft');
  assert.ok(b.unit <= 500);
});

test('missing prices are reported, the shopping list adds up leaves', () => {
  const c = calc({ buyPrice: (id) => (id === 20 ? null : prices[id] ?? null) });
  assert.equal(c.best(10).decision, 'buy'); // logs unpriced: can only buy lumber
  const t = calc().tree(11, 4);
  const list = calc().shoppingList(t);
  assert.deepEqual(list.map((x) => [x.name, x.qty]), [['Log', 60], ['Coin', 200]]);
  assert.deepEqual(calc().laborByVocation(t).map((x) => x.vocation), ['Carpentry']);
});

test('vocation suggestions cover the main processing categories', () => {
  assert.equal(CATEGORY_VOCATION.Lumber, 'Carpentry');
  assert.equal(CATEGORY_VOCATION.Metal, 'Metalwork');
  assert.equal(CATEGORY_VOCATION['Stone Brick'], 'Masonry');
  assert.equal(CATEGORY_VOCATION.Fabric, 'Tailoring');
});

test('the tree can show an item as crafted even when buying is cheaper', () => {
  const c = calc({ laborCopper: 100 }); // lumber is cheaper to buy now
  assert.equal(c.best(10).decision, 'buy');
  const t = c.tree(10, 2, 0, new Set(), true);
  assert.equal(t.decision, 'craft');
  assert.deepEqual(t.children.map((x) => [x.name, x.qty]), [['Log', 20]]);
  assert.equal(c.laborByVocation(t)[0].labor, 10); // 2 × 10 labor × 0.5
});

test('identical recipes (one per workbench) count once, keeping the lowest labor', () => {
  const dup = [...recipes, { ...recipes[0], id: 99, labor: 4 }];
  const c = makeCraftCalc({ recipes: dup, buyPrice: (id) => prices[id] ?? null, laborFactor: () => 1, laborCopper: 0 });
  assert.equal(c.recipesOf(10).length, 1);
  assert.equal(c.recipesOf(10)[0].labor, 4);
});

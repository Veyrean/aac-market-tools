// Owned land weekly maths. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landWeek } from '../site/assets/js/lib/land.js';

const G = 10000;
const prices = { 'Cedar Sapling': 2 * G, 'Apple Sapling': 3 * G, Lumber: 1 * G, Apple: 0.1 * G };
const ctx = {
  priceByName: (n) => prices[n] ?? null,
  certCopper: 0.9 * G,
  outputFactor: (v) => (v === 'Farming' ? 1.2 : 1), // e.g. a +20% pitchfork for Farming
  laborFactor: (v) => (v === 'Logging' ? 0.6 : 1),   // e.g. Famed Logging
};

test('a mixed 16x16 farm: tax, saplings, output, labor and net per week', () => {
  const farm = {
    taxCerts: 10, extraGold: 0.5,
    plantings: [
      { id: 'a', item: 'Cedar Sapling', qty: 9, cyclesPerWeek: 1, vocation: 'Logging', laborEach: 10, outputs: [{ name: 'Lumber', qty: 3 }] },
      { id: 'b', item: 'Apple Sapling', qty: 10, cyclesPerWeek: 2, vocation: 'Farming', laborEach: 5, outputs: [{ name: 'Apple', qty: 20 }, { name: 'Mystery', qty: 1 }] },
    ],
  };
  const w = landWeek(farm, ctx);
  assert.equal(w.tax, 9 * G);
  assert.equal(w.upkeep, 0.5 * G);
  assert.equal(w.inputs, 9 * 2 * G + 20 * 3 * G);
  assert.equal(w.cost, 9 * G + 0.5 * G + 78 * G);
  const lumber = 9 * 3 * 1 * G, apples = 20 * 20 * 1.2 * 0.1 * G;
  assert.ok(Math.abs(w.outputValue - (lumber + apples)) < 1e-6);
  assert.equal(w.labor, 9 * 10 * 0.6 + 20 * 5 * 1);
  assert.ok(Math.abs(w.net - (lumber + apples - w.cost)) < 1e-6);
  assert.deepEqual(w.missing, ['Mystery']);
});

test('a fruit tree gathered many times is bought once per replanting', () => {
  const orchard = { taxCerts: 0, extraGold: 0, plantings: [{ id: 'a', item: 'Apple Sapling', qty: 10, cyclesPerWeek: 14, harvestsPerPlant: 28, vocation: 'Gathering', laborEach: 0, outputs: [] }] };
  assert.equal(landWeek(orchard, ctx).inputs, (10 * 14 * 3 * G) / 28);
});

test('a property with nothing on it costs only its tax', () => {
  const w = landWeek({ taxCerts: 3, extraGold: 0, plantings: [] }, ctx);
  assert.equal(w.cost, 3 * 0.9 * G);
  assert.equal(w.hasOutputs, false);
  assert.equal(w.spl, null);
});

test('missing tax certificate price is reported, not silently zero', () => {
  const w = landWeek({ taxCerts: 3, extraGold: 0, plantings: [] }, { ...ctx, certCopper: null });
  assert.equal(w.tax, null);
  assert.ok(w.missing.includes('Tax Certificate'));
});

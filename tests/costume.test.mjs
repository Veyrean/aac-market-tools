// Costume / undergarment builder. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, synthiumNeeded, lockedAt, STATS, gradeIndex, statValue } from '../site/assets/js/lib/costume.js';

test('stat tables match the guide', () => {
  assert.equal(STATS.costume.length, 42);
  assert.equal(STATS.undergarment.length, 27);
  const dp = STATS.costume.find((s) => s.name === 'Defense Penetration');
  assert.deepEqual([dp.unlock, dp.eternal], ['Celestial', 755]);
  assert.equal(statValue(STATS.costume.find((s) => s.name === 'Backstab Melee Damage')), '8.2%');
});

test('build order follows the guide example (costume, melee)', () => {
  const steps = buildOrder('costume', ['Backstab Melee Damage', 'Melee Skill Damage', 'Melee Critical Rate', 'Melee Critical Damage', 'Defense Penetration'], gradeIndex('Legendary'));
  const at = (g) => steps.find((s) => s.grade === g);
  assert.deepEqual(at('Grand').roll, ['Backstab Melee Damage']);
  assert.deepEqual([at('Arcane').keep, at('Arcane').free], [['Backstab Melee Damage'], 1]);
  assert.deepEqual(at('Celestial').roll, ['Defense Penetration']);
  assert.deepEqual(at('Divine').roll, ['Melee Critical Damage']);
  assert.deepEqual(at('Epic').roll, ['Melee Skill Damage']);
  assert.deepEqual([at('Legendary').keep.length, at('Legendary').roll, at('Legendary').free], [4, ['Melee Critical Rate'], 0]);
});

test('synthium per step and totals', () => {
  const r = synthiumNeeded(gradeIndex('Basic'), gradeIndex('Mythic'));
  assert.equal(r.steps.length, 10);
  assert.deepEqual(r.totals, { Clear: 12, Vivid: 28, Lucid: 104, Radiant: 76 });
  assert.deepEqual(synthiumNeeded(gradeIndex('Heroic'), gradeIndex('Celestial')).totals, { Lucid: 44 });
});

test('stats above the target grade are flagged', () => {
  assert.deepEqual(lockedAt('undergarment', ['Melee Attack', 'Melee Critical Rate'], gradeIndex('Epic')).map((s) => s.name), ['Melee Critical Rate']);
});

// Land helpers and the land snapshot. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAND_GROUPS, LEGACY_LAND_TYPES, duration } from '../site/assets/js/lib/landtypes.js';

const land = JSON.parse(readFileSync(new URL('../pipeline/static/land.json', import.meta.url)));

test('durations read like the game', () => {
  assert.equal(duration(26), '1 d 2 h');
  assert.equal(duration(14.3), '14 h 18 m');
  assert.equal(duration(0.5), '30 m');
});

test('land snapshot: main farms by size, known types for old labels, plant vocations', () => {
  const t = Object.fromEntries(land.types.map((x) => [x.name, x]));
  assert.deepEqual(['Scarecrow Garden', 'Scarecrow Farm', 'Gazebo Farm', 'Oak Treehouse', 'Beanstalk House'].map((n) => t[n].size), [8, 16, 24, 28, 44]);
  assert.ok(land.types.every((x) => LAND_GROUPS.includes(x.group) || x.group === 'Other'));
  assert.ok(Object.values(LEGACY_LAND_TYPES).every((n) => t[n]));
  const p = Object.fromEntries(land.plantables.map((x) => [x.name, x]));
  assert.deepEqual(p['Apple Sapling'].vocations, ['Logging', 'Gathering']);
  assert.ok(p['Apple Sapling'].repeat.everyH > 11);
  assert.deepEqual(p['Clover Seed'].vocations, ['Gathering']);
  assert.deepEqual(p['Piglet'].vocations, ['Husbandry']);
  assert.ok(!land.plantables.some((x) => x.name.endsWith(' Bundle')));
});

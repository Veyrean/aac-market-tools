// Land type list tests. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAND_TYPE_GROUPS, LAND_TYPES, LEGACY_LAND_TYPES } from '../site/assets/js/lib/landtypes.js';

test('land types: unique, short enough to store, legacy labels map to listed types', () => {
  assert.equal(new Set(LAND_TYPES).size, LAND_TYPES.length);
  assert.ok(LAND_TYPES.every((t) => t.length <= 40));
  assert.ok(Object.values(LEGACY_LAND_TYPES).every((t) => LAND_TYPES.includes(t)));
  assert.deepEqual(LAND_TYPE_GROUPS.map(([g]) => g), ['Farms', 'Farmhouses', 'Houses', 'Private workstations', 'Other']);
});

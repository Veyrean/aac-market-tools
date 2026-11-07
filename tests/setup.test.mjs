// My Setup tests. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as setup from '../site/assets/js/lib/setup.js';

test('rank table matches the in-game Rank Details window', () => {
  assert.equal(setup.RANKS.length, 11);
  assert.deepEqual(setup.RANKS[10], { id: 10, name: 'Famed', labor: 40, time: 26 });
  assert.deepEqual(setup.RANKS[9], { id: 9, name: 'Celebrity', labor: 30, time: 20 });
  assert.equal(setup.ALL_VOCATIONS.length, 23);
});

test('labor, time and output factors combine rank and active tools', () => {
  setup.edit((d) => {
    d.proficiencies.Farming.rank = 10; // Famed: −40% labor, −26% time
    d.tools = [
      { id: 'a1', name: 'Pitchfork', appliesTo: 'Farming', outputPct: 20, laborPct: 10, timePct: 0, active: true },
      { id: 'a2', name: 'Off', appliesTo: 'Farming', outputPct: 50, laborPct: 0, timePct: 0, active: false },
      { id: 'a3', name: 'Buff', appliesTo: 'All', outputPct: 0, laborPct: 0, timePct: 10, active: true },
    ];
  });
  assert.ok(Math.abs(setup.laborFactor('Farming') - 0.6 * 0.9) < 1e-12);
  assert.ok(Math.abs(setup.timeFactor('Farming') - 0.74 * 0.9) < 1e-12);
  assert.equal(setup.outputFactor('Farming'), 1.2);
  assert.equal(setup.laborFactor('Mining'), 1); // Novice, no tool for Mining
});

test('sanitizing drops hostile or broken values', () => {
  const s = setup.sanitizeSetup({
    name: 'x'.repeat(500) + '‮',
    proficiencies: { Farming: { rank: 99, points: -5 }, NotAVocation: { rank: 3 } },
    land: [{ id: '../evil', name: '<img src=x onerror=alert(1)>', count: 1e9, taxCerts: 'lots', cycleDays: 0 }, 'junk'],
    tools: [{ appliesTo: 'Hacking', outputPct: 1e9 }],
    vehicles: [{ consumables: Array.from({ length: 50 }, () => ({ name: 'Fuel', qty: 2 })) }],
    laborSilver: Infinity,
    __proto__: { polluted: true },
  });
  assert.equal(s.name.length, 40);
  assert.equal(s.proficiencies.Farming.rank, 0);
  assert.equal(s.proficiencies.Farming.points, null);
  assert.ok(!('NotAVocation' in s.proficiencies));
  assert.equal(s.land.length, 1);
  assert.match(s.land[0].id, /^[a-z0-9]+$/);
  assert.equal(s.land[0].name, '<img src=x onerror=alert(1)>'); // kept as plain text; the UI never renders it as HTML
  assert.equal(s.land[0].taxCerts, 0);
  assert.deepEqual(s.land[0].plantings, []);
  assert.equal(s.tools[0].appliesTo, 'All');
  assert.equal(s.tools[0].outputPct, 0);
  assert.equal(s.vehicles[0].consumables.length, 20);
  assert.equal(s.laborSilver, 0);
});

test('a downloaded setup loads back as a new setup', () => {
  setup.edit((d) => { d.laborSilver = 12; d.land = [{ id: 'l1', name: 'Farm', taxCerts: 3, plantings: [{ id: 'p1', item: 'Cedar Sapling', qty: 19, cyclesPerWeek: 1, vocation: 'Logging', outputs: [{ name: 'Lumber', qty: 2 }] }] }]; });
  const file = setup.exportActive();
  const before = setup.names().length;
  const name = setup.importFile(file);
  assert.equal(setup.names().length, before + 1);
  assert.equal(setup.activeName(), name);
  assert.equal(setup.active().laborSilver, 12);
  assert.equal(setup.active().land[0].taxCerts, 3);
  assert.equal(setup.active().land[0].plantings[0].qty, 19);
  assert.equal(setup.active().land[0].plantings[0].outputs[0].name, 'Lumber');
  assert.throws(() => setup.importFile('{"kind":"something else"}'), /not an AAC Market Tools setup/);
  assert.throws(() => setup.importFile('not json'), /not valid JSON/);
});

test('older land entries are converted to weekly values', () => {
  const s = setup.sanitizeSetup({ land: [{ name: 'Old', count: 2, taxCerts: 3, cycleDays: 14, extraGold: 1 }] });
  assert.equal(s.land[0].taxCerts, 3); // 2 properties × 3 certs per 14 days = 3 per week
  assert.equal(s.land[0].extraGold, 1);
  assert.ok(!('slots' in s.land[0]) && !('cycleDays' in s.land[0]));
});

// Costume and undergarment synthesis: which stats unlock at which grade, how many stat slots each
// grade has, the build order (keep / roll for) and the synthium stones needed. No DOM access.
// Stat tables and build-order logic: "Costume and Undergarments Guide" by Raffin.
// Synthium per step: provided by the site owner from the game.

export const GRADES = ['Basic', 'Grand', 'Rare', 'Arcane', 'Heroic', 'Unique', 'Celestial', 'Divine', 'Epic', 'Legendary', 'Mythic'];
export const gradeIndex = (name) => GRADES.indexOf(name);

/** Stat slots at each grade (Basic has none). */
export const SLOTS = [0, 1, 1, 2, 3, 4, 4, 4, 4, 5, 5];

/** Synthium stones to go from grade i to grade i + 1. */
export const SYNTHIUM_STEPS = [
  { qty: 4, stone: 'Clear' },   // Basic → Grand
  { qty: 8, stone: 'Clear' },   // Grand → Rare
  { qty: 12, stone: 'Vivid' },  // Rare → Arcane
  { qty: 16, stone: 'Vivid' },  // Arcane → Heroic
  { qty: 20, stone: 'Lucid' },  // Heroic → Unique
  { qty: 24, stone: 'Lucid' },  // Unique → Celestial
  { qty: 28, stone: 'Lucid' },  // Celestial → Divine
  { qty: 32, stone: 'Lucid' },  // Divine → Epic
  { qty: 36, stone: 'Radiant' }, // Epic → Legendary
  { qty: 40, stone: 'Radiant' }, // Legendary → Mythic
];
export const STONES = ['Clear', 'Vivid', 'Lucid', 'Radiant'];
export const STONE_ITEM = { Clear: 8000929, Vivid: 8000930, Lucid: 8000931, Radiant: 8000932 };
export const stoneName = (s) => `${s} Synthium Stone`;

// [stat, unlock grade, amount at Eternal 100% (fractions are percentages)]
const COSTUME = [
  ['Physical Defense', 'Grand', 1210], ['Magic Defense', 'Grand', 1210], ['Max Health', 'Grand', 1550],
  ['Move Speed', 'Grand', 0.05], ['Stealth Detection', 'Grand', 0.28], ['PvE Magic Skills', 'Grand', 0.074],
  ['PvE Melee Skills', 'Grand', 0.074], ['PvE Ranged Skills', 'Grand', 0.074], ['Backstab Melee Damage', 'Grand', 0.082],
  ['Backstab Magic Damage', 'Grand', 0.082], ['Backstab Ranged Damage', 'Grand', 0.082], ['Received Damage', 'Grand', 0.038],
  ['Melee Attack', 'Arcane', 47.5], ['Ranged Attack', 'Arcane', 47.5], ['Magic Attack', 'Arcane', 47.5],
  ['Healing Power', 'Arcane', 47.5], ['PvE Damage Reduction', 'Arcane', 0.051], ['Received Healing', 'Arcane', 0.11],
  ['Cast Time', 'Arcane', 0.046], ['Evasion', 'Unique', 0.035], ['Parry Rate', 'Unique', 0.035],
  ['Shield Block Rate', 'Unique', 0.028], ['Resilience', 'Unique', 910], ['Toughness', 'Unique', 295], ['Focus', 'Unique', 960],
  ['Defense Penetration', 'Celestial', 755], ['Magic Defense Penetration', 'Celestial', 755],
  ['Received Magic Damage', 'Divine', 0.031], ['Received Melee Damage', 'Divine', 0.031], ['Received Ranged Damage', 'Divine', 0.031],
  ['Magic Critical Damage', 'Divine', 0.118], ['Melee Critical Damage', 'Divine', 0.118], ['Ranged Critical Damage', 'Divine', 0.118],
  ['Critical Heal Bonus', 'Divine', 0.118], ['Melee Skill Damage', 'Epic', 0.036], ['Magic Skill Damage', 'Epic', 0.036],
  ['Ranged Skill Damage', 'Epic', 0.036], ['Healing', 'Epic', 0.036], ['Melee Critical Rate', 'Legendary', 0.054],
  ['Magic Critical Rate', 'Legendary', 0.054], ['Ranged Critical Rate', 'Legendary', 0.054], ['Critical Heal Rate', 'Legendary', 0.054],
];
const UNDERGARMENT = [
  ['Physical Defense', 'Grand', 723], ['Magic Defense', 'Grand', 723], ['Max Health', 'Grand', 930],
  ['Melee Attack', 'Grand', 21.8], ['Ranged Attack', 'Grand', 21.8], ['Magic Attack', 'Grand', 21.8], ['Healing Power', 'Grand', 21.8],
  ['Backstab Melee Damage', 'Grand', 0.079], ['Backstab Magic Damage', 'Grand', 0.079], ['Backstab Ranged Damage', 'Grand', 0.079],
  ['Resilience', 'Arcane', 824], ['Toughness', 'Arcane', 373], ['Focus', 'Arcane', 660],
  ['Defense Penetration', 'Arcane', 522], ['Magic Defense Penetration', 'Arcane', 522],
  ['Received Magic Damage', 'Unique', 0.067], ['Received Melee Damage', 'Unique', 0.067], ['Received Ranged Damage', 'Unique', 0.067],
  ['Shield Defense Penetration Rate', 'Unique', 0.12], ['Melee Skill Damage', 'Divine', 0.038], ['Magic Skill Damage', 'Divine', 0.038],
  ['Ranged Skill Damage', 'Divine', 0.038], ['Healing', 'Divine', 0.038], ['Melee Critical Rate', 'Legendary', 0.048],
  ['Magic Critical Rate', 'Legendary', 0.048], ['Ranged Critical Rate', 'Legendary', 0.048], ['Critical Heal Rate', 'Legendary', 0.048],
];
const toStats = (rows) => rows.map(([name, unlock, eternal]) => ({ name, unlock, unlockIndex: gradeIndex(unlock), eternal, pct: eternal < 1 }));
export const STATS = { costume: toStats(COSTUME), undergarment: toStats(UNDERGARMENT) };
export const KINDS = { costume: 'Costume', undergarment: 'Undergarment' };
/** Rerolling one stat costs one Serendipity Stone. */
export const SERENDIPITY_ID = 8001000;
export const MAX_STATS = 5;

/** '8.2%' for fractions, '1,210' for flat values (the guide's value at Eternal 100%: reference only). */
export const statValue = (s) => (s.pct ? `${+(s.eternal * 100).toFixed(1)}%` : s.eternal.toLocaleString('en-US'));

/**
 * Build order: at each grade where something changes, which wanted stats to keep, which to roll for,
 * and how many slots are still free ("keep upgrading" with any stat).
 * Wanted stats get a slot in order of unlock grade (then the player's order), as soon as one is free.
 * @returns [{grade, slots, keep[], roll[], free}]
 */
export function buildOrder(kind, wanted, target = GRADES.length - 1) {
  const list = STATS[kind];
  const chosen = wanted.map((n, i) => ({ s: list.find((x) => x.name === n), i })).filter((x) => x.s)
    .sort((a, b) => a.s.unlockIndex - b.s.unlockIndex || a.i - b.i).map((x) => x.s);
  const steps = [];
  let have = [];
  for (let g = 1; g <= target; g++) {
    const slots = SLOTS[g];
    const want = chosen.filter((s) => s.unlockIndex <= g).slice(0, slots).map((s) => s.name);
    const keep = want.filter((n) => have.includes(n)), roll = want.filter((n) => !have.includes(n));
    const free = slots - want.length;
    const prev = steps[steps.length - 1];
    if (roll.length || !prev || prev.slots !== slots) steps.push({ grade: GRADES[g], gradeIndex: g, slots, keep, roll, free });
    have = want;
  }
  return steps;
}

/**
 * Expected Serendipity Stones for the rolls of a build order (an estimate).
 * Assumes each roll gives a random stat, all equally likely, from the stats unlocked at that grade
 * that the item does not already have; several wanted stats of a step are interchangeable; the first
 * stat of a newly opened slot is free. Adds `stones` to every step and returns the total.
 */
export function rollEstimate(kind, steps) {
  const list = STATS[kind];
  let total = 0, prevSlots = 0;
  for (const st of steps) {
    const pool = list.filter((s) => s.unlockIndex <= st.gradeIndex).length;
    let held = st.keep.length, freeTries = Math.max(0, st.slots - prevSlots), stones = 0;
    for (let left = st.roll.length; left > 0; left--) {
      const tries = (pool - held) / left; // expected tries until one of the `left` wanted stats comes up
      stones += freeTries > 0 ? Math.max(0, tries - 1) : tries;
      if (freeTries > 0) freeTries--;
      held++;
    }
    st.stones = stones;
    total += stones;
    prevSlots = st.slots;
  }
  return total;
}

/** Stats that cannot be on the item at the target grade. */
export const lockedAt = (kind, wanted, target) => STATS[kind].filter((s) => wanted.includes(s.name) && s.unlockIndex > target);

/** Synthium stones to go from grade `from` to `to`: {steps:[{from, to, qty, stone}], totals:{stone: qty}} */
export function synthiumNeeded(from, to) {
  const steps = [], totals = {};
  for (let g = from; g < to && g < SYNTHIUM_STEPS.length; g++) {
    const st = SYNTHIUM_STEPS[g];
    steps.push({ from: GRADES[g], to: GRADES[g + 1], ...st });
    totals[st.stone] = (totals[st.stone] || 0) + st.qty;
  }
  return { steps, totals };
}

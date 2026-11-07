// "My Setup": a player's proficiencies, land, tools, vehicles and labor value.
// Stored only in this browser (localStorage), with several named setups, and
// downloadable / loadable as a JSON file. Every value is validated on load and import.

import { LEGACY_LAND_TYPES } from './landtypes.js';

const KEY = 'aacmt.setups.v1';
const FILE_KIND = 'aac-market-tools/setup';
const MAX_ROWS = 200;
const listeners = new Set();

/** Rank bonuses, as shown in the in-game "Rank Details" window. */
export const RANKS = [
  { id: 0, name: 'Novice', labor: 0, time: 3 },
  { id: 1, name: 'Veteran', labor: 5, time: 6 },
  { id: 2, name: 'Expert', labor: 10, time: 6 },
  { id: 3, name: 'Master', labor: 15, time: 6 },
  { id: 4, name: 'Authority', labor: 20, time: 12 },
  { id: 5, name: 'Champion', labor: 20, time: 12 },
  { id: 6, name: 'Adept', labor: 20, time: 12 },
  { id: 7, name: 'Herald', labor: 20, time: 16 },
  { id: 8, name: 'Virtuoso', labor: 25, time: 16 },
  { id: 9, name: 'Celebrity', labor: 30, time: 20 },
  { id: 10, name: 'Famed', labor: 40, time: 26 },
];

export const VOCATIONS = {
  Harvesting: ['Husbandry', 'Farming', 'Fishing', 'Logging', 'Gathering', 'Mining'],
  Crafting: ['Alchemy', 'Cooking', 'Handicrafts', 'Machining', 'Metalwork', 'Printing', 'Masonry', 'Tailoring', 'Leatherwork', 'Weaponry', 'Carpentry'],
  Special: ['Construction', 'Larceny', 'Commerce', 'Artistry', 'Exploration', 'Taming'],
};
export const ALL_VOCATIONS = Object.values(VOCATIONS).flat();
/** Vocations used to harvest what grows or is raised on land: the harvesting vocations except Fishing. */
export const LAND_VOCATIONS = VOCATIONS.Harvesting.filter((v) => v !== 'Fishing');

/** The rank icon as shown in game: 1 (Novice) … 10 (Celebrity), ★ (Famed). */
export const rankIcon = (r) => (r.id >= 10 ? '★' : String(r.id + 1));

export const TAX_CERTIFICATE_ID = 31891;

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

function emptySetup(name = 'My setup') {
  const proficiencies = {};
  for (const v of ALL_VOCATIONS) proficiencies[v] = { rank: 0, points: null };
  return { name, proficiencies, land: [], tools: [], vehicles: [], laborSilver: 0, notes: '' };
}

// ---------------------------------------------------------------- validation
const text = (v, max = 80, fallback = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, max) : fallback);
const num = (v, lo, hi, fallback = null) => (Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);
const rows = (v, fn) => (Array.isArray(v) ? v.slice(0, MAX_ROWS).map(fn).filter(Boolean) : []);
const id = (v) => (typeof v === 'string' && /^[a-z0-9]{1,24}$/.test(v) ? v : newId());

function sanitizeItems(list) {
  // rows with an empty name are kept (the player is still typing) and ignored by the calculators
  return rows(list, (c) => (c && typeof c === 'object' ? { name: text(c.name, 120), qty: num(c.qty, 0, 1e6, 1) } : null)).slice(0, 20);
}

/** One week is one tax cycle. Older setups stored a count and a cycle length; fold them into weekly values. */
function sanitizeProperty(l) {
  const count = num(l.count, 1, 999, 1), cycleDays = num(l.cycleDays, 1, 365, 7), toWeek = (v) => (v * count * 7) / cycleDays;
  return {
    id: id(l.id), name: text(l.name, 60) || 'Property', type: legacyType(text(l.type, 40)),
    taxCerts: num(toWeek(num(l.taxCerts, 0, 100000, 0)), 0, 1e6, 0),
    extraGold: num(toWeek(num(l.extraGold, 0, 1e7, 0)), 0, 1e8, 0),
    notes: text(l.notes, 200),
    plantings: rows(l.plantings, sanitizePlanting).slice(0, 60),
  };
}

const legacyType = (t) => LEGACY_LAND_TYPES[t] || t;

function sanitizePlanting(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: id(p.id),
    item: text(p.item, 120),                       // what is planted / raised (sapling, seed, animal…)
    qty: num(p.qty, 0, 100000, 1),
    cyclesPerWeek: num(p.cyclesPerWeek, 0, 1000, 1), // plant → harvest cycles per week; the planted item is bought each cycle
    vocation: LAND_VOCATIONS.includes(p.vocation) ? p.vocation : 'Farming',
    laborEach: num(p.laborEach, 0, 10000, 0),        // labor to harvest one plant / animal once
    outputs: sanitizeItems(p.outputs),               // per plant per harvest: [{name, qty (average)}]
  };
}

export function sanitizeSetup(raw, fallbackName = 'My setup') {
  const s = emptySetup(text(raw?.name, 40) || fallbackName);
  if (!raw || typeof raw !== 'object') return s;
  if (raw.proficiencies && typeof raw.proficiencies === 'object') {
    for (const v of ALL_VOCATIONS) {
      const p = raw.proficiencies[v];
      if (p && typeof p === 'object') {
        s.proficiencies[v] = { rank: num(p.rank, 0, RANKS.length - 1, 0), points: num(p.points, 0, 1e7, null) };
      }
    }
  }
  s.land = rows(raw.land, (l) => (l && typeof l === 'object' ? sanitizeProperty(l) : null)).slice(0, 50);
  s.tools = rows(raw.tools, (t) => (t && typeof t === 'object' ? {
    id: id(t.id), name: text(t.name, 60) || 'Tool', appliesTo: ALL_VOCATIONS.includes(t.appliesTo) ? t.appliesTo : 'All',
    outputPct: num(t.outputPct, -100, 1000, 0), laborPct: num(t.laborPct, -100, 100, 0), timePct: num(t.timePct, -100, 100, 0),
    active: t.active !== false, notes: text(t.notes, 200),
  } : null));
  s.vehicles = rows(raw.vehicles, (v) => (v && typeof v === 'object' ? {
    id: id(v.id), name: text(v.name, 60) || 'Vehicle', capacity: num(v.capacity, 0, 1000, 1), tripMinutes: num(v.tripMinutes, 0, 10000, null),
    consumables: sanitizeItems(v.consumables), riskPct: num(v.riskPct, 0, 100, 0), notes: text(v.notes, 200),
  } : null));
  s.laborSilver = num(raw.laborSilver, 0, 1e6, 0);
  s.notes = text(raw.notes, 500);
  return s;
}

function sanitizeState(raw) {
  const state = { active: 'My setup', setups: {} };
  if (raw && typeof raw === 'object' && raw.setups && typeof raw.setups === 'object') {
    for (const [name, s] of Object.entries(raw.setups).slice(0, 20)) {
      const clean = sanitizeSetup(s, text(name, 40) || 'Setup');
      state.setups[clean.name] = clean;
    }
  }
  if (!Object.keys(state.setups).length) state.setups['My setup'] = emptySetup('My setup');
  state.active = state.setups[raw?.active] ? raw.active : Object.keys(state.setups)[0];
  return state;
}

// ---------------------------------------------------------------- state
let state = (() => {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  const s = sanitizeState(raw);
  if (!raw) {
    // first visit after the update: carry over the labor value from the old Settings page
    try {
      const old = JSON.parse(localStorage.getItem('aacmt.settings.v1') || 'null');
      if (old && Number.isFinite(old.laborSilver) && old.laborSilver > 0) s.setups[s.active].laborSilver = Math.min(old.laborSilver, 1e6);
    } catch { /* ignore */ }
  }
  return s;
})();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: keep in memory */ }
  for (const l of listeners) l(state);
}

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const active = () => state.setups[state.active];
export const names = () => Object.keys(state.setups);
export const activeName = () => state.active;

/** Change the active setup through a callback; the result is re-validated. */
export function edit(fn) {
  const draft = JSON.parse(JSON.stringify(active()));
  fn(draft);
  const clean = sanitizeSetup(draft, state.active);
  clean.name = state.active;
  state.setups[state.active] = clean;
  persist();
}

export function switchTo(name) { if (state.setups[name]) { state.active = name; persist(); } }

function uniqueName(base) {
  let name = text(base, 40) || 'Setup', i = 2;
  while (state.setups[name]) name = `${text(base, 36)} ${i++}`;
  return name;
}

export function create(name, copyOf = null) {
  if (Object.keys(state.setups).length >= 20) throw new Error('You can keep at most 20 setups.');
  const n = uniqueName(name);
  state.setups[n] = copyOf ? { ...sanitizeSetup(state.setups[copyOf], n), name: n } : emptySetup(n);
  state.active = n;
  persist();
  return n;
}

export function rename(newName) {
  const n = text(newName, 40);
  if (!n || n === state.active) return;
  if (state.setups[n]) throw new Error('A setup with that name already exists.');
  state.setups[n] = { ...state.setups[state.active], name: n };
  delete state.setups[state.active];
  state.active = n;
  persist();
}

export function remove(name) {
  delete state.setups[name];
  if (!Object.keys(state.setups).length) state.setups['My setup'] = emptySetup('My setup');
  if (!state.setups[state.active]) state.active = Object.keys(state.setups)[0];
  persist();
}

export function exportActive() {
  return JSON.stringify({ kind: FILE_KIND, version: 1, exportedAt: new Date().toISOString(), setup: active() }, null, 2);
}

/** Import a setup file as a new setup (never overwrites an existing one). */
export function importFile(textContent) {
  let parsed;
  try { parsed = JSON.parse(textContent); } catch { throw new Error('This file is not valid JSON.'); }
  if (!parsed || parsed.kind !== FILE_KIND || !parsed.setup) throw new Error('This file is not an AAC Market Tools setup.');
  if (Object.keys(state.setups).length >= 20) throw new Error('You can keep at most 20 setups. Delete one first.');
  const n = uniqueName(text(parsed.setup.name, 40) || 'Imported setup');
  state.setups[n] = { ...sanitizeSetup(parsed.setup, n), name: n };
  state.active = n;
  persist();
  return n;
}

// ---------------------------------------------------------------- helpers for calculators
export const rankOf = (vocation, setup = active()) => RANKS[setup.proficiencies[vocation]?.rank ?? 0];

/** Active tool bonuses that apply to a vocation (summed). */
export function toolBonus(vocation, setup = active()) {
  let output = 0, labor = 0, time = 0;
  for (const t of setup.tools) {
    if (!t.active || (t.appliesTo !== 'All' && t.appliesTo !== vocation)) continue;
    output += t.outputPct; labor += t.laborPct; time += t.timePct;
  }
  return { output, labor, time };
}

/** Multiplier for labor cost of an action of this vocation (rank reduction, then tools). */
export function laborFactor(vocation, setup = active()) {
  const r = rankOf(vocation, setup).labor, t = toolBonus(vocation, setup).labor;
  return Math.max(0, (1 - r / 100) * (1 - t / 100));
}

export function timeFactor(vocation, setup = active()) {
  const r = rankOf(vocation, setup).time, t = toolBonus(vocation, setup).time;
  return Math.max(0, (1 - r / 100) * (1 - t / 100));
}

export function outputFactor(vocation, setup = active()) {
  return Math.max(0, 1 + toolBonus(vocation, setup).output / 100);
}

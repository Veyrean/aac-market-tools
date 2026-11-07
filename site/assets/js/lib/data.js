// Loading and shaping of the published data files (all served by this site itself).
import { get as settings } from './store.js';

const cache = new Map();
const HISTORY_BUCKETS = 32;

async function loadJSON(name) {
  if (!cache.has(name)) {
    const p = fetch(`data/${name}.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${name} data (HTTP ${r.status}).`);
      return r.json();
    });
    cache.set(name, p);
    p.catch(() => cache.delete(name));
  }
  return cache.get(name);
}

export const loadMeta = () => loadJSON('meta');

let marketShaped = null;
export async function loadMarket() {
  if (marketShaped) return marketShaped;
  const raw = await loadJSON('market');
  const f = raw.fields;
  const at = (r, name) => { const i = f.indexOf(name); return i < 0 ? null : r[i]; };
  const rows = raw.rows.map((r) => ({
    id: at(r, 'id'), name: String(at(r, 'name')), cat: at(r, 'cat'), catLabel: raw.categories[String(at(r, 'cat'))] || 'Other',
    // "latest" is the 24-hour average from the price sheet
    latest: at(r, 'latest'), avg7: at(r, 'avg7'), avg30: at(r, 'avg30'),
    vol1: at(r, 'vol1') || 0, vol7: at(r, 'vol7') || 0, vol30: at(r, 'vol30') || 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = new Map();
  for (const r of rows) byName.set(r.name.toLowerCase(), byName.has(r.name.toLowerCase()) ? null : r); // null = ambiguous
  marketShaped = { rows, byId, byName, categories: raw.categories, groups: Array.isArray(raw.groups) ? raw.groups : [], builtAt: raw.builtAt, sheetDate: raw.sheetDate };
  return marketShaped;
}

let regradeShaped = null;
export async function loadRegrade() {
  if (regradeShaped) return regradeShaped;
  const raw = await loadJSON('regrade');
  const f = raw.fields, c = (n) => f.indexOf(n);
  const items = raw.items.map((r) => ({
    id: r[c('id')], name: String(r[c('name')]), group: r[c('group')], type: r[c('type')], level: r[c('level')],
    slotCost: r[c('slotCost')], maxGrade: r[c('maxGrade')], baseCost: r[c('baseCost')],
  }));
  regradeShaped = { rules: raw.rules, items, builtAt: raw.builtAt };
  return regradeShaped;
}

let packsShaped = null;
export async function loadPacks() {
  if (!packsShaped) packsShaped = await loadJSON('packs');
  return packsShaped;
}

/** The market price of a row according to the chosen basis, falling back to whatever exists. */
export function basisPrice(row, basis = settings().priceBasis) {
  if (!row) return null;
  const order = basis === 'avg30' ? ['avg30', 'avg7', 'latest'] : basis === 'avg7' ? ['avg7', 'latest', 'avg30'] : ['latest', 'avg7', 'avg30'];
  for (const k of order) if (row[k] != null) return row[k];
  return null;
}

/**
 * Price lookup used by the calculators. Order:
 *   1. the visitor's own override  2. market data by item id  3. market data by exact name
 *      (some items, e.g. anchoring shards, exist under two ids)
 */
export function priceResolver(market, rules = null, names = new Map()) {
  const s = settings();
  return function priceInfo(id) {
    const ov = s.overrides[String(id)];
    if (ov != null) return { copper: ov, source: 'your price' };
    const byId = market.byId.get(id);
    if (byId && basisPrice(byId, s.priceBasis) != null) return { copper: basisPrice(byId, s.priceBasis), source: 'market' };
    const name = names.get(id);
    const byName = name ? market.byName.get(name.toLowerCase()) : null;
    if (byName && basisPrice(byName, s.priceBasis) != null) return { copper: basisPrice(byName, s.priceBasis), source: 'market (by name)' };
    return { copper: null, source: 'missing' };
  };
}

/** Item names known to the regrade rules (scrolls, lucky points, charms, emblems, shards). */
export function regradeItemNames(rules) {
  const names = new Map();
  for (const s of rules.scrolls) names.set(s.item_id, s.name);
  for (const s of rules.supports) {
    names.set(s.item_id, s.name);
    if (s.shard_item_id && s.shard_name) names.set(s.shard_item_id, s.shard_name);
  }
  const lucky = { weapon: 'Lucky Sunpoint', armor: 'Lucky Moonpoint', accessory: 'Lucky Starpoint' };
  for (const s of rules.scrolls) if (s.lucky_point_item_id && lucky[s.type]) names.set(s.lucky_point_item_id, lucky[s.type]);
  return names;
}

/**
 * Daily price history collected by this site's own scheduled job (one point per day,
 * the 24-hour average from the price sheet). Returns [{date, avg: copper, volume}] oldest first.
 */
export async function priceHistory(itemId) {
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error('Bad item id');
  const bucket = await loadJSON(`history/${itemId % HISTORY_BUCKETS}`);
  const days = Array.isArray(bucket.days) ? bucket.days : [];
  const points = (bucket.items && bucket.items[String(itemId)]) || [];
  return points
    .filter((p) => Array.isArray(p) && days[p[0]] && Number.isFinite(p[1]))
    .map((p) => ({ date: days[p[0]], avg: p[1], volume: Number.isFinite(p[2]) ? p[2] : 0 }));
}

/** First day the site started recording history (for "history since …" notes). */
export async function historyStart(itemId) {
  const bucket = await loadJSON(`history/${itemId % HISTORY_BUCKETS}`);
  return Array.isArray(bucket.days) && bucket.days.length ? bucket.days[0] : null;
}

export function quantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const pos = (sortedValues.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (pos - lo);
}

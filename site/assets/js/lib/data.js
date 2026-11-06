// Loading and shaping of the published data files, plus live price history.
import { get as settings } from './store.js';

const cache = new Map();
const API = 'https://api.sermeatball.com';

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
  const col = (name) => f.indexOf(name);
  const I = { id: col('id'), name: col('name'), cat: col('cat'), latest: col('latest'), avg7: col('avg7'), avg30: col('avg30'), vol7: col('vol7'), vol30: col('vol30'), allTime: col('allTime') };
  const rows = raw.rows.map((r) => ({
    id: r[I.id], name: String(r[I.name]), cat: r[I.cat], catLabel: raw.categories[String(r[I.cat])] || 'Other',
    latest: r[I.latest], avg7: r[I.avg7], avg30: r[I.avg30], vol7: r[I.vol7] || 0, vol30: r[I.vol30] || 0, allTime: r[I.allTime],
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = new Map();
  for (const r of rows) byName.set(r.name.toLowerCase(), byName.has(r.name.toLowerCase()) ? null : r); // null = ambiguous
  marketShaped = { rows, byId, byName, categories: raw.categories, groups: Array.isArray(raw.groups) ? raw.groups : [], builtAt: raw.builtAt };
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
 *   4. the source's own price list (only real market prices, never vendor placeholders)
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
    const p = rules?.prices?.[String(id)];
    if (p && p.copper != null && p.tier === 'latest') return { copper: p.copper, source: 'Ser Meatball list' };
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
 * Daily price history straight from the price API (on demand, one request per item view).
 * Returns [{date:'YYYY-MM-DD', avg: copper, volume}] oldest first, one entry per day.
 */
export async function priceHistory(itemId, days = 30) {
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error('Bad item id');
  const now = Date.now();
  const end = new Date(now + 86400000); // the end date is exclusive upstream: ask through tomorrow
  const start = new Date(now - days * 86400000);
  const d = (x) => x.toISOString().slice(0, 10);
  const key = `hist:${itemId}:${days}:${d(end)}`;
  if (cache.has(key)) return cache.get(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const p = fetch(`${API}/prices/${itemId}/${d(start)}/${d(end)}`, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((r) => { if (!r.ok) throw new Error(`Price API returned HTTP ${r.status}`); return r.json(); })
    .then((list) => {
      if (!Array.isArray(list)) throw new Error('Unexpected price history format');
      const byDay = new Map();
      for (const e of list) {
        if (!e || typeof e.last_cache_time !== 'string') continue;
        const avg = Number(e.average), vol = Number(e.volume);
        if (!Number.isFinite(avg) || avg < 0 || avg > 1e9) continue;
        const day = e.last_cache_time.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const prev = byDay.get(day);
        if (!prev || e.last_cache_time > prev.t) byDay.set(day, { t: e.last_cache_time, date: day, avg: Math.round(avg * 10000), volume: Number.isFinite(vol) && vol >= 0 ? vol : 0 });
      }
      return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({ date, avg, volume }) => ({ date, avg, volume }));
    })
    .finally(() => clearTimeout(timer));
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

export function quantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const pos = (sortedValues.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (pos - lo);
}

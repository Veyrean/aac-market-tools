// Per-browser settings. Everything stays in localStorage on the visitor's device.
// Reads and writes are wrapped so the app still works when storage is blocked.

const KEY = 'aacmt.settings.v1';
const listeners = new Set();

export const DEFAULTS = Object.freeze({
  patron: true,              // Patron halves the AH trade fee (10% → 5%)
  priceBasis: 'latest',      // 'latest' | 'avg7' | 'avg30'
  laborSilver: 0,            // gold value of one labor point, in silver
  overrides: {},             // itemId → copper, user's own prices (beat market data)
  watchlist: [],             // [{id, name, buyBelow, sellAbove, added}]
  regrade: {
    resplendentOnlyFromDivine: true,
    emblemExtraGold: 0,
    last: null,
  },
});

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function sanitize(raw) {
  const s = clone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.patron === 'boolean') s.patron = raw.patron;
  if (['latest', 'avg7', 'avg30'].includes(raw.priceBasis)) s.priceBasis = raw.priceBasis;
  if (Number.isFinite(raw.laborSilver) && raw.laborSilver >= 0 && raw.laborSilver < 1e6) s.laborSilver = raw.laborSilver;
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [id, c] of Object.entries(raw.overrides)) {
      if (/^\d{1,10}$/.test(id) && Number.isFinite(c) && c >= 0 && c < 1e13) s.overrides[id] = Math.round(c);
    }
  }
  if (Array.isArray(raw.watchlist)) {
    s.watchlist = raw.watchlist.slice(0, 500).filter((w) => w && Number.isInteger(w.id)).map((w) => ({
      id: w.id,
      name: typeof w.name === 'string' ? w.name.slice(0, 120) : `Item ${w.id}`,
      buyBelow: Number.isFinite(w.buyBelow) && w.buyBelow > 0 ? Math.round(w.buyBelow) : null,
      sellAbove: Number.isFinite(w.sellAbove) && w.sellAbove > 0 ? Math.round(w.sellAbove) : null,
      added: typeof w.added === 'string' ? w.added.slice(0, 40) : null,
    }));
  }
  if (raw.regrade && typeof raw.regrade === 'object') {
    if (typeof raw.regrade.resplendentOnlyFromDivine === 'boolean') s.regrade.resplendentOnlyFromDivine = raw.regrade.resplendentOnlyFromDivine;
    if (Number.isFinite(raw.regrade.emblemExtraGold) && raw.regrade.emblemExtraGold >= 0) s.regrade.emblemExtraGold = raw.regrade.emblemExtraGold;
    if (raw.regrade.last && typeof raw.regrade.last === 'object') s.regrade.last = raw.regrade.last;
  }
  return s;
}

let state = (() => {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return clone(DEFAULTS); }
})();

export function get() { return state; }

export function update(fn) {
  const next = clone(state);
  fn(next);
  state = sanitize(next);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: keep in memory */ }
  for (const l of listeners) l(state);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function exportJSON() { return JSON.stringify({ app: 'aac-market-tools', version: 1, settings: state }, null, 2); }

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.app !== 'aac-market-tools') throw new Error('This file is not an AAC Market Tools export.');
  update((s) => Object.assign(s, sanitize(parsed.settings)));
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state = clone(DEFAULTS);
  for (const l of listeners) l(state);
}

export function watchEntry(id) { return state.watchlist.find((w) => w.id === id) || null; }

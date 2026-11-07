// Number formatting. All prices are handled internally in copper (1g = 100s = 10 000c).

export const COPPER_PER_GOLD = 10000;

export function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
}

export function pct(p, d = 1) { return Number.isFinite(p) ? `${fmt(p * 100, d)}%` : '—'; }

/** In-game style: 12g 34s 56c, shortened for large amounts. */
export function money(copper, { signed = false } = {}) {
  if (copper == null || !Number.isFinite(copper)) return '—';
  const neg = copper < 0, c = Math.round(Math.abs(copper));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cc = c % 100;
  const sign = neg ? '−' : signed && copper > 0 ? '+' : '';
  if (g >= 1e6) return `${sign}${fmt(g / 1e6, 2)}M g`;
  if (g >= 10000) return `${sign}${g.toLocaleString('en-US')}g`;
  if (g >= 100) return `${sign}${g.toLocaleString('en-US')}g ${s}s`;
  if (g > 0) return `${sign}${g}g ${s}s ${cc}c`;
  if (s > 0) return `${sign}${s}s ${cc}c`;
  return `${sign}${cc}c`;
}

/** Compact axis labels: 1.2k, 35, 4.5M (gold). */
export function goldShort(copper) {
  const g = copper / 10000, a = Math.abs(g);
  if (a >= 1e6) return `${(g / 1e6).toFixed(a >= 1e7 ? 0 : 1)}Mg`;
  if (a >= 1e3) return `${(g / 1e3).toFixed(a >= 1e4 ? 0 : 1)}kg`;
  if (a >= 10) return `${g.toFixed(0)}g`;
  if (a >= 1) return `${g.toFixed(1)}g`;
  return `${Math.round(copper / 100)}s`;
}

export function count(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${fmt(n / 1e6, 1)}M`;
  if (Math.abs(n) >= 1e4) return `${fmt(n / 1e3, 0)}k`;
  return Math.round(n).toLocaleString('en-US');
}

export const toCopper = (gold) => Math.round(Number(gold) * COPPER_PER_GOLD);
export const toGold = (copper) => (copper == null ? '' : +(copper / COPPER_PER_GOLD).toFixed(4));

export function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** Auction House maths, as shown on the in-game sale receipt. */
export function saleBreakdown(priceCopper, patron) {
  const feeRate = patron ? 0.05 : 0.10;
  const deposit = Math.round(priceCopper * 0.01);
  const tradeFee = Math.round(priceCopper * feeRate);
  return { price: priceCopper, deposit, feeRate, tradeFee, profit: priceCopper + deposit - tradeFee, net: priceCopper - tradeFee };
}

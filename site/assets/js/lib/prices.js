// Price sanity checks. No DOM access.
//
// The price sheet's 7- and 30-day averages can be thrown far off by a few mistyped sales (Charcoal
// Stabilizer traded at 1.5-1.9g every day while its 7-day average read 11g), and the 24-hour average of
// an item that sells a handful a day jumps around (one propellant: 156g, 2,146g, 487g, 1,687g on
// consecutive days). The pipeline publishes the median of the daily averages (med7, med30); a value that
// is far from its median is replaced by the median and flagged, so every page uses the same sane price.

export const AVG_TOLERANCE = 1.5;   // an average more than 1.5x above or below its median is replaced
export const SPIKE_TOLERANCE = 2;   // a 24h average more than 2x away from the 7-day median ...
export const THIN_DAY = 20;         // ... with fewer than 20 sales that day is replaced

const off = (v, med, k) => v != null && med != null && med > 0 && (v > med * k || v < med / k);

/**
 * @param row {latest, avg7, avg30, vol1, med7, med30}
 * @returns {latest, avg7, avg30, raw: {latest, avg7, avg30}, fixed: {latest?, avg7?, avg30?}} where
 *          fixed[key] says why that price was replaced ('spike' for the 24h value, 'outlier' for averages)
 */
export function sanePrices(row) {
  const raw = { latest: row.latest ?? null, avg7: row.avg7 ?? null, avg30: row.avg30 ?? null };
  const out = { ...raw }, fixed = {};
  const med7 = row.med7 ?? null, med30 = row.med30 ?? med7;
  if (off(raw.avg7, med7, AVG_TOLERANCE)) { out.avg7 = med7; fixed.avg7 = 'outlier'; }
  if (off(raw.avg30, med30, AVG_TOLERANCE)) { out.avg30 = med30; fixed.avg30 = 'outlier'; }
  if ((row.vol1 ?? 0) < THIN_DAY && off(raw.latest, med7, SPIKE_TOLERANCE)) { out.latest = med7; fixed.latest = 'spike'; }
  return { ...out, raw, fixed };
}

export const FIX_TEXT = {
  outlier: 'Far from the median of the daily prices (a few unusual sales skew this average): the median is used instead.',
  spike: 'Few sales and far from the 7-day median: the median is used instead.',
};

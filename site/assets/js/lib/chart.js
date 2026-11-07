// Minimal canvas charts (no third-party libraries).
import { goldShort, count } from './format.js';

const C = { grid: '#22303f', axis: '#7f91a8', line: '#f0c96a', bars: '#3f7ab6', red: '#ef7373', green: '#7ee2a6', purple: '#ad8cff' };

export function prepCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 260;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';
  return { ctx, w, h };
}

export function emptyChart(canvas, message) {
  const { ctx } = prepCanvas(canvas);
  ctx.fillStyle = '#74869e'; ctx.font = '14px system-ui, sans-serif'; ctx.fillText(message, 18, 30);
}

function hline(ctx, x0, x1, y) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }

/**
 * Daily price line with volume bars underneath.
 * points: [{date, avg, volume}], marks: [{value, color, label}]
 * Returns a hit-test function (clientX) → index.
 */
export function priceChart(canvas, points, marks = []) {
  const { ctx, w, h } = prepCanvas(canvas);
  if (!points.length) { emptyChart(canvas, 'No trades in this period.'); return () => -1; }
  const L = 56, R = 46, T = 12, B = 24, pw = w - L - R, ph = h - T - B;
  const priceH = ph * 0.72, volTop = T + ph * 0.78, volH = ph * 0.22;
  const vals = points.map((p) => p.avg).concat(marks.map((m) => m.value).filter(Number.isFinite));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { hi += 1; lo = Math.max(0, lo - 1); }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const n = points.length, X = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * priceH;
  ctx.strokeStyle = C.grid; ctx.fillStyle = C.axis; ctx.lineWidth = 1; ctx.textAlign = 'right';
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); hline(ctx, L, L + pw, y); ctx.fillText(goldShort(v), L - 6, y + 4); }
  const maxVol = Math.max(...points.map((p) => p.volume), 1), bw = Math.max(2, (pw / n) * 0.6);
  ctx.fillStyle = C.bars;
  points.forEach((p, i) => { const bh = (p.volume / maxVol) * volH; ctx.fillRect(X(i) - bw / 2, volTop + volH - bh, bw, bh); });
  ctx.fillStyle = C.axis; ctx.textAlign = 'left'; ctx.fillText(`vol ${count(maxVol)}`, L + pw + 4, volTop + 8);
  for (const m of marks) {
    if (!Number.isFinite(m.value)) continue;
    ctx.save(); ctx.strokeStyle = m.color; ctx.setLineDash([5, 4]); hline(ctx, L, L + pw, Y(m.value)); ctx.restore();
    ctx.fillStyle = m.color; ctx.textAlign = 'left'; ctx.fillText(m.label, L + pw + 4, Y(m.value) + 4);
  }
  ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.avg)) : ctx.moveTo(X(i), Y(p.avg))));
  ctx.stroke();
  ctx.fillStyle = C.line; points.forEach((p, i) => { ctx.beginPath(); ctx.arc(X(i), Y(p.avg), 2.5, 0, 7); ctx.fill(); });
  ctx.fillStyle = C.axis; ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) ctx.fillText(points[i].date.slice(5), X(i), h - 6);
  return (clientX) => {
    const r = canvas.getBoundingClientRect(), x = clientX - r.left;
    if (x < L - 10 || x > L + pw + 10) return -1;
    return Math.max(0, Math.min(n - 1, Math.round(((x - L) / pw) * (n - 1))));
  };
}

/**
 * Regrade cost distribution: histogram of finished runs + cumulative "done within x" line.
 * Returns hit-test (clientX) → spend value or null.
 */
export function distributionChart(canvas, sim, { doneWithin, budget = 0, mean = null }) {
  const { ctx, w, h } = prepCanvas(canvas);
  if (!sim.succ.length) { emptyChart(canvas, 'No simulated run reached the target.'); return () => null; }
  const L = 46, R = 40, T = 12, B = 24, pw = w - L - R, ph = h - T - B;
  const succ = sim.succ;
  const hi = Math.max(succ[Math.min(succ.length - 1, Math.floor(succ.length * 0.99))], 1);
  const bins = Math.max(16, Math.min(60, Math.floor(pw / 12))), cnt = new Array(bins).fill(0);
  let over = 0;
  for (const v of succ) { if (v > hi) { over++; continue; } cnt[Math.min(bins - 1, Math.floor((v / hi) * bins))]++; }
  const maxC = Math.max(...cnt, 1), X = (v) => L + Math.max(0, Math.min(1, v / hi)) * pw, Y = (p) => T + (1 - p) * ph;
  ctx.strokeStyle = C.grid; ctx.fillStyle = C.axis; ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => { hline(ctx, L, L + pw, Y(p)); ctx.textAlign = 'left'; ctx.fillText(`${p * 100}%`, L + pw + 5, Y(p) + 4); });
  ctx.textAlign = 'center';
  for (let k = 0; k <= 5; k++) { const v = (hi * k) / 5; ctx.fillText(goldShort(v), X(v), h - 6); }
  const bw = pw / bins; ctx.fillStyle = C.bars;
  cnt.forEach((c, i) => { const bh = (ph * 0.92 * c) / maxC; ctx.fillRect(L + i * bw + 1, T + ph - bh, Math.max(1, bw - 2), bh); });
  ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath();
  for (let px = 0; px <= pw; px += 2) { const y = Y(doneWithin(sim, (px / pw) * hi)); px ? ctx.lineTo(L + px, y) : ctx.moveTo(L + px, y); }
  ctx.stroke();
  const vline = (v, color, label, dash) => {
    if (!(v >= 0) || v > hi) return;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(X(v), T); ctx.lineTo(X(v), T + ph); ctx.stroke(); ctx.setLineDash([]);
    const right = X(v) > L + pw - 70; ctx.textAlign = right ? 'right' : 'left'; ctx.fillText(label, X(v) + (right ? -4 : 4), T + 11); ctx.restore();
  };
  if (mean != null) vline(mean, C.green, 'mean', [4, 3]);
  if (budget > 0) vline(budget, C.red, 'budget', null);
  if (over) { ctx.fillStyle = '#8f9fb5'; ctx.textAlign = 'right'; ctx.fillText(`+${((over / sim.N) * 100).toFixed(1)}% of runs cost more`, L + pw, T + 26); }
  return (clientX) => {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left - L) / pw)) * hi;
  };
}

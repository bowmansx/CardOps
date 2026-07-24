// Cents-exact money allocation (prevention rule 12): split an order-level
// amount across lines by weight so the parts ALWAYS sum back to the whole.
// Running-total rounding: line i gets round(cum_i) − round(cum_{i−1}), which
// reconciles exactly by construction and never drifts more than a cent per
// line. Degenerate weights (all zero/negative) put the whole amount on the
// last line — visible in one place rather than vanished.
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const t = Math.round(total * 100);
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const W = w.reduce((s, x) => s + x, 0);
  if (W <= 0) {
    const out = new Array(n).fill(0);
    out[n - 1] = t / 100;
    return out;
  }
  const out: number[] = [];
  let cum = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    cum += w[i];
    const upto = Math.round((cum / W) * t);
    out.push((upto - prev) / 100);
    prev = upto;
  }
  return out;
}

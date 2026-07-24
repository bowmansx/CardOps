// Card price movement (Beau, 2026-07-20). Pure, testable math over a card's
// price_history: percentage move across a window, and deviation from the card's
// own trend line (its "normal"). No I/O — the route/cron read history and call
// these. Powers %-move alerts, the top-movers digest, and the "generated
// standards" deviation flag.

export type PricePoint = { price: number; at: number }; // at = epoch ms
const DAY = 86_400_000;

/** Sorted ascending copy, dropping non-finite/non-positive prices. */
function clean(history: PricePoint[]): PricePoint[] {
  return history
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.at))
    .sort((a, b) => a.at - b.at);
}

/** The most recent point at or before `cutoff`, or null if none that old. */
function atOrBefore(sorted: PricePoint[], cutoff: number): PricePoint | null {
  let found: PricePoint | null = null;
  for (const p of sorted) {
    if (p.at <= cutoff) found = p;
    else break;
  }
  return found;
}

export type Move = { from: number; to: number; pct: number; fromAt: number; toAt: number };

/**
 * Percent change from the value as-of (now − windowDays) to the latest value.
 * Uses the newest point at/before the window start as the baseline (a card
 * priced weekly still compares against the right era). Null when there isn't a
 * distinct earlier point to compare against.
 */
export function pctChangeOverWindow(history: PricePoint[], windowDays: number, now: number): Move | null {
  const s = clean(history).filter((p) => p.at <= now);
  if (s.length < 2) return null;
  const latest = s[s.length - 1];
  const cutoff = now - windowDays * DAY;
  const base = atOrBefore(s, cutoff) ?? s[0];
  if (base.at >= latest.at || base.price <= 0) return null;
  // Don't call it a "windowDays move" if the baseline is far older than the
  // window (a card that hasn't been repriced in months isn't a recent mover).
  if (base.at < now - windowDays * 2 * DAY) return null;
  const pct = ((latest.price - base.price) / base.price) * 100;
  return { from: base.price, to: latest.price, pct: Math.round(pct * 10) / 10, fromAt: base.at, toAt: latest.at };
}

/** up / down / flat by an absolute threshold (percent). */
export function classifyMove(pct: number, thresholdPct: number): "up" | "down" | "flat" {
  if (pct >= thresholdPct) return "up";
  if (pct <= -thresholdPct) return "down";
  return "flat";
}

export type Deviation = { expected: number; actual: number; pct: number };

/**
 * How far the latest price sits from the card's OWN trend line — its generated
 * "normal". Fits a least-squares line to the history and projects it to `now`;
 * the deviation is (actual − expected) / expected. Needs ≥3 points spanning
 * time. This is the basis for "flag when a card deviates >X% from its typical
 * trend" without the user hand-setting a target.
 */
export function trendDeviation(history: PricePoint[], now: number): Deviation | null {
  const s = clean(history).filter((p) => p.at <= now);
  if (s.length < 3) return null;
  // Fit the trend on the ESTABLISHED history (everything but the newest point),
  // then measure how far the newest price lands from that projection — so a
  // fresh spike shows up in full instead of fitting to itself.
  const latest = s[s.length - 1];
  const prior = s.slice(0, -1);
  // Don't extrapolate the trend further forward than we actually observed it —
  // two clustered priors projected across a long gap give a meaningless line.
  const priorSpan = prior[prior.length - 1].at - prior[0].at;
  if (priorSpan <= 0 || latest.at - prior[prior.length - 1].at > priorSpan) return null;
  const t0 = prior[0].at;
  const xs = prior.map((p) => (p.at - t0) / DAY);
  const ys = prior.map((p) => p.price);
  const n = prior.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null; // prior points all at one instant → no trend
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const xNow = (latest.at - t0) / DAY;
  const expected = intercept + slope * xNow;
  if (!(expected > 0)) return null; // a non-positive projection isn't a usable baseline
  const pct = ((latest.price - expected) / expected) * 100;
  return { expected: Math.round(expected * 100) / 100, actual: latest.price, pct: Math.round(pct * 10) / 10 };
}

// CardOps liquidity (Beau, 2026-07-25) — pure functions, no I/O, server+client
// safe, same philosophy as valuation.ts. Everything here derives from SOLD
// comps (card_comps + vendor sales history): sales VELOCITY says how often
// this thing actually trades; the sold-price DISTRIBUTION says where a chosen
// asking price sits among prices that really cleared. That's the honest limit
// of our data today — no active-listing supply, no market-wide sell-through
// (those arrive with the eBay Browse/Insights phase and plug in as extra
// inputs; see `SellInputs`, which is deliberately a bag we can widen).
//
// Every output carries its sample size. Consumers must show it — a tier from
// 3 comps and a tier from 300 are different animals, and pretending otherwise
// is how trust dies. Estimates, not promises: the model calibrates against
// Beau's own listed_at→sold_at outcomes once real sales exist.

import type { Comp } from "./valuation";

const DAY = 86_400_000;
export const HALF_LIFE_DAYS = 180; // recency half-life for the price distribution

// ── Velocity: how often does it actually trade? ─────────────────────────────

export type Velocity = {
  n90: number;          // dated sales in the last 90 days
  n365: number;         // dated sales in the last 365 days
  perMonth: number | null; // best velocity estimate; null = too thin to say
  lastSaleDays: number | null;
  activeMonths12: number;  // distinct months with ≥1 sale in the last 12
};

export function velocity(comps: Comp[], nowMs: number): Velocity {
  let n90 = 0, n365 = 0;
  let lastMs: number | null = null;
  const months = new Set<string>();
  for (const c of comps) {
    if (c.sale_date == null || c.sale_price == null) continue; // undated/unpriced rows carry no liquidity signal
    const t = new Date(c.sale_date).getTime();
    if (!Number.isFinite(t) || t > nowMs + DAY) continue;
    const age = nowMs - t;
    if (age <= 90 * DAY) n90++;
    if (age <= 365 * DAY) {
      n365++;
      months.add(c.sale_date.slice(0, 7));
    }
    if (lastMs == null || t > lastMs) lastMs = t;
  }
  // Prefer the 90-day window when it has a real sample (current tempo beats
  // last year's); fall back to the year; below 2 sales/yr we refuse to guess.
  const perMonth = n90 >= 3 ? n90 / 3 : n365 >= 2 ? n365 / 12 : null;
  return {
    n90,
    n365,
    perMonth,
    lastSaleDays: lastMs == null ? null : Math.floor((nowMs - lastMs) / DAY),
    activeMonths12: months.size,
  };
}

// ── Tiers: label + the facts behind it, never a bare score ──────────────────

export type LiquidityTier = "hot" | "liquid" | "moderate" | "thin" | "stale" | "unknown";

export const TIER_LABEL: Record<LiquidityTier, string> = {
  hot: "Hot",
  liquid: "Liquid",
  moderate: "Moderate",
  thin: "Thin",
  stale: "Stale",
  unknown: "Unknown",
};

export const TIER_BLURB: Record<LiquidityTier, string> = {
  hot: "Trades constantly — pricing is the only variable.",
  liquid: "Sells steadily; a fair price should move in weeks.",
  moderate: "A market exists but patience is part of the price.",
  thin: "Occasional sales — expect to wait or discount.",
  stale: "No recorded sale in over a year.",
  unknown: "Not enough sales data to say.",
};

export function tierOf(v: Velocity): LiquidityTier {
  if (v.n365 === 0) return v.lastSaleDays != null ? "stale" : "unknown";
  if (v.perMonth == null) return "thin";
  if (v.lastSaleDays != null && v.lastSaleDays > 365) return "stale";
  if (v.perMonth >= 8) return "hot";
  if (v.perMonth >= 3) return "liquid";
  if (v.perMonth >= 1) return "moderate";
  return "thin";
}

// ── The price↔likelihood model behind the slider ────────────────────────────

export type WeightedPrice = { price: number; w: number };

/** Recency-weighted sold prices (half-life 180d). Undated comps get the
 *  minimum weight rather than being dropped — they're evidence of a clearing
 *  price, just old-ish evidence of unknown age. */
export function weightedPrices(comps: Comp[], nowMs: number): WeightedPrice[] {
  const out: WeightedPrice[] = [];
  for (const c of comps) {
    if (c.sale_price == null || !(c.sale_price > 0)) continue;
    let w = 0.25;
    if (c.sale_date != null) {
      const t = new Date(c.sale_date).getTime();
      if (Number.isFinite(t) && t <= nowMs + DAY) {
        w = Math.pow(0.5, (nowMs - t) / (HALF_LIFE_DAYS * DAY));
      }
    }
    out.push({ price: c.sale_price, w: Math.max(0.05, w) });
  }
  return out;
}

/** Weighted share of recorded sales that cleared AT OR ABOVE this price —
 *  the fraction of the historical market a seller at `price` was competitive
 *  for. Monotone non-increasing in price. */
export function shareAtOrAbove(weighted: WeightedPrice[], price: number): number {
  let above = 0, total = 0;
  for (const { price: p, w } of weighted) {
    total += w;
    if (p >= price) above += w;
  }
  return total > 0 ? above / total : 0;
}

export type SellInputs = {
  perMonth: number | null;     // market velocity for the comparable set
  weighted: WeightedPrice[];   // sold-price distribution for the comparable set
  // Future inputs plug in here (active-listing supply, eBay traffic, own
  // days-on-market calibration) without changing any call site.
};

export type SellEstimate = {
  p30: number;          // probability of a sale within 30 days, 0..1
  expectedMonths: number; // expected time to sell at this price
  share: number;        // where the price sits vs. cleared sales (diagnostic)
};

/**
 * Sale likelihood at a chosen price. Model: comparable sales arrive at
 * `perMonth`; priced at `price`, you're competitive for the `share` of buyers
 * who historically paid that much or more (floored at 3% — someone overpays
 * eventually, but you can't bank on it). Poisson arrival of "a buyer you were
 * competitive for": P(30d) = 1 − e^(−λ·share). A HEURISTIC from sold comps —
 * it knows nothing about competing active listings yet, and says so in the UI.
 */
export function sellEstimate(inputs: SellInputs, price: number): SellEstimate | null {
  if (inputs.perMonth == null || !(price > 0) || inputs.weighted.length === 0) return null;
  const share = shareAtOrAbove(inputs.weighted, price);
  const lambda = inputs.perMonth * Math.min(1, Math.max(0.03, share));
  if (!(lambda > 0)) return null;
  return {
    p30: 1 - Math.exp(-lambda),
    expectedMonths: 1 / lambda,
    share,
  };
}

export function formatEta(months: number): string {
  if (!Number.isFinite(months)) return "—";
  const days = months * 30.44;
  if (days <= 10) return `~${Math.max(1, Math.round(days))} days`;
  if (days <= 56) return `~${Math.round(days / 7)} weeks`;
  if (months <= 6) return `~${Math.round(months)} months`;
  return "6+ months";
}

// ── Exact-card comp matching — mirrors the pricing engine's semantics ───────

export function matchesExact(
  card: { grader: string | null; grade: number | null; condition_type?: string | null },
  c: Comp,
): boolean {
  const compGrader = (c.grader ?? "RAW").toUpperCase();
  const cardGraded = card.condition_type === "graded" && card.grader != null;
  if (!cardGraded) return compGrader === "RAW";
  return compGrader === card.grader!.toUpperCase()
    && c.grade != null && card.grade != null
    && Number(c.grade) === Number(card.grade);
}

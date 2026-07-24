// Credit metering for pricing intelligence (Beau, 2026-07-22). Pure cost model:
// how many "credits" a template's estimate layer spends per run, and the low→high
// band for the usage bar. "Credits" are the app's metered compute unit — in the
// MANAGED model the app holds the AI + API keys and each run debits the user's
// balance; a template that pulls more data / a deeper model costs more. No I/O.

export type EstimateMode =
  | "off" // pure pricing math, no AI, ~free
  | "standard_plus" // Estimate A: the template's value, AI-adjusted with context
  | "all_sales_plus"; // Estimate B: ignore the template, reason over ALL sales + context

export type AiDepth = "light" | "deep"; // Haiku vs Opus (accuracy ↔ cost)

// The estimate layer that can ride on a pricing template. Toggles are the context
// sources folded into the AI's reasoning (each adds cost + hopefully accuracy).
export type EstimateConfig = {
  mode: EstimateMode;
  comparables?: boolean; // same set/parallel + same player's other cards
  news?: boolean; // player news / recent performance (web search)
  macro?: boolean; // market-conditions overlay (stocks/collectibles sentiment)
  pop?: boolean; // population-report scarcity
  ai?: AiDepth;
};

export const DEFAULT_ESTIMATE: EstimateConfig = { mode: "off" };

// Per-component credit cost. Tuned so a cheap estimate is a few credits and a
// maxed-out deep one is ~20 — the ceiling the bar fills against.
export const COST = {
  base_sales: 1, // pulling the card's own recent sales
  full_sales: 2, // pulling the FULL all-time sales set (Estimate B)
  comparables: 2,
  news: 3,
  macro: 1,
  pop: 1,
  ai_light: 3,
  ai_deep: 12,
} as const;

export type CostBand = "none" | "low" | "medium" | "high";
export const COST_CEILING = 20; // a maxed deep estimate ≈ this

/** Credits one run of this estimate config costs, plus its low→high band. */
export function estimateCost(c: EstimateConfig | undefined | null): { credits: number; band: CostBand } {
  if (!c || c.mode === "off") return { credits: 0, band: "none" };
  let credits = COST.base_sales; // every estimate pulls sales
  if (c.mode === "all_sales_plus") credits += COST.full_sales; // B reads everything
  if (c.comparables) credits += COST.comparables;
  if (c.news) credits += COST.news;
  if (c.macro) credits += COST.macro;
  if (c.pop) credits += COST.pop;
  credits += c.ai === "deep" ? COST.ai_deep : COST.ai_light;
  return { credits, band: bandFor(credits) };
}

export function bandFor(credits: number): CostBand {
  if (credits <= 0) return "none";
  if (credits <= 6) return "low";
  if (credits <= 14) return "medium";
  return "high";
}

/** 0..1 fill for the usage bar (clamped against the ceiling). */
export function costFill(credits: number): number {
  return Math.max(0, Math.min(1, credits / COST_CEILING));
}

// Normalize an untrusted stored/loaded config to a safe shape.
export function normalizeEstimate(c: unknown): EstimateConfig {
  const o = (c ?? {}) as Record<string, unknown>;
  const mode = o.mode === "standard_plus" || o.mode === "all_sales_plus" ? o.mode : "off";
  if (mode === "off") return { mode: "off" };
  return {
    mode,
    comparables: !!o.comparables,
    news: !!o.news,
    macro: !!o.macro,
    pop: !!o.pop,
    ai: o.ai === "deep" ? "deep" : "light",
  };
}

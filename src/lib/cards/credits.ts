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
//
// HONESTY RULE (2026-07-25). A toggle may only carry a real price if it causes
// real work. `news` used to cost 3 credits while doing nothing but appending a
// sentence telling the model to recall what it already knew; `macro` and `pop`
// were the same. Charging for data we never fetched is selling something that
// doesn't exist, and it is the fastest way to lose a customer's trust.
//
// Now:
//   news  — a REAL read of card_news (headlines fetched + AI-scored daily by
//           the news cron). Priced at 1: it costs us a local query, not a
//           vendor call, and retail should track the shape of real cost.
//   macro — no data source exists. It is a MODEL-JUDGMENT overlay and is
//           labelled as one in the UI. Free.
//   pop   — same. A real population signal needs a PSA/BGS API we don't have;
//           until then this is judgment, not data. Free.
//
// If a real source is wired later, raise the price then — never before.
export const COST = {
  base_sales: 1, // pulling the card's own recent sales
  full_sales: 2, // pulling the FULL all-time sales set (Estimate B)
  comparables: 2, // live vendor fetches, one per comparable query
  news: 1, // real headlines, read locally
  macro: 0, // model judgment, no fetch — must stay 0 until a source exists
  pop: 0, // model judgment, no fetch — must stay 0 until a source exists
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

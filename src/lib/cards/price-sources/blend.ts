// Consensus blend (pure, no I/O — safe to import on the client). Beau wanted a
// "hybrid/combination of all these places while still seeing each separately."
// The panel renders each source on its own; THIS computes the one blended
// number: the card's own comp value + the single best-matching quote per source,
// medianed. It is guidance only and never writes cards.market_value.
import type { SourceQuote } from "./types";

type CondCard = { condition_type: string; grader: string | null; grade: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The one quote from a source that best matches the card's own condition. */
function bestForCondition(qs: SourceQuote[], card: CondCard): SourceQuote | null {
  const graded = card.condition_type === "graded";
  if (graded) {
    const g = qs.filter((q) => q.grader != null);
    if (!g.length) return null;
    if (card.grade == null) return g[0];
    return [...g].sort(
      (a, b) => Math.abs((a.grade ?? 0) - card.grade!) - Math.abs((b.grade ?? 0) - card.grade!),
    )[0];
  }
  // Raw card → the ungraded quote, preferring the base (non-foil) value.
  const raw = qs.filter((q) => q.grader == null);
  if (!raw.length) return null;
  return raw.find((q) => !/foil|etched/i.test(q.label)) ?? raw[0];
}

export type Consensus = {
  value: number | null;
  method: "none" | "single" | "median";
  inputs: { label: string; price: number }[];
};

export function consensusForCard(
  card: CondCard,
  compValue: number | null,
  quotes: SourceQuote[],
): Consensus {
  const bySource = new Map<string, SourceQuote[]>();
  for (const q of quotes) {
    const arr = bySource.get(q.source) ?? [];
    arr.push(q);
    bySource.set(q.source, arr);
  }
  const inputs: { label: string; price: number }[] = [];
  if (compValue != null && compValue > 0) inputs.push({ label: "Your comps", price: compValue });
  for (const [source, qs] of bySource) {
    const best = bestForCondition(qs, card);
    if (best) inputs.push({ label: `${source}${best.label ? " · " + best.label : ""}`, price: best.price });
  }
  if (!inputs.length) return { value: null, method: "none", inputs };
  const prices = inputs.map((i) => i.price).sort((a, b) => a - b);
  const m = prices.length >> 1;
  const value = prices.length % 2 ? prices[m] : (prices[m - 1] + prices[m]) / 2;
  return { value: round2(value), method: inputs.length === 1 ? "single" : "median", inputs };
}

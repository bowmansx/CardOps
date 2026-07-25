// Anthropic API list prices, $/MTok (platform.claude.com pricing, checked
// 2026-07-25). This is the COST side of the credit system — the retail side
// (what a run charges in credits) lives in src/lib/cards/credits.ts, and the
// two are deliberately decoupled: reprice retail without redefining cost.
//
// An unknown model returns null, never $0 — the margin screen flags unpriced
// rows instead of silently under-counting spend (prevention rule 9).

export type AiTokens = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// Keys may be exact ids or prefixes (date-suffixed ids resolve by prefix).
const RATES: Record<string, { in: number; out: number }> = {
  "claude-fable-5": { in: 10, out: 50 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

// Cache multipliers on the input rate: writes bill at 1.25×, reads at 0.1×.
const CACHE_WRITE = 1.25;
const CACHE_READ = 0.1;

export function rateFor(model: string): { in: number; out: number } | null {
  if (RATES[model]) return RATES[model];
  for (const key of Object.keys(RATES)) if (model.startsWith(key)) return RATES[key];
  return null;
}

/**
 * Dollar cost of one API call, or null when the model has no rate on file.
 * `input_tokens` is the UNCACHED remainder (Anthropic usage semantics), so the
 * four components sum without double-counting.
 */
export function costUsd(model: string, u: AiTokens): number | null {
  const rate = rateFor(model);
  if (!rate) return null;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return (
    (u.input_tokens * rate.in +
      u.output_tokens * rate.out +
      cacheWrite * rate.in * CACHE_WRITE +
      cacheRead * rate.in * CACHE_READ) /
    1_000_000
  );
}

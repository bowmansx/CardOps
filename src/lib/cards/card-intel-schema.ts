import { z } from "zod";

// Card Intel: live-web news + a disciplined verdict + sell-timing strategy.
// Shared so the route validates output and pages safeParse stored jsonb.
export const IntelSchema = z.object({
  news: z.array(z.object({
    headline: z.string(),
    source: z.string(),
    when: z.string(),
    why_it_matters: z.string(),
  })),
  verdict: z.enum(["strong_buy", "buy", "hold", "sell", "strong_sell"]),
  verdict_reason: z.string(),
  timing_strategy: z.string(),
  watch_for: z.string(),
  horizon: z.string().optional(),
  tier: z.string().optional(), // light (no web) | medium | deep
  at: z.string().optional(),
});

export type CardIntel = z.infer<typeof IntelSchema>;

export function parseStoredIntel(v: unknown): CardIntel | null {
  const r = IntelSchema.safeParse(v);
  return r.success ? r.data : null;
}

export const HORIZONS = [
  { key: "flip", label: "Fast flip (days–weeks)" },
  { key: "season", label: "This season (weeks–months)" },
  { key: "longterm", label: "Long hold (6mo+)" },
] as const;

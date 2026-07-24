// CardOps owner preferences — stored in user_settings.prefs.cardops (jsonb,
// no migration). Read on the server; edited from the CardOps Settings page.

export type GradingFees = { PSA: number; BGS: number; SGC: number; CGC: number; ship: number };
export type DescTone = "professional" | "enthusiast" | "minimal";
export type DescLength = "short" | "medium" | "long";

export type CardOpsPrefs = {
  grading_fees: GradingFees;
  description_tone: DescTone;
  description_length: DescLength;
};

export const DEFAULT_CARDOPS: CardOpsPrefs = {
  grading_fees: { PSA: 25, BGS: 22, SGC: 18, CGC: 18, ship: 8 },
  description_tone: "professional",
  description_length: "medium",
};

const posOr = (v: unknown, d: number) => (typeof v === "number" && v >= 0 ? v : d);

// Merge stored prefs.cardops over the defaults (defensive — jsonb is untyped).
export function cardOpsPrefs(prefs: Record<string, unknown> | null | undefined): CardOpsPrefs {
  const p = (prefs?.cardops as Partial<CardOpsPrefs> | undefined) ?? {};
  const f = (p.grading_fees ?? {}) as Partial<GradingFees>;
  return {
    grading_fees: {
      PSA: posOr(f.PSA, DEFAULT_CARDOPS.grading_fees.PSA),
      BGS: posOr(f.BGS, DEFAULT_CARDOPS.grading_fees.BGS),
      SGC: posOr(f.SGC, DEFAULT_CARDOPS.grading_fees.SGC),
      CGC: posOr(f.CGC, DEFAULT_CARDOPS.grading_fees.CGC),
      ship: posOr(f.ship, DEFAULT_CARDOPS.grading_fees.ship),
    },
    description_tone: (["professional", "enthusiast", "minimal"] as const).includes(p.description_tone as DescTone)
      ? (p.description_tone as DescTone) : DEFAULT_CARDOPS.description_tone,
    description_length: (["short", "medium", "long"] as const).includes(p.description_length as DescLength)
      ? (p.description_length as DescLength) : DEFAULT_CARDOPS.description_length,
  };
}

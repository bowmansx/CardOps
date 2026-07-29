// CardOps owner preferences — stored in user_settings.prefs.cardops (jsonb,
// no migration). Read on the server; edited from the CardOps Settings page.

export type GradingFees = { PSA: number; BGS: number; SGC: number; CGC: number; ship: number };

/**
 * WHERE THE DEFAULT FEES CAME FROM, AND WHEN.
 *
 * A grading fee is a price with a date on it, and the app was treating it as a
 * constant. The defaults were PSA 25 / BGS 22 / SGC 18 / CGC 18, which were
 * roughly right when they were written and are roughly a HALF of 2026 reality:
 * PSA paused every tier under $80 on 2026-06-02 and Economy now starts around
 * $50. Every "should I grade this?" answer was computed against a price that no
 * longer exists - and it erred toward YES, which is the expensive direction.
 *
 * So the schedule carries its own date. The UI shows it, and a schedule older
 * than a few months reads as what it is: a number to go and check, not a fact.
 *
 * THESE ARE STARTING POINTS, NOT QUOTES. Tiers depend on declared value and
 * turnaround, and they change without notice. Beau's own configured figures
 * always win - `cardOpsPrefs` merges his over these.
 */
export const FEE_SCHEDULE_DATED = "2026-07";
export const FEE_SCHEDULE_NOTE =
  "Starting points only - graders change tiers without notice, and the tier you qualify for depends on declared value. Check the grader's site and set your own.";
export type DescTone = "professional" | "enthusiast" | "minimal";
export type DescLength = "short" | "medium" | "long";

export type CardOpsPrefs = {
  grading_fees: GradingFees;
  description_tone: DescTone;
  description_length: DescLength;
};

export const DEFAULT_CARDOPS: CardOpsPrefs = {
  // 2026-07. PSA Economy ~$50 (Value tiers paused since 2026-06-02); the others
  // are their common entry tiers. See FEE_SCHEDULE_DATED above.
  grading_fees: { PSA: 50, BGS: 30, SGC: 25, CGC: 25, ship: 12 },
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

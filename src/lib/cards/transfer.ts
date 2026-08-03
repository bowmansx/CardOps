// PRICING A CARD FROM ITS NEIGHBOURS (2026-08-02).
//
// `thinReason` says WHY a card has no history and which transfer that licenses.
// This performs them. Three methods, and each abstains rather than guessing:
//
//   analog_parallel        — a neighbouring parallel of the same card
//   comparable_product     — last year's equivalent product
//   own_history_discounted — the card's own old sales
//
// THE MULTIPLIERS ARE MEASURED, NEVER SEEDED. The build prompt asked to seed
// prior tables ("a /5 is worth ~4x a base card"), and those tables do not exist
// in this repo — inventing them would put a number nobody can defend at the
// centre of every thin card's price, which is exactly the failure this whole
// engine was built to avoid. Every ratio here comes from cards where BOTH sides
// were actually observed, and where there are too few, the answer is no answer.
//
// PAIRED, NOT POOLED — the mistake that makes a plausible wrong number.
// Comparing "median of every /5 in the set" against "median of every base card"
// conflates the PARALLEL effect with the PLAYER effect: /5s get pulled for stars
// and base cards trade for commons, so the ratio measures roster quality as much
// as scarcity. The ratio has to come from the SAME card observed both ways.
//
// MEDIAN OF RATIOS, not ratio of medians. One card with a huge price and both
// variants present would otherwise dominate the estimate for the whole set.

/** Two prices for the SAME card — the anchor variant and the target variant. */
export type PricePair = {
  /** Identifies the card the pair belongs to. Used only for reporting. */
  ref?: string;
  /** Price of the variant we HAVE evidence for. */
  from: number;
  /** Price of the variant we WANT, for this one card. */
  to: number;
};

/**
 * How many paired observations before a ratio is worth using.
 *
 * Three is the floor at which a median is meaningful rather than decorative —
 * with two, the "median" is an average of the only two numbers present, and with
 * one it is that number. This is a judgement and should move once there are
 * outcomes to calibrate it against.
 */
export const MIN_PAIRS = 3;

export type MeasuredRatio = {
  ratio: number;
  /** Paired observations behind it. Travels WITH the ratio, never separately. */
  pairs: number;
  /** Lowest and highest per-card ratio seen — how much the set disagrees. */
  spread: { low: number; high: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The measured ratio between two variants, from cards where both were observed.
 *
 * Returns null below `minPairs`. That is the point: a transfer resting on one
 * or two coincidences is a guess with arithmetic attached, and this engine's
 * whole posture is that an abstention beats a confident wrong number.
 */
export function measureRatio(pairs: PricePair[], minPairs = MIN_PAIRS): MeasuredRatio | null {
  const ratios = pairs
    // A zero or negative anchor cannot produce a ratio, and a non-finite one
    // would poison the median silently.
    .filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.from > 0 && p.to > 0)
    .map((p) => p.to / p.from);

  if (ratios.length < Math.max(1, minPairs)) return null;

  const sorted = [...ratios].sort((a, b) => a - b);
  return {
    ratio: median(ratios),
    pairs: ratios.length,
    spread: { low: sorted[0], high: sorted[sorted.length - 1] },
  };
}

export type TransferResult = {
  price: number;
  /** What it was derived FROM — the anchor's own price. */
  anchor: number;
  ratio: MeasuredRatio;
  /**
   * A transferred price is ALWAYS weaker than a direct comp, and this says so
   * in the type rather than leaving it to a caller to remember.
   */
  derived: true;
  narrative: string;
};

/**
 * Apply a measured ratio to an anchor price.
 *
 * The narrative names the pair count and the spread, because a ratio of 4.1
 * measured across three cards that ranged 2.0–9.0 is a different claim from the
 * same 4.1 measured across thirty that ranged 3.9–4.3, and a price that hides
 * the difference cannot be checked.
 */
export function applyRatio(anchor: number, ratio: MeasuredRatio, what: string): TransferResult | null {
  if (!Number.isFinite(anchor) || anchor <= 0) return null;
  const wide = ratio.spread.high > ratio.spread.low * 2;
  return {
    price: round2(anchor * ratio.ratio),
    anchor: round2(anchor),
    ratio,
    derived: true,
    narrative:
      `Derived from ${what} at ${round2(anchor)}, using a ${round2(ratio.ratio)}× ratio measured ` +
      `across ${ratio.pairs} card${ratio.pairs === 1 ? "" : "s"} where both were observed` +
      (wide
        ? ` — but those ranged ${round2(ratio.spread.low)}× to ${round2(ratio.spread.high)}×, so treat this as a wide bracket rather than a price.`
        : "."),
  };
}

/**
 * GONE QUIET: the card's own last sale, stated with its age and NOT discounted.
 *
 * The obvious move is to apply a decay curve, and it is the wrong one. Any decay
 * rate would be invented — nothing in this repo measures how a set's price level
 * moves over time — and an invented rate applied to a real price produces a
 * number that looks derived and is not. "It last sold for $340, eighteen months
 * ago" is both more honest and more useful to someone deciding what to list at:
 * they know the market and can discount it themselves.
 *
 * Returns the price unchanged with the age attached, or null when the card has
 * never sold. `staleness` is the caller's cue to render it as history rather
 * than as a current value.
 */
export function ownHistory(
  lastPrice: number | null, lastSaleDays: number | null,
): { price: number; ageDays: number; staleness: "recent" | "aging" | "stale"; narrative: string } | null {
  if (lastPrice == null || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  if (lastSaleDays == null || !Number.isFinite(lastSaleDays)) return null;

  const months = Math.max(1, Math.round(lastSaleDays / 30));
  const staleness = lastSaleDays <= 180 ? "recent" : lastSaleDays <= 540 ? "aging" : "stale";
  return {
    price: round2(lastPrice),
    ageDays: Math.round(lastSaleDays),
    staleness,
    narrative:
      `Last sold for ${round2(lastPrice)}, ${months} month${months === 1 ? "" : "s"} ago. ` +
      (staleness === "recent"
        ? "Recent enough to lean on."
        : staleness === "aging"
          ? "Old enough that the market may have moved — not discounted, because any discount rate here would be invented."
          : "Old enough that it says more about the past than the present. Not discounted, because a made-up decay rate would look derived and wouldn't be."),
  };
}

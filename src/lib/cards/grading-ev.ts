// Is it worth grading this card? (2026-07-29)
//
// TWO THINGS WERE WRONG WITH THE OLD ANSWER.
//
// 1. It took the MIDPOINT of the grade estimate. `Math.round(((low + high) / 2)
//    / step) * step`, then the nearest ladder cell. An estimate of "PSA 8 to
//    10" collapsed to "PSA 9" and the screen reported one number as though the
//    grade were known. The entire reason grading is a gamble - that a 10 pays
//    for the submission and an 8 does not - was averaged away before it reached
//    the user.
//
// 2. The fee was a bare number with no schedule and no date behind it. Every
//    "should I grade this?" answer was computed against a price with no
//    provenance, which is the same class of problem as a comp with no source.
//
// So this module returns a DISTRIBUTION over outcomes, and every fee carries
// the tier and the date of the schedule it came from.
//
// WHY UNIFORM. The estimate gives a low and a high and nothing about shape. A
// triangular or normal weighting would look more sophisticated and would be
// inventing information nobody measured - uniform is the maximum-entropy
// choice given only an interval, and it is stated rather than hidden. If the
// estimator ever emits per-grade probabilities, pass them in and this becomes
// a real distribution instead of an honest placeholder.

export type GradeOutcome = {
  grade: number;
  /** Probability of landing on this grade, 0..1. Sums to 1 across outcomes. */
  p: number;
  /** Ladder value at this grade, or null when the ladder cannot price it. */
  value: number | null;
  /** value − fee, or null when value is null. */
  net: number | null;
};

export type GradingVerdict = {
  outcomes: GradeOutcome[];
  /** Probability-weighted net. Null when no outcome could be priced. */
  expectedNet: number | null;
  /** expectedNet − rawValue. The number the decision actually turns on. */
  expectedDelta: number | null;
  /** Share of probability mass where grading LOSES money against selling raw. */
  downsideP: number | null;
  /** Best and worst priced outcomes, so the spread is visible. */
  bestCase: GradeOutcome | null;
  worstCase: GradeOutcome | null;
  /** Fraction of probability mass the ladder could actually price. */
  priced: number;
};

/**
 * Every grade the estimate admits, weighted.
 *
 * Half-steps for BGS, whole grades for everyone else. A degenerate estimate
 * (low === high) yields one certain outcome, which is correct: the caller said
 * it was certain.
 */
export function gradeDistribution(low: number, high: number, step: number): { grade: number; p: number }[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(step > 0)) return [];
  const lo = Math.min(low, high), hi = Math.max(low, high);
  const grades: number[] = [];
  // Walk in integer multiples of the step to avoid float drift compounding.
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) grades.push(Math.round((lo + i * step) * 100) / 100);
  if (!grades.length) return [];
  const p = 1 / grades.length;
  return grades.map((grade) => ({ grade, p }));
}

/**
 * Turn a grade estimate plus a value ladder into a verdict with its spread.
 *
 * `valueAtGrade` returns what the card is worth at a grade, or null when the
 * ladder has nothing to say. Grades it cannot price are kept in the outcome
 * list with `value: null` rather than dropped — `priced` then reports how much
 * of the distribution the answer actually rests on, so a verdict computed from
 * one cell out of five is visibly that.
 */
export function gradingVerdict(
  est: { low: number; high: number },
  opts: {
    step: number;
    fee: number;
    rawValue: number;
    valueAtGrade: (grade: number) => number | null;
  },
): GradingVerdict {
  const dist = gradeDistribution(est.low, est.high, opts.step);
  const outcomes: GradeOutcome[] = dist.map((d) => {
    const value = opts.valueAtGrade(d.grade);
    return {
      grade: d.grade,
      p: d.p,
      value,
      net: value == null ? null : Math.round((value - opts.fee) * 100) / 100,
    };
  });

  const pricedOutcomes = outcomes.filter((o) => o.net != null) as (GradeOutcome & { net: number })[];
  const priced = outcomes.length ? pricedOutcomes.reduce((s, o) => s + o.p, 0) : 0;

  if (!pricedOutcomes.length) {
    return {
      outcomes, expectedNet: null, expectedDelta: null, downsideP: null,
      bestCase: null, worstCase: null, priced: 0,
    };
  }

  // Renormalise over what could be priced. Weighting unpriceable outcomes as
  // zero would drag the expectation toward a value nobody computed - the
  // honest move is to answer from the priced mass and report how big it was.
  const mass = priced;
  const expectedNet =
    Math.round((pricedOutcomes.reduce((s, o) => s + (o.p / mass) * o.net, 0)) * 100) / 100;
  const downsideP =
    Math.round((pricedOutcomes.filter((o) => o.net <= opts.rawValue).reduce((s, o) => s + o.p / mass, 0)) * 1000) / 1000;

  const sorted = [...pricedOutcomes].sort((a, b) => a.net - b.net);
  return {
    outcomes,
    expectedNet,
    expectedDelta: Math.round((expectedNet - opts.rawValue) * 100) / 100,
    downsideP,
    worstCase: sorted[0],
    bestCase: sorted[sorted.length - 1],
    priced: Math.round(mass * 1000) / 1000,
  };
}

/**
 * The sentence a person can act on.
 *
 * Deliberately refuses to say "grade it" or "don't" — it reports the
 * expectation and the risk and lets the person decide, which is the same
 * posture the rest of the app takes with money.
 */
export function verdictLine(v: GradingVerdict, currency = (n: number) => `$${n.toFixed(0)}`): string | null {
  if (v.expectedDelta == null || v.downsideP == null) return null;
  const dir = v.expectedDelta >= 0 ? "+" : "−";
  const risk = Math.round(v.downsideP * 100);
  const base = `Expected ${dir}${currency(Math.abs(v.expectedDelta))} versus selling raw`;
  if (risk === 0) return `${base}, and no outcome in the estimate loses money.`;
  if (risk === 100) return `${base} — but every outcome in the estimate loses money.`;
  return `${base}, but ${risk}% of outcomes lose money.`;
}

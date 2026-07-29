import { describe, it, expect } from "vitest";
import { gradeDistribution, gradingVerdict, verdictLine } from "@/lib/cards/grading-ev";

describe("gradeDistribution", () => {
  it("covers every whole grade in the estimate", () => {
    expect(gradeDistribution(8, 10, 1).map((d) => d.grade)).toEqual([8, 9, 10]);
  });

  it("uses half steps for BGS", () => {
    expect(gradeDistribution(9, 10, 0.5).map((d) => d.grade)).toEqual([9, 9.5, 10]);
  });

  it("sums to one", () => {
    const d = gradeDistribution(7, 10, 1);
    expect(d.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 10);
  });

  // A caller that says low === high has said the grade is certain. Believe it.
  it("gives one certain outcome for a degenerate estimate", () => {
    expect(gradeDistribution(9, 9, 1)).toEqual([{ grade: 9, p: 1 }]);
  });

  it("tolerates a reversed range and rejects nonsense", () => {
    expect(gradeDistribution(10, 8, 1).map((d) => d.grade)).toEqual([8, 9, 10]);
    expect(gradeDistribution(NaN, 10, 1)).toEqual([]);
    expect(gradeDistribution(8, 10, 0)).toEqual([]);
  });
});

describe("gradingVerdict", () => {
  // The defect this module exists for. A PSA 8-10 estimate on a card whose 10
  // is worth $600 and 8 is worth $60: the midpoint said "PSA 9, $200, worth
  // it" and never mentioned that a third of the range loses money.
  const ladder: Record<number, number> = { 8: 60, 9: 200, 10: 600 };
  const v = gradingVerdict(
    { low: 8, high: 10 },
    { step: 1, fee: 100, rawValue: 120, valueAtGrade: (g) => ladder[g] ?? null },
  );

  it("reports the whole spread, not a midpoint", () => {
    expect(v.outcomes.map((o) => o.grade)).toEqual([8, 9, 10]);
    expect(v.outcomes.map((o) => o.net)).toEqual([-40, 100, 500]);
  });

  it("computes a probability-weighted expectation", () => {
    // (-40 + 100 + 500) / 3 = 186.67
    expect(v.expectedNet).toBeCloseTo(186.67, 1);
    expect(v.expectedDelta).toBeCloseTo(66.67, 1);
  });

  // The number the old screen could never say.
  it("reports how much of the estimate loses money", () => {
    // Grade 8 nets -40, which is below the raw value of 120. Grade 9 nets 100,
    // also below 120. So two of three outcomes lose against selling raw.
    expect(v.downsideP).toBeCloseTo(0.667, 2);
    expect(verdictLine(v)).toMatch(/67% of outcomes lose money/);
  });

  it("names the best and worst case", () => {
    expect(v.worstCase!.grade).toBe(8);
    expect(v.bestCase!.grade).toBe(10);
  });

  it("says so when nothing in the estimate loses", () => {
    const good = gradingVerdict(
      { low: 9, high: 10 },
      { step: 1, fee: 20, rawValue: 50, valueAtGrade: (g) => ({ 9: 200, 10: 600 })[g] ?? null },
    );
    expect(good.downsideP).toBe(0);
    expect(verdictLine(good)).toMatch(/no outcome in the estimate loses money/);
  });

  it("says so when everything loses", () => {
    const bad = gradingVerdict(
      { low: 6, high: 7 },
      { step: 1, fee: 90, rawValue: 200, valueAtGrade: (g) => ({ 6: 40, 7: 55 })[g] ?? null },
    );
    expect(bad.downsideP).toBe(1);
    expect(verdictLine(bad)).toMatch(/every outcome in the estimate loses money/);
  });

  // Weighting an unpriceable grade as zero would drag the expectation toward a
  // number nobody computed. Answer from the priced mass and report its size.
  it("answers from what the ladder could price, and says how much that was", () => {
    const partial = gradingVerdict(
      { low: 8, high: 10 },
      { step: 1, fee: 50, rawValue: 100, valueAtGrade: (g) => (g === 10 ? 600 : null) },
    );
    expect(partial.priced).toBeCloseTo(0.333, 2);
    expect(partial.expectedNet).toBe(550);   // not 550/3
    expect(partial.outcomes).toHaveLength(3); // the unpriceable ones are kept, visible
  });

  it("returns nulls rather than a number when nothing can be priced", () => {
    const none = gradingVerdict(
      { low: 8, high: 10 },
      { step: 1, fee: 50, rawValue: 100, valueAtGrade: () => null },
    );
    expect(none.expectedNet).toBeNull();
    expect(none.expectedDelta).toBeNull();
    expect(none.priced).toBe(0);
    expect(verdictLine(none)).toBeNull();
  });
});

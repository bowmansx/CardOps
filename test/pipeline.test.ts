import { describe, expect, it } from "vitest";
import {
  interpretPipeline, computeMarketValue, adjustToGrade,
  type Comp, type PipelineV1, type Multiplier,
} from "../src/lib/cards/valuation";

// Fixed "now" so window math is deterministic.
const NOW = new Date("2026-07-18T12:00:00Z").getTime();
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

const raw = (price: number, daysAgo: number | null, source = "manual"): Comp => ({
  grader: "RAW", grade: 0, sale_price: price, sale_date: daysAgo == null ? null : day(daysAgo), source,
});
const graded = (grader: string, grade: number, price: number, daysAgo: number): Comp => ({
  grader, grade, sale_price: price, sale_date: day(daysAgo), source: "manual",
});

const run = (
  comps: Comp[],
  p: PipelineV1,
  ctx?: { grader?: string | null; grade?: number | null; multipliers?: Multiplier[] | null; era?: "modern" | "vintage" | null },
) => interpretPipeline(comps, p, ctx, NOW);

// A grade ladder: a PSA 9 is worth 4x raw, a PSA 8 2x, a BGS 9 3.6x. These are
// the ratios that make one grade's sale say anything about another's.
const MULT: Multiplier[] = [
  { grader: "PSA", grade: 8, era_bucket: "all", multiplier: 2 },
  { grader: "PSA", grade: 9, era_bucket: "all", multiplier: 4 },
  { grader: "PSA", grade: 10, era_bucket: "all", multiplier: 12 },
  { grader: "BGS", grade: 9, era_bucket: "all", multiplier: 3.6 },
];

describe("interpretPipeline — scope", () => {
  const pool = [raw(10, 5), raw(20, 10), graded("PSA", 9, 100, 3), graded("BGS", 9, 90, 4), graded("PSA", 8, 60, 6)];

  it("raw scope (default) ignores graded sales", () => {
    expect(run(pool, { aggregate: { fn: "mean" } })).toBe(15);
  });

  it("own_grade uses only the card's grader+grade", () => {
    const v = run(pool, { comp_scope: "own_grade", aggregate: { fn: "mean" } }, { grader: "PSA", grade: 9 });
    expect(v).toBe(100);
  });

  // THIS TEST USED TO ASSERT THE BUG. It expected 80 - the plain average of a
  // PSA 9 at $100 and a PSA 8 at $60 - as the value of a PSA 9. Widening
  // grade_delta pulled a lower-grade sale in at face value and dragged the
  // answer down 20%, and the only reason anyone widens grade_delta is to escape
  // a min_comps abstention. The feature's sole use case was the one where it
  // was wrong.
  it("drops an off-grade comp it cannot adjust, rather than pooling it blind", () => {
    const v = run(pool, { comp_scope: "own_grade", grade_delta: 1, aggregate: { fn: "mean" } }, { grader: "PSA", grade: 9 });
    expect(v).toBe(100); // the PSA 8 is evidence about a PSA 8, and is excluded
  });

  it("uses an off-grade comp once a multiplier makes it comparable", () => {
    // PSA 8 at $60 with an 8 worth 2x raw implies raw $30, so a 9 at 4x is $120.
    // Averaged with the real PSA 9 at $100 gives $110.
    const v = run(
      pool,
      { comp_scope: "own_grade", grade_delta: 1, aggregate: { fn: "mean" } },
      { grader: "PSA", grade: 9, multipliers: MULT, era: "modern" },
    );
    expect(v).toBe(110);
  });

  it("cross_grade borrows the grade across companies, filtered by list", () => {
    const any = run(pool, { comp_scope: "cross_grade", aggregate: { fn: "mean" } }, { grader: "PSA", grade: 9 });
    expect(any).toBe(95); // PSA 9 + BGS 9
    const only = run(pool, { comp_scope: "cross_grade", grade_companies: ["BGS"], aggregate: { fn: "mean" } }, { grader: "PSA", grade: 9 });
    expect(only).toBe(90);
  });

  it("graded scope on a raw card safely falls back to raw sales", () => {
    const v = run(pool, { comp_scope: "own_grade", aggregate: { fn: "mean" } }, { grader: null, grade: null });
    expect(v).toBe(15);
  });
});

describe("interpretPipeline — window & sampling", () => {
  it("window excludes older and null-date sales", () => {
    const pool = [raw(10, 5), raw(50, 200), raw(99, null)];
    expect(run(pool, { window_days: 30, aggregate: { fn: "mean" } })).toBe(10);
  });

  it("no window lets null-date sales count", () => {
    const pool = [raw(10, 5), raw(30, null)];
    expect(run(pool, { window_days: null, aggregate: { fn: "mean" } })).toBe(20);
  });

  it("last_n keeps the newest N", () => {
    const pool = [raw(10, 1), raw(20, 2), raw(90, 50)];
    expect(run(pool, { last_n: 2, aggregate: { fn: "mean" } })).toBe(15);
  });

  it("top_n keeps the highest N — 'average of the 5 highest ever'", () => {
    const pool = [raw(10, 1), raw(20, 2), raw(90, 300), raw(80, 400), raw(70, 500)];
    expect(run(pool, { window_days: null, top_n: 3, aggregate: { fn: "mean" } })).toBe(80); // 90+80+70
  });

  it("last_n then top_n compose: highest of the recent", () => {
    const pool = [raw(100, 100), raw(10, 1), raw(30, 2), raw(20, 3)];
    // last 3 = 10,30,20 → top 2 = 30,20 → mean 25 (the old 100 never enters)
    expect(run(pool, { last_n: 3, top_n: 2, aggregate: { fn: "mean" } })).toBe(25);
  });
});

describe("interpretPipeline — guards & abstain", () => {
  it("iqr fence tosses the wild outlier", () => {
    const pool = [raw(10, 1), raw(11, 2), raw(12, 3), raw(10, 4), raw(500, 5)];
    const v = run(pool, { guards: { iqr_k: 1.5 }, aggregate: { fn: "mean" } });
    expect(v).toBeLessThan(20);
  });

  it("drop_top_pct shaves the highest before averaging", () => {
    const pool = [raw(10, 1), raw(10, 2), raw(10, 3), raw(10, 4), raw(10, 5), raw(10, 6), raw(10, 7), raw(10, 8), raw(10, 9), raw(100, 10)];
    expect(run(pool, { guards: { drop_top_pct: 0.1 }, aggregate: { fn: "mean" } })).toBe(10);
  });

  it("abs bounds filter garbage prices", () => {
    const pool = [raw(0.5, 1), raw(10, 2), raw(999999, 3)];
    expect(run(pool, { guards: { abs_min: 1, abs_max: 100000 }, aggregate: { fn: "mean" } })).toBe(10);
  });

  it("min_comps abstains (null) when evidence is thin", () => {
    expect(run([raw(10, 1)], { min_comps: 3, aggregate: { fn: "mean" } })).toBeNull();
  });
});

describe("interpretPipeline — aggregates & adjust", () => {
  const pool = [raw(10, 1), raw(20, 2), raw(60, 3)];

  it("median resists the freak sale", () => {
    expect(run(pool, { aggregate: { fn: "median" } })).toBe(20);
  });

  it("min / max / last_sale", () => {
    expect(run(pool, { aggregate: { fn: "min" } })).toBe(10);
    expect(run(pool, { aggregate: { fn: "max" } })).toBe(60);
    expect(run(pool, { aggregate: { fn: "last_sale" } })).toBe(10); // newest = 1 day ago
  });

  it("wavg_recency leans toward newer sales", () => {
    const p = [raw(10, 1), raw(100, 90)];
    const v = run(p, { aggregate: { fn: "wavg_recency", half_life_days: 14 } })!;
    expect(v).toBeLessThan(55); // plain mean; recency pulls toward 10
  });

  it("multiplier and round_99 apply last", () => {
    expect(run(pool, { aggregate: { fn: "median" }, adjust: { multiplier: 2 } })).toBe(40);
    expect(run(pool, { aggregate: { fn: "median" }, adjust: { round_99: true } })).toBe(19.99);
  });
});

describe("computeMarketValue — dispatch & fallbacks", () => {
  const card = {
    year: 2024, manual_price: null, market_value: 77, price_locked: false,
    pricing_strategy: "c_test", landed_cost: null,
  };

  it("locked manual price always wins", () => {
    const c = { ...card, price_locked: true, manual_price: 42 };
    expect(computeMarketValue(c, [raw(10, 1)], { v: 1, pipeline: { aggregate: { fn: "mean" } } })).toBe(42);
  });

  it("v1 pipeline computes; abstain falls back to prior value (never null-out)", () => {
    expect(computeMarketValue(card, [raw(10, 1)], { v: 1, pipeline: { aggregate: { fn: "mean" } } })).toBe(10);
    expect(computeMarketValue(card, [], { v: 1, pipeline: { min_comps: 3 } })).toBe(77);
  });

  it("legacy keys keep the old engine (standard = trimmed mean of raw)", () => {
    const legacy = { ...card, pricing_strategy: "standard" };
    expect(computeMarketValue(legacy, [raw(10, 1), raw(20, 2)], null)).toBe(15);
  });
});


describe("adjustToGrade", () => {
  it("returns the price untouched for the same grader and grade", () => {
    expect(adjustToGrade(100, { grader: "PSA", grade: 9 }, { grader: "PSA", grade: 9 }, MULT, "modern")).toBe(100);
  });

  it("scales by the ratio of the two multipliers", () => {
    // PSA 8 (2x) -> PSA 9 (4x) doubles.
    expect(adjustToGrade(60, { grader: "PSA", grade: 8 }, { grader: "PSA", grade: 9 }, MULT, "modern")).toBe(120);
    // PSA 10 (12x) -> PSA 9 (4x) is a third.
    expect(adjustToGrade(600, { grader: "PSA", grade: 10 }, { grader: "PSA", grade: 9 }, MULT, "modern")).toBe(200);
  });

  it("crosses companies when both sides have a multiplier", () => {
    // BGS 9 (3.6x) -> PSA 9 (4x).
    expect(adjustToGrade(90, { grader: "BGS", grade: 9 }, { grader: "PSA", grade: 9 }, MULT, "modern")).toBe(100);
  });

  // The honest refusal. A comp that cannot be converted is evidence about a
  // different card, not weak evidence about this one.
  it("returns null rather than guessing when a multiplier is missing", () => {
    expect(adjustToGrade(60, { grader: "PSA", grade: 8 }, { grader: "PSA", grade: 9 }, [], "modern")).toBeNull();
    expect(adjustToGrade(60, { grader: "SGC", grade: 9 }, { grader: "PSA", grade: 9 }, MULT, "modern")).toBeNull();
    expect(adjustToGrade(60, { grader: "PSA", grade: null }, { grader: "PSA", grade: 9 }, MULT, "modern")).toBeNull();
  });
});

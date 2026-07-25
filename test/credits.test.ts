import { describe, it, expect } from "vitest";
import { estimateCost, bandFor, costFill, normalizeEstimate, COST, COST_CEILING } from "@/lib/cards/credits";

describe("estimateCost", () => {
  it("off = free / no band", () => {
    expect(estimateCost({ mode: "off" })).toEqual({ credits: 0, band: "none" });
    expect(estimateCost(undefined)).toEqual({ credits: 0, band: "none" });
    expect(estimateCost(null)).toEqual({ credits: 0, band: "none" });
  });

  it("cheapest estimate is low band", () => {
    // A + light AI + no extra context = base(1) + ai_light(3) = 4
    const r = estimateCost({ mode: "standard_plus", ai: "light" });
    expect(r.credits).toBe(4);
    expect(r.band).toBe("low");
  });

  it("all-sales reads more than standard", () => {
    const a = estimateCost({ mode: "standard_plus", ai: "light" }).credits;
    const b = estimateCost({ mode: "all_sales_plus", ai: "light" }).credits;
    expect(b).toBeGreaterThan(a); // full_sales surcharge
  });

  it("each context source and deep AI raise the cost", () => {
    const bare = estimateCost({ mode: "standard_plus", ai: "light" }).credits;
    const withComps = estimateCost({ mode: "standard_plus", ai: "light", comparables: true }).credits;
    const deep = estimateCost({ mode: "standard_plus", ai: "deep" }).credits;
    expect(withComps).toBeGreaterThan(bare);
    expect(deep).toBeGreaterThan(bare);
  });

  it("a maxed deep estimate lands in high band near the ceiling", () => {
    const r = estimateCost({ mode: "all_sales_plus", ai: "deep", comparables: true, news: true, macro: true, pop: true });
    // base 1 + full_sales 2 + comparables 2 + news 1 + macro 0 + pop 0 + deep 12 = 18
    expect(r.credits).toBe(18);
    expect(r.band).toBe("high");
  });
});

// The honesty rule, pinned so it can't regress silently: a toggle may only
// carry a price if it causes real work. macro and pop fetch NOTHING — they add
// the model's own judgment — so they must stay free until a real data source
// is wired behind them. If someone raises these, this test should stop them
// and make them justify it.
describe("no toggle charges for data it doesn't fetch", () => {
  it("macro and pop are free — they are model judgment, not fetched data", () => {
    expect(COST.macro).toBe(0);
    expect(COST.pop).toBe(0);
    const base = estimateCost({ mode: "standard_plus", ai: "light" }).credits;
    const withJudgment = estimateCost({ mode: "standard_plus", ai: "light", macro: true, pop: true }).credits;
    expect(withJudgment).toBe(base);
  });

  it("news costs something because it really reads collected headlines", () => {
    const base = estimateCost({ mode: "standard_plus", ai: "light" }).credits;
    const withNews = estimateCost({ mode: "standard_plus", ai: "light", news: true }).credits;
    expect(withNews).toBeGreaterThan(base);
    // …but less than a live vendor fetch, since it's a local read.
    expect(COST.news).toBeLessThan(COST.comparables);
  });
});

describe("bandFor / costFill", () => {
  it("band thresholds", () => {
    expect(bandFor(0)).toBe("none");
    expect(bandFor(6)).toBe("low");
    expect(bandFor(7)).toBe("medium");
    expect(bandFor(14)).toBe("medium");
    expect(bandFor(15)).toBe("high");
  });
  it("fill clamps 0..1", () => {
    expect(costFill(0)).toBe(0);
    expect(costFill(COST_CEILING / 2)).toBeCloseTo(0.5);
    expect(costFill(999)).toBe(1);
  });
});

describe("normalizeEstimate", () => {
  it("defaults junk to off", () => {
    expect(normalizeEstimate({ mode: "bogus" })).toEqual({ mode: "off" });
    expect(normalizeEstimate(null)).toEqual({ mode: "off" });
    expect(normalizeEstimate(undefined)).toEqual({ mode: "off" });
  });
  it("coerces flags to booleans and ai to light/deep", () => {
    expect(normalizeEstimate({ mode: "all_sales_plus", comparables: 1, news: "yes", ai: "deep" }))
      .toEqual({ mode: "all_sales_plus", comparables: true, news: true, macro: false, pop: false, ai: "deep" });
    expect(normalizeEstimate({ mode: "standard_plus", ai: "weird" }).ai).toBe("light");
  });
});

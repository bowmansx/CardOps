import { describe, it, expect } from "vitest";
import {
  eraOf, rawValue, applyStrategy, marketValue, suggestedListPrice, buildLadder, gradeUp,
  type Comp, type Multiplier,
} from "../src/lib/cards/valuation";

const card = (over: Partial<Parameters<typeof rawValue>[0]> = {}) => ({
  year: 2021, manual_price: null, market_value: null, price_locked: false,
  pricing_strategy: "standard", landed_cost: null, ...over,
});
const rawComp = (price: number | null): Comp => ({ grader: "RAW", grade: 0, sale_price: price, sale_date: "2026-01-01", source: "manual" });
const gradedComp = (grader: string, grade: number, price: number): Comp => ({ grader, grade, sale_price: price, sale_date: "2026-01-01", source: "manual" });
const mults: Multiplier[] = [
  { grader: "PSA", grade: 10, era_bucket: "modern", multiplier: 4 },
  { grader: "PSA", grade: 9, era_bucket: "modern", multiplier: 1.8 },
];

describe("eraOf", () => {
  it("splits modern/vintage at 1986", () => {
    expect(eraOf(2021)).toBe("modern");
    expect(eraOf(1985)).toBe("vintage");
    expect(eraOf(null)).toBe("modern");
  });
});

describe("applyStrategy", () => {
  it("handles each strategy", () => {
    const p = [10, 20, 30];
    expect(applyStrategy("conservative", p, null)).toBe(10.5); // min*1.05
    expect(applyStrategy("aggressive", p, null)).toBe(28.5); // max*0.95
    expect(applyStrategy("hot", p, null)).toBe(33); // max*1.1
    expect(applyStrategy("standard", p, null)).toBe(20); // trimmed mean → mean here
    expect(applyStrategy("thin_market", p, null)).toBe(24); // mean*1.2
    expect(applyStrategy("manual_lock", p, 99)).toBe(99);
  });
  it("returns null on empty prices (except manual_lock)", () => {
    expect(applyStrategy("standard", [], null)).toBe(null);
    expect(applyStrategy("manual_lock", [], 42)).toBe(42);
  });
});

describe("rawValue", () => {
  it("uses priced raw comps when present", () => {
    expect(rawValue(card(), [rawComp(50), rawComp(60), rawComp(70)])).toBe(60);
  });
  it("falls back to manual/prior when no priced comps", () => {
    expect(rawValue(card({ manual_price: 25 }), [rawComp(null)])).toBe(25);
    expect(rawValue(card({ market_value: 15 }), [])).toBe(15);
    expect(rawValue(card(), [])).toBe(null);
  });
});

describe("marketValue", () => {
  it("honors a locked manual price", () => {
    expect(marketValue(card({ price_locked: true, manual_price: 80 }), [rawComp(10)])).toBe(80);
  });
  it("computes from raw comps by strategy", () => {
    expect(marketValue(card({ pricing_strategy: "conservative" }), [rawComp(100), rawComp(120)])).toBe(105);
  });
});

describe("suggestedListPrice — floor is inviolable", () => {
  it("lifts to the floor when market is below it", () => {
    const r = suggestedListPrice(50, 60); // floor = 69
    expect(r.price).toBe(69);
    expect(r.floorApplied).toBe(true);
  });
  it("keeps market when above the floor", () => {
    const r = suggestedListPrice(200, 60);
    expect(r.price).toBe(200);
    expect(r.floorApplied).toBe(false);
  });
  it("uses the floor when market is unknown", () => {
    expect(suggestedListPrice(null, 100).price).toBe(115);
  });
});

describe("buildLadder — actual vs modeled honesty (guardrail #7)", () => {
  it("RAW is 'actual' only with >=3 PRICED comps", () => {
    const oneComp = buildLadder(card({ manual_price: 40 }), [rawComp(40)], mults);
    expect(oneComp[0].basis_source).toBe("modeled"); // 1 comp → not actual
    const threeComp = buildLadder(card(), [rawComp(40), rawComp(42), rawComp(44)], mults);
    expect(threeComp[0].basis_source).toBe("actual");
  });
  it("never badges a null-price fallback as actual", () => {
    const l = buildLadder(card({ manual_price: 50 }), [rawComp(null), rawComp(null)], mults);
    expect(l[0].basis_source).toBe("modeled"); // fallback value, not comp-derived
  });
  it("graded cells are modeled (raw x multiplier) below 3 comps", () => {
    const l = buildLadder(card(), [rawComp(100), rawComp(100), rawComp(100)], mults);
    const psa10 = l.find((c) => c.grader === "PSA" && c.grade === 10)!;
    expect(psa10.basis_source).toBe("modeled");
    expect(psa10.value).toBe(400); // 100 * 4
  });
  it("graded cells become actual with >=3 comps", () => {
    const comps = [rawComp(100), gradedComp("PSA", 10, 500), gradedComp("PSA", 10, 520), gradedComp("PSA", 10, 480)];
    const l = buildLadder(card(), comps, mults);
    const psa10 = l.find((c) => c.grader === "PSA" && c.grade === 10)!;
    expect(psa10.basis_source).toBe("actual");
    expect(psa10.value).toBe(500);
  });
});

describe("gradeUp carries basis_source (guardrail #7)", () => {
  it("returns the winning cell's basis tag", () => {
    const l = buildLadder(card(), [rawComp(100), rawComp(100), rawComp(100)], mults);
    const up = gradeUp(l, 100);
    expect(up).not.toBe(null);
    expect(up!.basis_source).toBe("modeled");
    expect(up!.grader).toBe("PSA");
  });
  it("returns null when nothing clears the grading hurdle", () => {
    expect(gradeUp([{ grader: "PSA", grade: 10, value: 110, basis_source: "modeled", comp_count: 0 }], 100, 25)).toBe(null);
  });
});

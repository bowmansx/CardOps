// Liquidity engine — velocity, tiers, and the price↔likelihood model the
// slider trusts. Pinned properties: monotonicity (higher price never raises
// the sale chance), refusal to guess on thin data, and undated comps never
// counting toward velocity.
import { describe, it, expect } from "vitest";
import {
  velocity, tierOf, weightedPrices, shareAtOrAbove, sellEstimate, formatEta, matchesExact,
} from "@/lib/cards/liquidity";
import type { Comp } from "@/lib/cards/valuation";

const NOW = Date.UTC(2026, 6, 25); // fixed clock — the lib takes nowMs explicitly
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const comp = (price: number, ageDays: number | null, grader = "RAW", grade = 0): Comp =>
  ({ grader, grade, sale_price: price, sale_date: ageDays == null ? null : daysAgo(ageDays), source: "test" });

describe("velocity", () => {
  it("counts windows and prefers the 90-day tempo when sampled", () => {
    const comps = [comp(10, 5), comp(11, 20), comp(12, 40), comp(13, 80), comp(14, 200)];
    const v = velocity(comps, NOW);
    expect(v.n90).toBe(4);
    expect(v.n365).toBe(5);
    expect(v.perMonth).toBeCloseTo(4 / 3);
    expect(v.lastSaleDays).toBe(5);
  });

  it("falls back to the 365-day rate below the 90-day sample floor", () => {
    const v = velocity([comp(10, 30), comp(11, 100), comp(12, 300)], NOW);
    expect(v.perMonth).toBeCloseTo(3 / 12);
  });

  it("refuses to estimate from a single dated sale", () => {
    expect(velocity([comp(10, 100)], NOW).perMonth).toBeNull();
  });

  it("ignores undated and unpriced comps entirely", () => {
    const v = velocity([comp(10, null), { grader: "RAW", grade: 0, sale_price: null, sale_date: daysAgo(3), source: "t" }], NOW);
    expect(v.n365).toBe(0);
    expect(v.perMonth).toBeNull();
  });
});

describe("tierOf", () => {
  const tier = (comps: Comp[]) => tierOf(velocity(comps, NOW));
  it("no sales ever → unknown; only ancient sales → stale", () => {
    expect(tier([])).toBe("unknown");
    expect(tier([comp(10, 400), comp(11, 500), comp(12, 600)])).toBe("stale");
  });
  it("ladders hot → liquid → moderate by monthly rate", () => {
    const burst = (n: number) => Array.from({ length: n }, (_, i) => comp(10, (i % 85) + 1));
    expect(tier(burst(30))).toBe("hot");      // 10/mo
    expect(tier(burst(12))).toBe("liquid");   // 4/mo
    expect(tier(burst(4))).toBe("moderate");  // ~1.3/mo
  });
});

describe("price↔likelihood model", () => {
  const weighted = weightedPrices(
    [comp(50, 10), comp(60, 20), comp(70, 40), comp(80, 60), comp(100, 80), comp(120, 85)], NOW);
  const inputs = { perMonth: 2, weighted };

  it("share of cleared sales is monotone non-increasing in price", () => {
    let prev = Infinity;
    for (const p of [40, 55, 65, 75, 90, 110, 150]) {
      const s = shareAtOrAbove(weighted, p);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(shareAtOrAbove(weighted, 1)).toBe(1);
  });

  it("raising the price never raises the 30-day chance, and floors at the 3% overpayer tail", () => {
    let prev = 1;
    for (const p of [40, 60, 80, 100, 140, 500]) {
      const e = sellEstimate(inputs, p)!;
      expect(e.p30).toBeGreaterThan(0);
      expect(e.p30).toBeLessThanOrEqual(prev + 1e-12);
      prev = e.p30;
    }
    const floor = sellEstimate(inputs, 10_000)!;
    expect(floor.p30).toBeCloseTo(1 - Math.exp(-2 * 0.03), 6);
  });

  it("below every recorded sale, likelihood equals the full market rate", () => {
    const e = sellEstimate(inputs, 30)!;
    expect(e.p30).toBeCloseTo(1 - Math.exp(-2), 6);
    expect(e.expectedMonths).toBeCloseTo(0.5, 6);
  });

  it("returns null rather than inventing numbers on thin data", () => {
    expect(sellEstimate({ perMonth: null, weighted }, 50)).toBeNull();
    expect(sellEstimate({ perMonth: 2, weighted: [] }, 50)).toBeNull();
  });

  it("recency weighting makes fresh sales count more", () => {
    const w = weightedPrices([comp(100, 1), comp(100, 361)], NOW);
    expect(w[0].w).toBeGreaterThan(w[1].w * 3);
  });
});

describe("formatEta", () => {
  it("speaks in days, weeks, months, then gives up honestly", () => {
    expect(formatEta(0.1)).toBe("~3 days");
    expect(formatEta(1)).toBe("~4 weeks");
    expect(formatEta(3)).toBe("~3 months");
    expect(formatEta(9)).toBe("6+ months");
  });
});

describe("matchesExact", () => {
  it("raw cards match only RAW comps; graded cards need grader AND grade", () => {
    const rawCard = { grader: null, grade: null, condition_type: "raw" };
    const psa9 = { grader: "PSA", grade: 9, condition_type: "graded" };
    expect(matchesExact(rawCard, comp(10, 1, "RAW"))).toBe(true);
    expect(matchesExact(rawCard, comp(10, 1, "PSA", 9))).toBe(false);
    expect(matchesExact(psa9, comp(10, 1, "PSA", 9))).toBe(true);
    expect(matchesExact(psa9, comp(10, 1, "PSA", 10))).toBe(false);
    expect(matchesExact(psa9, comp(10, 1, "BGS", 9))).toBe(false);
  });
});

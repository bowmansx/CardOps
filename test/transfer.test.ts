import { describe, it, expect } from "vitest";
import { measureRatio, applyRatio, ownHistory, MIN_PAIRS, type PricePair } from "@/lib/cards/transfer";

const pair = (from: number, to: number, ref?: string): PricePair => ({ from, to, ref });

describe("measureRatio — measured, never seeded", () => {
  it("takes the median of per-card ratios", () => {
    const r = measureRatio([pair(10, 20), pair(10, 40), pair(10, 30)])!;
    expect(r.ratio).toBe(3); // median(2, 4, 3)
    expect(r.pairs).toBe(3);
  });

  // THE CASE THAT SEPARATES THE TWO METHODS. Two cheap cards where the target
  // is 5× the anchor, two expensive ones where it is 1.1×.
  //
  //   median of ratios  = median(5, 5, 1.1, 1.1)              = 3.05
  //   ratio of medians  = median(50,50,1100,1100) / median(10,10,1000,1000)
  //                     = 575 / 505                           ≈ 1.14
  //
  // Ratio-of-medians is dominated by the two expensive cards purely because
  // their prices are large — the cheap cards' 5× barely registers. Per-card
  // ratios give every card one vote.
  it("is the median of ratios, not the ratio of medians", () => {
    const r = measureRatio([pair(10, 50), pair(10, 50), pair(1000, 1100), pair(1000, 1100)])!;
    expect(r.ratio).toBe(3.05);
    expect(r.ratio).not.toBeCloseTo(575 / 505, 2);
  });

  // An abstention beats a confident wrong number — the posture the whole engine
  // is built on.
  it("abstains below the pair floor", () => {
    expect(measureRatio([pair(10, 20), pair(10, 30)])).toBeNull();
    expect(measureRatio([pair(10, 20)])).toBeNull();
    expect(measureRatio(Array.from({ length: MIN_PAIRS }, () => pair(10, 20)))).not.toBeNull();
  });

  // A zero anchor is a division by zero; a non-finite one poisons the median
  // without anything looking wrong.
  it("drops unusable pairs rather than letting them into the median", () => {
    const r = measureRatio([pair(0, 20), pair(10, 0), pair(10, 20), pair(10, 20), pair(10, 40)]);
    expect(r?.pairs).toBe(3);
    expect(r?.ratio).toBe(2);
  });

  it("reports how much the set disagrees", () => {
    const r = measureRatio([pair(10, 20), pair(10, 90), pair(10, 30)])!;
    expect(r.spread).toEqual({ low: 2, high: 9 });
  });
});

describe("applyRatio", () => {
  it("derives a price and shows the ratio it used", () => {
    const r = measureRatio([pair(10, 20), pair(10, 20), pair(10, 20)])!;
    const t = applyRatio(50, r, "the base card")!;
    expect(t.price).toBe(100);
    expect(t.anchor).toBe(50);
    expect(t.derived).toBe(true);
    expect(t.narrative).toContain("2×");
    expect(t.narrative).toContain("3 cards");
  });

  // 4.1 across three cards that ranged 2×–9× is a different claim from 4.1
  // across thirty that ranged 3.9×–4.3×, and a price hiding that can't be checked.
  it("says so when the measured ratios disagree wildly", () => {
    const wide = measureRatio([pair(10, 20), pair(10, 90), pair(10, 30)])!;
    expect(applyRatio(50, wide, "the base card")!.narrative).toContain("wide bracket");

    const tight = measureRatio([pair(10, 20), pair(10, 21), pair(10, 22)])!;
    expect(applyRatio(50, tight, "the base card")!.narrative).not.toContain("wide bracket");
  });

  it("refuses an anchor that isn't a price", () => {
    const r = measureRatio([pair(10, 20), pair(10, 20), pair(10, 20)])!;
    expect(applyRatio(0, r, "x")).toBeNull();
    expect(applyRatio(-5, r, "x")).toBeNull();
  });
});

describe("ownHistory — stated, never discounted", () => {
  // Any decay rate would be invented, and an invented rate on a real price
  // produces a number that LOOKS derived and isn't.
  it("returns the price unchanged, with its age", () => {
    const h = ownHistory(340, 540)!;
    expect(h.price).toBe(340);
    expect(h.ageDays).toBe(540);
    expect(h.narrative).toContain("18 months ago");
  });

  it("grades staleness so a caller can render history as history", () => {
    expect(ownHistory(100, 30)!.staleness).toBe("recent");
    expect(ownHistory(100, 300)!.staleness).toBe("aging");
    expect(ownHistory(100, 900)!.staleness).toBe("stale");
  });

  it("says plainly that it did not discount, and why", () => {
    expect(ownHistory(100, 900)!.narrative).toContain("Not discounted");
  });

  it("has no answer for a card that never sold", () => {
    expect(ownHistory(null, 100)).toBeNull();
    expect(ownHistory(100, null)).toBeNull();
    expect(ownHistory(0, 100)).toBeNull();
  });
});

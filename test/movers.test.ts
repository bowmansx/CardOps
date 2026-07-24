import { describe, it, expect } from "vitest";
import { pctChangeOverWindow, classifyMove, trendDeviation, type PricePoint } from "../src/lib/cards/movers";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed epoch for determinism
const pt = (daysAgo: number, price: number): PricePoint => ({ at: NOW - daysAgo * DAY, price });

describe("pctChangeOverWindow", () => {
  it("computes the move from the value as-of the window start", () => {
    const h = [pt(30, 100), pt(10, 110), pt(0, 120)];
    const m = pctChangeOverWindow(h, 7, NOW); // baseline = newest point ≤ 7d ago = the 10-day-ago $110
    expect(m).not.toBeNull();
    expect(m!.from).toBe(110);
    expect(m!.to).toBe(120);
    expect(m!.pct).toBeCloseTo(9.1, 1);
  });
  it("falls back to the earliest point when nothing is older than the window", () => {
    const h = [pt(3, 50), pt(0, 60)];
    const m = pctChangeOverWindow(h, 30, NOW);
    expect(m!.from).toBe(50);
    expect(m!.pct).toBeCloseTo(20, 5);
  });
  it("returns null without two distinct points", () => {
    expect(pctChangeOverWindow([pt(0, 100)], 7, NOW)).toBeNull();
    expect(pctChangeOverWindow([], 7, NOW)).toBeNull();
  });
  it("ignores points in the future relative to now", () => {
    const h = [pt(10, 100), pt(0, 120), { at: NOW + 5 * DAY, price: 999 }];
    const m = pctChangeOverWindow(h, 30, NOW);
    expect(m!.to).toBe(120); // the 999 future point is excluded
  });
  it("returns null when the baseline is far older than the window (not a recent move)", () => {
    const h = [pt(85, 10), pt(0, 20)]; // only prior point is 85d old, window 7d
    expect(pctChangeOverWindow(h, 7, NOW)).toBeNull();
  });
});

describe("classifyMove", () => {
  it("thresholds up / down / flat", () => {
    expect(classifyMove(12, 10)).toBe("up");
    expect(classifyMove(-12, 10)).toBe("down");
    expect(classifyMove(5, 10)).toBe("flat");
    expect(classifyMove(-5, 10)).toBe("flat");
  });
});

describe("trendDeviation", () => {
  it("is ~0 when the latest point sits on the trend line", () => {
    const h = [pt(20, 100), pt(10, 110), pt(0, 120)]; // perfectly linear +1/day
    const d = trendDeviation(h, NOW);
    expect(d).not.toBeNull();
    expect(Math.abs(d!.pct)).toBeLessThan(0.5);
  });
  it("flags a spike above the card's own trend", () => {
    const h = [pt(30, 100), pt(20, 102), pt(10, 104), pt(0, 140)]; // last point jumps
    const d = trendDeviation(h, NOW);
    expect(d!.actual).toBe(140);
    expect(d!.pct).toBeGreaterThan(20); // well above the ~106 the trend expected
  });
  it("needs at least three points", () => {
    expect(trendDeviation([pt(10, 100), pt(0, 120)], NOW)).toBeNull();
  });
  it("refuses to extrapolate two clustered priors across a long gap", () => {
    const h = [pt(20, 100), pt(19, 105), pt(0, 110)]; // priors 1d apart, latest 19d later
    expect(trendDeviation(h, NOW)).toBeNull();
  });
});

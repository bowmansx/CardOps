import { describe, it, expect } from "vitest";
import { allocate } from "@/lib/ebay/allocate";

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe("allocate", () => {
  it("always sums back exactly to the total", () => {
    for (const [total, weights] of [
      [10, [1, 1, 1]],
      [0.3, [3, 7]],
      [99.99, [12.34, 56.78, 9.01]],
      [1.01, [1, 1, 1, 1, 1, 1, 1]],
      [0.01, [5, 5]],
    ] as [number, number[]][]) {
      const parts = allocate(total, weights);
      expect(sum(parts)).toBe(Math.round(total * 100) / 100);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it("single line gets the whole amount", () => {
    expect(allocate(12.34, [77])).toEqual([12.34]);
  });

  it("proportions track weights (equal weights within a cent of equal)", () => {
    const parts = allocate(10, [1, 1, 1]);
    for (const p of parts) expect(Math.abs(p - 10 / 3)).toBeLessThan(0.011);
  });

  it("degenerate weights put everything on the last line, never lost", () => {
    expect(allocate(5, [0, 0])).toEqual([0, 5]);
    expect(sum(allocate(5, [NaN, -2, 0]))).toBe(5);
  });

  it("empty weights → empty result", () => {
    expect(allocate(5, [])).toEqual([]);
  });
});

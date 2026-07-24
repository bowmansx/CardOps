import { describe, it, expect } from "vitest";
import { consensusForCard } from "../src/lib/cards/price-sources/blend";
import type { SourceQuote } from "../src/lib/cards/price-sources/types";

const q = (over: Partial<SourceQuote>): SourceQuote => ({
  source: "pricecharting", kind: "guide", grader: null, grade: null,
  price: 10, currency: "USD", label: "Ungraded", ...over,
});

describe("consensusForCard", () => {
  it("returns none when there are no inputs", () => {
    const r = consensusForCard({ condition_type: "raw", grader: null, grade: null }, null, []);
    expect(r.method).toBe("none");
    expect(r.value).toBeNull();
    expect(r.inputs).toEqual([]);
  });

  it("uses the comp value alone as a single input", () => {
    const r = consensusForCard({ condition_type: "raw", grader: null, grade: null }, 25, []);
    expect(r.method).toBe("single");
    expect(r.value).toBe(25);
    expect(r.inputs).toHaveLength(1);
  });

  it("for a RAW card, blends comps with each source's UNGRADED (non-foil) value", () => {
    const quotes = [
      q({ source: "scryfall", price: 8, label: "Ungraded" }),
      q({ source: "scryfall", price: 30, label: "Ungraded · foil" }), // ignored for raw consensus
      q({ source: "pricecharting", price: 12, label: "Ungraded" }),
      q({ source: "pricecharting", grader: "PSA", grade: 10, price: 200, label: "PSA 10" }), // graded → ignored
    ];
    const r = consensusForCard({ condition_type: "raw", grader: null, grade: null }, 10, quotes);
    // inputs: comps 10, scryfall 8, pricecharting 12 → median 10
    expect(r.method).toBe("median");
    expect(r.value).toBe(10);
    expect(r.inputs.map((i) => i.price).sort((a, b) => a - b)).toEqual([8, 10, 12]);
  });

  it("prefers the base ungraded value over foil even when foil is listed first", () => {
    const quotes = [
      q({ source: "scryfall", price: 50, label: "Ungraded · foil" }),
      q({ source: "scryfall", price: 5, label: "Ungraded" }),
    ];
    const r = consensusForCard({ condition_type: "raw", grader: null, grade: null }, null, quotes);
    expect(r.value).toBe(5);
  });

  it("for a GRADED card, picks the source quote nearest the card's grade", () => {
    const quotes = [
      q({ source: "pricecharting", grader: "PSA", grade: 8, price: 40, label: "Grade 8" }),
      q({ source: "pricecharting", grader: "PSA", grade: 9, price: 90, label: "PSA 9" }),
      q({ source: "pricecharting", grader: "PSA", grade: 10, price: 300, label: "PSA 10" }),
      q({ source: "pricecharting", grader: null, grade: null, price: 12, label: "Ungraded" }), // raw → ignored
    ];
    const r = consensusForCard({ condition_type: "graded", grader: "PSA", grade: 9 }, 85, quotes);
    // inputs: comps 85 + pricecharting PSA9 90 → median of two = 87.5
    expect(r.value).toBe(87.5);
    expect(r.inputs).toHaveLength(2);
  });

  it("ignores a source with no condition-relevant quote", () => {
    const quotes = [q({ source: "scryfall", grader: null, grade: null, price: 8, label: "Ungraded" })];
    // graded card, scryfall only has ungraded → no source input, comps only
    const r = consensusForCard({ condition_type: "graded", grader: "PSA", grade: 10 }, 100, quotes);
    expect(r.method).toBe("single");
    expect(r.value).toBe(100);
  });
});

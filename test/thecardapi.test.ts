import { describe, it, expect } from "vitest";
import { distillSales, saleQuery, type CardApiSale } from "@/lib/cards/price-sources/thecardapi";
import type { CardForPricing } from "@/lib/cards/price-sources/types";

const graded = (grader: string, grade: number): CardForPricing => ({
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader, grade, condition_type: "graded",
});
const raw: CardForPricing = { ...graded("", 0), grader: null, grade: null, condition_type: "raw" };

const sale = (o: Partial<CardApiSale>): CardApiSale => ({ price: 50, currency: "USD", platform: "eBay", sold_at: "2026-05-14", ...o });

describe("saleQuery", () => {
  it("joins identifying fields into a search string", () => {
    expect(saleQuery(graded("PSA", 10))).toBe("2021 Bowman Chrome Kyle Harrison BCP-42");
  });
  it("skips null fields", () => {
    expect(saleQuery({ ...raw, year: null, card_number: null })).toBe("Bowman Chrome Kyle Harrison");
  });
});

describe("distillSales — graded", () => {
  it("medians only the matching grader+grade sales", () => {
    const sales = [
      sale({ grader: "PSA", grade: "10", price: 100 }),
      sale({ grader: "PSA", grade: "10", price: 120 }),
      sale({ grader: "PSA", grade: "9", price: 40 }),   // wrong grade
      sale({ grader: "SGC", grade: "10", price: 200 }), // wrong grader
      sale({ grader: null, price: 10 }),                 // raw
    ];
    const [q] = distillSales(sales, graded("PSA", 10));
    expect(q.price).toBe(110); // median(100,120)
    expect(q.grader).toBe("PSA");
    expect(q.grade).toBe(10);
    expect(q.kind).toBe("sold");
    expect(q.label).toContain("median of 2");
  });

  it("returns NOTHING on no exact grade match — never contaminates with other grades/graders", () => {
    const sales = [sale({ grader: "PSA", grade: "9", price: 60 }), sale({ grader: "BGS", grade: "9.5", price: 80 })];
    expect(distillSales(sales, graded("PSA", 10))).toHaveLength(0);
  });

  it("returns nothing when there are no graded sales at all", () => {
    expect(distillSales([sale({ grader: null, price: 10 })], graded("PSA", 10))).toHaveLength(0);
  });

  it("exposes a sample of the exact sales behind the median for auditing", () => {
    const sales = [sale({ grader: "PSA", grade: "10", price: 100, title: "A" }), sale({ grader: "PSA", grade: "10", price: 120, title: "B" })];
    const [q] = distillSales(sales, graded("PSA", 10));
    const payload = q.payload as { count: number; sample: { grade: string | number | null }[] };
    expect(payload.count).toBe(2);
    expect(payload.sample).toHaveLength(2);
    expect(payload.sample.every((s) => Number(s.grade) === 10)).toBe(true);
  });
});

describe("distillSales — raw", () => {
  it("medians only ungraded sales", () => {
    const sales = [
      sale({ grader: null, price: 10 }),
      sale({ grader: null, price: 20 }),
      sale({ grader: "PSA", grade: "10", price: 500 }), // graded — excluded
    ];
    const [q] = distillSales(sales, raw);
    expect(q.price).toBe(15);
    expect(q.grader).toBeNull();
    expect(q.grade).toBeNull();
  });
});

describe("distillSales — hygiene", () => {
  it("ignores zero/negative/non-numeric prices", () => {
    const sales = [sale({ grader: null, price: 0 }), sale({ grader: null, price: -5 }), sale({ grader: null, price: "abc" as unknown as number }), sale({ grader: null, price: 30 })];
    const [q] = distillSales(sales, raw);
    expect(q.price).toBe(30);
  });
  it("empty input → no quote", () => {
    expect(distillSales([], raw)).toHaveLength(0);
  });
});

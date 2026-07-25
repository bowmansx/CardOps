import { describe, it, expect } from "vitest";
import { saleToRow, salesToRows, saleKey, storedToSales, dailyMedianSeries } from "@/lib/cards/market-sales";
import type { CardApiSale } from "@/lib/cards/price-sources/thecardapi";

const sale = (o: Partial<CardApiSale>): CardApiSale => ({ id: "1", price: 2, sold_at: "2026-05-01", title: "t", platform: "eBay", ...o });

describe("saleKey / saleToRow", () => {
  it("uses the platform id as the dedup key when present", () => {
    expect(saleKey(sale({ id: "137222685761" }))).toBe("137222685761");
  });
  it("falls back to a stable hash when there's no id", () => {
    const k = saleKey(sale({ id: undefined, price: 2.5, sold_at: "2026-05-01", title: "Roiling Dragonstorm" }));
    expect(k).toBe("2026-05-01:2.5:Roiling Dragonstorm");
  });
  it("maps a sale to a row and drops junk prices", () => {
    expect(saleToRow("i1", "c1", sale({ price: 0 }))).toBeNull();
    const r = saleToRow("i1", "c1", sale({ price: 2.05, grader: "PSA", grade: "10" as unknown as number }));
    expect(r).toMatchObject({ identity_id: "i1", card_id: "c1", source: "thecardapi", price: 2.05, grader: "PSA", grade: 10, sold_at: "2026-05-01" });
  });
  // Sales belong to the shared identity; card_id is provenance only and may be
  // absent (e.g. a refresh driven by identity rather than by someone's copy).
  it("allows a null card_id — history is identity-owned", () => {
    const r = saleToRow("i1", null, sale({ price: 5 }));
    expect(r).toMatchObject({ identity_id: "i1", card_id: null });
  });
});

describe("salesToRows dedups within a batch", () => {
  it("keeps one row per external id", () => {
    const rows = salesToRows("i1", "c1", [sale({ id: "a", price: 2 }), sale({ id: "a", price: 2 }), sale({ id: "b", price: 3 })]);
    expect(rows.map((r) => r.external_id).sort()).toEqual(["a", "b"]);
  });
});

describe("dailyMedianSeries", () => {
  it("collapses to one median point per day, sorted by date", () => {
    const series = dailyMedianSeries([
      { sold_at: "2026-05-02", price: 3 },
      { sold_at: "2026-05-01", price: 2 },
      { sold_at: "2026-05-01", price: 4 },
      { sold_at: null, price: 9 },     // no date → ignored
      { sold_at: "2026-05-01", price: 0 }, // junk → ignored
    ]);
    expect(series).toEqual([
      { date: "2026-05-01", price: 3, n: 2 }, // median(2,4)
      { date: "2026-05-02", price: 3, n: 1 },
    ]);
  });
});

describe("storedToSales", () => {
  it("round-trips stored rows into the sale shape summarize/estimate read", () => {
    const s = storedToSales([{ price: 2.1, sold_at: "2026-05-01", grader: null, grade: null, platform: "ebay", title: null }]);
    expect(s[0]).toMatchObject({ price: 2.1, sold_at: "2026-05-01", platform: "ebay" });
  });
});

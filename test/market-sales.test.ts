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
    const b = salesToRows("i1", "c1", [sale({ id: "a", price: 2 }), sale({ id: "a", price: 2 }), sale({ id: "b", price: 3 })]);
    expect(b.rows.map((r) => r.external_id).sort()).toEqual(["a", "b"]);
    expect(b.refusedSource).toBeNull();
  });
});

describe("salesToRows consults the source's licence", () => {
  // PriceCharting is internal-use-only, so its rows may not be stored. The point
  // of the gate is that this holds whoever writes the next accumulator.
  it("refuses a source that may not be persisted, and says which", () => {
    const b = salesToRows("i1", "c1", [sale({ id: "a", price: 2 })], "pricecharting");
    expect(b.rows).toEqual([]);
    expect(b.refusedSource).toBe("pricecharting");
  });

  // "We never checked" must not read the same as "permitted".
  it("default-denies a source nobody has stated terms for", () => {
    expect(salesToRows("i1", "c1", [sale({ id: "a" })], "some-new-vendor").refusedSource).toBe("some-new-vendor");
  });

  it("permits the source whose terms allow storage", () => {
    expect(salesToRows("i1", "c1", [sale({ id: "a" })], "thecardapi").rows).toHaveLength(1);
  });
});

describe("provisional prices are never stored", () => {
  // The accumulator upserts with ignoreDuplicates, so a fast-settle estimate
  // written once would never be corrected — it would sit in the shared history
  // at the wrong number for good. A later run picks it up once confirmed.
  it("holds back an unconfirmed price and counts it", () => {
    const b = salesToRows("i1", "c1", [
      sale({ id: "a", price: 10, price_confirmed: true }),
      sale({ id: "b", price: 999, price_confirmed: false }),
    ]);
    expect(b.rows.map((r) => r.external_id)).toEqual(["a"]);
    expect(b.unconfirmed).toBe(1);
  });

  // Older payloads omit the field entirely; only an explicit false is provisional.
  it("treats a missing flag as confirmed", () => {
    expect(saleToRow("i1", "c1", sale({ price: 5 }))).not.toBeNull();
    expect(saleToRow("i1", "c1", sale({ price: 5, price_confirmed: false }))).toBeNull();
  });
});

describe("dailyMedianSeries", () => {
  it("collapses to one median point per day, sorted by date", () => {
    const { points, excluded } = dailyMedianSeries([
      { sold_at: "2026-05-02", price: 3, platform: "eBay" },
      { sold_at: "2026-05-01", price: 2, platform: "eBay" },
      { sold_at: "2026-05-01", price: 4, platform: "eBay" },
      { sold_at: null, price: 9, platform: "eBay" },     // no date → ignored
      { sold_at: "2026-05-01", price: 0, platform: "eBay" }, // junk → ignored
    ]);
    expect(points).toEqual([
      { date: "2026-05-01", price: 3, n: 2 }, // median(2,4)
      { date: "2026-05-02", price: 3, n: 1 },
    ]);
    // A junk price isn't an exclusion worth reporting — it was never a sale.
    expect(excluded).toBe(0);
  });

  // The bug this exists to stop: a Goldin day plotting ~22% below an eBay day
  // and reading as a market move that never happened.
  it("converts a hammer price to all-in before medianing", () => {
    const { points } = dailyMedianSeries([{ sold_at: "2026-05-01", price: 100, platform: "Goldin" }]);
    expect(points[0].price).toBe(122); // 100 × 1.22
  });

  it("uses the pre-2022 premium for older sales", () => {
    const { points } = dailyMedianSeries([{ sold_at: "2021-05-01", price: 100, platform: "Goldin" }]);
    expect(points[0].price).toBe(120); // 100 × 1.20
  });

  it("excludes an undocumented auction house rather than guessing its premium", () => {
    const { points, excluded } = dailyMedianSeries([
      { sold_at: "2026-05-01", price: 100, platform: "eBay" },
      { sold_at: "2026-05-01", price: 100, platform: "Lelands" },
    ]);
    expect(points).toEqual([{ date: "2026-05-01", price: 100, n: 1 }]);
    expect(excluded).toBe(1);
  });

  // A missing platform can't be placed on either footing. Silently treating it
  // as all-in is the default-a-money-field failure rule 9 forbids.
  it("excludes a sale with no platform", () => {
    const { points, excluded } = dailyMedianSeries([{ sold_at: "2026-05-01", price: 100, platform: null }]);
    expect(points).toEqual([]);
    expect(excluded).toBe(1);
  });
});

describe("storedToSales", () => {
  it("round-trips stored rows into the sale shape summarize/estimate read", () => {
    const s = storedToSales([{ price: 2.1, sold_at: "2026-05-01", grader: null, grade: null, platform: "ebay", title: null }]);
    expect(s[0]).toMatchObject({ price: 2.1, sold_at: "2026-05-01", platform: "ebay" });
  });
});

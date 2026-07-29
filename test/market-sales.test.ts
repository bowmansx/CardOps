import { describe, it, expect } from "vitest";
import { saleToRow, salesToRows, storedToSales, dailyMedianSeries } from "@/lib/cards/market-sales";
import type { ObservedSale } from "@/lib/cards/observed-sale";

const sale = (o: Partial<ObservedSale> = {}): ObservedSale => ({
  externalId: "1", price: 2, currency: "USD", priceBasis: "all_in",
  soldAt: "2026-05-01", platform: "eBay", title: "t", url: null,
  grader: null, grade: null, isGraded: null, confirmed: true, ...o,
});

describe("saleToRow", () => {
  it("maps a sale to a row and drops junk prices", () => {
    expect(saleToRow("i1", "c1", sale({ price: 0 }), "thecardapi")).toBeNull();
    const r = saleToRow("i1", "c1", sale({ price: 2.05, grader: "PSA", grade: 10 }), "thecardapi");
    expect(r).toMatchObject({ identity_id: "i1", card_id: "c1", source: "thecardapi", price: 2.05, grader: "PSA", grade: 10, sold_at: "2026-05-01" });
  });

  // Sales belong to the shared identity; card_id is provenance only and may be
  // absent (e.g. a refresh driven by identity rather than by someone's copy).
  it("allows a null card_id — history is identity-owned", () => {
    expect(saleToRow("i1", null, sale({ price: 5 }), "thecardapi")).toMatchObject({ identity_id: "i1", card_id: null });
  });
});

describe("salesToRows dedups within a batch", () => {
  it("keeps one row per external id", () => {
    const b = salesToRows("i1", "c1", [
      sale({ externalId: "a", price: 2 }), sale({ externalId: "a", price: 2 }), sale({ externalId: "b", price: 3 }),
    ], "thecardapi");
    expect(b.rows.map((r) => r.external_id).sort()).toEqual(["a", "b"]);
    expect(b.refusedSource).toBeNull();
  });
});

describe("salesToRows consults the source's licence", () => {
  // PriceCharting is internal-use-only, so its rows may not be stored. The point
  // of the gate is that this holds whoever writes the next accumulator.
  it("refuses a source that may not be persisted, and says which", () => {
    const b = salesToRows("i1", "c1", [sale()], "pricecharting");
    expect(b.rows).toEqual([]);
    expect(b.refusedSource).toBe("pricecharting");
  });

  // "We never checked" must not read the same as "permitted".
  it("default-denies a source nobody has stated terms for", () => {
    expect(salesToRows("i1", "c1", [sale()], "some-new-vendor").refusedSource).toBe("some-new-vendor");
  });

  it("permits the source whose terms allow storage", () => {
    expect(salesToRows("i1", "c1", [sale()], "thecardapi").rows).toHaveLength(1);
  });
});

describe("provisional prices are never stored", () => {
  // The accumulator upserts with ignoreDuplicates, so a fast-settle estimate
  // written once would never be corrected — it would sit in the shared history
  // at the wrong number for good. A later run picks it up once confirmed.
  it("holds back an unconfirmed price and counts it", () => {
    const b = salesToRows("i1", "c1", [
      sale({ externalId: "a", price: 10 }),
      sale({ externalId: "b", price: 999, confirmed: false }),
    ], "thecardapi");
    expect(b.rows.map((r) => r.external_id)).toEqual(["a"]);
    expect(b.unconfirmed).toBe(1);
  });
});

describe("dailyMedianSeries", () => {
  it("collapses to one median point per day, sorted by date", () => {
    const { points, excluded } = dailyMedianSeries([
      sale({ soldAt: "2026-05-02", price: 3 }),
      sale({ soldAt: "2026-05-01", price: 2 }),
      sale({ soldAt: "2026-05-01", price: 4 }),
      sale({ soldAt: null, price: 9 }),   // no date → ignored
      sale({ soldAt: "2026-05-01", price: 0 }), // junk → ignored
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
    const { points } = dailyMedianSeries([sale({ price: 100, platform: "Goldin", priceBasis: "hammer" })]);
    expect(points[0].price).toBe(122); // 100 × 1.22
  });

  it("uses the pre-2022 premium for older sales", () => {
    const { points } = dailyMedianSeries([sale({ soldAt: "2021-05-01", price: 100, platform: "Goldin", priceBasis: "hammer" })]);
    expect(points[0].price).toBe(120); // 100 × 1.20
  });

  it("excludes a hammer price from a house whose premium we can't cite", () => {
    const { points, excluded } = dailyMedianSeries([
      sale({ price: 100 }),
      sale({ price: 100, platform: "Lelands", priceBasis: "hammer" }),
    ]);
    expect(points).toEqual([{ date: "2026-05-01", price: 100, n: 1 }]);
    expect(excluded).toBe(1);
  });

  // Silently treating an unknown basis as all-in is the default-a-money-field
  // failure rule 9 forbids.
  it("excludes a sale whose basis was never established", () => {
    const { points, excluded } = dailyMedianSeries([sale({ price: 100, priceBasis: "unknown" })]);
    expect(points).toEqual([]);
    expect(excluded).toBe(1);
  });
});

describe("storedToSales", () => {
  it("round-trips stored rows into the shape every consumer reads", () => {
    const s = storedToSales([{ price: 2.1, sold_at: "2026-05-01", grader: null, grade: null, platform: "ebay", title: null }]);
    expect(s[0]).toMatchObject({ price: 2.1, soldAt: "2026-05-01", platform: "ebay", confirmed: true });
  });

  // Rows written before the price_basis column existed are classified by asking
  // the SOURCE that fetched them, not a global platform table.
  it("derives the basis from the source when the row has no stored one", () => {
    const [ebay, goldin] = storedToSales([
      { price: 10, sold_at: "2026-05-01", grader: null, grade: null, platform: "eBay", title: null, source: "thecardapi" },
      { price: 10, sold_at: "2026-05-01", grader: null, grade: null, platform: "Goldin", title: null, source: "thecardapi" },
    ]);
    expect(ebay.priceBasis).toBe("all_in");
    expect(goldin.priceBasis).toBe("hammer");
  });

  it("prefers the stored basis over any inference", () => {
    const [s] = storedToSales([
      { price: 10, sold_at: "2026-05-01", grader: null, grade: null, platform: "Goldin", title: null, source: "thecardapi", price_basis: "all_in" },
    ]);
    expect(s.priceBasis).toBe("all_in");
  });

  // An unrecognised source must not inherit another vendor's convention.
  it("falls back to unknown for a source with no declared convention", () => {
    const [s] = storedToSales([
      { price: 10, sold_at: "2026-05-01", grader: null, grade: null, platform: "Goldin", title: null, source: "some-old-import" },
    ]);
    expect(s.priceBasis).toBe("unknown");
  });

  // NULL means "nobody recorded it" and must never collapse to false, which
  // would assert every legacy row was raw.
  it("keeps an unrecorded graded flag as null", () => {
    const [s] = storedToSales([{ price: 10, sold_at: null, grader: null, grade: null, platform: "eBay", title: null }]);
    expect(s.isGraded).toBeNull();
  });
});

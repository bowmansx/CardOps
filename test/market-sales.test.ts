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

// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE. Migration 20260750, applied 2026-07-29. The database CHECKs the
// relationship between `provenance` and `added_by`, and a violation fails the
// WHOLE upsert batch — so the shape is corrected before it is sent.
// ─────────────────────────────────────────────────────────────────────────────

describe("saleToRow — provenance columns", () => {
  it("defaults to the vendor lane, which asserts nothing about a person", () => {
    const r = saleToRow("i1", "c1", sale(), "thecardapi")!;
    expect(r.provenance).toBe("vendor");
    expect(r.added_by).toBeNull();
  });

  it("attributes a paste to whoever contributed it", () => {
    const r = saleToRow("i1", "c1", sale(), "paste-terapeak", {
      provenance: "manual_paste", addedBy: "user-7",
    })!;
    expect(r.provenance).toBe("manual_paste");
    expect(r.added_by).toBe("user-7");
  });

  // The DB CHECK says a vendor row may not claim a contributor. Sending one
  // would fail the whole batch, so a caller that supplies both is corrected
  // rather than allowed to poison every other sale in the same fetch.
  it("strips a contributor from a vendor row instead of failing the batch", () => {
    const r = saleToRow("i1", "c1", sale(), "thecardapi", {
      provenance: "vendor", addedBy: "user-7",
    })!;
    expect(r.added_by).toBeNull();
  });

  // Stored rather than re-derived: re-deriving reinterprets years of history
  // the day a vendor changes how it reports an auction house.
  it("stores the basis the source declared", () => {
    expect(saleToRow("i1", "c1", sale({ priceBasis: "hammer" }), "thecardapi")!.price_basis).toBe("hammer");
    expect(saleToRow("i1", "c1", sale({ priceBasis: "unknown" }), "thecardapi")!.price_basis).toBe("unknown");
  });

  // NULL means nobody recorded it. Collapsing to false would assert every row
  // was raw, which is the inflation bug this whole column exists to end.
  it("keeps an unknown graded flag null", () => {
    expect(saleToRow("i1", "c1", sale({ isGraded: null }), "thecardapi")!.is_graded).toBeNull();
    expect(saleToRow("i1", "c1", sale({ isGraded: true }), "thecardapi")!.is_graded).toBe(true);
    expect(saleToRow("i1", "c1", sale({ isGraded: false }), "thecardapi")!.is_graded).toBe(false);
  });
});

describe("salesToRows carries the origin to every row", () => {
  it("stamps a whole paste batch with its contributor", () => {
    const b = salesToRows("i1", "c1", [
      sale({ externalId: "a" }), sale({ externalId: "b" }),
    ], "paste-130point", { provenance: "manual_paste", addedBy: "user-9" });
    expect(b.rows).toHaveLength(2);
    expect(b.rows.every((r) => r.provenance === "manual_paste" && r.added_by === "user-9")).toBe(true);
  });

  it("leaves a cron batch as vendor rows with no contributor", () => {
    const b = salesToRows("i1", "c1", [sale()], "thecardapi");
    expect(b.rows[0]).toMatchObject({ provenance: "vendor", added_by: null });
  });
});

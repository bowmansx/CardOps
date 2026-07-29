import { describe, it, expect } from "vitest";
import { rollupSales, rollupsToSeries, weekStart, monthStart, type SaleForRollup } from "@/lib/cards/rollup";

const sale = (o: Partial<SaleForRollup> = {}): SaleForRollup => ({
  externalId: Math.random().toString(36).slice(2), price: 100, currency: "USD", priceBasis: "all_in",
  soldAt: "2026-05-13", platform: "eBay", title: "t", url: null,
  grader: null, grade: null, isGraded: null, confirmed: true,
  source: "thecardapi", provenance: "vendor", ...o,
});

describe("weekStart", () => {
  // Parsed as UTC on purpose: a sale must not drift into the previous week for
  // anyone west of Greenwich, or the same data rolls up differently depending on
  // who ran the job.
  it("snaps to the Monday of the ISO week", () => {
    expect(weekStart("2026-05-13")).toBe("2026-05-11"); // Wed → Mon
    expect(weekStart("2026-05-11")).toBe("2026-05-11"); // Mon → itself
    expect(weekStart("2026-05-17")).toBe("2026-05-11"); // Sun → the Mon before
  });

  it("crosses month and year boundaries", () => {
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // Thu → prior Mon
    expect(weekStart("2026-03-01")).toBe("2026-02-23"); // Sun
  });

  it("ignores any time component", () => {
    expect(weekStart("2026-05-13T22:45:00Z")).toBe("2026-05-11");
  });
});

describe("monthStart", () => {
  it("snaps to the first", () => {
    expect(monthStart("2026-05-13")).toBe("2026-05-01");
  });
});

describe("rollupSales", () => {
  it("collapses a week into one row with the statistics a valuation needs", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 100, soldAt: "2026-05-11" }),
      sale({ price: 200, soldAt: "2026-05-13" }),
      sale({ price: 300, soldAt: "2026-05-17" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identity_id: "id1", period: "week", period_start: "2026-05-11",
      n: 3, median_price: 200, min_price: 100, max_price: 300,
      first_sold: "2026-05-11", last_sold: "2026-05-17", excluded_unknown_basis: 0,
    });
  });

  // A PSA 10 and a raw copy are different goods; a median across both describes
  // neither.
  it("keeps conditions apart", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 500, grader: "PSA", grade: 10 }),
      sale({ price: 520, grader: "PSA", grade: 10 }),
      sale({ price: 40, grader: null, grade: null }),
      sale({ price: 200, grader: "PSA", grade: 9 }),
    ]);
    expect(rows).toHaveLength(3);
    const psa10 = rows.find((r) => r.grader === "PSA" && r.grade === 10);
    expect(psa10).toMatchObject({ n: 2, median_price: 510 });
  });

  // grade 0 and grade null are different buckets; a key that collapsed them
  // would merge an authentic-only slab with a raw card.
  it("does not collide a null grade with grade 0", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 10, grader: "PSA", grade: 0 }),
      sale({ price: 90, grader: "PSA", grade: null }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("splits weeks", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 100, soldAt: "2026-05-11" }),
      sale({ price: 300, soldAt: "2026-05-18" }),
    ]);
    expect(rows.map((r) => [r.period_start, r.median_price])).toEqual([
      ["2026-05-11", 100], ["2026-05-18", 300],
    ]);
  });

  it("buckets by month when asked", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 100, soldAt: "2026-05-01" }),
      sale({ price: 300, soldAt: "2026-05-28" }),
    ], "month");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "month", period_start: "2026-05-01", n: 2, median_price: 200 });
  });
});

describe("rollupSales — money hygiene survives compaction", () => {
  it("normalizes a hammer price before taking statistics", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 100, platform: "Goldin", priceBasis: "hammer" }),
    ]);
    expect(rows[0].median_price).toBe(122);
  });

  // The rollup has to admit what it left out, because after the hot rows are
  // deleted nobody can reconstruct it.
  it("counts unconvertible sales onto the row they would have joined", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 100 }),
      sale({ price: 900, platform: "Hakes", priceBasis: "unknown" }),
    ]);
    expect(rows[0]).toMatchObject({ n: 1, median_price: 100, excluded_unknown_basis: 1 });
  });

  // n=0 would be a row asserting a price it does not have, and the table's
  // CHECK (n > 0) rejects it anyway.
  it("emits no row when every sale in a bucket was unconvertible", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 900, platform: "REA", priceBasis: "unknown" }),
    ]);
    expect(rows).toEqual([]);
  });

  it("ignores junk prices without calling them exclusions", () => {
    const { rows } = rollupSales("id1", [sale({ price: 100 }), sale({ price: 0 }), sale({ price: -5 })]);
    expect(rows[0]).toMatchObject({ n: 1, excluded_unknown_basis: 0 });
  });

  // Undated sales cannot be bucketed. They are REPORTED because a job that
  // deletes hot rows after compaction would otherwise lose them silently.
  it("reports undated sales instead of dropping them quietly", () => {
    const { rows, undated } = rollupSales("id1", [sale({ price: 100 }), sale({ soldAt: null, price: 50 })]);
    expect(rows).toHaveLength(1);
    expect(undated).toBe(1);
  });
});

describe("rollupSales — provenance survives compaction", () => {
  // The whole reason the cold tier is safe to build: "median of 41 PSA 9 sales,
  // week of 12 May, The Card API" still holds after the rows are gone.
  it("keeps sources, platforms and provenances, deduped and sorted", () => {
    const { rows } = rollupSales("id1", [
      sale({ price: 100, source: "thecardapi", platform: "eBay", provenance: "vendor" }),
      sale({ price: 110, source: "thecardapi", platform: "eBay", provenance: "vendor" }),
      sale({ price: 120, source: "terapeak-paste", platform: "eBay", provenance: "manual_paste" }),
      sale({ price: 130, source: "thecardapi", platform: "TCGplayer", provenance: "vendor" }),
    ]);
    expect(rows[0].sources).toEqual(["terapeak-paste", "thecardapi"]);
    expect(rows[0].platforms).toEqual(["TCGplayer", "eBay"]);
    expect(rows[0].provenances).toEqual(["manual_paste", "vendor"]);
  });
});

describe("rollupsToSeries", () => {
  const rows = rollupSales("id1", [
    sale({ price: 100, soldAt: "2026-05-11", grader: "PSA", grade: 10 }),
    sale({ price: 200, soldAt: "2026-05-18", grader: "PSA", grade: 10 }),
    sale({ price: 30, soldAt: "2026-05-18", grader: null, grade: null }),
  ]).rows;

  // Same shape as the raw-sale series, so a graph can span both tiers without
  // knowing where the hot/cold boundary falls.
  it("returns chart points in date order", () => {
    expect(rollupsToSeries(rows).points.map((p) => p.date)).toEqual(["2026-05-11", "2026-05-18", "2026-05-18"]);
  });

  it("filters to one condition when asked", () => {
    const { points } = rollupsToSeries(rows, { grader: "PSA", grade: 10 });
    expect(points.map((p) => p.price)).toEqual([100, 200]);
  });

  it("matches raw sales on a null grader", () => {
    const { points } = rollupsToSeries(rows, { grader: null, grade: null });
    expect(points.map((p) => p.price)).toEqual([30]);
  });

  it("carries exclusions forward so a partial rollup keeps saying so", () => {
    const partial = rollupSales("id1", [
      sale({ price: 100 }),
      sale({ price: 900, platform: "Hakes", priceBasis: "unknown" }),
    ]).rows;
    expect(rollupsToSeries(partial).excluded).toBe(1);
  });
});

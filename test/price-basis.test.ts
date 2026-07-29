import { describe, it, expect } from "vitest";
import { basisFor, toAllIn, partitionByBasis, exclusionNote } from "@/lib/cards/price-basis";

describe("basisFor", () => {
  it("reads the vendor's documented platforms", () => {
    expect(basisFor("eBay")).toBe("all_in");
    expect(basisFor("TCGplayer")).toBe("all_in");
    expect(basisFor("Goldin")).toBe("hammer");
  });

  // The API returns display casing ("eBay", "SCP Auctions"). A casing change
  // upstream must never silently reclassify money.
  it("is case- and whitespace-insensitive", () => {
    expect(basisFor("  EBAY  ")).toBe("all_in");
    expect(basisFor("goldin")).toBe("hammer");
  });

  // Auction houses the vendor documents no premium rate for. Assuming all-in
  // would be defaulting a money field to a convenient guess.
  it("treats an undocumented platform as unknown", () => {
    for (const p of ["Lelands", "SCP Auctions", "Hakes", "REA"]) expect(basisFor(p)).toBe("unknown");
  });

  // A platform added upstream tomorrow starts excluded rather than quietly
  // joining the median on an assumption nobody made deliberately.
  it("treats an absent or novel platform as unknown", () => {
    expect(basisFor(null)).toBe("unknown");
    expect(basisFor("")).toBe("unknown");
    expect(basisFor("SomeNewHouse")).toBe("unknown");
  });
});

describe("toAllIn", () => {
  it("leaves an all-in price alone and says it didn't convert", () => {
    expect(toAllIn(100, "eBay", "2026-05-01")).toEqual({ ok: true, price: 100, basis: "all_in", converted: false });
  });

  it("adds the buyer's premium to a hammer price", () => {
    expect(toAllIn(100, "Goldin", "2026-05-01")).toEqual({ ok: true, price: 122, basis: "hammer", converted: true });
  });

  it("uses the pre-2022 rate on the other side of the boundary", () => {
    expect(toAllIn(100, "Goldin", "2021-12-31")).toMatchObject({ price: 120 });
    expect(toAllIn(100, "Goldin", "2022-01-01")).toMatchObject({ price: 122 });
  });

  // An undated hammer sale can't be placed on either side of the rate change,
  // so there is no honest conversion to make.
  it("refuses an undated hammer price rather than picking an era", () => {
    expect(toAllIn(100, "Goldin", null)).toEqual({ ok: false, reason: "no_premium_rate" });
  });

  it("refuses an unknown basis", () => {
    expect(toAllIn(100, "Lelands", "2026-05-01")).toEqual({ ok: false, reason: "unknown_basis" });
  });

  it("refuses junk prices", () => {
    expect(toAllIn(0, "eBay", "2026-05-01")).toEqual({ ok: false, reason: "bad_price" });
    expect(toAllIn(Number.NaN, "eBay", "2026-05-01")).toEqual({ ok: false, reason: "bad_price" });
  });

  it("rounds to cents", () => {
    expect(toAllIn(47.5, "Goldin", "2026-05-01")).toMatchObject({ price: 57.95 });
  });
});

describe("partitionByBasis", () => {
  it("returns BOTH halves — a thinned comp set must be distinguishable from a complete one", () => {
    const { usable, excluded } = partitionByBasis([
      { price: 100, platform: "eBay", sold_at: "2026-05-01" },
      { price: 100, platform: "Goldin", sold_at: "2026-05-01" },
      { price: 100, platform: "Hakes", sold_at: "2026-05-01" },
    ]);
    expect(usable.map((u) => u.allIn)).toEqual([100, 122]);
    expect(usable.map((u) => u.converted)).toEqual([false, true]);
    expect(excluded).toEqual([{ platform: "Hakes", reason: "unknown_basis" }]);
  });

  it("falls back to sale_date when sold_at is absent", () => {
    const { usable } = partitionByBasis([{ price: 100, platform: "Goldin", sale_date: "2021-06-01" }]);
    expect(usable[0].allIn).toBe(120);
  });

  // A junk price was never a sale; reporting it as an exclusion would overstate
  // how much real data was dropped.
  it("does not report a junk price as an exclusion", () => {
    const { usable, excluded } = partitionByBasis([{ price: 0, platform: "eBay", sold_at: "2026-05-01" }]);
    expect(usable).toEqual([]);
    expect(excluded).toEqual([]);
  });
});

describe("exclusionNote", () => {
  it("is null when nothing was dropped, so the UI shows no banner", () => {
    expect(exclusionNote([])).toBeNull();
  });

  it("names the platforms responsible", () => {
    const note = exclusionNote([
      { platform: "Hakes", reason: "unknown_basis" },
      { platform: "REA", reason: "unknown_basis" },
    ]);
    expect(note).toContain("2 sales excluded");
    expect(note).toContain("Hakes");
    expect(note).toContain("REA");
  });
});

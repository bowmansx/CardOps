import { describe, it, expect } from "vitest";
import { distill, asSoldPayload } from "@/lib/cards/distill";
import type { ObservedSale } from "@/lib/cards/observed-sale";
import type { CardForPricing } from "@/lib/cards/price-sources/types";

const raw: CardForPricing = {
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader: null, grade: null, condition_type: "raw",
};

const sale = (o: Partial<ObservedSale> = {}): ObservedSale => ({
  externalId: Math.random().toString(36).slice(2), price: 50, currency: "USD", priceBasis: "all_in",
  soldAt: "2026-05-14", platform: "eBay", title: "t", url: null,
  grader: null, grade: null, isGraded: null, confirmed: true, ...o,
});

describe("the sold-quote payload is the evidence behind a price", () => {
  it("records the WINDOW the median describes", () => {
    // "median of 7" says nothing about whether those seven happened last week or
    // across two years, and the difference decides whether the number means
    // anything.
    const { quote } = distill([
      sale({ price: 10, soldAt: "2026-03-04" }),
      sale({ price: 20, soldAt: "2026-04-18" }),
      sale({ price: 30, soldAt: "2026-04-01" }),
    ], raw, "thecardapi");
    const p = asSoldPayload(quote?.payload);
    expect(p).toMatchObject({ count: 3, from: "2026-03-04", to: "2026-04-18" });
  });

  it("lists the platforms the price rests on, deduped", () => {
    const { quote } = distill([
      sale({ price: 10, platform: "eBay" }),
      sale({ price: 20, platform: "eBay" }),
      sale({ price: 30, platform: "TCGplayer" }),
    ], raw, "thecardapi");
    expect(asSoldPayload(quote?.payload)?.platforms.sort()).toEqual(["TCGplayer", "eBay"]);
  });

  // Both numbers survive so the chip can show a converted hammer price AS a
  // conversion. Otherwise the figure silently disagrees with the listing it
  // links to and the listing looks wrong.
  it("keeps the reported price alongside the all-in figure", () => {
    const { quote } = distill(
      [sale({ price: 100, platform: "Goldin", priceBasis: "hammer" })], raw, "thecardapi");
    const s = asSoldPayload(quote?.payload)?.sample[0];
    expect(s).toMatchObject({ price: 100, allIn: 122, converted: true });
  });

  it("marks an unconverted sale as not converted", () => {
    const { quote } = distill([sale({ price: 100 })], raw, "thecardapi");
    expect(asSoldPayload(quote?.payload)?.sample[0]).toMatchObject({ price: 100, allIn: 100, converted: false });
  });

  it("caps the sample but reports the true count, so the chip can say 6 of 20", () => {
    const many = Array.from({ length: 20 }, (_, i) => sale({ price: 10 + i }));
    const p = asSoldPayload(distill(many, raw, "thecardapi").quote?.payload);
    expect(p?.count).toBe(20);
    expect(p?.sample).toHaveLength(6);
  });

  it("carries the caveats the UI must surface", () => {
    const { quote } = distill([
      sale({ price: 30 }),
      sale({ price: 900, platform: "Hakes", priceBasis: "unknown" }),
      sale({ price: 9999, confirmed: false }),
    ], raw, "thecardapi");
    const p = asSoldPayload(quote?.payload);
    expect(p?.excluded).toBe(1);
    expect(p?.exclusionNote).toContain("Hakes");
    expect(p?.unconfirmed).toBe(1);
  });

  it("omits the caveat fields entirely when there is nothing to caveat", () => {
    const p = asSoldPayload(distill([sale({ price: 30 })], raw, "thecardapi").quote?.payload);
    expect(p?.excluded).toBeUndefined();
    expect(p?.unconfirmed).toBeUndefined();
  });
});

describe("asSoldPayload", () => {
  // A guide value is one figure a vendor asserts with nothing behind it to show.
  // Rendering a chip for it would fabricate evidence.
  it("returns null for anything that isn't a sold payload", () => {
    expect(asSoldPayload(null)).toBeNull();
    expect(asSoldPayload(undefined)).toBeNull();
    expect(asSoldPayload("nope")).toBeNull();
    expect(asSoldPayload({ name: "Charizard", field: "loose-price" })).toBeNull();
    expect(asSoldPayload({ count: 3 })).toBeNull();          // no sample
    expect(asSoldPayload({ sample: [] })).toBeNull();        // no count
  });

  // Rows written before the window existed must still render, just without it.
  it("tolerates a payload stored before `from`/`to` were added", () => {
    const p = asSoldPayload({ count: 2, sample: [], platforms: ["eBay"] });
    expect(p).toMatchObject({ count: 2, from: null, to: null });
  });
});

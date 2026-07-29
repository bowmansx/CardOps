import { describe, it, expect } from "vitest";
import { saleQuery, toObserved, cardApiSaleKey, type CardApiSale } from "@/lib/cards/price-sources/thecardapi";
import { thecardapi } from "@/lib/cards/price-sources/thecardapi";
import type { CardForPricing } from "@/lib/cards/price-sources/types";

const graded = (grader: string, grade: number): CardForPricing => ({
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader, grade, condition_type: "graded",
});
const raw: CardForPricing = { ...graded("", 0), grader: null, grade: null, condition_type: "raw" };

const sale = (o: Partial<CardApiSale> = {}): CardApiSale => ({ price: 50, currency: "USD", platform: "eBay", sold_at: "2026-05-14", ...o });

describe("saleQuery", () => {
  it("joins identifying fields into a search string", () => {
    expect(saleQuery(graded("PSA", 10))).toBe("2021 Bowman Chrome Kyle Harrison BCP-42");
  });
  it("skips null fields", () => {
    expect(saleQuery({ ...raw, year: null, card_number: null })).toBe("Bowman Chrome Kyle Harrison");
  });
});

describe("cardApiSaleKey", () => {
  it("uses the vendor's sale id when present", () => {
    expect(cardApiSaleKey(sale({ id: "137222685761" }))).toBe("137222685761");
  });
  it("falls back to a stable hash when there's no id", () => {
    expect(cardApiSaleKey(sale({ price: 2.5, sold_at: "2026-05-01", title: "Roiling Dragonstorm" })))
      .toBe("2026-05-01:2.5:Roiling Dragonstorm");
  });
});

describe("toObserved — this vendor's wire row into CardOps' shape", () => {
  it("maps the fields we depend on", () => {
    const o = toObserved(sale({ id: "x", price: "47.50", grader: "PSA", grade: "10", listing_url: "https://e/1", title: "T" }));
    expect(o).toMatchObject({
      externalId: "x", price: 47.5, currency: "USD", soldAt: "2026-05-14",
      platform: "eBay", title: "T", url: "https://e/1", grader: "PSA", grade: 10, confirmed: true,
    });
  });

  it("drops a row with no usable price", () => {
    expect(toObserved(sale({ price: 0 }))).toBeNull();
    expect(toObserved(sale({ price: "abc" }))).toBeNull();
  });

  // The whole reason the basis lives on the adapter: this vendor documents eBay
  // as all-in and Goldin as hammer, and another vendor may not agree.
  it("stamps the basis this vendor documents for each platform", () => {
    expect(toObserved(sale({ platform: "eBay" }))?.priceBasis).toBe("all_in");
    expect(toObserved(sale({ platform: "TCGplayer" }))?.priceBasis).toBe("all_in");
    expect(toObserved(sale({ platform: "Goldin" }))?.priceBasis).toBe("hammer");
  });

  // Auction houses whose basis the vendor never states, plus anything added
  // upstream tomorrow — excluded rather than assumed.
  it("marks an undocumented or novel platform unknown", () => {
    for (const p of ["Lelands", "SCP Auctions", "Hakes", "REA", "SomeNewHouse"]) {
      expect(toObserved(sale({ platform: p }))?.priceBasis).toBe("unknown");
    }
    expect(toObserved(sale({ platform: null }))?.priceBasis).toBe("unknown");
  });

  it("is case- and whitespace-insensitive about platform names", () => {
    expect(toObserved(sale({ platform: "  GOLDIN " }))?.priceBasis).toBe("hammer");
  });

  // Only an explicit false is provisional; older payloads omit the field.
  it("treats a missing price_confirmed as confirmed", () => {
    expect(toObserved(sale())?.confirmed).toBe(true);
    expect(toObserved(sale({ price_confirmed: false }))?.confirmed).toBe(false);
  });

  // This vendor populates `grader` on ~12% of rows, so a row cannot answer
  // graded-vs-raw. Only the query we made can, and that is stamped by the fetch.
  it("leaves isGraded null unless the caller states it", () => {
    expect(toObserved(sale({ grader: "PSA" }))?.isGraded).toBeNull();
    expect(toObserved(sale(), true)?.isGraded).toBe(true);
    expect(toObserved(sale(), false)?.isGraded).toBe(false);
  });
});

describe("the adapter declares its licence", () => {
  // §4a permits storing "to serve your users" and displaying transaction
  // history in your own product interface; §5 requires deletion within 30 days
  // of cancellation, which is only executable because rows carry their source.
  it("permits storage and re-display, and not pooling", () => {
    expect(thecardapi.rights).toMatchObject({ persist: true, redisplay: true, pool: false, deleteOnTerminationDays: 30 });
  });

  it("supplies sales, so the accumulator picks it up without naming it", () => {
    expect(typeof thecardapi.fetchSales).toBe("function");
    expect(typeof thecardapi.salesBasis).toBe("function");
  });
});

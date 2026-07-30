import { describe, it, expect } from "vitest";
import { MANUAL_SOURCES, manualSource, isManualSource } from "@/lib/cards/price-sources/manual";
import { mayPersist, sourceRights, basisForSource, ADAPTERS, salesAdapters } from "@/lib/cards/price-sources";
import { salesToRows } from "@/lib/cards/market-sales";
import { parsePastedSales } from "@/lib/cards/paste-sales";
import type { CardForPricing } from "@/lib/cards/price-sources/types";

const card: CardForPricing = {
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader: "PSA", grade: 10, condition_type: "graded",
};

describe("manual sources are recognised by the same gate as vendors", () => {
  // `mayPersist` default-denies an unknown source id — correct, and it would
  // otherwise silently refuse every paste while looking like "no sales found".
  it("permits storing every paste source", () => {
    for (const s of Object.values(MANUAL_SOURCES)) {
      expect(mayPersist(s.id), s.id).toBe(true);
      expect(sourceRights(s.id)?.redisplay, s.id).toBe(true);
    }
  });

  // Whether a user-supplied export may feed a cross-tenant aggregate is the open
  // eBay-licence question. It needs counsel, not a default.
  it("does NOT permit pooling any of them", () => {
    for (const s of Object.values(MANUAL_SOURCES)) {
      expect(sourceRights(s.id)?.pool, s.id).toBe(false);
    }
  });

  it("still default-denies something nobody registered", () => {
    expect(mayPersist("paste-whatever")).toBe(false);
    expect(isManualSource("paste-whatever")).toBe(false);
  });
});

describe("manual sources are NOT adapters, deliberately", () => {
  // The adapter contract requires `fetch`, and a paste has nothing to call. A
  // stub returning no quotes would sit in the refresh loop forever and show up
  // in the card page's availability list nudging "tap Refresh to pull values".
  it("stays out of the adapter registry", () => {
    const ids = ADAPTERS.map((a) => a.id);
    for (const s of Object.values(MANUAL_SOURCES)) expect(ids).not.toContain(s.id);
  });

  it("stays out of the sales-fetch loop", () => {
    const ids = salesAdapters(card).map((a) => a.id);
    for (const s of Object.values(MANUAL_SOURCES)) expect(ids).not.toContain(s.id);
  });
});

describe("basisForSource falls back to a paste source's usual meaning", () => {
  // An auction house quotes the hammer. Reading those as all-in would understate
  // every one of them by roughly the buyer's premium.
  it("treats an auction paste as hammer and an eBay paste as all-in", () => {
    expect(basisForSource("paste-auction", "REA")).toBe("hammer");
    expect(basisForSource("paste-ebay", "eBay")).toBe("all_in");
  });

  it("still returns unknown for a source nobody declared", () => {
    expect(basisForSource("paste-whatever", "eBay")).toBe("unknown");
  });

  it("declares a default basis for every registered source", () => {
    for (const s of Object.values(MANUAL_SOURCES)) {
      expect(["all_in", "hammer", "unknown"]).toContain(s.defaultBasis);
      expect(s.hint.length).toBeGreaterThan(10); // a source with no guidance is a trap
    }
  });
});

describe("a paste reaches storage end to end", () => {
  const paste = [
    "Title\tSold Price\tSold Date",
    "2021 Bowman Chrome Kyle Harrison Auto PSA 10\t$1,250.00\t2026-05-14",
    "2021 Bowman Chrome Kyle Harrison Auto PSA 10\t$1,180.00\t2026-05-02",
  ].join("\n");

  it("parses, passes the licence gate, and produces storable rows", () => {
    const src = manualSource("paste-terapeak")!;
    const parsed = parsePastedSales(paste, {
      source: src.id, defaultPlatform: src.defaultPlatform, priceBasis: src.defaultBasis,
    });
    expect(parsed.sales).toHaveLength(2);

    const batch = salesToRows("identity-1", "card-1", parsed.sales, src.id);
    expect(batch.refusedSource).toBeNull();
    expect(batch.rows).toHaveLength(2);
    expect(batch.rows[0]).toMatchObject({
      identity_id: "identity-1", card_id: "card-1", source: "paste-terapeak", price: 1250, platform: "eBay",
    });
  });

  // The dedup key is derived from date+price+title, so re-pasting the same table
  // is a no-op at the database level rather than a double-count.
  it("produces stable ids so a re-paste cannot double-count", () => {
    const src = manualSource("paste-terapeak")!;
    const opts = { source: src.id, defaultPlatform: src.defaultPlatform, priceBasis: src.defaultBasis };
    const a = parsePastedSales(paste, opts).sales.map((s) => s.externalId);
    const b = parsePastedSales(paste, opts).sales.map((s) => s.externalId);
    expect(a).toEqual(b);
  });

  // An auction paste carries hammer prices all the way to the row, so the
  // normalization downstream adds the premium instead of under-reading them.
  it("carries the declared basis through to the parsed sales", () => {
    const src = manualSource("paste-auction")!;
    const parsed = parsePastedSales(
      "Lot | Realized | Sale Date\n1952 Topps Mantle PSA 8 | $2,880,000 | 14 May 2026",
      { source: src.id, defaultPlatform: src.defaultPlatform, priceBasis: src.defaultBasis },
    );
    expect(parsed.sales[0].priceBasis).toBe("hammer");
  });
});

import { describe, it, expect } from "vitest";
import {
  parsePastedSales, detectDelimiter, mapHeader, parseMoney, parseDate,
  detectDateOrder, graderFromTitle,
} from "@/lib/cards/paste-sales";

const opts = { source: "terapeak", priceBasis: "all_in" as const, defaultPlatform: "eBay" };

describe("detectDelimiter", () => {
  // Card titles are full of commas, so a raw comma count wins and shreds the
  // title. Consistency of column count is the real signal.
  it("prefers tabs over commas even when commas are more numerous", () => {
    const lines = [
      "Title\tPrice\tDate",
      "2021 Topps Chrome, Refractor, /99\t100.00\t2026-05-01",
      "2020 Prizm, Silver, RC\t200.00\t2026-05-02",
    ];
    expect(detectDelimiter(lines)).toBe("\t");
  });

  it("finds commas in a genuine CSV", () => {
    expect(detectDelimiter(["Title,Price,Date", "Card A,100,2026-05-01"])).toBe(",");
  });

  it("falls back to runs of spaces, as a copied HTML table lands", () => {
    expect(detectDelimiter(["Title   Price   Date", "Card A   100   2026-05-01"])).toBe("  +");
  });
});

describe("mapHeader", () => {
  it("maps the obvious names", () => {
    expect(mapHeader(["Title", "Price", "Date"])).toEqual({ title: 0, price: 1, date: 2 });
  });

  // "Sold price" contains "sold", which a looser rule would hand to `date`.
  it("does not let a price column be read as a date", () => {
    const m = mapHeader(["Item", "Sold Price", "Sold Date"]);
    expect(m.price).toBe(1);
    expect(m.date).toBe(2);
  });

  it("understands auction-house wording", () => {
    const m = mapHeader(["Lot", "Realized", "Sale Date", "Auction House"]);
    expect(m).toMatchObject({ title: 0, price: 1, date: 2, platform: 3 });
  });

  // Without a header the columns are unknown, and reading them positionally
  // would put a price in a date field on some other site's layout.
  it("rejects a row that isn't a header", () => {
    expect(mapHeader(["2021 Topps Chrome", "100.00", "2026-05-01"])).toEqual({});
  });

  it("needs more than just a price to be a header", () => {
    expect(mapHeader(["Price", "Bids", "Shipping"])).toEqual({});
  });
});

describe("parseMoney", () => {
  it("strips currency symbols and thousands separators", () => {
    expect(parseMoney("$1,234.56")).toBe(1234.56);
    expect(parseMoney("USD 47.50")).toBe(47.5);
    expect(parseMoney("  99 ")).toBe(99);
  });

  // A price is the one field that must never be defaulted (rule 9).
  it("returns null rather than 0 for junk", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("—")).toBeNull();
    expect(parseMoney("free")).toBeNull();
    expect(parseMoney("0.00")).toBeNull();
  });

  // "1.234,56" and "1,234.56" differ by a factor of a thousand. There is no safe
  // assumption, so it refuses.
  it("refuses a European decimal comma instead of guessing", () => {
    expect(parseMoney("1.234,56")).toBeNull();
  });
});

describe("detectDateOrder — one unambiguous row fixes the whole paste", () => {
  it("is certain when a day above 12 appears anywhere", () => {
    expect(detectDateOrder(["03/04/2026", "17/05/2026"])).toBe("dmy");
  });

  it("is certain the other way when a second part exceeds 12", () => {
    expect(detectDateOrder(["03/04/2026", "05/17/2026"])).toBe("mdy");
  });

  it("recognises ISO", () => {
    expect(detectDateOrder(["2026-05-14"])).toBe("iso");
  });

  // THE TRAP. Guessing here moves a sale into the wrong week and silently
  // corrupts a weekly rollup.
  it("admits ambiguity when every date could be read either way", () => {
    expect(detectDateOrder(["03/04/2026", "05/06/2026"])).toBe("ambiguous");
  });

  it("reports unknown on contradictory evidence", () => {
    expect(detectDateOrder(["17/05/2026", "05/17/2026"])).toBe("unknown");
  });
});

describe("parseDate", () => {
  it("reads ISO regardless of the detected order", () => {
    expect(parseDate("2026-05-14", "iso")).toBe("2026-05-14");
    expect(parseDate("2026-5-4", "mdy")).toBe("2026-05-04");
  });

  it("applies the detected order", () => {
    expect(parseDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(parseDate("03/04/2026", "dmy")).toBe("2026-04-03");
  });

  it("reads named months in both layouts", () => {
    expect(parseDate("May 14, 2026", "unknown")).toBe("2026-05-14");
    expect(parseDate("14 May 2026", "unknown")).toBe("2026-05-14");
  });

  it("expands two-digit years", () => {
    expect(parseDate("05/14/26", "mdy")).toBe("2026-05-14");
  });

  // No guessing under ambiguity — the row gets rejected with a reason instead.
  it("returns null when the order was never established", () => {
    expect(parseDate("03/04/2026", "ambiguous")).toBeNull();
    expect(parseDate("03/04/2026", "unknown")).toBeNull();
  });

  it("rejects impossible dates", () => {
    expect(parseDate("13/45/2026", "mdy")).toBeNull();
  });
});

describe("graderFromTitle", () => {
  it("finds a slab in the listing title", () => {
    expect(graderFromTitle("2021 Bowman Chrome Kyle Harrison Auto PSA 10")).toEqual({ grader: "PSA", grade: 10 });
    expect(graderFromTitle("2011 Topps Update Trout RC BGS 9.5")).toEqual({ grader: "BGS", grade: 9.5 });
  });

  it("finds nothing in a raw-card title", () => {
    expect(graderFromTitle("2021 Topps Chrome Refractor")).toEqual({ grader: null, grade: null });
  });
});

describe("parsePastedSales", () => {
  const paste = [
    "Title\tSold Price\tSold Date\tPlatform",
    "2021 Bowman Chrome Kyle Harrison Auto PSA 10\t$1,250.00\t2026-05-14\teBay",
    "2021 Bowman Chrome Kyle Harrison Auto PSA 10\t$1,180.00\t2026-05-02\teBay",
  ].join("\n");

  it("parses a clean paste into normalized sales", () => {
    const r = parsePastedSales(paste, opts);
    expect(r.sales).toHaveLength(2);
    expect(r.rejected).toEqual([]);
    expect(r.sales[0]).toMatchObject({
      price: 1250, soldAt: "2026-05-14", platform: "eBay",
      grader: "PSA", grade: 10, isGraded: true, priceBasis: "all_in", confirmed: true,
    });
  });

  it("reports the column mapping so the user can check it", () => {
    expect(parsePastedSales(paste, opts).columns).toMatchObject({
      title: "Title", price: "Sold Price", date: "Sold Date", platform: "Platform",
    });
  });

  // The caller must STATE what the prices include. Defaulting it would
  // reintroduce the ~22% hammer error the basis work removed.
  it("stamps the basis the caller declared, not a guess", () => {
    const r = parsePastedSales(paste, { ...opts, priceBasis: "hammer" });
    expect(r.sales.every((s) => s.priceBasis === "hammer")).toBe(true);
  });

  it("falls back to the default platform when there is no column", () => {
    const p = "Title\tPrice\tDate\nCard A\t100\t2026-05-01";
    expect(parsePastedSales(p, opts).sales[0].platform).toBe("eBay");
  });
});

describe("parsePastedSales — nothing is dropped silently", () => {
  // A parser that quietly keeps 2 of 4 rows reads as "your paste had 2 sales".
  it("rejects unreadable rows WITH a line number and a reason", () => {
    const p = [
      "Title\tPrice\tDate",
      "Card A\t100\t2026-05-01",
      "Card B\t—\t2026-05-02",
      "Card C\t200\tnot a date",
    ].join("\n");
    const r = parsePastedSales(p, opts);
    expect(r.sales).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0]).toMatchObject({ line: 3 });
    expect(r.rejected[0].reason).toContain("price");
    expect(r.rejected[1]).toMatchObject({ line: 4 });
  });

  // Line numbers must match what the user sees, blank lines included.
  it("keeps original line numbers across blank lines", () => {
    const p = ["Title\tPrice\tDate", "", "Card A\t100\t2026-05-01", "", "Card B\tbad\t2026-05-02"].join("\n");
    expect(parsePastedSales(p, opts).rejected[0].line).toBe(5);
  });

  it("rejects an ambiguous-date paste with an actionable reason", () => {
    const p = ["Title\tPrice\tDate", "Card A\t100\t03/04/2026", "Card B\t200\t05/06/2026"].join("\n");
    const r = parsePastedSales(p, opts);
    expect(r.dateOrder).toBe("ambiguous");
    expect(r.sales).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("day/month or month/day");
  });

  // One unambiguous row rescues the whole paste.
  it("parses the same paste once any row disambiguates it", () => {
    const p = ["Title\tPrice\tDate", "Card A\t100\t03/04/2026", "Card B\t200\t05/17/2026"].join("\n");
    const r = parsePastedSales(p, opts);
    expect(r.dateOrder).toBe("mdy");
    expect(r.sales.map((s) => s.soldAt)).toEqual(["2026-03-04", "2026-05-17"]);
  });

  it("drops in-paste duplicates and says it did", () => {
    const p = [
      "Title\tPrice\tDate",
      "Card A\t100\t2026-05-01",
      "Card A\t100\t2026-05-01",
    ].join("\n");
    const r = parsePastedSales(p, opts);
    expect(r.sales).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("duplicate");
  });

  // Positional reading would put a price in a date field on another site's
  // layout, so a headerless paste is refused with instructions.
  it("refuses a paste with no header rather than guessing columns", () => {
    const r = parsePastedSales("2021 Topps Chrome\t100\t2026-05-01", opts);
    expect(r.sales).toEqual([]);
    expect(r.note).toContain("header");
  });

  it("handles an empty paste without throwing", () => {
    expect(parsePastedSales("   \n  \n", opts).note).toBe("nothing pasted");
  });
});

describe("parsePastedSales — an auction-house prices-realized table", () => {
  // The complementary corpus: hammer prices, house as platform, grade in the
  // lot title. Different shape, same output type.
  it("reads it and marks the prices as hammer", () => {
    const p = [
      "Lot | Realized | Sale Date | Auction House",
      "1952 Topps Mickey Mantle #311 PSA 8 | $2,880,000 | 14 May 2026 | REA",
      "1909 T206 Wagner SGC 3 | $1,200,000 | 14 May 2026 | REA",
    ].join("\n");
    const r = parsePastedSales(p, { source: "rea-paste", priceBasis: "hammer" });
    expect(r.rejected).toEqual([]);
    expect(r.sales[0]).toMatchObject({
      price: 2_880_000, soldAt: "2026-05-14", platform: "REA",
      grader: "PSA", grade: 8, priceBasis: "hammer",
    });
    expect(r.sales[1]).toMatchObject({ grader: "SGC", grade: 3 });
  });
});

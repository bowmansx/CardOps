import { describe, it, expect } from "vitest";
import {
  parseFile, detectDelimiter, normalizeHeader, proposeMapping, toMapping, mappingProblem,
  applyMapping, parseMoney, parseYear, parseGrade, looksLikeRowIndex, isIdentityless,
  moneyNumber, basisStated, importCondition, MONEY_CEILING, detectMoneyStyle,
  type Mapping,
} from "@/lib/cards/import-map";

const csv = (...lines: string[]) => lines.join("\n");

describe("the regression guard — files that import today must map the same", () => {
  // Every column name the old importer recognised. If any of these stops
  // mapping EXACTLY, an existing CardOps export silently imports differently.
  it("maps every canonical column exactly", () => {
    const headers = [
      "player", "year", "set_name", "card_number", "parallel", "sport_category", "condition_type",
      "grader", "grade", "market_value", "status", "zone", "location_code", "individual_basis",
    ];
    const p = proposeMapping(headers);
    for (const h of headers) {
      expect(p.map[h as keyof typeof p.map]).toMatchObject({ header: h, how: "exact" });
    }
    expect(p.unmapped).toEqual([]);
    expect(p.ambiguous).toEqual([]);
  });
});

describe("another app's column names", () => {
  it("recognises common inventory vocabulary", () => {
    const p = proposeMapping(["Player Name", "Year", "Set", "Card #", "Grading Company", "Grade", "Purchase Price", "Market Value"]);
    expect(p.map.player?.header).toBe("Player Name");
    expect(p.map.set_name?.header).toBe("Set");
    expect(p.map.card_number?.header).toBe("Card #");
    expect(p.map.grader?.header).toBe("Grading Company");
    expect(p.map.individual_basis?.header).toBe("Purchase Price");
    expect(p.map.market_value?.header).toBe("Market Value");
    expect(p.map.player?.how).toBe("likely");
  });

  // THE TRAP containment matching falls into: "Set Name" contains "name".
  it("never makes 'Set Name' the player", () => {
    const p = proposeMapping(["Set Name", "Player"]);
    expect(p.map.set_name?.header).toBe("Set Name");
    expect(p.map.player?.header).toBe("Player");
  });

  it("does not map words that only look relevant", () => {
    const p = proposeMapping(["Brand", "Type", "Notes"]);
    expect(Object.keys(p.map)).toEqual([]);
    expect(p.unmapped.map((u) => u.header)).toEqual(["Brand", "Type", "Notes"]);
  });

  // A second column for the same field is shown, not swallowed.
  it("reports a duplicate column instead of dropping it", () => {
    const p = proposeMapping(["Name", "Player Name"]);
    expect(p.map.player?.header).toBe("Name");
    expect(p.unmapped).toEqual([{ col: 1, header: "Player Name", note: "also looked like Player / name" }]);
  });

  it("lets an exact column win over an earlier likely one", () => {
    const p = proposeMapping(["Name", "player"]);
    expect(p.map.player).toMatchObject({ header: "player", how: "exact" });
    expect(p.unmapped[0]).toMatchObject({ header: "Name" });
  });
});

describe("ambiguity is shown, never resolved by guess", () => {
  // The same word is the cost in one file and a sale price in another; either
  // guess puts wrong money on every card.
  it("refuses to map a bare Price", () => {
    const p = proposeMapping(["Player", "Price"]);
    expect(p.map.individual_basis).toBeUndefined();
    expect(p.map.market_value).toBeUndefined();
    expect(p.ambiguous[0]).toMatchObject({ header: "Price" });
    expect(p.ambiguous[0].why).toContain("Pick which one");
  });

  it("refuses to treat a condition column as raw/graded", () => {
    expect(proposeMapping(["Condition"]).ambiguous[0].header).toBe("Condition");
  });

  it("points a sale price at the sell flow", () => {
    expect(proposeMapping(["Sold Price"]).ambiguous[0].why).toContain("sell flow");
  });

  // "#" heads a row counter as often as a card number.
  it("does not take a 1, 2, 3 counter as the card number", () => {
    const p = proposeMapping(["#", "Player"], [["1", "A"], ["2", "B"], ["3", "C"]]);
    expect(p.map.card_number).toBeUndefined();
    expect(p.ambiguous[0].why).toContain("row number");
  });

  it("does take a real card-number column headed #", () => {
    const p = proposeMapping(["#", "Player"], [["150", "A"], ["BCP-42", "B"], ["7", "C"]]);
    expect(p.map.card_number?.header).toBe("#");
  });
});

describe("parseFile", () => {
  // Excel prepends a byte-order mark; it used to glue itself to the first header
  // and lose that whole column.
  it("strips the byte-order mark", () => {
    const f = parseFile("﻿player,year\nKyle Harrison,2021");
    expect(f.headers).toEqual(["player", "year"]);
    expect(proposeMapping(f.headers).map.player?.how).toBe("exact");
  });

  it("keeps a quoted comma inside one field", () => {
    const f = parseFile(csv('player,set', '"Smith, J.","Topps Chrome, Refractor"'));
    expect(f.rows[0]).toEqual(["Smith, J.", "Topps Chrome, Refractor"]);
  });

  it("reads tab- and semicolon-separated files", () => {
    expect(parseFile(csv("player\tyear", "A\t2021")).rows[0]).toEqual(["A", "2021"]);
    expect(parseFile(csv("player;year", "A;2021")).rows[0]).toEqual(["A", "2021"]);
  });

  it("chooses the delimiter that is consistent, not the most frequent", () => {
    // Commas inside quoted titles would win a raw count.
    const text = csv('player;set;year', '"Smith, J.";"Topps, Chrome, Refractor";2021', '"Lee, K.";"Prizm, Silver";2022');
    expect(detectDelimiter(text)).toBe(";");
  });

  it("drops blank lines and pads short rows", () => {
    const f = parseFile(csv("player,year,set", "A,2021", "", ",,", "B,2022,Prizm"));
    expect(f.rows).toEqual([["A", "2021", ""], ["B", "2022", "Prizm"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseFile("player,year\r\nA,2021\r\n").rows).toEqual([["A", "2021"]]);
  });
});

describe("values", () => {
  it("normalises a header", () => {
    expect(normalizeHeader("Card #")).toBe("card #");
    expect(normalizeHeader("Card#")).toBe("card #");
    expect(normalizeHeader("  Player_Name ")).toBe("player name");
    expect(normalizeHeader("Set/Series")).toBe("set series");
  });

  // NULL IS NOT ZERO. A real $12.50 used to land as a cost of 0.
  it("reads money, and keeps a stated zero distinct from unreadable", () => {
    expect(parseMoney("$1,234.50")).toBe("1234.50");
    expect(parseMoney("USD 12")).toBe("12");
    expect(parseMoney("12.00 USD")).toBe("12.00");
    expect(parseMoney("0")).toBe("0");
    expect(parseMoney("$0.00")).toBe("0.00");
    expect(parseMoney("")).toBe("");
    expect(parseMoney("n/a")).toBeNull();
    expect(parseMoney("-12")).toBeNull();
  });

  it("reads the print year out of a season", () => {
    expect(parseYear("2021-22")).toBe("2021");
    expect(parseYear("1952")).toBe("1952");
    expect(parseYear("")).toBe("");
    expect(parseYear("unknown")).toBeNull();
    expect(parseYear("12345")).toBeNull();
  });

  it("splits a grader out of a grade cell", () => {
    expect(parseGrade("PSA 10")).toEqual({ grade: "10", grader: "PSA" });
    expect(parseGrade("bgs 9.5")).toEqual({ grade: "9.5", grader: "BGS" });
    expect(parseGrade("10")).toEqual({ grade: "10", grader: null });
    expect(parseGrade("Gem Mint")).toEqual({ grade: null, grader: null });
    // A year in the wrong column must not read as grade 21.
    expect(parseGrade("2021").grade).toBeNull();
  });

  it("recognises a row counter", () => {
    expect(looksLikeRowIndex(["1", "2", "3"])).toBe(true);
    expect(looksLikeRowIndex(["0", "1", "2", "3"])).toBe(true);
    expect(looksLikeRowIndex(["1", "2", "4"])).toBe(false);
    expect(looksLikeRowIndex(["150", "151", "152"])).toBe(false);
    expect(looksLikeRowIndex(["1", "2"])).toBe(false);
  });
});

describe("applyMapping", () => {
  const only = (pairs: Partial<Mapping>): Mapping => ({
    player: null, year: null, set_name: null, card_number: null, parallel: null,
    sport_category: null, condition_type: null, grader: null, grade: null,
    market_value: null, individual_basis: null, status: null, zone: null, location_code: null,
    ...pairs,
  });

  it("restructures a foreign file into CardOps rows", () => {
    const f = parseFile(csv(
      "Player Name,Season,Set,Card #,Grade,Paid,Sport",
      'Kyle Harrison,2021-22,Bowman Chrome,BCP-42,PSA 10,"$1,250.00",MLB',
    ));
    const { cards, issues } = applyMapping(f.rows, toMapping(proposeMapping(f.headers, f.rows)));
    expect(cards[0]).toEqual({
      player: "Kyle Harrison", year: "2021", set_name: "Bowman Chrome", card_number: "BCP-42",
      grade: "10", grader: "PSA", individual_basis: "1250.00", sport_category: "Baseball",
    });
    expect(issues).toEqual([]);
  });

  it("counts unreadable values per field instead of guessing", () => {
    const { cards, issues } = applyMapping(
      [["A", "n/a", "Gem"], ["B", "$5", "abc"], ["C", "free", "9"]],
      only({ player: 0, individual_basis: 1, grade: 2 }),
    );
    expect(cards.map((c) => c.individual_basis)).toEqual(["", "5", ""]);
    expect(issues).toContainEqual({ field: "individual_basis", count: 2, examples: ["n/a", "free"] });
    expect(issues).toContainEqual({ field: "grade", count: 2, examples: ["Gem", "abc"] });
  });

  // "NM" passed through would fail the raw/graded CHECK and reject the WHOLE batch.
  it("normalises raw/graded and blanks anything else", () => {
    const { cards, issues } = applyMapping([["A", "Yes"], ["B", "raw"], ["C", "NM"]], only({ player: 0, condition_type: 1 }));
    expect(cards.map((c) => c.condition_type)).toEqual(["graded", "raw", ""]);
    expect(issues[0]).toMatchObject({ field: "condition_type", count: 1 });
  });

  it("keeps a separate grader column over one parsed out of the grade", () => {
    const { cards } = applyMapping([["A", "SGC", "PSA 9"]], only({ player: 0, grader: 1, grade: 2 }));
    expect(cards[0]).toMatchObject({ grader: "SGC", grade: "9" });
  });

  it("maps category spellings and keeps unknown ones as written", () => {
    const { cards } = applyMapping([["A", "nfl"], ["B", "Pokémon"], ["C", "Garbage Pail Kids"]], only({ player: 0, sport_category: 1 }));
    expect(cards.map((c) => c.sport_category)).toEqual(["Football", "Pokemon", "Garbage Pail Kids"]);
  });

  it("counts rows that would be blank cards", () => {
    const { identityless } = applyMapping([["A", "x"], ["", "y"], ["", ""]], only({ player: 0, zone: 1 }));
    expect(identityless).toBe(2);
  });
});

describe("whether anything can be imported", () => {
  // The file that used to "succeed" and create one blank card per row.
  it("blocks a mapping with no identity column", () => {
    const m = toMapping(proposeMapping(["Item", "Qty", "Notes"]));
    expect(mappingProblem(m)).toContain("blank card");
  });

  it("allows any single identity column", () => {
    expect(mappingProblem(toMapping(proposeMapping(["Year"])))).toBeNull();
  });

  it("recognises an identity-less canonical row", () => {
    expect(isIdentityless({ zone: "GR" })).toBe(true);
    expect(isIdentityless({ card_number: "7" })).toBe(false);
    expect(isIdentityless({ player: "  " })).toBe(true);
  });
});

// ── What importCards does with a row, server side ─────────────────────────
// The client can be bypassed, so the server applies these itself.
describe("server-side coercion", () => {
  it("reads money as a number, null meaning NOT STATED", () => {
    expect(moneyNumber("$12.50")).toBe(12.5);
    expect(moneyNumber("1,000")).toBe(1000);
    expect(moneyNumber("0")).toBe(0);
    expect(moneyNumber("")).toBeNull();
    expect(moneyNumber(undefined)).toBeNull();
    expect(moneyNumber("abc")).toBeNull();
    expect(moneyNumber(String(MONEY_CEILING + 1))).toBeNull();
  });

  // THE BUG: "$12.50" used to fail Number(), become 0 and be marked un-entered,
  // so a real cost the user typed was lost.
  it("treats a currency-formatted cost as stated", () => {
    expect(basisStated("$12.50")).toBe(true);
    expect(moneyNumber("$12.50")).toBe(12.5);
  });

  // A stated zero is a fact; a blank is an absence. basis_entered turns on it.
  it("keeps a stated zero distinct from a blank", () => {
    expect(basisStated("0")).toBe(true);
    expect(basisStated("$0.00")).toBe(true);
    expect(basisStated("")).toBe(false);
    expect(basisStated("unknown")).toBe(false);
  });

  // An out-of-range figure must not become "stated as 0" — that would present
  // a zero the user never wrote as their cost.
  it("does not claim a stated cost for an absurd figure", () => {
    expect(basisStated("99999999")).toBe(false);
  });

  // THE OTHER BUG: grader PSA + grade 10 with no condition column became a RAW
  // card, and pricing keyed on condition_type valued it off ungraded comps.
  it("infers graded from a grader when the row didn't say", () => {
    expect(importCondition({ grader: "PSA", grade: "10" })).toBe("graded");
    expect(importCondition({ grade: "10" })).toBe("raw");
    expect(importCondition({})).toBe("raw");
  });

  it("respects a stated condition over the inference", () => {
    expect(importCondition({ condition_type: "raw", grader: "PSA" })).toBe("raw");
    expect(importCondition({ condition_type: "Graded" })).toBe("graded");
  });

  // Passed through, "NM" would fail the raw/graded CHECK and reject the batch.
  it("falls back to inference for an unrecognised condition value", () => {
    expect(importCondition({ condition_type: "NM" })).toBe("raw");
    expect(importCondition({ condition_type: "NM", grader: "BGS" })).toBe("graded");
  });
});

// ── Found by the adversarial pass on this branch ──────────────────────────
describe("decimal commas — the hundredfold money error", () => {
  // The first version stripped every comma, so a European "12,50" became
  // TWELVE HUNDRED AND FIFTY with nothing flagged.
  it("reads a European decimal comma as a decimal", () => {
    expect(parseMoney("12,50")).toBe("12.50");
    expect(parseMoney("1.234,50")).toBe("1234.50");
    expect(moneyNumber("12,50")).toBe(12.5);
  });

  it("still reads US thousands separators", () => {
    expect(parseMoney("1,000")).toBe("1000");
    expect(parseMoney("12,500.00")).toBe("12500.00");
  });

  // One decimal-comma cell settles the column's convention.
  it("detects a column's convention from its own values", () => {
    expect(detectMoneyStyle(["$1,234.50", "12"])).toBe("us");
    expect(detectMoneyStyle(["12,50", "3"])).toBe("eu");
    expect(detectMoneyStyle(["1.234,00"])).toBe("eu");
  });

  // "1.234" means one thousand two hundred and thirty-four in a European file;
  // read per cell it would have been $1.23.
  it("reads 1.234 the European way inside a European column", () => {
    const { cards } = applyMapping(
      [["A", "1.234"], ["B", "5,00"]],
      { player: 0, individual_basis: 1, year: null, set_name: null, card_number: null, parallel: null,
        sport_category: null, condition_type: null, grader: null, grade: null, market_value: null,
        status: null, zone: null, location_code: null },
    );
    expect(cards.map((c) => c.individual_basis)).toEqual(["1234", "5.00"]);
  });

  it("flags a US-formatted value inside a European column rather than misreading it", () => {
    expect(parseMoney("1,234.50", "eu")).toBeNull();
  });

  // CardOps keeps money in USD; a bare number can't say which currency it was,
  // but a symbol can, and it must not be imported as dollars.
  it("refuses other currencies instead of importing them as dollars", () => {
    expect(parseMoney("€12")).toBeNull();
    expect(parseMoney("£5.00")).toBeNull();
    expect(parseMoney("12 EUR")).toBeNull();
  });
});

describe("grades with a decimal", () => {
  it("reads 9.8 and 10.0, not just halves", () => {
    expect(parseGrade("CGC 9.8")).toEqual({ grade: "9.8", grader: "CGC" });
    expect(parseGrade("10.0")).toEqual({ grade: "10.0", grader: null });
    expect(parseGrade("2021").grade).toBeNull();
  });
});

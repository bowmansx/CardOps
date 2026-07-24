import { describe, it, expect } from "vitest";
import { computeField, buildCsv, type FormatProfile } from "../src/lib/cards/export";

const cardRow = {
  sku: "FB-2026-000001", player: "Josh Allen", year: 2020, set_name: "Prizm",
  card_number: "150", parallel: "Silver", manual_price: 250, market_value: 200,
  sport_category: "Football", condition_type: "graded", grader: "PSA", grade: 10,
};

describe("computeField", () => {
  it("literal (=), computed (_), and plain field", () => {
    expect(computeField(cardRow, "=Add")).toBe("Add");
    expect(computeField(cardRow, "player")).toBe("Josh Allen");
    expect(computeField(cardRow, "_price")).toBe("250"); // manual over market
    expect(computeField(cardRow, "_title")).toContain("2020 Josh Allen Prizm");
    expect(computeField(cardRow, "_condition")).toBe("PSA 10");
    expect(computeField(cardRow, "missing")).toBe("");
  });
});

describe("buildCsv", () => {
  const profile: FormatProfile = {
    name: "t", column_order: ["Action", "SKU", "Title", "Price"],
    field_map: { Action: "=Add", SKU: "sku", Title: "_title", Price: "_price" },
  };
  it("emits header + mapped rows in column order", () => {
    const csv = buildCsv([cardRow], profile);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("Action,SKU,Title,Price");
    expect(row.startsWith("Add,FB-2026-000001,")).toBe(true);
    expect(row.endsWith(",250")).toBe(true);
  });

  it("neutralizes CSV formula injection", () => {
    const evil = { ...cardRow, player: "=1+1", set_name: "@SUM(A1)" };
    const csv = buildCsv([evil], { name: "t", column_order: ["P", "S"], field_map: { P: "player", S: "set_name" } });
    const row = csv.split("\r\n")[1];
    // leading =/@ get an apostrophe so Excel/Sheets won't execute them
    expect(row.includes("'=1+1")).toBe(true);
    expect(row.includes("'@SUM(A1)")).toBe(true);
  });

  it("quotes and escapes values with commas/quotes", () => {
    const c = { ...cardRow, set_name: 'Topps "Chrome", 2021' };
    const csv = buildCsv([c], { name: "t", column_order: ["S"], field_map: { S: "set_name" } });
    expect(csv.split("\r\n")[1]).toBe('"Topps ""Chrome"", 2021"');
  });
});

import { describe, it, expect } from "vitest";
import { cardSaleLines, linesBalance, receiptEntries } from "../src/lib/books/journal";

const sum = (lines: { debit: number; credit: number }[], k: "debit" | "credit") =>
  Math.round(lines.reduce((a, l) => a + l[k], 0) * 100) / 100;

describe("cardSaleLines", () => {
  it("is balanced and reconciles to profit for a normal sale", () => {
    // price 100, fees 13, shipIn 5, shipCost 4, basis 40 → profit = 100-13+5-4-40 = 48
    const lines = cardSaleLines({ sale_price: 100, fees: 13, shipping_income: 5, shipping_cost: 4, basis_drawn: 40 });
    expect(linesBalance(lines)).toBe(true);
    // net income = revenue(105) - fees(13) - shipping(4) - cogs(40) = 48
    const rev = lines.filter((l) => l.account === "sales_revenue").reduce((a, l) => a + l.credit, 0);
    const exp = lines.filter((l) => ["platform_fees", "shipping_expense", "cogs"].includes(l.account)).reduce((a, l) => a + l.debit, 0);
    expect(Math.round((rev - exp) * 100) / 100).toBe(48);
  });

  it("balances a loss (net proceeds below fees → cash credit)", () => {
    // price 10, fees 13, shipIn 0, shipCost 4, basis 20 → net = 10-13-4 = -7 (paid to sell)
    const lines = cardSaleLines({ sale_price: 10, fees: 13, shipping_income: 0, shipping_cost: 4, basis_drawn: 20 });
    expect(linesBalance(lines)).toBe(true);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
    const cash = lines.find((l) => l.account === "cash");
    expect(cash?.credit).toBe(7); // money went out
  });

  it("balances with zero fees / shipping / basis", () => {
    const lines = cardSaleLines({ sale_price: 50, fees: 0, shipping_income: 0, shipping_cost: 0, basis_drawn: 0 });
    expect(linesBalance(lines)).toBe(true);
    expect(sum(lines, "debit")).toBe(50);
    expect(sum(lines, "credit")).toBe(50);
  });

  it("tolerates null/string inputs", () => {
    const lines = cardSaleLines({ sale_price: "75", fees: null, shipping_income: null, shipping_cost: null, basis_drawn: "30" });
    expect(linesBalance(lines)).toBe(true);
  });

  it("balances a NEGATIVE fee (a fee refund/credit)", () => {
    const lines = cardSaleLines({ sale_price: 100, fees: -5, shipping_income: 0, shipping_cost: 0, basis_drawn: 0 });
    expect(linesBalance(lines)).toBe(true);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  const S = { sale_price: 100, fees: 13, shipping_income: 5, shipping_cost: 4, basis_drawn: 40 };

  it("investment treatment books a capital gain, not sales revenue, and balances", () => {
    const lines = cardSaleLines(S, "investment");
    expect(linesBalance(lines)).toBe(true);
    expect(lines.some((l) => l.account === "sales_revenue")).toBe(false);
    expect(lines.some((l) => l.account === "cogs")).toBe(false);
    // gain = amount realized (100-13+5-4=88) - basis 40 = 48, booked as a credit
    const gl = lines.find((l) => l.account === "capital_gain_loss");
    expect(gl?.credit).toBe(48);
  });

  it("investment treatment flips to a capital LOSS (debit) and still balances", () => {
    const lines = cardSaleLines({ sale_price: 20, fees: 3, shipping_income: 0, shipping_cost: 2, basis_drawn: 40 }, "investment");
    expect(linesBalance(lines)).toBe(true);
    const gl = lines.find((l) => l.account === "capital_gain_loss");
    expect(gl?.debit).toBe(25); // realized 15 - basis 40 = -25 loss
  });

  it("hobby treatment: selling costs are non-deductible, income = receipts − basis, balances", () => {
    const lines = cardSaleLines(S, "hobby");
    expect(linesBalance(lines)).toBe(true);
    expect(lines.find((l) => l.account === "nondeductible_costs")?.debit).toBe(17); // fees 13 + ship 4
    expect(lines.find((l) => l.account === "hobby_income")?.credit).toBe(65); // receipts 105 − basis 40
    expect(lines.some((l) => l.account === "platform_fees")).toBe(false); // no deductible expense line
  });
});

describe("receiptEntries", () => {
  it("a pool/cards receipt debits the treatment's asset account (dealer=inventory)", () => {
    const e = receiptEntries({ amount: 40, entity_id: "A", disposition: "pool", treatment: "dealer" });
    expect(e).toHaveLength(1);
    expect(e[0].entityId).toBe("A");
    expect(linesBalance(e[0].lines)).toBe(true);
    expect(e[0].lines.find((l) => l.account === "inventory")?.debit).toBe(40);
  });

  it("an investment/hobby receipt debits the SAME account a later sale credits", () => {
    const inv = receiptEntries({ amount: 40, entity_id: "A", disposition: "cards", treatment: "investment" });
    expect(inv[0].lines.find((l) => l.account === "investment_assets")?.debit).toBe(40); // matches cardSaleLines credit
    expect(inv[0].lines.some((l) => l.account === "inventory")).toBe(false);
    const hob = receiptEntries({ amount: 40, entity_id: "A", disposition: "cards", treatment: "hobby" });
    expect(hob[0].lines.find((l) => l.account === "card_assets")?.debit).toBe(40);
  });

  it("an advance = two entries (payer + payee), each balanced; payee holds it per ITS treatment", () => {
    const e = receiptEntries({ amount: 100, entity_id: "A", disposition: "advance", to_entity_id: "B", advance_disposition: "cards", advance_treatment: "investment" });
    expect(e).toHaveLength(2);
    const payer = e.find((x) => x.entityId === "A")!;
    const payee = e.find((x) => x.entityId === "B")!;
    expect(linesBalance(payer.lines)).toBe(true);
    expect(linesBalance(payee.lines)).toBe(true);
    // Payer holds a receivable; payee a payable — they net at consolidation.
    expect(payer.lines.find((l) => l.account === "intercompany_advance")?.debit).toBe(100);
    expect(payee.lines.find((l) => l.account === "intercompany_payable")?.credit).toBe(100);
    // Receiver treats it as investment → investment_assets (not plain inventory).
    expect(payee.lines.find((l) => l.account === "investment_assets")?.debit).toBe(100);
  });

  it("ignores a non-positive amount", () => {
    expect(receiptEntries({ amount: 0, entity_id: "A", disposition: "pool" })).toHaveLength(0);
  });
});

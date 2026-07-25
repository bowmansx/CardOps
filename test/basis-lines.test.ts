import { describe, it, expect } from "vitest";
import {
  cardBasis, cardAcquisitionBasis, cardCostLines, lotAverages,
} from "@/lib/cards/basis";

const noLots = new Map<string, number>();
const lots = lotAverages([{ id: "L1", remaining_cost: 100, remaining_count: 4 }]);

describe("acquisition vs cost lines", () => {
  it("a lot card acquires at the lot's current average", () => {
    expect(cardAcquisitionBasis({ purchase_lot_id: "L1", individual_basis: null }, lots)).toBe(25);
  });

  it("a lot-less card acquires at its stated figure", () => {
    expect(cardAcquisitionBasis({ purchase_lot_id: null, individual_basis: 12.34 }, noLots)).toBe(12.34);
  });

  it("total is acquisition plus cost lines", () => {
    const card = { purchase_lot_id: null, individual_basis: 20, basis_items_total: 60 };
    expect(cardBasis(card, noLots)).toBe(80);
  });

  // The whole point of letting a lot card carry cost lines: a graded card out
  // of a box break costs the lot share PLUS the grading.
  it("a lot card carries its own cost lines on top of the lot share", () => {
    const card = { purchase_lot_id: "L1", individual_basis: null, basis_items_total: 50 };
    expect(cardAcquisitionBasis(card, lots)).toBe(25);
    expect(cardCostLines(card)).toBe(50);
    expect(cardBasis(card, lots)).toBe(75);
  });

  // This is the identity that stops reports double-counting. Splitting on
  // purchase_lot_id at the call site instead put a lot card's cost lines in
  // BOTH buckets.
  it("the two components always partition the total", () => {
    const cards = [
      { purchase_lot_id: "L1", individual_basis: null, basis_items_total: 50 },
      { purchase_lot_id: null, individual_basis: 20, basis_items_total: 5 },
      { purchase_lot_id: null, individual_basis: 0, basis_items_total: 0 },
    ];
    for (const c of cards) {
      expect(cardAcquisitionBasis(c, lots) + cardCostLines(c)).toBe(cardBasis(c, lots));
    }
    const total = cards.reduce((s, c) => s + cardBasis(c, lots), 0);
    const parts =
      cards.reduce((s, c) => s + cardAcquisitionBasis(c, lots), 0) +
      cards.reduce((s, c) => s + cardCostLines(c), 0);
    expect(parts).toBe(total);
  });
});

describe("missing and malformed values", () => {
  // A caller that hasn't selected basis_items_total yet must degrade to
  // acquisition-only rather than produce NaN and poison a whole page of money.
  it("treats an absent cost-line total as zero, never NaN", () => {
    expect(cardBasis({ purchase_lot_id: null, individual_basis: 10 }, noLots)).toBe(10);
    expect(cardCostLines({ purchase_lot_id: null, individual_basis: 10 })).toBe(0);
  });

  it("survives junk in either component", () => {
    const junk = {
      purchase_lot_id: null,
      individual_basis: "abc" as unknown as number,
      basis_items_total: "xyz" as unknown as number,
    };
    expect(cardBasis(junk, noLots)).toBe(0);
    expect(Number.isNaN(cardBasis(junk, noLots))).toBe(false);
  });

  it("a card pointing at a lot we couldn't read acquires at 0, not NaN", () => {
    expect(cardAcquisitionBasis({ purchase_lot_id: "GONE", individual_basis: 99 }, lots)).toBe(0);
  });

  // Credit lines are real: a refunded grading fee reduces basis.
  it("allows a negative cost line to reduce the total", () => {
    const card = { purchase_lot_id: null, individual_basis: 100, basis_items_total: -30 };
    expect(cardBasis(card, noLots)).toBe(70);
  });
});

describe("an emptied lot", () => {
  it("averages to 0 rather than dividing by zero", () => {
    const empty = lotAverages([{ id: "L0", remaining_cost: 0, remaining_count: 0 }]);
    expect(cardAcquisitionBasis({ purchase_lot_id: "L0", individual_basis: null }, empty)).toBe(0);
  });
});

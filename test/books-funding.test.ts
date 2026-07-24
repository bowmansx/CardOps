import { describe, it, expect } from "vitest";
import { acquisitionEntries, holderAfter, simulate, FUNDING_PATHS, type FundingInput } from "@/lib/books/funding";
import { linesBalance } from "@/lib/books/journal";

const OWNER = "owner-personal";
const ENTITY = "entity-af";

const base: FundingInput = {
  cost: 100,
  path: "keep_personal",
  owner_entity_id: OWNER,
  owner_treatment: "investment",
  entity_id: ENTITY,
  entity_treatment: "dealer",
};

const sumDr = (lines: { debit: number }[]) => lines.reduce((a, l) => a + l.debit, 0);
const sumCr = (lines: { credit: number }[]) => lines.reduce((a, l) => a + l.credit, 0);

describe("acquisitionEntries — every path, every treatment balances on every side", () => {
  const treatments = ["dealer", "investment", "hobby"] as const;
  for (const path of FUNDING_PATHS) {
    for (const ot of treatments) {
      for (const et of treatments) {
        it(`${path} · owner=${ot} · entity=${et} balances`, () => {
          const entries = acquisitionEntries({ ...base, path, owner_treatment: ot, entity_treatment: et, transfer_price: 140 });
          expect(entries.length).toBeGreaterThan(0);
          for (const e of entries) expect(linesBalance(e.lines)).toBe(true);
        });
      }
    }
  }

  it("keep_personal is one entry on the owner's books, no entity side", () => {
    const e = acquisitionEntries({ ...base, path: "keep_personal" });
    expect(e).toHaveLength(1);
    expect(e[0].entityId).toBe(OWNER);
  });

  it("transfers produce two entries: owner + entity", () => {
    for (const path of ["sale_to_entity", "loan_to_entity", "capital_contribution"] as const) {
      const e = acquisitionEntries({ ...base, path });
      expect(e).toHaveLength(2);
      expect(e[0].entityId).toBe(OWNER);
      expect(e[1].entityId).toBe(ENTITY);
    }
  });

  it("zero/negative cost books nothing", () => {
    expect(acquisitionEntries({ ...base, cost: 0 })).toHaveLength(0);
    expect(acquisitionEntries({ ...base, cost: -5 })).toHaveLength(0);
  });
});

describe("sale_to_entity — related-party mechanics", () => {
  it("owner recognizes gain = price − cost; entity's basis becomes the price", () => {
    const s = simulate({ ...base, path: "sale_to_entity", owner_treatment: "investment", entity_treatment: "dealer", cost: 100, transfer_price: 140 });
    expect(s.acquisition_gain).toBe(40);
    expect(s.acquisition_character).toBe("capital");
    expect(s.holder_basis).toBe(140); // basis reset to the price the entity paid
    expect(s.holder_entity_id).toBe(ENTITY);
    expect(s.holder_treatment).toBe("dealer");
  });

  it("entity debits its asset account at the PRICE, not the owner's cost", () => {
    const [, entitySide] = acquisitionEntries({ ...base, path: "sale_to_entity", entity_treatment: "dealer", cost: 100, transfer_price: 140 });
    const inv = entitySide.lines.find((l) => l.account === "inventory");
    expect(inv?.debit).toBe(140);
  });

  it("unsettled sale parks proceeds/cost as receivable + payable, not cash", () => {
    const [ownerSide, entitySide] = acquisitionEntries({ ...base, path: "sale_to_entity", settled: false, cost: 100, transfer_price: 140 });
    expect(ownerSide.lines.some((l) => l.account === "due_from_entity")).toBe(true);
    expect(ownerSide.lines.some((l) => l.account === "cash")).toBe(false);
    expect(entitySide.lines.some((l) => l.account === "due_to_owner")).toBe(true);
    expect(linesBalance(ownerSide.lines)).toBe(true);
    expect(linesBalance(entitySide.lines)).toBe(true);
  });

  it("flags the related-party rule", () => {
    const s = simulate({ ...base, path: "sale_to_entity", transfer_price: 140 });
    expect(s.flags.some((f) => /related-party|§267/i.test(f))).toBe(true);
  });
});

describe("loan vs contribution — no gain now, basis carries over at cost", () => {
  it("loan_to_entity: owner holds a receivable, entity owes a member loan, basis = cost", () => {
    const s = simulate({ ...base, path: "loan_to_entity", cost: 100 });
    expect(s.acquisition_gain).toBe(0);
    expect(s.holder_basis).toBe(100);
    const [ownerSide, entitySide] = s.acquisition;
    expect(ownerSide.lines.some((l) => l.account === "due_from_entity")).toBe(true);
    expect(entitySide.lines.some((l) => l.account === "due_to_owner")).toBe(true);
    expect(s.flags.some((f) => /loan/i.test(f))).toBe(true);
  });

  it("capital_contribution: owner adds equity basis, entity credits owner equity", () => {
    const s = simulate({ ...base, path: "capital_contribution", cost: 100 });
    expect(s.acquisition_gain).toBe(0);
    const [ownerSide, entitySide] = s.acquisition;
    expect(ownerSide.lines.some((l) => l.account === "investment_in_entity")).toBe(true);
    expect(entitySide.lines.some((l) => l.account === "owner_equity")).toBe(true);
    expect(s.flags.some((f) => /contribution/i.test(f))).toBe(true);
  });
});

describe("simulate — eventual sale + character + SE/long-term flags", () => {
  it("dealer holder → ordinary + SE exposure on a profitable sale", () => {
    const s = simulate({ ...base, path: "loan_to_entity", entity_treatment: "dealer", cost: 100, sale_price: 200, fees: 20 });
    // net proceeds 180 − basis 100 = 80 gain
    expect(s.final_gain).toBe(80);
    expect(s.final_character).toBe("ordinary");
    expect(s.self_employment_exposed).toBe(true);
    expect(s.sale && linesBalance(s.sale.lines)).toBe(true);
  });

  it("investment holder ≥12mo → long-term possible, no SE tax", () => {
    const s = simulate({ ...base, path: "keep_personal", owner_treatment: "investment", cost: 100, sale_price: 300, holding_months: 18 });
    expect(s.final_character).toBe("capital");
    expect(s.self_employment_exposed).toBe(false);
    expect(s.long_term_possible).toBe(true);
    expect(s.flags.some((f) => /long-term/i.test(f))).toBe(true);
  });

  it("investment holder <12mo → short-term note, not long-term", () => {
    const s = simulate({ ...base, path: "keep_personal", owner_treatment: "investment", sale_price: 300, holding_months: 5 });
    expect(s.long_term_possible).toBe(false);
    expect(s.flags.some((f) => /short-term/i.test(f))).toBe(true);
  });

  it("no sale price → no sale entry, final gain 0", () => {
    const s = simulate({ ...base, path: "keep_personal" });
    expect(s.sale).toBeNull();
    expect(s.final_gain).toBe(0);
    expect(s.balanced).toBe(true);
  });

  it("everything balanced flag is true across a full transfer+sale", () => {
    const s = simulate({ ...base, path: "sale_to_entity", cost: 100, transfer_price: 150, sale_price: 260, fees: 30, holding_months: 14 });
    expect(s.balanced).toBe(true);
  });
});

describe("adversarial-review fixes", () => {
  it("hobby headline gain = receipts − basis (non-deductible selling costs NOT netted out)", () => {
    // Was the bug: net−basis = 150. Correct: 300−100 = 200, matching the hobby_income the journal books.
    const s = simulate({ ...base, path: "keep_personal", owner_treatment: "hobby", cost: 100, sale_price: 300, fees: 50 });
    expect(s.final_gain).toBe(200);
    const income = s.sale?.lines.find((l) => l.account === "hobby_income");
    expect(income?.credit).toBe(200); // headline equals the journal
  });

  it("dealer/investment DO net selling costs into the headline", () => {
    const d = simulate({ ...base, path: "keep_personal", owner_treatment: "dealer", cost: 100, sale_price: 300, fees: 50 });
    expect(d.final_gain).toBe(150); // net 250 − basis 100
    const i = simulate({ ...base, path: "keep_personal", owner_treatment: "investment", cost: 100, sale_price: 300, fees: 50 });
    expect(i.final_gain).toBe(150);
  });

  it("sale_to_entity does NOT award long-term — the buyer's holding clock restarts", () => {
    const s = simulate({ ...base, path: "sale_to_entity", entity_treatment: "investment", cost: 100, transfer_price: 140, sale_price: 300, holding_months: 24 });
    expect(s.long_term_possible).toBe(false);
    expect(s.flags.some((f) => /holding period restarts/i.test(f))).toBe(true);
    // carryover-basis paths still can be long-term
    const c = simulate({ ...base, path: "capital_contribution", entity_treatment: "investment", holding_months: 24, sale_price: 300 });
    expect(c.long_term_possible).toBe(true);
  });

  it("related-party LOSS is flagged as disallowed, not presented as recognized", () => {
    const s = simulate({ ...base, path: "sale_to_entity", owner_treatment: "investment", cost: 200, transfer_price: 100 });
    expect(s.acquisition_gain).toBe(-100);
    expect(s.flags.some((f) => /DISALLOWED under §267/i.test(f))).toBe(true);
    // must NOT claim a clean recognized loss
    expect(s.flags.some((f) => /recognize a .*loss/i.test(f))).toBe(false);
  });

  it("owner's dealer disposition to the entity is SE-exposed now", () => {
    const s = simulate({ ...base, path: "sale_to_entity", owner_treatment: "dealer", entity_treatment: "investment", cost: 100, transfer_price: 300 });
    expect(s.acquisition_gain).toBe(200);
    expect(s.acquisition_character).toBe("ordinary");
    expect(s.self_employment_exposed).toBe(true);
    expect(s.flags.some((f) => /self-employment tax/i.test(f))).toBe(true);
  });
});

describe("holderAfter", () => {
  it("keep_personal holds on owner books at cost", () => {
    expect(holderAfter({ ...base, path: "keep_personal", cost: 100 })).toEqual({ entityId: OWNER, basis: 100, treatment: "investment" });
  });
  it("sale_to_entity holds on entity books at price", () => {
    expect(holderAfter({ ...base, path: "sale_to_entity", cost: 100, transfer_price: 175, entity_treatment: "dealer" })).toEqual({ entityId: ENTITY, basis: 175, treatment: "dealer" });
  });
});

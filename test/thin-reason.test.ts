import { describe, it, expect } from "vitest";
import {
  thinReason, methodFor, thinNarrative, NEW_PRODUCT_DAYS,
  type ThinContext,
} from "@/lib/cards/thin-reason";

const NOW = Date.parse("2026-07-30");
const ctx = (o: Partial<ThinContext> = {}): ThinContext => ({
  issueYear: 2021, setHasSales: true, lastSaleDays: null, ownSales365: 0, nowMs: NOW, ...o,
});

describe("thinReason — the distinction that decides the method", () => {
  // The set trades, this variant does not. Siblings are real and actively
  // priced, so reaching sideways is exactly right.
  it("calls an untraded variant of a trading set TOO_RARE", () => {
    expect(thinReason(ctx({ issueYear: 2021, setHasSales: true }))).toBe("too_rare");
  });

  // A product three weeks old has no market yet, and neither do its siblings —
  // so reaching sideways finds nothing.
  it("calls a brand-new product TOO_NEW", () => {
    expect(thinReason(ctx({ issueYear: 2026, setHasSales: false }))).toBe("too_new");
  });

  // THE CASE THAT DECIDES THE ORDER. A three-week-old /5 is both new AND rare.
  // Treating it as rare sends the transfer into siblings that have not traded
  // either, so youth has to be checked first.
  it("prefers TOO_NEW when a card is both new and rare", () => {
    expect(thinReason(ctx({ issueYear: 2026, setHasSales: true }))).toBe("too_new");
  });

  // It sold once and stopped. There is a real price in the past — the card's own
  // history is better evidence than any sibling, it just needs discounting.
  it("calls a card that sold and went quiet GONE_QUIET, not rare", () => {
    expect(thinReason(ctx({ setHasSales: true, lastSaleDays: 800, ownSales365: 0 }))).toBe("gone_quiet");
  });

  it("prefers its own history over a sideways reach even for a new product", () => {
    expect(thinReason(ctx({ issueYear: 2026, lastSaleDays: 40, ownSales365: 0 }))).toBe("gone_quiet");
  });

  // `unknown` here means the CALLER did not supply enough context — not that the
  // card is mysterious.
  it("returns unknown when nothing is known about the wider set", () => {
    expect(thinReason(ctx({ issueYear: null, setHasSales: false, lastSaleDays: null }))).toBe("unknown");
  });

  it("stops calling a product new once it has been out long enough", () => {
    const justOld = NEW_PRODUCT_DAYS + 10;
    const year = new Date(NOW - justOld * 86_400_000).getUTCFullYear();
    // An older product with a trading set is rare, not new.
    expect(thinReason(ctx({ issueYear: year - 1, setHasSales: true }))).toBe("too_rare");
  });
});

describe("methodFor — never guess the method from the tier", () => {
  it("maps each reason to the transfer it licenses", () => {
    expect(methodFor("too_new")).toBe("comparable_product");
    expect(methodFor("too_rare")).toBe("analog_parallel");
    expect(methodFor("gone_quiet")).toBe("own_history_discounted");
  });

  // NOT a fallback to the least-bad option. With no idea why a card is thin, any
  // transfer is a guess wearing a method's name.
  it("licenses NO method when the reason is unknown", () => {
    expect(methodFor("unknown")).toBe("none");
  });

  // The whole point: these are different methods, so a mix-up prices a 2026
  // rookie off a 2019 sibling.
  it("never gives the same method to too_new and too_rare", () => {
    expect(methodFor("too_new")).not.toBe(methodFor("too_rare"));
  });
});

describe("thinNarrative", () => {
  it("explains a new product by its year", () => {
    expect(thinNarrative("too_new", ctx({ issueYear: 2026 }))).toContain("2026");
    expect(thinNarrative("too_new", ctx())).toContain("last year's equivalent");
  });

  it("explains a rare variant by the set trading around it", () => {
    expect(thinNarrative("too_rare", ctx())).toContain("neighbouring parallel");
  });

  it("puts a number on how long a quiet card has been quiet", () => {
    expect(thinNarrative("gone_quiet", ctx({ lastSaleDays: 600 }))).toContain("20 months");
  });

  it("admits the gap is in what we know, not in the card", () => {
    expect(thinNarrative("unknown", ctx())).toContain("not enough information");
  });
});

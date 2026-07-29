import { describe, it, expect } from "vitest";
import {
  observedFeeRate, resolveFeeRate, estimateProceeds, breakEvenPrice, offerVerdict,
  rateLabel, FEE_SCHEDULES, tieredPct, perOrderFee,
  type SettledSale, type FeeRateSource, type FeeSchedule,
} from "@/lib/cards/net-proceeds";

const settled = (o: Partial<SettledSale> = {}): SettledSale => ({
  platform: "ebay", sale_price: 100, fees: 13.35, shipping_income: 0, ...o,
});

/** A clean 10% + $0 rate, so the arithmetic in a test is checkable by hand. */
const flat10: FeeRateSource = {
  kind: "schedule",
  schedule: {
    platform: "Test", tiers: [{ upTo: null, pct: 0.1 }], perOrderTiers: [{ upTo: null, amount: 0 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false, source: "test", verifiedAt: "2026-07-29",
  },
};

/** A schedule builder, so a test states only what it is exercising. */
const sched = (o: Partial<FeeSchedule>): FeeRateSource => ({
  kind: "schedule",
  schedule: {
    platform: "T", tiers: [{ upTo: null, pct: 0.1 }], perOrderTiers: [{ upTo: null, amount: 0 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false, source: "t", verifiedAt: "2026-07-29", ...o,
  },
});

describe("observedFeeRate — your own rate beats any published table", () => {
  it("derives the median effective rate from settled sales", () => {
    const r = observedFeeRate(Array.from({ length: 6 }, () => settled({ sale_price: 100, fees: 13 })), "ebay");
    expect(r.kind).toBe("observed");
    if (r.kind !== "observed") return;
    expect(r.pct).toBeCloseTo(0.13, 6);
    expect(r.n).toBe(6);
  });

  // MEDIAN, not mean: one promoted listing at 20% would drag a mean up and
  // quietly raise the break-even on every other card.
  it("is not moved by a single outlier the way a mean would be", () => {
    const sales = [
      ...Array.from({ length: 5 }, () => settled({ sale_price: 100, fees: 13 })),
      settled({ sale_price: 100, fees: 40 }), // promoted listing
    ];
    const r = observedFeeRate(sales, "ebay");
    if (r.kind !== "observed") throw new Error("expected observed");
    expect(r.pct).toBeCloseTo(0.13, 6); // a mean would be ~0.175
  });

  // The fee was charged on the total the buyer paid, so the denominator has to
  // match or the derived rate reads low on every sale with shipping.
  it("counts shipping income in the denominator", () => {
    const r = observedFeeRate(
      Array.from({ length: 5 }, () => settled({ sale_price: 90, shipping_income: 10, fees: 10 })), "ebay");
    if (r.kind !== "observed") throw new Error("expected observed");
    expect(r.pct).toBeCloseTo(0.1, 6); // 10 / (90+10), not 10/90
  });

  it("ignores other platforms and is case-insensitive", () => {
    const sales = [
      ...Array.from({ length: 5 }, () => settled({ platform: "eBay", fees: 13 })),
      ...Array.from({ length: 5 }, () => settled({ platform: "tcgplayer", fees: 5 })),
    ];
    const r = observedFeeRate(sales, "EBAY");
    if (r.kind !== "observed") throw new Error("expected observed");
    expect(r.n).toBe(5);
    expect(r.pct).toBeCloseTo(0.13, 6);
  });

  // A rate from two sales is noise wearing a decimal point.
  it("returns none below the sale floor, and says how short it is", () => {
    const r = observedFeeRate([settled(), settled()], "ebay");
    expect(r.kind).toBe("none");
    if (r.kind !== "none") return;
    expect(r.why).toContain("only 2");
  });

  // A negative fee, or one exceeding the sale price, is a data problem —
  // averaging it in would corrupt every estimate downstream.
  it("rejects impossible fee figures rather than averaging them in", () => {
    const sales = [
      ...Array.from({ length: 5 }, () => settled({ sale_price: 100, fees: 13 })),
      settled({ sale_price: 100, fees: -50 }),
      settled({ sale_price: 100, fees: 500 }),
    ];
    const r = observedFeeRate(sales, "ebay");
    if (r.kind !== "observed") throw new Error("expected observed");
    expect(r.n).toBe(5);
  });

  // A free-listing promo genuinely charged nothing; that is data, not an error.
  it("keeps a legitimate zero-fee sale", () => {
    const r = observedFeeRate(Array.from({ length: 5 }, () => settled({ fees: 0 })), "ebay");
    if (r.kind !== "observed") throw new Error("expected observed");
    expect(r.pct).toBe(0);
  });
});

describe("resolveFeeRate", () => {
  it("prefers your own sales over the published schedule", () => {
    const r = resolveFeeRate(Array.from({ length: 5 }, () => settled({ fees: 20 })), "ebay");
    expect(r.kind).toBe("observed");
  });

  it("falls back to the schedule when there aren't enough sales", () => {
    expect(resolveFeeRate([], "ebay").kind).toBe("schedule");
  });

  // No rate is a first-class outcome. A fee of zero is a claim that the platform
  // takes nothing, and it is always wrong.
  it("returns none for a platform with neither", () => {
    const r = resolveFeeRate([], "some-local-card-show");
    expect(r.kind).toBe("none");
    if (r.kind !== "none") return;
    expect(r.why).toContain("some-local-card-show");
  });
});

describe("estimateProceeds", () => {
  it("computes what actually lands in your account", () => {
    // 100 + 10 shipping in, 10% of 110 = 11 fee, 6 postage out.
    const p = estimateProceeds({ price: 100, shipIncome: 10, shipCost: 6 }, flat10)!;
    expect(p.feeable).toBe(110);
    expect(p.fees).toBe(11);
    expect(p.net).toBe(93); // 100 + 10 - 11 - 6
  });

  it("reports profit and margin against basis", () => {
    const p = estimateProceeds({ price: 100, basis: 50 }, flat10)!;
    expect(p.net).toBe(90);
    expect(p.profit).toBe(40);
    expect(p.margin).toBeCloseTo(40 / 90, 6);
  });

  it("leaves profit null with no basis, rather than implying it is all profit", () => {
    const p = estimateProceeds({ price: 100 }, flat10)!;
    expect(p.profit).toBeNull();
    expect(p.margin).toBeNull();
  });

  // PREVENTION RULE 12: a fixed fee applies once per ORDER, not per line.
  it("splits a per-order fixed fee across the order's lines", () => {
    const withFixed = sched({ tiers: [{ upTo: null, pct: 0 }], perOrderTiers: [{ upTo: null, amount: 1 }] });
    expect(estimateProceeds({ price: 100, orderLines: 1 }, withFixed)!.feeFixed).toBe(1);
    expect(estimateProceeds({ price: 100, orderLines: 4 }, withFixed)!.feeFixed).toBe(0.25);
  });

  it("excludes shipping from the fee base when the platform does", () => {
    const noShipFee = sched({ pctAppliesToShipping: false });
    const p = estimateProceeds({ price: 100, shipIncome: 50 }, noShipFee)!;
    expect(p.feeable).toBe(100);
    expect(p.fees).toBe(10);
  });

  // An observed rate was divided out of real totals, so it already contains
  // whatever fixed fee was charged. Adding one on top would double-count.
  it("adds no fixed fee on top of an observed rate", () => {
    const r = observedFeeRate(Array.from({ length: 5 }, () => settled({ sale_price: 100, fees: 13 })), "ebay");
    expect(estimateProceeds({ price: 100 }, r)!.feeFixed).toBe(0);
  });

  it("returns null rather than a number when the rate is unknown", () => {
    expect(estimateProceeds({ price: 100 }, { kind: "none", why: "x" })).toBeNull();
  });

  it("returns null for a junk price", () => {
    expect(estimateProceeds({ price: 0 }, flat10)).toBeNull();
    expect(estimateProceeds({ price: Number.NaN }, flat10)).toBeNull();
  });

  it("flags an estimate built on an unconfirmed published rate", () => {
    // Whatnot is still an unconfirmed preset; eBay was verified against their own
    // fees page on 2026-07-29, so it must NOT be flagged.
    expect(estimateProceeds({ price: 100 }, resolveFeeRate([], "whatnot"))!.unverifiedRate).toBe(true);
    expect(estimateProceeds({ price: 100 }, resolveFeeRate([], "ebay"))!.unverifiedRate).toBe(false);
    expect(estimateProceeds({ price: 100 }, flat10)!.unverifiedRate).toBe(false);
  });
});

describe("breakEvenPrice — the inversion, which is the whole point", () => {
  // THE BUG THIS PREVENTS. Naive markup says basis × (1 + pct); the truth is
  // basis / (1 - pct), because the fee is charged on the higher price too. The
  // naive answer is LOWER, so it says an offer clears when it loses money.
  it("is higher than a naive markup, and the difference is real money", () => {
    const be = breakEvenPrice({ basis: 100 }, flat10)!;
    expect(be.price).toBeCloseTo(111.11, 2); // 100 / 0.9
    expect(be.price).toBeGreaterThan(110);   // naive 100 × 1.10
  });

  it("round-trips exactly: selling at break-even nets the basis", () => {
    const be = breakEvenPrice({ basis: 250, shipIncome: 8, shipCost: 5 }, flat10)!;
    const p = estimateProceeds({ price: be.price, shipIncome: 8, shipCost: 5, basis: 250 }, flat10)!;
    expect(p.net).toBeCloseTo(250, 1);
    expect(p.profit).toBeCloseTo(0, 1);
  });

  it("round-trips with a per-order fixed fee split across lines", () => {
    const r = resolveFeeRate([], "ebay"); // 13.35% + $0.30/order, unverified
    const be = breakEvenPrice({ basis: 187, shipIncome: 5, shipCost: 4, orderLines: 3 }, r)!;
    const p = estimateProceeds({ price: be.price, shipIncome: 5, shipCost: 4, basis: 187, orderLines: 3 }, r)!;
    expect(p.profit).toBeCloseTo(0, 1);
  });

  it("counts shipping the buyer pays as covering part of the basis", () => {
    const withShip = breakEvenPrice({ basis: 100, shipIncome: 20 }, flat10)!;
    const without = breakEvenPrice({ basis: 100 }, flat10)!;
    expect(withShip.price).toBeLessThan(without.price);
  });

  it("counts postage you pay as raising the bar", () => {
    expect(breakEvenPrice({ basis: 100, shipCost: 9 }, flat10)!.price)
      .toBeGreaterThan(breakEvenPrice({ basis: 100 }, flat10)!.price);
  });

  // Shipping income alone can exceed the basis on a bulk card. You cannot sell
  // for less than nothing, so zero is the floor rather than a negative price.
  it("floors at zero instead of returning a negative price", () => {
    expect(breakEvenPrice({ basis: 1, shipIncome: 50 }, flat10)!.price).toBe(0);
  });

  // At a 100% fee the platform takes the increase faster than you can earn it —
  // there is no break-even at any price, and a huge number would look like one.
  it("returns null when no price can break even", () => {
    const impossible = sched({ tiers: [{ upTo: null, pct: 1 }] });
    expect(breakEvenPrice({ basis: 100 }, impossible)).toBeNull();
  });

  it("returns null when the rate is unknown", () => {
    expect(breakEvenPrice({ basis: 100 }, { kind: "none", why: "x" })).toBeNull();
  });

  // A zero basis is a real state — CLAUDE.md makes individual_basis optional and
  // defaulting to 0 — so it must produce a price, not an error.
  it("handles a zero basis", () => {
    expect(breakEvenPrice({ basis: 0 }, flat10)!.price).toBe(0);
  });
});

describe("offerVerdict — should I take this offer?", () => {
  it("answers with arithmetic, not advice", () => {
    const v = offerVerdict({ price: 340, basis: 187, shipCost: 5 }, flat10)!;
    expect(v.proceeds.net).toBe(301); // 340 - 34 fee - 5 postage
    expect(v.clears).toBe(true);
    expect(v.headroom).toBeGreaterThan(0);
    expect(v.proceeds.profit).toBe(114); // 301 - 187
  });

  it("says no when an offer looks fine but doesn't cover the basis", () => {
    // $100 offer on a $95 basis: it LOOKS profitable and it is not, once the
    // platform's cut lands. This is the case the whole file exists for.
    const v = offerVerdict({ price: 100, basis: 95 }, flat10)!;
    expect(v.proceeds.net).toBe(90);
    expect(v.clears).toBe(false);
    expect(v.headroom).toBeLessThan(0);
    expect(v.proceeds.profit).toBe(-5);
  });

  it("agrees with break-even exactly at the boundary", () => {
    const be = breakEvenPrice({ basis: 100 }, flat10)!;
    expect(offerVerdict({ price: be.price, basis: 100 }, flat10)!.clears).toBe(true);
    expect(offerVerdict({ price: be.price - 1, basis: 100 }, flat10)!.clears).toBe(false);
  });

  it("returns null rather than a verdict when the rate is unknown", () => {
    expect(offerVerdict({ price: 100, basis: 50 }, { kind: "none", why: "x" })).toBeNull();
  });
});

describe("rateLabel — the number never travels without its source", () => {
  it("credits your own sales", () => {
    const r = observedFeeRate(Array.from({ length: 7 }, () => settled({ fees: 13 })), "ebay");
    expect(rateLabel(r)).toBe("13.0% — your last 7 ebay sales");
  });

  it("marks an unconfirmed published rate as unconfirmed", () => {
    // Whatnot is still a preset nobody has checked. eBay was verified against
    // their own fees page, so using it here would assert the opposite of truth.
    expect(rateLabel(resolveFeeRate([], "whatnot"))).toContain("UNCONFIRMED");
  });

  it("explains itself when there is no rate at all", () => {
    expect(rateLabel({ kind: "none", why: "no schedule for Whatnot" })).toBe("no schedule for Whatnot");
  });
});

describe("the seeded schedules are honest about not being verified", () => {
  // They are what I believe is current, and belief is not verification. Anything
  // built on one is flagged until someone who actually sells there confirms it.
  it("marks every UNCONFIRMED preset as such, and only those", () => {
    for (const s of Object.values(FEE_SCHEDULES)) {
      if (s.verifiedAt == null) expect(s.source).toContain("NEEDS CONFIRMING");
      else expect(s.source).not.toContain("NEEDS CONFIRMING");
    }
  });

  // Read off eBay's own fees page on 2026-07-29, which is why this one is not
  // flagged. It is also the only schedule whose numbers are load-bearing today.
  it("carries eBay's verified tiers exactly as published", () => {
    const e = FEE_SCHEDULES.ebay;
    expect(e.verifiedAt).toBe("2026-07-29");
    expect(e.tiers).toEqual([{ upTo: 7500, pct: 0.1325 }, { upTo: null, pct: 0.0235 }]);
    expect(e.perOrderTiers).toEqual([{ upTo: 10, amount: 0.3 }, { upTo: null, amount: 0.4 }]);
    expect(e.pctAppliesToShipping).toBe(true);
    expect(e.pctAppliesToSalesTax).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIERS. Verified against eBay's own fees page 2026-07-29. Every case below was
// silently wrong under the flat-rate model this replaced.
// ─────────────────────────────────────────────────────────────────────────────

describe("tieredPct", () => {
  const cards = [{ upTo: 7500, pct: 0.1325 }, { upTo: null, pct: 0.0235 }];

  it("charges the first band only, below the threshold", () => {
    expect(tieredPct(100, cards)).toBeCloseTo(13.25, 6);
  });

  it("charges each band on its own portion above the threshold", () => {
    // 13.25% x 7500 = 993.75, plus 2.35% x 2500 = 58.75.
    expect(tieredPct(10_000, cards)).toBeCloseTo(1052.5, 6);
  });

  // THE $272 ERROR. A flat 13.25% on a $10,000 slab computes $1,325.
  it("is materially cheaper than a flat rate on a high-value card", () => {
    expect(10_000 * 0.1325 - tieredPct(10_000, cards)).toBeCloseTo(272.5, 6);
  });

  it("is exact at the threshold", () => {
    expect(tieredPct(7500, cards)).toBeCloseTo(993.75, 6);
  });

  it("is zero at zero", () => {
    expect(tieredPct(0, cards)).toBe(0);
  });
});

describe("perOrderFee", () => {
  // "For orders $10.00 or less the per order fee is $0.30, for orders over
  // $10.00 the per order fee is $0.40."
  const bands = [{ upTo: 10, amount: 0.3 }, { upTo: null, amount: 0.4 }];

  it("uses the cheap band at or below the boundary", () => {
    expect(perOrderFee(5, bands)).toBe(0.3);
    expect(perOrderFee(10, bands)).toBe(0.3);
  });

  it("uses the dearer band above it", () => {
    expect(perOrderFee(10.01, bands)).toBe(0.4);
    expect(perOrderFee(500, bands)).toBe(0.4);
  });
});

describe("the fee base includes sales tax, which nobody models", () => {
  // eBay: the total amount of the sale "includes the item price, any handling
  // charges, any shipping costs collected from the buyer, SALES TAX, and any
  // other applicable fees." You pay a percentage on money you never receive.
  it("charges the percentage on tax the platform collected", () => {
    const p = estimateProceeds({ price: 100, salesTax: 8 }, sched({ pctAppliesToSalesTax: true }))!;
    expect(p.feeable).toBe(108);
    expect(p.fees).toBe(10.8);
  });

  // The tax is remitted by the platform, so it must NOT be added to net — only
  // to the fee base. Getting this backwards would inflate every payout.
  it("does not add the tax to what you keep", () => {
    const p = estimateProceeds({ price: 100, salesTax: 8 }, sched({ pctAppliesToSalesTax: true }))!;
    expect(p.net).toBe(89.2); // 100 - 10.80
  });

  it("ignores tax for a platform that does not charge on it", () => {
    expect(estimateProceeds({ price: 100, salesTax: 8 }, sched({ pctAppliesToSalesTax: false }))!.feeable).toBe(100);
  });
});

describe("break-even solves the right band", () => {
  const ebay = resolveFeeRate([], "ebay");

  it("round-trips inside the first band", () => {
    const be = breakEvenPrice({ basis: 187, shipCost: 4 }, ebay)!;
    expect(estimateProceeds({ price: be.price, shipCost: 4, basis: 187 }, ebay)!.profit).toBeCloseTo(0, 1);
  });

  // The case a flat-rate inversion gets badly wrong: the marginal rate above
  // $7,500 is 2.35%, not 13.25%, so the required price is far closer to basis.
  it("round-trips ACROSS the threshold, using the marginal rate", () => {
    const be = breakEvenPrice({ basis: 9000 }, ebay)!;
    expect(be.price).toBeGreaterThan(7500);
    expect(estimateProceeds({ price: be.price, basis: 9000 }, ebay)!.profit).toBeCloseTo(0, 1);
  });

  it("round-trips with the cheap per-order band on a sub-$10 card", () => {
    const be = breakEvenPrice({ basis: 5 }, ebay)!;
    const p = estimateProceeds({ price: be.price, basis: 5 }, ebay)!;
    expect(p.feeFixed).toBe(0.3); // the <=$10 band
    expect(p.profit).toBeCloseTo(0, 1);
  });

  it("round-trips with sales tax in the base", () => {
    const be = breakEvenPrice({ basis: 200, salesTax: 15, shipIncome: 5, shipCost: 4 }, ebay)!;
    const p = estimateProceeds({ price: be.price, salesTax: 15, shipIncome: 5, shipCost: 4, basis: 200 }, ebay)!;
    expect(p.profit).toBeCloseTo(0, 1);
  });

  // A steep first band is climbable when a cheaper band sits above it; only an
  // unclimbable TOP band has no solution.
  it("still solves when the answer lies above a steep first band", () => {
    const steep = sched({ tiers: [{ upTo: 10, pct: 0.9 }, { upTo: null, pct: 0.05 }] });
    const be = breakEvenPrice({ basis: 1000 }, steep)!;
    expect(estimateProceeds({ price: be.price, basis: 1000 }, steep)!.profit).toBeCloseTo(0, 1);
  });
});

describe("rateLabel describes the tiers rather than flattening them", () => {
  it("names both eBay bands and both per-order bands", () => {
    const l = rateLabel(resolveFeeRate([], "ebay"));
    expect(l).toContain("13.25%");
    expect(l).toContain("2.35%");
    expect(l).toContain("$7,500");
    expect(l).toContain("confirmed 2026-07-29");
    expect(l).not.toContain("UNCONFIRMED");
  });
});

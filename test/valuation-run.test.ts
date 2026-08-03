import { describe, it, expect } from "vitest";
import {
  sourceCosts, confidenceFrom, verdictFor, runValuation, UNPRICED_SOURCE,
  type CostableSource,
} from "@/lib/cards/valuation-run";
import { costOrder, gatherComps, type SourceCost } from "@/lib/cards/orchestrator";
import type { ObservedSale } from "@/lib/cards/observed-sale";
import type { CardForPricing } from "@/lib/cards/price-sources/types";
import type { ThinContext } from "@/lib/cards/thin-reason";

const NOW = Date.parse("2026-07-30");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString().slice(0, 10);

const card: CardForPricing = {
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader: "PSA", grade: 10, condition_type: "graded",
};
const raw: CardForPricing = { ...card, grader: null, grade: null, condition_type: "raw" };

let n = 0;
const sale = (o: Partial<ObservedSale> = {}): ObservedSale => ({
  externalId: `s${n++}`, price: 100, currency: "USD",
  priceBasis: "all_in", soldAt: daysAgo(10), platform: "eBay", title: null, url: null,
  grader: "PSA", grade: 10, isGraded: true, confirmed: true, ...o,
});

const thin = (o: Partial<ThinContext> = {}): ThinContext => ({
  issueYear: 2021, setHasSales: true, lastSaleDays: null, ownSales365: 0, nowMs: NOW, ...o,
});

const src = (id: string, o: Partial<CostableSource> = {}): CostableSource => ({
  id, enabled: () => true, handles: () => true, ...o,
});

describe("sourceCosts", () => {
  it("drops sources that aren't configured or don't cover the card", () => {
    const got = sourceCosts(card, [
      src("on"),
      src("no-key", { enabled: () => false }),
      src("wrong-sport", { handles: () => false }),
    ]);
    expect(got.map((s) => s.id)).toEqual(["on"]);
  });

  // The mirror of `mayPersist` default-denying an unknown source: "we never
  // checked" must not read the same as "free", or an unpriced vendor sorts to
  // the head of a walk order whose whole purpose is to spend nothing it needn't.
  it("treats a source that never declared a cost as EXPENSIVE, not free", () => {
    const got = sourceCosts(card, [src("unpriced"), src("free", { cost: { costPerCall: 0, latency: 5 } })]);
    const unpriced = got.find((s) => s.id === "unpriced")!;
    expect(unpriced.costPerCall).toBe(UNPRICED_SOURCE.costPerCall);
    expect(costOrder(got).map((s) => s.id)).toEqual(["free", "unpriced"]);
  });

  it("carries the declared cost through to the walk order", () => {
    const got = sourceCosts(card, [
      src("vendor", { cost: { costPerCall: 0.02, latency: 400 } }),
      src("own-book", { cost: { costPerCall: 0, latency: 5 } }),
    ]);
    expect(costOrder(got).map((s) => s.id)).toEqual(["own-book", "vendor"]);
  });
});

describe("confidenceFrom", () => {
  // Confidence describes the EVIDENCE, not how hard someone asked. A fast run
  // that happened to find twelve fresh comps is firm; tying it to the budget
  // would report the same evidence differently depending on the question.
  it("calls a deep-quality comp set firm even on a fast run", () => {
    const comps = Array.from({ length: 12 }, () => sale({ soldAt: daysAgo(20) }));
    expect(confidenceFrom(comps, true, NOW)).toBe("firm");
  });

  it("is indicative when sufficient but short of the deep bar", () => {
    const comps = Array.from({ length: 5 }, () => sale({ soldAt: daysAgo(20) }));
    expect(confidenceFrom(comps, true, NOW)).toBe("indicative");
  });

  it("is thin when the walk never reached sufficiency", () => {
    expect(confidenceFrom([sale()], false, NOW)).toBe("thin");
  });

  // Twelve comps that are all two years old are a count without currency.
  it("does not call a stale pile firm on volume alone", () => {
    const stale = Array.from({ length: 20 }, () => sale({ soldAt: daysAgo(700) }));
    expect(confidenceFrom(stale, true, NOW)).toBe("indicative");
  });
});

describe("verdictFor", () => {
  const gatherOf = async (sales: ObservedSale[], sources: SourceCost[] = [{ id: "own-book", costPerCall: 0, latency: 5 }]) =>
    gatherComps(card, sources, async () => ({ sales }), { nowMs: NOW });

  it("prices a card and carries the evidence behind the number", async () => {
    const g = await gatherOf(Array.from({ length: 5 }, () => sale({ price: 100 })));
    const v = verdictFor(card, g, thin(), { nowMs: NOW });

    expect(v.price).toBe(100);
    expect(v.thin).toBeNull();
    expect(v.evidence?.count).toBe(5);
    expect(v.asked).toEqual(["own-book"]);
    expect(v.spent).toBe(0);
  });

  // The whole reason the engine exists: a silence with its reason attached.
  it("abstains with a reason instead of guessing", async () => {
    const g = await gatherOf([]);
    const v = verdictFor(card, g, thin({ setHasSales: true }), { nowMs: NOW });

    expect(v.price).toBeNull();
    expect(v.confidence).toBe("thin");
    expect(v.thin?.reason).toBe("too_rare");
    expect(v.thin?.method).toBe("analog_parallel");
  });

  // With no idea WHY a card is thin, any transfer is a guess wearing a method's
  // name — so the verdict licenses none.
  it("licenses no method when nothing is known about the wider set", async () => {
    const g = await gatherOf([]);
    const v = verdictFor(card, g, thin({ issueYear: null, setHasSales: false }), { nowMs: NOW });
    expect(v.thin?.reason).toBe("unknown");
    expect(v.thin?.method).toBe("none");
  });

  // "Found nothing" and "found five and threw them all away" are different
  // stories, and only the second tells you to go get a comp at your own grade.
  it("says when comps were found but none matched the condition", async () => {
    // Raw card, every comp graded.
    const g = await gatherComps(raw, [{ id: "own-book", costPerCall: 0, latency: 5 }],
      async () => ({ sales: Array.from({ length: 4 }, () => sale({ isGraded: true, grader: "PSA" })) }),
      { nowMs: NOW });
    const v = verdictFor(raw, g, thin(), { nowMs: NOW });

    expect(v.price).toBeNull();
    expect(v.narrative).toContain("none matched this card's condition");
    expect(v.narrative).toContain("4 sales were found");
  });

  // Rule 10: a valuation built from two of five sources is a different claim
  // from one built from all five, and the difference has to be visible.
  it("reports the sources it never asked", async () => {
    const g = await gatherOf(Array.from({ length: 5 }, () => sale()), [
      { id: "own-book", costPerCall: 0, latency: 5 },
      { id: "vendor", costPerCall: 0.02, latency: 400 },
    ]);
    const v = verdictFor(card, g, thin(), { nowMs: NOW });
    expect(v.skipped).toEqual(["vendor"]);
    expect(v.narrative).toContain("not asked");
  });
});

describe("runValuation", () => {
  it("never pays a vendor when the user's own sales already answered", async () => {
    const asked: string[] = [];
    const { verdict } = await runValuation(
      card,
      [{ id: "own-book", costPerCall: 0, latency: 5 }, { id: "vendor", costPerCall: 1, latency: 400 }],
      async (id) => { asked.push(id); return { sales: Array.from({ length: 6 }, () => sale()) }; },
      thin(), { nowMs: NOW },
    );

    expect(asked).toEqual(["own-book"]);
    expect(verdict.price).toBe(100);
    expect(verdict.spent).toBe(0);
  });

  // A vendor being down must not read as "this card has no comps" — that would
  // let an outage silently reprice an inventory.
  it("carries a failed source through to the verdict as a failure", async () => {
    const { verdict } = await runValuation(
      card, [{ id: "vendor", costPerCall: 0.02, latency: 400 }],
      async () => null,
      thin(), { nowMs: NOW },
    );

    expect(verdict.price).toBeNull();
    expect(verdict.empty).toEqual([{ id: "vendor", note: "source failed" }]);
    // Not charged for a call that returned nothing.
    expect(verdict.spent).toBe(0);
  });
});

describe("the user's own pricing rules govern the engine", () => {
  const gatherFive = async () =>
    gatherComps(card, [{ id: "own-book", costPerCall: 0, latency: 5 }],
      async () => ({ sales: [10, 20, 30, 40, 1000].map((price) => sale({ price })) }),
      { nowMs: NOW });

  it("uses the configured aggregate instead of a hardcoded median", async () => {
    const g = await gatherFive();
    expect(verdictFor(card, g, thin(), { nowMs: NOW }).price).toBe(30);
    expect(verdictFor(card, g, thin(), { nowMs: NOW, aggregate: { aggregate: { fn: "mean" } } }).price).toBe(220);
  });

  // The message that would otherwise be a lie: these comps DID match the card's
  // condition, and telling someone to go find comps they already have is worse
  // than saying nothing.
  it("says the rules abstained, not that nothing matched", async () => {
    const g = await gatherFive();
    const v = verdictFor(card, g, thin(), { nowMs: NOW, aggregate: { min_comps: 10 } });

    expect(v.price).toBeNull();
    expect(v.narrative).toContain("5 matched this card's condition");
    expect(v.narrative).toContain("your pricing rules ask for more");
    expect(v.narrative).not.toContain("none matched");
  });
});

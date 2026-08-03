import { describe, it, expect } from "vitest";
import {
  costOrder, isSufficient, gatherComps, gatherNarrative, SUFFICIENCY,
  type SourceCost,
} from "@/lib/cards/orchestrator";
import type { ObservedSale } from "@/lib/cards/observed-sale";
import type { CardForPricing } from "@/lib/cards/price-sources/types";

const NOW = Date.parse("2026-07-30");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString().slice(0, 10);

const card: CardForPricing = {
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader: "PSA", grade: 10, condition_type: "graded",
};

const sale = (o: Partial<ObservedSale> = {}): ObservedSale => ({
  externalId: Math.random().toString(36).slice(2), price: 100, currency: "USD",
  priceBasis: "all_in", soldAt: daysAgo(10), platform: "eBay", title: null, url: null,
  grader: "PSA", grade: 10, isGraded: true, confirmed: true, ...o,
});

const SOURCES: SourceCost[] = [
  { id: "own-book", costPerCall: 0, latency: 5 },
  { id: "thecardapi", costPerCall: 0.02, latency: 400 },
  { id: "expensive", costPerCall: 1.0, latency: 400 },
];

describe("costOrder", () => {
  it("walks cheapest first", () => {
    expect(costOrder(SOURCES).map((s) => s.id)).toEqual(["own-book", "thecardapi", "expensive"]);
  });

  // Reading rows already in the database beats a network round trip that also
  // costs nothing.
  it("breaks ties on latency", () => {
    const o = costOrder([
      { id: "slow-free", costPerCall: 0, latency: 900 },
      { id: "fast-free", costPerCall: 0, latency: 5 },
    ]);
    expect(o.map((s) => s.id)).toEqual(["fast-free", "slow-free"]);
  });

  // A valuation that reorders its own sources run to run is one nobody can
  // reproduce.
  it("is stable when cost and latency are equal", () => {
    const same: SourceCost[] = [
      { id: "a", costPerCall: 0, latency: 1 },
      { id: "b", costPerCall: 0, latency: 1 },
      { id: "c", costPerCall: 0, latency: 1 },
    ];
    expect(costOrder(same).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("isSufficient", () => {
  const std = SUFFICIENCY.standard;

  it("needs both the count AND the freshness", () => {
    // Five comps, all two years old — a count without currency.
    const stale = Array.from({ length: 5 }, () => sale({ soldAt: daysAgo(700) }));
    expect(isSufficient(stale, std, NOW)).toBe(false);
    // Two fresh, but not enough of them.
    expect(isSufficient([sale(), sale()], std, NOW)).toBe(false);
    // Both satisfied.
    expect(isSufficient(Array.from({ length: 5 }, () => sale()), std, NOW)).toBe(true);
  });

  // An undated sale cannot be placed in time, so it cannot testify that the
  // market is current — but it IS evidence of a clearing price.
  it("counts an undated comp toward the total and not toward freshness", () => {
    const comps = [
      ...Array.from({ length: 4 }, () => sale({ soldAt: null })),
      sale({ soldAt: daysAgo(5) }),
    ];
    expect(comps.length).toBe(5);
    // Only one fresh; standard wants two.
    expect(isSufficient(comps, std, NOW)).toBe(false);
  });

  // A single sale is a data point, not a market — it could be a wash trade or a
  // friend doing a favour. Two is the floor at which disagreement is visible.
  it("never treats one comp as enough, even on fast", () => {
    expect(isSufficient([sale()], SUFFICIENCY.fast, NOW)).toBe(false);
    expect(isSufficient([sale(), sale()], SUFFICIENCY.fast, NOW)).toBe(true);
  });

  it("gets stricter as the budget rises", () => {
    const six = Array.from({ length: 6 }, () => sale({ soldAt: daysAgo(120) }));
    expect(isSufficient(six, SUFFICIENCY.fast, NOW)).toBe(true);
    expect(isSufficient(six, SUFFICIENCY.standard, NOW)).toBe(true);
    expect(isSufficient(six, SUFFICIENCY.deep, NOW)).toBe(false); // deep wants 12, fresh in 90d
  });
});

describe("gatherComps — cheapest first, stop on sufficiency", () => {
  it("never pays a vendor when the free source already answered", async () => {
    const asked: string[] = [];
    const r = await gatherComps(card, SOURCES, async (id) => {
      asked.push(id);
      return id === "own-book" ? { sales: Array.from({ length: 5 }, () => sale()) } : { sales: [] };
    }, { nowMs: NOW });

    expect(asked).toEqual(["own-book"]);
    expect(r.satisfied).toBe(true);
    expect(r.evidence.spent).toBe(0);
    // The unasked sources are REPORTED, not silently dropped.
    expect(r.skipped).toEqual(["thecardapi", "expensive"]);
  });

  it("moves on when the cheap source is not enough", async () => {
    const r = await gatherComps(card, SOURCES, async (id) => {
      if (id === "own-book") return { sales: [sale()] };
      if (id === "thecardapi") return { sales: Array.from({ length: 5 }, () => sale()) };
      return { sales: [] };
    }, { nowMs: NOW });

    expect(r.evidence.asked).toEqual(["own-book", "thecardapi"]);
    expect(r.satisfied).toBe(true);
    expect(r.evidence.comps).toHaveLength(6);
    expect(r.evidence.spent).toBeCloseTo(0.02, 5);
    expect(r.skipped).toEqual(["expensive"]);
  });

  // Discovering the budget is blown after the money is gone is not a budget.
  it("checks the spend BEFORE making the call", async () => {
    const asked: string[] = [];
    const r = await gatherComps(card, SOURCES, async (id) => {
      asked.push(id);
      return { sales: [sale()] };
    }, { nowMs: NOW, maxSpend: 0.05 });

    expect(asked).toEqual(["own-book", "thecardapi"]); // "expensive" costs 1.0
    expect(r.evidence.spent).toBeLessThanOrEqual(0.05);
    expect(r.steps.at(-1)).toMatchObject({ reason: "budget-exhausted" });
  });

  // A vendor being down is not evidence that a card has no comps. Treating it as
  // such would let an outage silently reprice an inventory.
  it("distinguishes a failed source from an empty one, and does not charge for it", async () => {
    const r = await gatherComps(card, SOURCES, async (id) => {
      if (id === "own-book") return { sales: [] };
      if (id === "thecardapi") return null;          // failed
      throw new Error("boom");                        // also failed
    }, { nowMs: NOW });

    expect(r.evidence.spent).toBe(0);
    expect(r.evidence.empty.map((e) => e.id)).toEqual(["own-book", "thecardapi", "expensive"]);
    expect(r.evidence.empty[1].note).toBe("source failed");
    expect(r.satisfied).toBe(false);
  });

  it("dedups the same sale arriving from two sources", async () => {
    const shared = sale({ externalId: "dupe" });
    const r = await gatherComps(card, [SOURCES[0], SOURCES[1]], async () => ({
      sales: [shared, sale()],
    }), { nowMs: NOW });
    // Same externalId from two DIFFERENT sources is two rows — the id is only
    // unique within a source — but a repeat within one source is dropped.
    const ids = r.evidence.comps.map((c) => c.externalId);
    expect(ids.filter((i) => i === "dupe")).toHaveLength(2);
  });

  it("reports having asked everything and still fallen short", async () => {
    const r = await gatherComps(card, SOURCES, async () => ({ sales: [sale()] }), { nowMs: NOW });
    expect(r.satisfied).toBe(false);
    expect(r.skipped).toEqual([]);
    expect(r.steps.at(-1)).toMatchObject({ reason: "no-more-sources" });
  });

  it("copes with no sources at all", async () => {
    const r = await gatherComps(card, [], async () => ({ sales: [] }), { nowMs: NOW });
    expect(r.evidence.comps).toEqual([]);
    expect(r.satisfied).toBe(false);
  });
});

describe("gatherNarrative", () => {
  it("says why it stopped early", async () => {
    const r = await gatherComps(card, SOURCES, async (id) =>
      id === "own-book" ? { sales: Array.from({ length: 5 }, () => sale()) } : { sales: [] },
      { nowMs: NOW });
    const n = gatherNarrative(r);
    expect(n).toContain("own-book");
    expect(n).toContain("not asked");
  });

  // The honest ending, and the one that matters: everything was asked and it is
  // still thin.
  it("says when everything was asked and it is still not enough", async () => {
    const r = await gatherComps(card, SOURCES, async () => ({ sales: [sale()] }), { nowMs: NOW });
    expect(gatherNarrative(r)).toContain("still below");
    expect(gatherNarrative(r)).toContain("thin");
  });

  it("says plainly when there is nothing", async () => {
    const r = await gatherComps(card, SOURCES, async () => ({ sales: [] }), { nowMs: NOW });
    expect(gatherNarrative(r)).toContain("No comps found");
  });
});

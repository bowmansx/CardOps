import { describe, it, expect } from "vitest";
import { retentionDuty, purgeNarrative, VENDOR_PROVENANCE, type PurgeScope } from "@/lib/cards/retention";

const NOW = Date.parse("2026-08-02T00:00:00Z");
const scope = (o: Partial<PurgeScope> = {}): PurgeScope => ({
  sourceId: "thecardapi", vendorSales: 0, userRowsKept: 0, rollupsCarrying: 0, truncated: false, ...o,
});

describe("retentionDuty", () => {
  it("dates the deadline from termination, not from now", () => {
    // The Card API §5: 30 days from cancellation.
    const d = retentionDuty("thecardapi", { deleteOnTerminationDays: 30 }, "2026-07-20", NOW);
    expect(d.dueAt).toBe("2026-08-19");
    expect(d.daysLeft).toBe(17);
    expect(d.urgent).toBe(false);
  });

  it("flags a deadline that is close or already gone", () => {
    expect(retentionDuty("x", { deleteOnTerminationDays: 30 }, "2026-07-05", NOW).urgent).toBe(true);
    const past = retentionDuty("x", { deleteOnTerminationDays: 30 }, "2026-06-01", NOW);
    expect(past.daysLeft).toBeLessThan(0);
    expect(past.urgent).toBe(true);
  });

  // "There is a clause and it isn't due" is a different state from "there is no
  // clause", and a screen has to be able to tell them apart.
  it("keeps the clause visible before it is triggered", () => {
    const d = retentionDuty("thecardapi", { deleteOnTerminationDays: 30 }, null, NOW);
    expect(d.withinDays).toBe(30);
    expect(d.dueAt).toBeNull();
    expect(d.urgent).toBe(false);
  });

  it("has no duty for a source whose terms impose none", () => {
    const d = retentionDuty("scryfall", { deleteOnTerminationDays: null }, "2026-07-20", NOW);
    expect(d.withinDays).toBeNull();
    expect(d.dueAt).toBeNull();
  });

  it("doesn't invent a deadline from an unparseable date", () => {
    expect(retentionDuty("x", { deleteOnTerminationDays: 30 }, "not-a-date", NOW).dueAt).toBeNull();
  });
});

describe("purgeNarrative — the blast radius, before anything happens", () => {
  it("says plainly when there is nothing to do", () => {
    expect(purgeNarrative(scope())).toContain("nothing to delete");
  });

  it("counts what goes", () => {
    expect(purgeNarrative(scope({ vendorSales: 412 }))).toContain("412 sales fetched from thecardapi will be deleted permanently");
  });

  // A vendor's termination clause has no reach over the user's own records, and
  // their survival must be a stated outcome rather than a surprise.
  it("states that the user's own rows survive, and why", () => {
    const n = purgeNarrative(scope({ vendorSales: 10, userRowsKept: 3 }));
    expect(n).toContain("3 rows you entered or sold yourself will be kept");
    expect(n).toContain("don't reach your own records");
  });

  // Guessing either way on derived aggregates is wrong, so it asks.
  it("surfaces rollups as a decision rather than deleting or hiding them", () => {
    const n = purgeNarrative(scope({ vendorSales: 10, rollupsCarrying: 7 }));
    expect(n).toContain("7 compacted summaries");
    expect(n).toContain("NOT touched");
    expect(n).toContain("needs a decision");
  });

  it("admits when the count itself was capped", () => {
    expect(purgeNarrative(scope({ vendorSales: 99_999, truncated: true }))).toContain("real number is higher");
  });
});

describe("scope constant", () => {
  // Scoping on source ALONE would sweep up pasted comps and own sales sitting in
  // the same table — destroying work under cover of compliance.
  it("names the one provenance a vendor's clause can reach", () => {
    expect(VENDOR_PROVENANCE).toBe("vendor");
  });
});

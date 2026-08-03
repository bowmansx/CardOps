import { describe, it, expect } from "vitest";
import { distill, distillBySource, matchesCondition } from "@/lib/cards/distill";
import type { ObservedSale } from "@/lib/cards/observed-sale";
import type { CardForPricing } from "@/lib/cards/price-sources/types";

const graded = (grader: string, grade: number): CardForPricing => ({
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome", card_number: "BCP-42",
  parallel: null, sport_category: "Baseball", grader, grade, condition_type: "graded",
});
const raw: CardForPricing = { ...graded("", 0), grader: null, grade: null, condition_type: "raw" };

const sale = (o: Partial<ObservedSale> = {}): ObservedSale => ({
  externalId: Math.random().toString(36).slice(2), price: 50, currency: "USD", priceBasis: "all_in",
  soldAt: "2026-05-14", platform: "eBay", title: "t", url: null,
  grader: null, grade: null, isGraded: null, confirmed: true, ...o,
});

describe("distill — graded", () => {
  it("medians only the matching grader+grade sales", () => {
    const { quote } = distill([
      sale({ grader: "PSA", grade: 10, price: 100 }),
      sale({ grader: "PSA", grade: 10, price: 120 }),
      sale({ grader: "PSA", grade: 9, price: 40 }),   // wrong grade
      sale({ grader: "SGC", grade: 10, price: 200 }), // wrong grader
      sale({ grader: null, price: 10 }),              // raw
    ], graded("PSA", 10), "thecardapi");
    expect(quote?.price).toBe(110); // median(100,120)
    expect(quote?.grader).toBe("PSA");
    expect(quote?.grade).toBe(10);
    expect(quote?.kind).toBe("sold");
    expect(quote?.label).toContain("median of 2");
  });

  it("returns NOTHING on no exact grade match — never contaminates with other grades/graders", () => {
    const { quote } = distill(
      [sale({ grader: "PSA", grade: 9, price: 60 }), sale({ grader: "BGS", grade: 9.5, price: 80 })],
      graded("PSA", 10), "thecardapi");
    expect(quote).toBeNull();
  });

  it("returns nothing when there are no graded sales at all", () => {
    expect(distill([sale({ grader: null, price: 10 })], graded("PSA", 10), "thecardapi").quote).toBeNull();
  });

  it("exposes a sample of the exact sales behind the median for auditing", () => {
    const { quote } = distill([
      sale({ grader: "PSA", grade: 10, price: 100, title: "A" }),
      sale({ grader: "PSA", grade: 10, price: 120, title: "B" }),
    ], graded("PSA", 10), "thecardapi");
    const payload = quote?.payload as { count: number; sample: { grade: number | null }[] };
    expect(payload.count).toBe(2);
    expect(payload.sample).toHaveLength(2);
    expect(payload.sample.every((s) => Number(s.grade) === 10)).toBe(true);
  });
});

describe("distill — raw", () => {
  it("medians only ungraded sales", () => {
    const { quote } = distill([
      sale({ grader: null, price: 10 }),
      sale({ grader: null, price: 20 }),
      sale({ grader: "PSA", grade: 10, price: 500 }), // graded — excluded
    ], raw, "thecardapi");
    expect(quote?.price).toBe(15);
    expect(quote?.grader).toBeNull();
    expect(quote?.grade).toBeNull();
  });

  // The pollution bug. A source that can state graded-vs-raw is believed over
  // the grader field, because "no grader" is overwhelmingly "not extracted".
  it("believes an explicit isGraded over a missing grader", () => {
    const { quote } = distill([
      sale({ grader: null, isGraded: true, price: 500 }), // graded, grade never extracted
      sale({ grader: null, isGraded: false, price: 10 }),
      sale({ grader: null, isGraded: false, price: 20 }),
    ], raw, "thecardapi");
    expect(quote?.price).toBe(15); // the 500 stays out
  });
});

describe("distill — money hygiene", () => {
  it("converts a hammer price to all-in before medianing", () => {
    // 100 hammer → 122 all-in, against a 122 eBay sale: the two agree, which is
    // the point. Unconverted they would median to 111 and match neither.
    const { quote } = distill([
      sale({ grader: null, price: 100, platform: "Goldin", priceBasis: "hammer" }),
      sale({ grader: null, price: 122, platform: "eBay" }),
    ], raw, "thecardapi");
    expect(quote?.price).toBe(122);
  });

  it("excludes sales it can't put on a common footing, and SAYS SO", () => {
    const { quote, excluded } = distill([
      sale({ grader: null, price: 30 }),
      sale({ grader: null, price: 900, platform: "Hakes", priceBasis: "unknown" }),
    ], raw, "thecardapi");
    expect(quote?.price).toBe(30);
    expect(excluded).toBe(1);
    const payload = quote?.payload as { excluded: number; exclusionNote: string };
    expect(payload.excluded).toBe(1);
    expect(payload.exclusionNote).toContain("Hakes");
  });

  it("holds provisional prices out of the median and counts them", () => {
    const { quote, unconfirmed } = distill([
      sale({ grader: null, price: 30 }),
      sale({ grader: null, price: 9999, confirmed: false }),
    ], raw, "thecardapi");
    expect(quote?.price).toBe(30);
    expect(unconfirmed).toBe(1);
  });

  it("ignores zero/negative/non-numeric prices", () => {
    const { quote } = distill([
      sale({ grader: null, price: 0 }), sale({ grader: null, price: -5 }),
      sale({ grader: null, price: Number.NaN }), sale({ grader: null, price: 30 }),
    ], raw, "thecardapi");
    expect(quote?.price).toBe(30);
  });

  it("empty input → no quote", () => {
    expect(distill([], raw, "thecardapi").quote).toBeNull();
  });

  // Every sale unconvertible is not the same as no sales, but both must yield
  // no number rather than a number built from nothing.
  it("returns no quote when every matching sale is unconvertible", () => {
    const { quote, excluded } = distill(
      [sale({ grader: null, price: 100, platform: "REA", priceBasis: "unknown" })], raw, "thecardapi");
    expect(quote).toBeNull();
    expect(excluded).toBe(1);
  });
});

describe("matchesCondition", () => {
  it("falls back to the grader field only when isGraded is unknown", () => {
    expect(matchesCondition(sale({ grader: "PSA", grade: 10, isGraded: null }), graded("PSA", 10))).toBe(true);
    expect(matchesCondition(sale({ grader: null, isGraded: null }), raw)).toBe(true);
  });
});

describe("distillBySource", () => {
  // Sources stay SEPARATE rather than pooled: they have different coverage,
  // freshness and licences, so a disagreement should be visible on the card page
  // instead of averaged into one number.
  it("returns one quote per source, tagged with that source", () => {
    const quotes = distillBySource([
      { source: "thecardapi", sales: [sale({ grader: null, price: 10 }), sale({ grader: null, price: 20 })] },
      { source: "other-vendor", sales: [sale({ grader: null, price: 100 })] },
    ], raw);
    expect(quotes.map((q) => [q.source, q.price])).toEqual([["thecardapi", 15], ["other-vendor", 100]]);
  });

  it("drops a source that produced no usable quote rather than emitting an empty one", () => {
    const quotes = distillBySource([
      { source: "thecardapi", sales: [sale({ grader: null, price: 10 })] },
      { source: "empty-vendor", sales: [] },
    ], raw);
    expect(quotes.map((q) => q.source)).toEqual(["thecardapi"]);
  });
});

// ── The user's own pricing rules, applied to gathered sales ────────────────
//
// Extracted 2026-08-02: `interpretPipeline` and `distill` had each grown their
// own "turn these prices into one number", and two implementations of the same
// arithmetic drift. `distill` now delegates to the same `aggregateEntries` the
// configurable pipeline uses, so the engine cannot quietly disagree with the
// value shown two panels down on the same card.
describe("distill — configured aggregate", () => {
  const four = [10, 20, 30, 1000].map((price) => sale({ grader: null, price }));

  it("defaults to the plain median it always used", () => {
    expect(distill(four, raw, "src").quote?.price).toBe(25);
  });

  it("honours a configured aggregate function", () => {
    expect(distill(four, raw, "src", { aggregate: { fn: "mean" } }).quote?.price).toBe(265);
    expect(distill(four, raw, "src", { aggregate: { fn: "min" } }).quote?.price).toBe(10);
  });

  // The $1000 sale is the one an IQR fence exists to remove.
  it("applies configured guards before aggregating", () => {
    const q = distill(four, raw, "src", { guards: { iqr_k: 1.5 }, aggregate: { fn: "mean" } }).quote;
    expect(q?.price).toBe(20); // mean(10,20,30) — the outlier fenced out
  });

  it("names the function it actually used, not 'median'", () => {
    const q = distill(four, raw, "src", { aggregate: { fn: "wavg_recency" } }).quote;
    expect(q?.label).toContain("recency-weighted of 4");
  });

  // Trading an abstention for a confidently wrong number is the worse outcome
  // under this app's posture — so min_comps abstains rather than shrinking.
  it("abstains when fewer comps survive than the rules require", () => {
    const d = distill(four, raw, "src", { min_comps: 5 });
    expect(d.quote).toBeNull();
    // ...and reports that they MATCHED, so a caller doesn't claim otherwise.
    expect(d.usable).toBe(4);
  });

  // "Nothing matched your condition" and "four matched, your rules want five"
  // are different facts with different fixes.
  it("distinguishes a condition miss from a rules abstention", () => {
    const wrongGrade = distill([sale({ grader: "PSA", grade: 9, price: 100 })], graded("PSA", 10), "src");
    expect(wrongGrade.quote).toBeNull();
    expect(wrongGrade.usable).toBe(0);
  });
});

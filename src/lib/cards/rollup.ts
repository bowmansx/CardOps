// COMPACTION: individual sales -> per-identity statistics that survive them.
//
// Storage arithmetic forces this, and the numbers are not close. eBay did $2.32B
// in card singles in H1 2026; at a $25-30 average that is on the order of
// 400-500K card transactions a day. The Card API's Pro plan permits 25,000,000
// stored records — roughly 50-60 days of that firehose. **Individual sales cannot
// be kept forever, and any design that assumes they can breaks in month two.**
//
// So the hot tier holds recent sales with tap-through evidence, and everything
// older collapses into per-identity/grade/period rollups: orders of magnitude
// smaller, and what a price graph and a valuation actually consume.
//
// THE ROLLUP CARRIES ITS PROVENANCE. "Median of 41 PSA 9 sales, week of 12 May,
// The Card API" survives compaction intact — only the tap-through to individual
// listings degrades, and that is a labelled loss rather than a silent one. A
// rollup that dropped its sources would defeat the whole reason any of this
// exists. Derived analytics are ours under §4a ("fair value estimates, price
// indexes... these are your intellectual property"), which is what makes a
// rollup a different kind of object from a stored transaction record.
//
// Pure — no I/O. The job that reads, writes and deletes is separate, and must
// not run before migration 20260750 is applied.
import type { ObservedSale, SaleProvenance } from "./observed-sale";
import { toAllIn } from "./price-basis";

const round2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A stored sale, with the two fields only the row knows. */
export type SaleForRollup = ObservedSale & {
  source: string;
  provenance: SaleProvenance;
};

export type RollupPeriod = "week" | "month";

/** One row of `card_market_rollups`. */
export type RollupRow = {
  identity_id: string;
  period: RollupPeriod;
  /** Monday of the ISO week, or the 1st of the month. */
  period_start: string;
  grader: string | null;
  grade: number | null;
  n: number;
  median_price: number;
  min_price: number;
  max_price: number;
  first_sold: string;
  last_sold: string;
  /** Sales in the bucket we could not put on a common footing. */
  excluded_unknown_basis: number;
  sources: string[];
  platforms: string[];
  provenances: SaleProvenance[];
};

/**
 * The Monday of the week containing `date`, in UTC.
 *
 * Sale dates are calendar days with no timezone, so parsing them as UTC keeps a
 * sale from drifting into the previous week for anyone west of Greenwich — which
 * would make the same data roll up differently depending on who ran the job.
 */
export function weekStart(date: string): string {
  const d = new Date(date.slice(0, 10) + "T00:00:00Z");
  // getUTCDay: 0=Sunday. Shift so Monday is 0, then step back that many days.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export function monthStart(date: string): string {
  return date.slice(0, 7) + "-01";
}

export function periodStart(date: string, period: RollupPeriod): string {
  return period === "month" ? monthStart(date) : weekStart(date);
}

export type RollupResult = {
  rows: RollupRow[];
  /**
   * Sales that could not be bucketed at all because they carry no date.
   *
   * Reported rather than dropped: these are real sales that will be lost if the
   * hot rows are deleted after compaction, so a job must decide deliberately
   * whether to keep them rather than discover the loss later (rule 10).
   */
  undated: number;
};

/**
 * Collapse sales into rollup rows, grouped by period and condition.
 *
 * Grouped by grader+grade rather than pooled, for the same reason the distill
 * matches strictly: a PSA 10 and a raw copy are different goods, and a median
 * across both describes neither.
 *
 * Every price is normalized to all-in first. Sales whose basis can't be resolved
 * are counted into `excluded_unknown_basis` on the row they would have joined,
 * so a rollup states how much it left out instead of quietly being a partial
 * figure (rule 4).
 */
export function rollupSales(
  identityId: string,
  sales: SaleForRollup[],
  period: RollupPeriod = "week",
): RollupResult {
  type Bucket = {
    prices: number[];
    dates: string[];
    excluded: number;
    sources: Set<string>;
    platforms: Set<string>;
    provenances: Set<SaleProvenance>;
    grader: string | null;
    grade: number | null;
    period_start: string;
  };
  const buckets = new Map<string, Bucket>();
  let undated = 0;

  for (const s of sales) {
    if (!s.soldAt) { undated++; continue; }
    const start = periodStart(s.soldAt, period);
    // Grade is part of the key, so `null` and `0` must not collide.
    const key = `${start}|${s.grader ?? ""}|${s.grade ?? ""}`;
    const b = buckets.get(key) ?? {
      prices: [], dates: [], excluded: 0,
      sources: new Set<string>(), platforms: new Set<string>(), provenances: new Set<SaleProvenance>(),
      grader: s.grader, grade: s.grade, period_start: start,
    };
    if (!buckets.has(key)) buckets.set(key, b);

    const n = toAllIn(s.price, s.priceBasis, s.platform, s.soldAt);
    if (!n.ok) {
      // A junk price was never a sale; an unconvertible real one is an exclusion
      // the row has to admit to.
      if (n.reason !== "bad_price") b.excluded++;
      continue;
    }
    b.prices.push(n.price);
    b.dates.push(s.soldAt.slice(0, 10));
    b.sources.add(s.source);
    if (s.platform) b.platforms.add(s.platform);
    b.provenances.add(s.provenance);
  }

  const rows: RollupRow[] = [];
  for (const b of buckets.values()) {
    // A bucket where every sale was unconvertible has no statistics to state.
    // Emitting one with n=0 would be a row asserting a price it doesn't have,
    // and the table's CHECK (n > 0) rejects it anyway.
    if (!b.prices.length) continue;
    const dates = [...b.dates].sort();
    rows.push({
      identity_id: identityId,
      period,
      period_start: b.period_start,
      grader: b.grader,
      grade: b.grade,
      n: b.prices.length,
      median_price: round2(median(b.prices)),
      min_price: round2(Math.min(...b.prices)),
      max_price: round2(Math.max(...b.prices)),
      first_sold: dates[0],
      last_sold: dates[dates.length - 1],
      excluded_unknown_basis: b.excluded,
      sources: [...b.sources].sort(),
      platforms: [...b.platforms].sort(),
      provenances: [...b.provenances].sort(),
    });
  }
  rows.sort((a, b) => a.period_start.localeCompare(b.period_start) || (a.grade ?? -1) - (b.grade ?? -1));
  return { rows, undated };
}

/**
 * Rollups → the chart series, for history older than the hot window.
 *
 * Deliberately returns the same `{ date, price, n }` shape the raw-sale series
 * uses, so a graph can span both tiers without knowing where the boundary is.
 * `excluded` carries forward, because a rollup built from part of its bucket must
 * keep saying so after the underlying rows are gone.
 */
export function rollupsToSeries(
  rows: RollupRow[],
  match?: { grader: string | null; grade: number | null },
): { points: { date: string; price: number; n: number }[]; excluded: number } {
  const relevant = match
    ? rows.filter((r) => r.grader === match.grader && (r.grade ?? null) === (match.grade ?? null))
    : rows;
  return {
    points: [...relevant]
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
      .map((r) => ({ date: r.period_start, price: r.median_price, n: r.n })),
    excluded: relevant.reduce((a, r) => a + r.excluded_unknown_basis, 0),
  };
}

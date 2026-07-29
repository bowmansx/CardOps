// Realized sales → ONE market quote at this card's condition (2026-07-29).
//
// This logic used to live inside the The Card API adapter, which made it look
// like a property of that vendor. It is not: strict condition matching, all-in
// normalization and "no comp is better than a wrong comp" are how CardOps
// prices a card from ANY set of observed sales — an API, a pasted Terapeak
// table, a Seller Hub export, an auction house's prices-realized CSV. It sits
// above the adapters so a second sales source inherits it instead of
// reimplementing it slightly differently.
import type { ObservedSale } from "./observed-sale";
import { byNewest } from "./observed-sale";
import { partitionByBasis, exclusionNote } from "./price-basis";
import type { CardForPricing, SourceQuote } from "./price-sources/types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Keep only sales that describe the same THING this card is.
 *
 * Never blends across graders or grades: a graded card is priced off sales at
 * the same grader and, where known, the same grade; a raw card off ungraded
 * sales only. No exact match yields no quote, deliberately — an honest "no comp
 * at this grade" beats a price borrowed from a neighbouring one.
 *
 * `isGraded` is consulted FIRST and the grader field only as a fallback,
 * because a source that can answer graded-vs-raw properly should decide it.
 * Where a source reports null, the fallback is explicitly unsafe: The Card API
 * populates `grader` on ~12% of records, so treating its absence as proof of
 * raw sweeps graded sales into a raw card's comps and pushes the value up.
 * Sources that can state `isGraded` are the fix; the fallback exists for rows
 * already stored without it.
 */
export function matchesCondition(s: ObservedSale, card: CardForPricing): boolean {
  const wantGraded = card.condition_type === "graded";
  const hasGrader = !!(s.grader && String(s.grader).trim());
  const saleGraded = s.isGraded ?? hasGrader;

  if (!wantGraded) return !saleGraded;
  if (!saleGraded) return false;
  if (card.grader && String(s.grader ?? "").toUpperCase() !== card.grader.toUpperCase()) return false;
  if (card.grade != null && Number(s.grade) !== card.grade) return false;
  return true;
}

export type DistilledQuote = {
  quote: SourceQuote | null;
  /** Sales dropped because their price basis couldn't be resolved. */
  excluded: number;
  /** Provisional figures held out of the median. */
  unconfirmed: number;
};

/** One sale as shown behind a price — the evidence a provenance chip opens. */
export type SampleSale = {
  title: string | null;
  /** What the source reported. */
  price: number;
  /** What went into the median. Differs from `price` on a converted hammer sale. */
  allIn: number;
  converted: boolean;
  grader: string | null;
  grade: number | null;
  platform: string | null;
  sold_at: string | null;
  url: string | null;
};

/**
 * The stored shape behind a sold quote — WHAT THE NUMBER RESTS ON.
 *
 * Typed rather than left as `unknown` because the card page reads it to render
 * provenance, and a price whose evidence can't be parsed is a price nobody can
 * check. Beau: "if we can't get good sales data and determine accurate prices
 * of scanned in cards and show where that data came from then i don't know what
 * good we are."
 */
export type SoldQuotePayload = {
  /** Sales in the median. */
  count: number;
  platforms: string[];
  /** Oldest and newest sale in the median — the WINDOW the price describes. */
  from: string | null;
  to: string | null;
  sample: SampleSale[];
  excluded?: number;
  exclusionNote?: string | null;
  unconfirmed?: number;
};

/** Read a stored quote's payload, or null when it isn't a sold quote. */
export function asSoldPayload(payload: unknown): SoldQuotePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<SoldQuotePayload>;
  if (typeof p.count !== "number" || !Array.isArray(p.sample)) return null;
  return {
    count: p.count,
    platforms: Array.isArray(p.platforms) ? p.platforms : [],
    from: p.from ?? null,
    to: p.to ?? null,
    sample: p.sample,
    excluded: p.excluded,
    exclusionNote: p.exclusionNote ?? null,
    unconfirmed: p.unconfirmed,
  };
}

/**
 * Distill sales from ONE source into that source's quote for this card.
 *
 * Every price is converted to all-in before it is medianed; sales whose basis
 * can't be resolved are dropped and COUNTED, never quietly discarded.
 */
export function distill(sales: ObservedSale[], card: CardForPricing, source: string): DistilledQuote {
  // A provisional figure is not a realized sale.
  const confirmed = sales.filter((s) => s.confirmed);
  const unconfirmed = sales.length - confirmed.length;

  const matched = confirmed.filter((s) => matchesCondition(s, card));
  if (!matched.length) return { quote: null, excluded: 0, unconfirmed };

  // Put every surviving sale on the same footing before taking a median.
  const { usable, excluded } = partitionByBasis(matched);
  if (!usable.length) return { quote: null, excluded: excluded.length, unconfirmed };

  const recent = [...usable].sort(byNewest);
  const graded = card.condition_type === "graded";
  const gradeLabel = graded ? `${card.grader ?? "Graded"}${card.grade != null ? " " + card.grade : ""}` : "Ungraded";

  // A sample of the exact sales behind the median, so a card page can answer
  // "show me why this price". BOTH numbers are kept: `price` is what the source
  // reported, `allIn` is what went into the median — a converted hammer price
  // reads as a conversion rather than as a figure that silently disagrees with
  // the listing it links to.
  const sample: SampleSale[] = recent.slice(0, 6).map((s) => ({
    title: s.title, price: s.price, allIn: s.allIn, converted: s.converted,
    grader: s.grader, grade: s.grade, platform: s.platform, sold_at: s.soldAt, url: s.url,
  }));

  // The WINDOW the median describes. "Median of 7" says nothing about whether
  // those seven happened last week or across two years, and the difference
  // decides whether the number means anything.
  const dates = usable.map((s) => s.soldAt).filter((d): d is string => !!d).sort();
  const payload: SoldQuotePayload = {
    count: usable.length,
    platforms: [...new Set(usable.map((s) => s.platform).filter((p): p is string => !!p))],
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    sample,
    // Surfaced, never silent: a comp set thinned by unconvertible prices
    // must not look like a complete one (rules 4 and 10).
    ...(excluded.length ? { excluded: excluded.length, exclusionNote: exclusionNote(excluded) } : {}),
    ...(unconfirmed ? { unconfirmed } : {}),
  };

  return {
    quote: {
      source,
      kind: "sold",
      grader: graded ? card.grader ?? null : null,
      grade: graded ? card.grade ?? null : null,
      price: round2(median(usable.map((s) => s.allIn))),
      currency: recent[0]?.currency ?? "USD",
      label: `${gradeLabel} · median of ${usable.length}`,
      url: recent[0]?.url ?? null,
      product_ref: null,
      payload,
    },
    excluded: excluded.length,
    unconfirmed,
  };
}

/**
 * Distill across EVERY sales source at once, one quote per source.
 *
 * Sources stay separate rather than being pooled into a single median: they
 * have different coverage, different freshness and different licences, and the
 * card page shows each one so a disagreement between them is visible instead of
 * averaged away. The blend sits above this.
 */
export function distillBySource(
  bySource: { source: string; sales: ObservedSale[] }[],
  card: CardForPricing,
): SourceQuote[] {
  return bySource
    .map(({ source, sales }) => distill(sales, card, source).quote)
    .filter((q): q is SourceQuote => q !== null);
}

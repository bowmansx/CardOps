// ONE REALIZED SALE, in CardOps' own terms (2026-07-29).
//
// Beau: "we don't specifically want to build around any one api too much, do
// we? i would think we want a platform that is ready to connect to any apis
// collectively"
//
// He was right, and this file is the correction. `CardApiSale` — one vendor's
// wire shape, fields named the way THEY named them — had quietly become the
// internal sale type: `market-sales`, `estimate` and the price-refresh cron all
// spoke it, and the cron called that vendor's fetch function by name. Adding a
// second sales source would have meant either translating into a competitor's
// field names or forking every consumer.
//
// The quote side never had this problem — `SourceQuote` has always been our
// shape and adapters normalize into it. Sales simply never got the same
// treatment. `ObservedSale` is that shape, and the boundary is:
//
//   vendor wire format  →  [adapter]  →  ObservedSale  →  everything else
//
// WHAT AN ADAPTER MUST DECIDE, because only it can:
//
//   - `priceBasis`. Whether a Goldin row arrives as a hammer price or already
//     all-in is a fact about the VENDOR, not about Goldin — one may normalize,
//     another may not. The adapter stamps it. What the premium actually IS
//     (~22%, ~20% pre-2022) is a fact about the auction house and lives once,
//     in `price-basis`.
//   - `confirmed`. Every source has some notion of a provisional figure; only
//     the adapter knows which field carries it.
//   - `isGraded`. Sources that can answer this properly should; sources that
//     cannot must say null rather than let a downstream guess be made from a
//     sparsely-populated grader field.
//
// A PASTE IS A SOURCE TOO. This shape deliberately says nothing about HTTP. A
// Terapeak paste parser, a Seller Hub CSV upload, or an auction house's
// prices-realized export produces `ObservedSale[]` exactly like an API does,
// and every consumer downstream is already written for it.
import type { PriceBasis } from "./price-basis";

export type ObservedSale = {
  /**
   * Stable and unique WITHIN a source — the dedup key across daily runs.
   * A vendor's own sale id where there is one; a hash of the identifying
   * fields where there isn't.
   */
  externalId: string;
  price: number;
  currency: string;
  /** What `price` includes. The adapter stamps this; see the note above. */
  priceBasis: PriceBasis;
  /** YYYY-MM-DD, or null when the source didn't say. */
  soldAt: string | null;
  /** Marketplace or auction house the sale happened on. */
  platform: string | null;
  title: string | null;
  /** Back to the actual listing — the tap-through behind a provenance chip. */
  url: string | null;
  grader: string | null;
  grade: number | null;
  /**
   * Graded or raw, where the source can genuinely state it.
   *
   * NULL MEANS UNKNOWN AND MUST STAY NULL. The Card API populates `grader` on
   * ~12% of records, so "no grader" is overwhelmingly "not extracted" rather
   * than "ungraded" — collapsing that to false counts graded sales as raw comps
   * and inflates every ungraded valuation.
   */
  isGraded: boolean | null;
  /**
   * False for a provisional figure the source expects to revise.
   *
   * Such a sale must not be stored: the accumulator upserts with
   * `ignoreDuplicates`, so a provisional price written once is never corrected.
   * Adapters default this to true only where the source has no such concept.
   */
  confirmed: boolean;
};

export type SalesResult = {
  sales: ObservedSale[];
  /**
   * Ran cleanly. False on a transient error — which must never be read as
   * "this card has no sales", because that wipes a good prior answer.
   */
  ok: boolean;
  /**
   * The source had more than we asked for. Surfaced, never swallowed: a capped
   * read that reports nothing reads as "covered everything" (rule 10).
   */
  truncated?: boolean;
  note?: string;
};

/** Options every sales-capable source understands. */
export type SalesQuery = {
  limit?: number;
  /** Ignore the card's own condition and return every grade. */
  allGrades?: boolean;
};

/**
 * Which lane a sale arrived through. Mirrors the `card_sale_provenance` enum in
 * migration 20260750.
 *
 * Not cosmetic: eBay's licence forbids blending API-pulled order data into a
 * comp shown to another user, and its own carve-out is "information that you
 * lawfully obtain independent of eBay". A cross-tenant pool may draw on some of
 * these lanes and not others, and the database enforces it with a CHECK because
 * a boundary that lives in a query gets rewritten by someone who doesn't know
 * it was load-bearing.
 */
export type SaleProvenance = "vendor" | "own_sale" | "user_upload" | "manual_paste";

/** Newest first, undated last — undated sales can't be ordered against dated ones. */
export function byNewest(a: ObservedSale, b: ObservedSale): number {
  if (!a.soldAt && !b.soldAt) return 0;
  if (!a.soldAt) return 1;
  if (!b.soldAt) return -1;
  return b.soldAt.localeCompare(a.soldAt);
}

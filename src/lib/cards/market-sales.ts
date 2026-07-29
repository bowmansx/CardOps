// Observed-sales history (Beau, 2026-07-23). Turns normalized sales into
// dedup-keyed rows we accumulate in card_market_sales, and builds a
// price-over-time series for the card graph. Pure — no I/O.
//
// Speaks `ObservedSale`, not any one vendor's wire format (2026-07-29). This
// file used to be typed against `CardApiSale`, which meant a second sales
// source would have had to translate into a competitor's field names to be
// stored. See `observed-sale.ts` for the boundary.
import type { ObservedSale } from "./observed-sale";
import { mayPersist, basisForSource } from "./price-sources";
import { toAllIn, type PriceBasis } from "./price-basis";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type MarketSaleRow = {
  // Sales belong to the shared card IDENTITY, not to one owner's copy — that's
  // what lets every owner of the same card share one accumulated history (and
  // one vendor fetch). card_id is provenance only: which copy first caused the
  // fetch. It is nullable and no longer cascades, so deleting a card can't
  // destroy history other owners depend on.
  identity_id: string;
  card_id: string | null;
  source: string;
  external_id: string;
  title: string | null;
  price: number;
  currency: string;
  grader: string | null;
  grade: number | null;
  platform: string | null;
  sold_at: string | null;
};

export function saleToRow(
  identityId: string, cardId: string | null, s: ObservedSale, source: string,
): MarketSaleRow | null {
  if (!Number.isFinite(s.price) || s.price <= 0) return null;
  // A fast-settle estimate is not a realized sale. It must not be stored: the
  // accumulator upserts with ignoreDuplicates, so a provisional number written
  // once is never corrected — it would sit in the shared history at the wrong
  // price permanently.
  if (!s.confirmed) return null;
  return {
    identity_id: identityId, card_id: cardId, source, external_id: s.externalId,
    title: s.title, price: round2(s.price), currency: s.currency,
    grader: s.grader, grade: s.grade, platform: s.platform, sold_at: s.soldAt,
  };
}

export type RowBatch = {
  rows: MarketSaleRow[];
  /**
   * Set when the SOURCE itself may not be stored — its licence permits live
   * display only. Rows is empty in that case and the caller must say so; a
   * silent empty batch reads exactly like "the vendor had no sales".
   */
  refusedSource: string | null;
  /** Provisional prices held back, to be picked up once the source settles them. */
  unconfirmed: number;
};

/**
 * Turn a source's sales into storable rows — CONSULTING THE LICENCE FIRST.
 *
 * The persist decision is structural rather than remembered. A display-only
 * source (permits showing a sale inside your product, forbids storing it "for
 * the purposes of creating or populating a database") can be wired in as a live
 * source and cannot reach this table, whoever writes the next accumulator.
 */
export function salesToRows(
  identityId: string, cardId: string | null, sales: ObservedSale[], source: string,
): RowBatch {
  if (!mayPersist(source)) return { rows: [], refusedSource: source, unconfirmed: 0 };

  const rows: MarketSaleRow[] = [];
  const seen = new Set<string>();
  let unconfirmed = 0;
  for (const s of sales) {
    if (!s.confirmed) { unconfirmed++; continue; }
    const r = saleToRow(identityId, cardId, s, source);
    if (r && !seen.has(r.external_id)) { seen.add(r.external_id); rows.push(r); } // in-batch dedup too
  }
  return { rows, refusedSource: null, unconfirmed };
}

// card_market_sales rows → the shape every consumer reads.
export type StoredSale = {
  price: number | string;
  sold_at: string | null;
  grader: string | null;
  grade: number | null;
  platform: string | null;
  title: string | null;
  source?: string | null;
  external_id?: string | null;
  /** Post-migration column; absent on rows written before it existed. */
  price_basis?: PriceBasis | null;
  /** Post-migration column; null means genuinely unknown, never false. */
  is_graded?: boolean | null;
};

/**
 * Rehydrate stored rows into `ObservedSale`.
 *
 * Basis comes from the stored column where the row has one, and otherwise from
 * the SOURCE THAT FETCHED IT — asking that adapter how it reports the venue,
 * rather than consulting a global table that would be wrong for whichever
 * vendor disagrees. A row with neither resolves to "unknown" and is excluded
 * from medians rather than assumed all-in.
 *
 * `confirmed` is true because an unconfirmed sale is never stored in the first
 * place, so anything read back has already passed that gate.
 */
export function storedToSales(rows: StoredSale[]): ObservedSale[] {
  return rows.map((r) => {
    const source = r.source ?? "thecardapi";
    return {
      externalId: r.external_id ?? `${r.sold_at ?? "x"}:${Number(r.price)}:${String(r.title ?? "").slice(0, 48)}`,
      price: Number(r.price),
      currency: "USD",
      priceBasis: r.price_basis ?? basisForSource(source, r.platform),
      soldAt: r.sold_at,
      platform: r.platform,
      title: r.title,
      url: null,
      grader: r.grader,
      grade: r.grade,
      isGraded: r.is_graded ?? null,
      confirmed: true,
    };
  });
}

// Collapse sales into one point per day (median of that day) for a clean line graph.
//
// Normalized to ALL-IN first, for the same reason a quote is: a day whose sales
// happened to come from Goldin plotted ~22% below a neighbouring eBay day, which
// reads as a price movement that never happened. Sales whose basis can't be
// resolved are excluded, and the count is returned so a thinned graph can say so
// rather than implying it plotted everything.
export type HistoryPoint = { date: string; price: number; n: number };
export type HistorySeries = {
  points: HistoryPoint[];
  /** Dated sales dropped because their price basis couldn't be resolved. */
  excluded: number;
};

export function dailyMedianSeries(sales: ObservedSale[]): HistorySeries {
  const byDay = new Map<string, number[]>();
  let excluded = 0;
  for (const s of sales) {
    if (!s.soldAt) continue;
    const d = s.soldAt.slice(0, 10);
    const n = toAllIn(s.price, s.priceBasis, s.platform, s.soldAt);
    // A junk price was never plotted and isn't an exclusion worth reporting;
    // a real sale we can't put on a common footing is.
    if (!n.ok) { if (n.reason !== "bad_price") excluded++; continue; }
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(n.price);
  }
  const points = [...byDay.entries()]
    .map(([date, ps]) => {
      const s = [...ps].sort((a, b) => a - b);
      const m = s.length >> 1;
      return { date, price: round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2), n: s.length };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return { points, excluded };
}

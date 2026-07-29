// Observed-sales history (Beau, 2026-07-23). Turns the Card API's raw sales into
// dedup-keyed rows we accumulate in card_market_sales, and builds a price-over-time
// series for the card graph. Pure — no I/O.
import type { CardApiSale } from "./price-sources/thecardapi";
import { mayPersist } from "./price-sources";
import { toAllIn } from "./price-basis";

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

function saleDate(s: CardApiSale): string | null {
  const raw = String(s.sold_at ?? s.sale_date ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

// A stable dedup key: the platform sale id if present, else a hash of the sale's
// identifying fields (so the same sale isn't stored twice across daily runs).
export function saleKey(s: CardApiSale): string {
  if (s.id) return String(s.id);
  return `${saleDate(s) ?? "x"}:${Number(s.price)}:${String(s.title ?? "").slice(0, 48)}`;
}

export function saleToRow(
  identityId: string, cardId: string | null, s: CardApiSale, source = "thecardapi",
): MarketSaleRow | null {
  const price = Number(s.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  // A fast-settle estimate is not a realized sale. It must not be stored: the
  // accumulator upserts with ignoreDuplicates, so a provisional number written
  // once is never corrected — it would sit in the shared history at the wrong
  // price permanently. Only an explicit false is provisional.
  if (s.price_confirmed === false) return null;
  const grade = s.grade != null && Number.isFinite(Number(s.grade)) ? Number(s.grade) : null;
  return {
    identity_id: identityId, card_id: cardId, source, external_id: saleKey(s), title: s.title ?? null,
    price: round2(price), currency: (s.currency as string) ?? "USD",
    grader: (s.grader as string | null) ?? null, grade, platform: s.platform ?? null, sold_at: saleDate(s),
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
  /** Provisional prices held back, to be picked up once the vendor settles them. */
  unconfirmed: number;
};

/**
 * Turn a vendor's sales into storable rows — CONSULTING THE LICENCE FIRST.
 *
 * The persist decision is structural rather than remembered. A display-only
 * vendor (permits showing a sale inside your product, forbids storing it "for
 * the purposes of creating or populating a database") can be wired in as a live
 * source and cannot reach this table, whoever writes the next accumulator.
 */
export function salesToRows(
  identityId: string, cardId: string | null, sales: CardApiSale[], source = "thecardapi",
): RowBatch {
  if (!mayPersist(source)) return { rows: [], refusedSource: source, unconfirmed: 0 };

  const rows: MarketSaleRow[] = [];
  const seen = new Set<string>();
  let unconfirmed = 0;
  for (const s of sales) {
    if (s.price_confirmed === false) { unconfirmed++; continue; }
    const r = saleToRow(identityId, cardId, s, source);
    if (r && !seen.has(r.external_id)) { seen.add(r.external_id); rows.push(r); } // in-batch dedup too
  }
  return { rows, refusedSource: null, unconfirmed };
}

// card_market_sales rows → the CardApiSale shape the estimate/summarize helpers read.
export type StoredSale = { price: number | string; sold_at: string | null; grader: string | null; grade: number | null; platform: string | null; title: string | null };
export function storedToSales(rows: StoredSale[]): CardApiSale[] {
  return rows.map((r) => ({ price: r.price, sold_at: r.sold_at, sale_date: r.sold_at, grader: r.grader, grade: r.grade, platform: r.platform, title: r.title }));
}

// Collapse sales into one point per day (median of that day) for a clean line graph.
//
// Normalized to ALL-IN first, for the same reason the quote is: a day whose
// sales happened to come from Goldin plotted ~22% below a neighbouring eBay day,
// which reads as a price movement that never happened. Sales whose basis is
// undocumented are excluded, and the count of excluded rows is returned so a
// thinned graph can say so rather than implying it plotted everything.
export type HistoryPoint = { date: string; price: number; n: number };
export type HistorySeries = {
  points: HistoryPoint[];
  /** Dated sales dropped because their price basis is undocumented. */
  excluded: number;
};

/**
 * `platform` is REQUIRED, not optional, and that is deliberate. Making it
 * optional let a caller map `{ sold_at, price }` and get a silently empty
 * series, because a missing platform resolves to an unknown basis and every row
 * drops. Requiring it turns that into a compile error at the call site — which
 * is exactly how it was caught here.
 */
export function dailyMedianSeries(
  rows: { sold_at: string | null; price: number | string; platform: string | null }[],
): HistorySeries {
  const byDay = new Map<string, number[]>();
  let excluded = 0;
  for (const r of rows) {
    const d = r.sold_at ? String(r.sold_at).slice(0, 10) : null;
    if (!d) continue;
    const n = toAllIn(Number(r.price), r.platform, r.sold_at);
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

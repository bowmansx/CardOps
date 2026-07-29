// The Card API adapter (Beau, 2026-07-21) — realized SOLD sales aggregated across
// eBay, TCGplayer, Goldin, etc. This is the "base it off eBay's prices" source.
// Free tier: 5,000 records/day, 3-day lookback. Activates when THECARDAPI_TOKEN is
// set. Covers every card (sports + TCG), so it's the broad market feed.
//   docs: https://thecardapi.com/docs  ·  GET /api/v1/market/sales
import type { PriceSourceAdapter, SourceQuote, CardForPricing, AdapterResult } from "./types";
import { partitionByBasis, exclusionNote } from "../price-basis";

const BASE = "https://thecardapi.com/api/v1/market";

// One raw sale row from GET /sales (the fields we use).
export type CardApiSale = {
  id?: string;
  platform?: string | null;
  title?: string | null;
  sold_at?: string | null;
  sale_date?: string | null;
  price?: number | string | null;
  currency?: string | null;
  grader?: string | null;
  grade?: string | number | null;
  listing_url?: string | null;
  /**
   * Vendor field: "true = confirmed final price. false = fast-settle estimate
   * (auction BIN/BO, updated to true within minutes once confirmed)."
   *
   * We were ignoring it, so an unsettled estimate was medianed as though it
   * were a realized sale. Worse for storage: the accumulator upserts with
   * `ignoreDuplicates: true`, so an unconfirmed price written once would never
   * be corrected — it would sit in the shared history at the wrong number
   * forever. Unconfirmed sales are therefore not stored at all; a later run
   * picks them up once the vendor has settled them.
   *
   * Absent on older/other payloads, so `undefined` is treated as confirmed —
   * only an explicit `false` is a fast-settle estimate.
   */
  price_confirmed?: boolean | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Build the full-text query for a card from its identifying fields.
export function saleQuery(card: CardForPricing): string {
  return [card.year, card.set_name, card.player, card.parallel, card.card_number]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
}

/**
 * Distill raw sales into ONE market quote matching the card's condition:
 *   graded → sales at the same grader (and grade, when known); median of those
 *   raw    → sales with no grader; median of those
 * The blend then medians this across sources. Returns [] when nothing matches.
 * Pure — unit-tested; the fetch wrapper does the I/O.
 *
 * Every price is converted to ALL-IN before it is medianed. See `price-basis`:
 * eBay quotes what the buyer paid, Goldin quotes the hammer with a ~22% premium
 * still to come, and the median used to blend the two as though they were the
 * same number. Sales whose basis is undocumented are dropped rather than
 * guessed, and the drop is reported.
 */
export function distillSales(sales: CardApiSale[], card: CardForPricing): SourceQuote[] {
  const graded = card.condition_type === "graded";
  const priced = sales
    .map((s) => ({ ...s, p: Number(s.price) }))
    // A fast-settle estimate is not a realized sale (see `price_confirmed`).
    .filter((s) => Number.isFinite(s.p) && s.p > 0 && s.price_confirmed !== false);

  // STRICT condition match — never blend across graders or grades. A graded card
  // is priced only off sales at the SAME grader and (when we know it) the SAME
  // grade; a raw card only off ungraded sales. No exact match → NO quote (an
  // honest "no comp at this grade" beats a wrong-grade price).
  //
  // CAVEAT for raw cards, and it is a real one. The vendor populates `grader`
  // on only ~12% of records, so "no grader" is mostly "not extracted" rather
  // than "ungraded" — treating absence as proof of raw sweeps graded sales into
  // a raw card's comps and pushes the value up. The live fetch now asks the API
  // for `graded=false`, which filters server-side on signals we don't have; that
  // covers the fetch path. Sales replayed out of `card_market_sales` predate
  // that flag and are NOT distinguishable, which is why the migration adds a
  // stored graded column.
  const matched = priced.filter((s) => {
    const hasGrader = !!(s.grader && String(s.grader).trim());
    if (!graded) return !hasGrader; // raw card → ungraded sales only
    if (!hasGrader) return false; // graded card → graded sales only
    if (card.grader && String(s.grader).toUpperCase() !== card.grader.toUpperCase()) return false;
    if (card.grade != null && Number(s.grade) !== card.grade) return false;
    return true;
  });
  if (matched.length === 0) return [];

  // Put every surviving sale on the same footing before taking a median.
  const { usable, excluded } = partitionByBasis(matched);
  if (usable.length === 0) return [];

  const recent = [...usable].sort((a, b) => String(b.sold_at ?? b.sale_date ?? "").localeCompare(String(a.sold_at ?? a.sale_date ?? "")));
  const value = round2(median(usable.map((s) => s.allIn)));
  const gradeLabel = graded ? `${card.grader ?? "Graded"}${card.grade != null ? " " + card.grade : ""}` : "Ungraded";
  // Keep a sample of the exact sales behind the median so it can be inspected /
  // audited on the card page ("show me why this price"). Both numbers are kept:
  // `price` is what the vendor reported, `allIn` is what went into the median,
  // so a converted hammer price is visible as a conversion rather than as a
  // figure that silently disagrees with the source listing.
  const sample = recent.slice(0, 6).map((s) => ({
    title: s.title ?? null, price: s.p, allIn: s.allIn, converted: s.converted,
    grader: s.grader ?? null, grade: s.grade ?? null,
    platform: s.platform ?? null, sold_at: s.sold_at ?? s.sale_date ?? null, url: s.listing_url ?? null,
  }));
  return [{
    source: "thecardapi",
    kind: "sold",
    grader: graded ? card.grader ?? null : null,
    grade: graded ? card.grade ?? null : null,
    price: value,
    currency: (recent[0]?.currency as string) ?? "USD",
    label: `${gradeLabel} · median of ${usable.length}`,
    url: recent[0]?.listing_url ?? null,
    product_ref: null,
    payload: {
      count: usable.length,
      platforms: [...new Set(usable.map((s) => s.platform).filter(Boolean))],
      sample,
      // Surfaced, never silent: a comp set thinned by unconvertible prices must
      // not look like a complete one (rules 4 and 10).
      ...(excluded.length ? { excluded: excluded.length, exclusionNote: exclusionNote(excluded) } : {}),
    },
  }];
}

// Raw-sales fetch for the ESTIMATE engine (the adapter only returns a distilled
// quote; estimates reason over the underlying sales). allGrades=true pulls every
// grade (Estimate B wants the whole picture).
export async function fetchCardApiSales(
  card: CardForPricing,
  opts: { limit?: number; allGrades?: boolean } = {},
): Promise<{ sales: CardApiSale[]; ok: boolean; note?: string }> {
  const token = process.env.THECARDAPI_TOKEN;
  if (!token) return { sales: [], ok: false, note: "no THECARDAPI_TOKEN set" };
  const q = saleQuery(card);
  if (!q) return { sales: [], ok: true, note: "no fields to search on" };
  const params = new URLSearchParams({ q, limit: String(Math.min(Math.max(opts.limit ?? 40, 1), 200)) });
  if (!opts.allGrades && card.condition_type === "graded" && card.grader) params.set("grader", card.grader);
  if (!opts.allGrades && card.condition_type === "graded" && card.grade != null) params.set("grade", String(card.grade));
  // Ask the vendor to decide graded-vs-raw. Their `graded` filter "works on
  // every platform" and doesn't depend on the sparse `grader` field we get back
  // (~12% populated) — inferring raw from a missing grader counts graded sales
  // as raw comps and inflates ungraded values.
  if (!opts.allGrades) params.set("graded", card.condition_type === "graded" ? "true" : "false");
  return runQuery(token, params);
}

// Fetch sales by a free-text query (comparables — e.g. the same parallel for other
// players, or the player's broader market).
export async function fetchCardApiByQuery(q: string, limit = 12): Promise<CardApiSale[]> {
  const token = process.env.THECARDAPI_TOKEN;
  const query = q.trim().slice(0, 200);
  if (!token || !query) return [];
  const { sales } = await runQuery(token, new URLSearchParams({ q: query, limit: String(Math.min(Math.max(limit, 1), 50)) }));
  return sales;
}

async function runQuery(token: string, params: URLSearchParams): Promise<{ sales: CardApiSale[]; ok: boolean; note?: string }> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/sales?${params.toString()}`, { headers: { "x-market-api-key": token, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    return { sales: [], ok: false, note: e instanceof Error ? e.message : "network error" };
  }
  if (r.status === 429 || r.status >= 500) return { sales: [], ok: false, note: `HTTP ${r.status}` };
  if (!r.ok) return { sales: [], ok: true, note: `HTTP ${r.status}` };
  const d = (await r.json().catch(() => null)) as { data?: CardApiSale[] } | null;
  return { sales: d?.data ?? [], ok: true };
}

export const thecardapi: PriceSourceAdapter = {
  id: "thecardapi",
  label: "The Card API · sold",
  enabled: () => !!process.env.THECARDAPI_TOKEN,
  handles: () => true, // broad sold-sales aggregator: sports + TCG

  // Terms of Service §4a (Thompson Data Products, LLC, last updated July 2026),
  // read 2026-07-29. Explicitly permitted on any PAID plan: "Building and
  // operating commercial applications, SaaS products...", "Caching and storing
  // API responses locally in your own database to serve your users", and
  // "Displaying card prices, transaction history, and market data within your
  // own product interface". Derived analytics are stated to be our IP.
  //
  // POOL IS FALSE, and not because of this licence. §4 forbids re-exposing the
  // records "as a standalone dataset or competing data product" — storing them
  // against a shared identity so every owner of that card sees them is the
  // permitted caching case, not that. It is false because a cross-tenant pool
  // is a different decision with a different legal question behind it (whether
  // user-supplied marketplace exports fall outside "eBay Content"), and that
  // question is unanswered. Defaulting it to true would answer it by accident.
  //
  // NOTE the free tier is NOT covered by any of the above: §4a ends "Free tier
  // usage is limited to personal, non-commercial, and evaluation purposes
  // only" and §5 allows it "no persistent local storage of API responses".
  // These rights describe a paid plan; on the free tier the app is storing
  // rows it is not entitled to store.
  rights: {
    persist: true,
    redisplay: true,
    pool: false,
    attribution: "The Card API",
    deleteOnTerminationDays: 30, // §5, on cancellation or termination
  },

  async fetch(card: CardForPricing): Promise<AdapterResult> {
    const token = process.env.THECARDAPI_TOKEN;
    if (!token) return { quotes: [], ok: false, matched: false, note: "no THECARDAPI_TOKEN set" };
    const q = saleQuery(card);
    if (!q) return { quotes: [], ok: true, matched: false, note: "no fields to search on" };

    const params = new URLSearchParams({ q, limit: "20" });
    if (card.condition_type === "graded" && card.grader) params.set("grader", card.grader);
    if (card.condition_type === "graded" && card.grade != null) params.set("grade", String(card.grade));
    // Server-side graded/raw split — see fetchCardApiSales for why the returned
    // `grader` field can't be trusted to make this call.
    params.set("graded", card.condition_type === "graded" ? "true" : "false");

    let r: Response;
    try {
      r = await fetch(`${BASE}/sales?${params.toString()}`, {
        headers: { "x-market-api-key": token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { quotes: [], ok: false, matched: false, note: e instanceof Error ? e.message : "network error" };
    }
    // 429/5xx = transient (don't wipe a prior good quote); other non-OK = clean "no data".
    if (r.status === 429 || r.status >= 500) return { quotes: [], ok: false, matched: false, note: `The Card API HTTP ${r.status}` };
    if (!r.ok) return { quotes: [], ok: true, matched: false, note: `The Card API HTTP ${r.status}` };

    const d = (await r.json().catch(() => null)) as { data?: CardApiSale[] } | null;
    const sales = d?.data ?? [];
    if (!sales.length) return { quotes: [], ok: true, matched: false, note: "no recent sales matched" };

    const quotes = distillSales(sales, card);
    return { quotes, ok: true, matched: quotes.length > 0, note: quotes.length ? undefined : "sales found, but none matched the card's condition" };
  },
};

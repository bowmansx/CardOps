// The Card API adapter (Beau, 2026-07-21) — realized SOLD sales aggregated across
// eBay, TCGplayer, Goldin, etc. This is the "base it off eBay's prices" source.
// Free tier: 5,000 records/day, 3-day lookback. Activates when THECARDAPI_TOKEN is
// set. Covers every card (sports + TCG), so it's the broad market feed.
//   docs: https://thecardapi.com/docs  ·  GET /api/v1/market/sales
import type { PriceSourceAdapter, CardForPricing, AdapterResult } from "./types";
import type { PriceBasis } from "../price-basis";
import type { ObservedSale, SalesQuery, SalesResult } from "../observed-sale";
import { distill } from "../distill";

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

// WHAT THIS VENDOR'S PRICES INCLUDE, per platform.
//
// Their field reference: "For eBay: all-in buyer price. For Goldin: hammer
// price only - buyer also pays ~22% buyer's premium on top."
//
// This map is THE CARD API'S CONVENTION and belongs to this adapter, not to the
// app. Another vendor reporting the same auction house may normalize before it
// reaches us; a shared table would make one of them wrong. What the premium
// actually IS lives once, in `price-basis`, because that is a fact about the
// venue rather than about whoever reports it.
//
// Only platforms the vendor documents are listed. Lelands, SCP, Hakes and REA
// are auction houses whose basis they never state, so they resolve to "unknown"
// and their sales are excluded from medians rather than assumed all-in. A
// platform added upstream tomorrow starts excluded for the same reason.
const PLATFORM_BASIS: Record<string, PriceBasis> = {
  ebay: "all_in",
  tcgplayer: "all_in",
  goldin: "hammer",
};

function basisOf(platform: string | null | undefined): PriceBasis {
  if (!platform) return "unknown";
  return PLATFORM_BASIS[platform.trim().toLowerCase()] ?? "unknown";
}

const saleDate = (s: CardApiSale): string | null => {
  const raw = String(s.sold_at ?? s.sale_date ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};

/**
 * A stable dedup key within this source: the vendor's sale id when present,
 * else a hash of the identifying fields so the same sale isn't stored twice
 * across daily runs.
 */
export function cardApiSaleKey(s: CardApiSale): string {
  if (s.id) return String(s.id);
  return `${saleDate(s) ?? "x"}:${Number(s.price)}:${String(s.title ?? "").slice(0, 48)}`;
}

/**
 * This vendor's wire row -> CardOps' own `ObservedSale`.
 *
 * The whole point of the boundary: everything downstream - the accumulator, the
 * distill, the estimate engine - speaks our shape, so a second sales source is
 * one more mapping function rather than a fork of every consumer.
 *
 * Returns null for a row with no usable price. `isGraded` is deliberately left
 * NULL: this vendor populates `grader` on only ~12% of records, so the row
 * itself cannot answer graded-vs-raw. The fetch asks the server-side `graded`
 * filter instead, and `fetchSales` stamps the answer it asked for.
 */
export function toObserved(s: CardApiSale, isGraded: boolean | null = null): ObservedSale | null {
  const price = Number(s.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const grade = s.grade != null && Number.isFinite(Number(s.grade)) ? Number(s.grade) : null;
  return {
    externalId: cardApiSaleKey(s),
    price: Math.round(price * 100) / 100,
    currency: (s.currency as string) ?? "USD",
    priceBasis: basisOf(s.platform),
    soldAt: saleDate(s),
    platform: s.platform ?? null,
    title: s.title ?? null,
    url: s.listing_url ?? null,
    grader: (s.grader as string | null) ?? null,
    grade,
    isGraded,
    // Absent on older payloads, so only an explicit false is provisional.
    confirmed: s.price_confirmed !== false,
  };
}

/**
 * Realized sales for one card, in CardOps' shape.
 *
 * The estimate engine reasons over the underlying sales rather than a distilled
 * quote, which is why this is exposed alongside the adapter's `fetch`.
 * allGrades=true pulls every grade (Estimate B wants the whole picture).
 */
export async function fetchCardApiSales(
  card: CardForPricing,
  opts: SalesQuery = {},
): Promise<SalesResult> {
  const token = process.env.THECARDAPI_TOKEN;
  if (!token) return { sales: [], ok: false, note: "no THECARDAPI_TOKEN set" };
  const q = saleQuery(card);
  if (!q) return { sales: [], ok: true, note: "no fields to search on" };
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (!opts.allGrades && card.condition_type === "graded" && card.grader) params.set("grader", card.grader);
  if (!opts.allGrades && card.condition_type === "graded" && card.grade != null) params.set("grade", String(card.grade));
  // Ask the vendor to decide graded-vs-raw. Their `graded` filter "works on
  // every platform" and doesn't depend on the sparse `grader` field we get back
  // (~12% populated) — inferring raw from a missing grader counts graded sales
  // as raw comps and inflates ungraded values.
  //
  // We then STAMP the answer we asked for onto every row, because the rows
  // themselves can't carry it. That is only honest when we constrained the
  // query: under allGrades the result is a mix and isGraded stays null.
  const asked = opts.allGrades ? null : card.condition_type === "graded";
  if (asked !== null) params.set("graded", asked ? "true" : "false");
  return runQuery(token, params, limit, asked);
}

// Fetch sales by a free-text query (comparables — e.g. the same parallel for other
// players, or the player's broader market).
export async function fetchCardApiByQuery(q: string, limit = 12): Promise<ObservedSale[]> {
  const token = process.env.THECARDAPI_TOKEN;
  const query = q.trim().slice(0, 200);
  if (!token || !query) return [];
  const capped = Math.min(Math.max(limit, 1), 50);
  const { sales } = await runQuery(token, new URLSearchParams({ q: query, limit: String(capped) }), capped, null);
  return sales;
}

async function runQuery(
  token: string, params: URLSearchParams, limit: number, isGraded: boolean | null,
): Promise<SalesResult> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/sales?${params.toString()}`, { headers: { "x-market-api-key": token, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    return { sales: [], ok: false, note: e instanceof Error ? e.message : "network error" };
  }
  if (r.status === 429 || r.status >= 500) return { sales: [], ok: false, note: `HTTP ${r.status}` };
  if (!r.ok) return { sales: [], ok: true, note: `HTTP ${r.status}` };
  const d = (await r.json().catch(() => null)) as
    | { data?: CardApiSale[]; pagination?: { has_more?: boolean; total?: number } }
    | null;
  const raw = d?.data ?? [];
  const sales = raw.map((s) => toObserved(s, isGraded)).filter((s): s is ObservedSale => s !== null);
  return {
    sales,
    ok: true,
    // The vendor tells us when it held more back. Passing that on is the
    // difference between "these are the sales" and "these are the first N"
    // (rule 10).
    truncated: d?.pagination?.has_more === true || raw.length >= limit,
  };
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

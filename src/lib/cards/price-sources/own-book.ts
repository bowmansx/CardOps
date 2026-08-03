// YOUR OWN COMPLETED SALES, as comps (2026-07-30).
//
// The first source in the valuation engine's Phase 1, and the one that outlasts
// every vendor: zero cost, highest trust, and it compounds. Two days of research
// into who will sell us sold-card data ended with a shortlist of four; this one
// needs nobody's permission, because it is a record of transactions the user was
// a party to.
//
// WHY IT IS THE HIGHEST-TRUST SOURCE AVAILABLE, and it is not close:
//
//   - The price is SETTLED, not scraped, inferred or estimated. It is what
//     actually cleared, taken from `card_sales` where `card_sell` recorded it.
//   - The identity is EXACT. A vendor feed matches on a listing title and gets
//     the wrong parallel; this row is attached to a card whose fingerprint the
//     app itself computed.
//   - The condition is EXACT. Vendor `grader` fields are ~12% populated; here
//     the grade is whatever the card was recorded as.
//   - Accepted Best Offers are the REAL negotiated number, because the seller
//     entered it. That is the figure most public sold data hides.
//
// THE LEGAL POSITION, stated plainly because it is the whole reason this works:
// a seller is a party to their own transaction, and eBay's contract lever bites
// on "eBay Content" — data retrieved FROM eBay. A number the user typed into
// their own books is not that. This is an ABSENCE OF PROHIBITION rather than a
// grant, which is the strongest position available and not a safe harbour.
//
// POOLING IS OFF. These rows are private to the user who sold the card
// (`rights.pool: false`, and `private_to` set on every row). Turning that on is
// the Lane C decision — it needs explicit opt-in consent, a k-anonymity floor,
// and it must never carry listing titles or images. `CoStar v. Xceligent` was a
// $500M judgment and Chapter 7 over 38,489 copied photographs, not over facts.
import type { PriceSourceAdapter, CardForPricing, AdapterResult } from "./types";
import type { ObservedSale, SalesQuery, SalesResult } from "../observed-sale";
import type { PriceBasis } from "../price-basis";
import { distill } from "../distill";

/** One settled sale as `card_sales` records it. */
export type OwnSaleRow = {
  id: string;
  card_id: string;
  platform: string | null;
  sale_price: number | string | null;
  shipping_income?: number | string | null;
  sold_at: string | null;
  order_ref?: string | null;
  /** Joined from `cards` — the condition the card was in when it sold. */
  grader?: string | null;
  grade?: number | string | null;
  condition_type?: string | null;
};

/**
 * What a seller's own recorded price INCLUDES.
 *
 * `all_in` for every venue, and that is a real claim rather than a default. The
 * figure came from the seller's own settlement — the money that actually
 * arrived, before fees but after any negotiation. There is no buyer's premium
 * hiding behind it the way there is behind an auction house's published hammer
 * price, because the seller is not reading a published figure, they are
 * recording what the buyer paid them.
 *
 * The exception worth knowing: a consignment payout is NET of the consignor's
 * cut and is not the same number. If consignment sales ever land in
 * `card_sales`, they need their own basis rather than inheriting this.
 */
const OWN_BOOK_BASIS: PriceBasis = "all_in";

/**
 * A seller's own sale → `ObservedSale`.
 *
 * `isGraded` comes from the card's own condition, which is the one place in this
 * whole system where graded-vs-raw is known rather than inferred. Every vendor
 * feed leaves it null because their grader field is sparse; here the app
 * recorded it at intake.
 */
export function ownSaleToObserved(row: OwnSaleRow): ObservedSale | null {
  const price = Number(row.sale_price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const soldAt = row.sold_at ? String(row.sold_at).slice(0, 10) : null;
  const grade = row.grade != null && Number.isFinite(Number(row.grade)) ? Number(row.grade) : null;
  const graded = row.condition_type === "graded";

  return {
    // The sale's own id. Stable, unique, and it means a re-read can never
    // double-count a sale the way a hashed key might.
    externalId: `own:${row.id}`,
    price: Math.round(price * 100) / 100,
    currency: "USD",
    priceBasis: OWN_BOOK_BASIS,
    soldAt,
    platform: row.platform,
    // NO LISTING TITLE. Deliberate: if these rows are ever pooled, facts travel
    // and expression does not, and a title is the seller's own copy. Keeping the
    // field null from the start means the pooling decision never has to be
    // retrofitted through stored data.
    title: null,
    url: null,
    grader: graded ? row.grader ?? null : null,
    grade: graded ? grade : null,
    // KNOWN, not inferred — the one source that can say this for certain.
    isGraded: graded,
    // A recorded sale has already settled. There is no provisional state.
    confirmed: true,
  };
}

export function ownSalesToObserved(rows: OwnSaleRow[]): ObservedSale[] {
  const out: ObservedSale[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const o = ownSaleToObserved(r);
    if (o && !seen.has(o.externalId)) { seen.add(o.externalId); out.push(o); }
  }
  return out;
}

/**
 * The rows this source would want for a card, as a query descriptor.
 *
 * Returned rather than executed because this module stays pure — the caller owns
 * the Supabase client and the RLS context. A source that did its own I/O here
 * would also have to know whether it was running as a user or as the service
 * role, and getting that wrong is the first of the two recurring bug classes.
 */
export function ownBookQuery(card: CardForPricing): { identityScoped: boolean; cardId: string } {
  return { identityScoped: true, cardId: card.id };
}

/**
 * The adapter.
 *
 * `fetchSales` is deliberately absent: this source has nothing to FETCH. Its
 * data is already in the database, and the orchestrator reads it directly rather
 * than round-tripping through an adapter that would only be able to return what
 * the caller already had. `salesBasis` is present so stored own-book rows can
 * still be classified.
 *
 * It stays in the registry because `mayPersist` and `sourceRights` are keyed on
 * source id, and a source absent from the registry DEFAULT-DENIES — own-book
 * rows would be silently refused at the write path.
 */
export const ownBook: PriceSourceAdapter = {
  id: "own-book",
  label: "Your own sales",
  // Always available. There is no key, no quota, and no vendor to be down.
  enabled: () => true,
  handles: () => true,

  rights: {
    persist: true,
    redisplay: true,
    // OFF until Lane C is decided. See the header: pooling these needs opt-in
    // consent, a k-anonymity floor, and a guarantee that no title or image
    // travels with them.
    pool: false,
    attribution: null,
    deleteOnTerminationDays: null,
  },

  salesBasis: () => OWN_BOOK_BASIS,

  // No vendor to call. The orchestrator supplies these rows from the database;
  // this exists so the source is a first-class citizen of the registry rather
  // than a special case every consumer has to remember.
  async fetch(): Promise<AdapterResult> {
    return { quotes: [], ok: true, matched: false, note: "own-book is read from the database, not fetched" };
  },
};

/**
 * Distill a user's own sales into a quote for this card.
 *
 * Separate from the adapter because the rows arrive from the caller. Same
 * strict condition matching and all-in normalization as every other source —
 * own-book gets no exemption from the rules, it just starts from better data.
 */
export function distillOwnBook(rows: OwnSaleRow[], card: CardForPricing) {
  return distill(ownSalesToObserved(rows), card, "own-book");
}

/** Options accepted by the orchestrator when it reads own-book rows. */
export type OwnBookQuery = SalesQuery & { sinceDays?: number };

/** Shape-compatible with `SalesResult`, for callers that treat sources alike. */
export function ownBookResult(rows: OwnSaleRow[]): SalesResult {
  return { sales: ownSalesToObserved(rows), ok: true };
}

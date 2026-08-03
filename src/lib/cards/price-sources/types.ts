// Multi-source pricing (Beau, 2026-07-20). A "source quote" is one vendor's
// CURRENT value for a card at some grade — NOT a realized sale (that's a comp).
// Each adapter normalizes its vendor's response into SourceQuote[]; the card
// page shows every source separately and a blended consensus on top.
import type { SalesQuery, SalesResult } from "../observed-sale";
import type { PriceBasis } from "../price-basis";

export type SourceQuote = {
  source: string;              // adapter id, e.g. 'pricecharting'
  kind: "guide" | "sold";      // vendor guide value vs a realized sale
  grader: string | null;       // null = raw / ungraded
  grade: number | null;
  price: number;
  currency: string;
  label: string;               // human tag: 'Ungraded', 'PSA 10', 'Ungraded · foil'
  url?: string | null;
  product_ref?: string | null; // vendor product id
  payload?: unknown;
};

// The slice of a card an adapter needs to build a query. Kept minimal so both
// the refresh route and any batch job can pass a plain row.
export type CardForPricing = {
  id: string;
  player: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  parallel: string | null;
  sport_category: string | null;
  grader: string | null;
  grade: number | null;
  condition_type: string;
};

export type AdapterResult = {
  quotes: SourceQuote[];
  // ran cleanly (safe to REPLACE this source's stored quotes). false on a
  // transient error — a 429/5xx must never wipe a previously-good quote.
  ok: boolean;
  matched?: boolean;
  note?: string;
};

/**
 * What a vendor's licence actually PERMITS — carried in code, not in a comment.
 *
 * Every source here is governed by different terms, and the differences are
 * load-bearing rather than academic:
 *
 *   - The Card API §4a permits storing responses "to serve your users" and
 *     displaying "card prices, transaction history, and market data within your
 *     own product interface". Persist and re-display: yes.
 *   - PriceCharting's licence is internal-use-only. Beau looking at a value is
 *     what it contemplates; a friend's screen showing that value is not, free
 *     or not. Re-display: no, until a redistribution licence exists.
 *   - Display-only vendors exist (CardSight permits showing a sale inside an end
 *     user application but forbids storing it "for the purposes of creating or
 *     populating a database"). Those must be usable live and unable to write.
 *
 * Declaring it this way makes the write path consult the licence instead of a
 * developer remembering it, so adding a vendor is a config change rather than a
 * legal re-read of the whole codebase.
 */
export type SourceRights = {
  /** May rows from this source be written to card_market_sales at all? */
  persist: boolean;
  /** May an individual sale be shown to an end user as evidence for a price? */
  redisplay: boolean;
  /**
   * May rows be shown to a user OTHER than the one whose fetch produced them?
   *
   * TRUE HERE IS NECESSARY BUT NOT SUFFICIENT. Poolability is not a property of
   * a source at all — it is a property of (source, WHOSE CREDENTIAL paid for the
   * call), and this field can only speak to the first half. The Card API on
   * CardOps' own key may be pooled, because §4a licenses storing responses "to
   * serve your users", plural. THE SAME ADAPTER ON A USER'S OWN KEY MAY NOT: that
   * licence is theirs, and showing what their key retrieved to a different tenant
   * is CardOps redistributing under someone else's subscription.
   *
   * `mayPoolFrom(source, credential)` is the real answer. This is one input to it.
   *
   * Separate from `persist` on purpose: storing a sale against a shared identity
   * so every owner of that card sees it is ordinary caching; blending users' own
   * marketplace data into a comp shown to someone else is a pool, and eBay's
   * licence forbids exactly that — it anticipates the consent argument by name:
   * "Notwithstanding Your Users' access to and use of their own information...".
   */
  pool: boolean;
  /**
   * Attribution that must render wherever this data appears, if any.
   *
   * NOT decorative. PriceCharting's terms make citation part of the permission
   * itself — price data may be referenced "provided that PriceCharting is
   * clearly cited as the source, and a visible hyperlink to PriceCharting is
   * included". An attribution declared here and never rendered is a licence
   * condition the app claims to meet and does not.
   */
  attribution: string | null;
  /** Where the visible hyperlink should point. Null when text alone suffices. */
  attributionUrl?: string | null;
  /**
   * Days after the subscription ends within which stored rows must be deleted.
   * The Card API §5 says 30. An obligation nobody can execute is an obligation
   * nobody meets — this is why stored rows carry their source.
   */
  deleteOnTerminationDays: number | null;
};

export type PriceSourceAdapter = {
  id: string;
  label: string;
  /** Configured/available in this environment (e.g. a token is set)? */
  enabled: () => boolean;
  /** Does this source even cover this card (category gate)? */
  handles: (card: CardForPricing) => boolean;
  fetch: (card: CardForPricing) => Promise<AdapterResult>;
  /** What this vendor's terms permit. Required — there is no safe default. */
  rights: SourceRights;
  /**
   * OPTIONAL: sources that supply realized SALES, not just current values.
   *
   * Separate from `fetch` because they are different kinds of answer. A guide
   * value is one number a vendor asserts today; a sale is a transaction that
   * happened, with a date, a venue and a price whose basis has to be stated.
   * PriceCharting and Scryfall have the first and not the second.
   *
   * Any source implementing this is picked up automatically by the accumulator
   * and the distill — including ones that aren't APIs at all. A Terapeak paste
   * parser or a Seller Hub CSV upload satisfies this signature just as well as
   * an HTTP client does.
   */
  fetchSales?: (card: CardForPricing, opts?: SalesQuery) => Promise<SalesResult>;
  /**
   * How THIS source reports a given venue's prices — hammer, all-in, or unknown.
   *
   * Exposed so a row already sitting in `card_market_sales` can be classified by
   * the source that fetched it, rather than by a global table that would be
   * wrong for whichever vendor disagrees. Sources with no sales omit it, and an
   * unrecognised source resolves to "unknown" — excluded from medians rather
   * than assumed.
   */
  salesBasis?: (platform: string | null) => PriceBasis;
};

/** Sources whose licence permits writing their rows to card_market_sales. */
export function canPersist(a: Pick<PriceSourceAdapter, "rights">): boolean {
  return a.rights.persist;
}

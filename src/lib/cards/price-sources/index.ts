import { pricecharting } from "./pricecharting";
import { scryfall } from "./scryfall";
import { thecardapi } from "./thecardapi";
import { ownBook } from "./own-book";
import type { CardForPricing, PriceSourceAdapter, SourceRights } from "./types";
import type { PriceBasis } from "../price-basis";
import { manualSource } from "./manual";

// The registry, in display order. Add a new vendor by dropping an adapter file
// here — the refresh route and the card page pick it up automatically.
// OWN-BOOK FIRST, and the order is the cost order. The orchestrator walks this
// list cheapest-first and stops when the evidence is sufficient, so a card with
// three of the user's own settled sales never spends a vendor call at all.
export const ADAPTERS: PriceSourceAdapter[] = [ownBook, thecardapi, pricecharting, scryfall];

/** Adapters that are BOTH configured and cover this card — the ones to run. */
export function runnableAdapters(card: CardForPricing): PriceSourceAdapter[] {
  return ADAPTERS.filter((a) => a.enabled() && a.handles(card));
}

/**
 * Sources that supply realized SALES for this card, as opposed to guide values.
 *
 * The accumulator and the distill both iterate this rather than naming a
 * vendor, so a second sales source — another API, a paste parser, a CSV
 * uploader — starts contributing the moment its adapter lands in ADAPTERS.
 */
export type SalesAdapter = PriceSourceAdapter & {
  fetchSales: NonNullable<PriceSourceAdapter["fetchSales"]>;
};
export function salesAdapters(card: CardForPricing): SalesAdapter[] {
  return runnableAdapters(card).filter((a): a is SalesAdapter => typeof a.fetchSales === "function");
}

/**
 * A source's declared licence rights, or null if the id isn't a known source.
 *
 * Looks in BOTH registries. Manual sources aren't adapters — a paste has nothing
 * to fetch — but a pasted sale is stored in the same table under the same gate,
 * so it needs the same rights lookup or `mayPersist` default-denies every paste.
 */
export function sourceRights(id: string): SourceRights | null {
  return ADAPTERS.find((a) => a.id === id)?.rights ?? manualSource(id)?.rights ?? null;
}

/**
 * May rows attributed to this source id be written to card_market_sales?
 *
 * DEFAULT-DENY. An unrecognised source id returns false rather than true,
 * because the only way to reach that branch is a source nobody has stated the
 * terms for — and "we never checked" must not read the same as "permitted".
 */
export function mayPersist(id: string): boolean {
  return sourceRights(id)?.persist ?? false;
}

/**
 * WHOSE SUBSCRIPTION PAID FOR THE CALL.
 *
 * `"platform"` — CardOps' own key, from an environment variable. Data fetched
 * this way is ours to serve to our users, where the licence says so.
 *
 * A user id — that user's own key, configured in `card_source_configs`. This is
 * what makes the whole bring-your-own model work: PriceCharting's "internal use
 * only" and every similar term blocks US REDISTRIBUTING TO A USER, and blocks
 * nothing about a user using the subscription they pay for. Move the credential
 * and the same data becomes reachable — but it stays THEIRS.
 */
export type CredentialOwner = "platform" | { userId: string };

/**
 * May a row from this fetch be shown to anyone other than the person who caused
 * it?
 *
 * Two conditions, and BOTH are required:
 *   1. the source's own terms allow it at all, and
 *   2. the call was made on CardOps' credential.
 *
 * A user's own key fails (2) however permissive the source is. That is not
 * caution — it is the difference between a user reading their own subscription
 * and CardOps redistributing it, which is the exact act every blocking licence
 * names.
 *
 * DEFAULT-DENY on an unknown source, same as `mayPersist`.
 */
export function mayPoolFrom(id: string, credential: CredentialOwner): boolean {
  if (credential !== "platform") return false;
  return sourceRights(id)?.pool ?? false;
}

/**
 * How the source that fetched a row reports that venue's prices.
 *
 * Lets a row already in `card_market_sales` be normalized without a global
 * platform table — which would be wrong for whichever vendor reports the same
 * auction house differently. Unknown source or a source with no sales resolves
 * to "unknown", so the row is excluded from medians rather than assumed.
 */
export function basisForSource(sourceId: string, platform: string | null): PriceBasis {
  const fromAdapter = ADAPTERS.find((a) => a.id === sourceId)?.salesBasis?.(platform);
  if (fromAdapter) return fromAdapter;
  // A paste has no fixed convention — the person pasting declared it at import
  // time. Once the migration lands, `price_basis` is stored per row and this
  // fallback stops mattering; until then a paste source's usual meaning is the
  // best available answer, and it is a stated default rather than a guess about
  // a platform we know nothing about.
  return manualSource(sourceId)?.defaultBasis ?? "unknown";
}

export type SourceAvailability = {
  id: string; label: string; enabled: boolean; handles: boolean;
  /**
   * Supplies realized SALES rather than only a guide value.
   *
   * The UI needs this to tell two silences apart: a sold source with no quote
   * found no comps at this card's condition, which is a fact worth stating. A
   * guide source with no quote simply didn't match.
   */
  sold: boolean;
};

/** A UI descriptor of every source and whether it's live for this card — so the
 *  panel can nudge "add a PriceCharting token" or "Scryfall covers MTG only". */
export function sourceAvailability(card: CardForPricing): SourceAvailability[] {
  return ADAPTERS.map((a) => ({
    id: a.id, label: a.label, enabled: a.enabled(), handles: a.handles(card),
    sold: typeof a.fetchSales === "function",
  }));
}

export * from "./types";
export * from "./blend";
export * from "./manual";

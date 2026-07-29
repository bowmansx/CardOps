import { pricecharting } from "./pricecharting";
import { scryfall } from "./scryfall";
import { thecardapi } from "./thecardapi";
import type { CardForPricing, PriceSourceAdapter, SourceRights } from "./types";
import type { PriceBasis } from "../price-basis";

// The registry, in display order. Add a new vendor by dropping an adapter file
// here — the refresh route and the card page pick it up automatically.
export const ADAPTERS: PriceSourceAdapter[] = [thecardapi, pricecharting, scryfall];

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

/** A source's declared licence rights, or null if the id isn't a known source. */
export function sourceRights(id: string): SourceRights | null {
  return ADAPTERS.find((a) => a.id === id)?.rights ?? null;
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
 * How the source that fetched a row reports that venue's prices.
 *
 * Lets a row already in `card_market_sales` be normalized without a global
 * platform table — which would be wrong for whichever vendor reports the same
 * auction house differently. Unknown source or a source with no sales resolves
 * to "unknown", so the row is excluded from medians rather than assumed.
 */
export function basisForSource(sourceId: string, platform: string | null): PriceBasis {
  return ADAPTERS.find((a) => a.id === sourceId)?.salesBasis?.(platform) ?? "unknown";
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

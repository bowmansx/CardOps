import { pricecharting } from "./pricecharting";
import { scryfall } from "./scryfall";
import { thecardapi } from "./thecardapi";
import type { CardForPricing, PriceSourceAdapter } from "./types";

// The registry, in display order. Add a new vendor by dropping an adapter file
// here — the refresh route and the card page pick it up automatically.
export const ADAPTERS: PriceSourceAdapter[] = [thecardapi, pricecharting, scryfall];

/** Adapters that are BOTH configured and cover this card — the ones to run. */
export function runnableAdapters(card: CardForPricing): PriceSourceAdapter[] {
  return ADAPTERS.filter((a) => a.enabled() && a.handles(card));
}

export type SourceAvailability = { id: string; label: string; enabled: boolean; handles: boolean };

/** A UI descriptor of every source and whether it's live for this card — so the
 *  panel can nudge "add a PriceCharting token" or "Scryfall covers MTG only". */
export function sourceAvailability(card: CardForPricing): SourceAvailability[] {
  return ADAPTERS.map((a) => ({ id: a.id, label: a.label, enabled: a.enabled(), handles: a.handles(card) }));
}

export * from "./types";
export * from "./blend";

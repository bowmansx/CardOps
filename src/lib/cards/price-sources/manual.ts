// MANUAL SOURCES — a person with a clipboard (2026-07-29).
//
// Deliberately NOT `PriceSourceAdapter`s. That contract requires `fetch`, and a
// paste cannot fetch: there is nothing to call, and a stub returning no quotes
// would put a permanently-empty source in the refresh loop and in the card
// page's availability list, nudging "tap Refresh to pull values" forever.
//
// But they DO need the same two things every stored sale needs:
//
//   - RIGHTS, so `mayPersist` recognises them. It default-denies an unknown
//     source id, which is correct and would otherwise silently refuse every
//     paste. A paste is the user's own transcription of a public sale — they may
//     store and re-display it. `pool` stays false: whether a user-supplied
//     export may feed a cross-tenant aggregate is the open eBay-licence question
//     ("eBay Content does not include information that you lawfully obtain
//     independent of eBay"), and it needs counsel, not a default.
//   - A BASIS CONVENTION, so a stored row can be classified later. Unlike an API
//     a paste has no fixed convention — an auction house's prices-realized page
//     is hammer and an eBay sold search is all-in — so the basis is declared per
//     paste by whoever pastes it, and this map only records what a source
//     USUALLY means as the form's default.
import type { SourceRights } from "./types";
import type { PriceBasis } from "../price-basis";

export type ManualSource = {
  id: string;
  label: string;
  /** What this source's prices usually include — the form's default, editable. */
  defaultBasis: PriceBasis;
  /** Marketplace to stamp when a paste has no platform column. */
  defaultPlatform: string | null;
  /** A hint about what to copy, shown next to the box. */
  hint: string;
  rights: SourceRights;
};

/** Every manual source shares these rights; only the label and hints differ. */
const PASTE_RIGHTS: SourceRights = {
  persist: true,
  redisplay: true,
  // The open question, not a default. See the note at the top of this file.
  pool: false,
  attribution: null,
  deleteOnTerminationDays: null,
};

export const MANUAL_SOURCES: Record<string, ManualSource> = {
  "paste-ebay": {
    id: "paste-ebay",
    label: "eBay sold search",
    defaultBasis: "all_in",
    defaultPlatform: "eBay",
    hint: "eBay prices are what the buyer paid. Include the column headings when you copy.",
  rights: PASTE_RIGHTS,
  },
  "paste-terapeak": {
    id: "paste-terapeak",
    label: "Terapeak / Seller Hub research",
    defaultBasis: "all_in",
    defaultPlatform: "eBay",
    hint: "Copy the results table with its headings. Accepted Best Offers show their real negotiated price here.",
    rights: PASTE_RIGHTS,
  },
  "paste-130point": {
    id: "paste-130point",
    label: "130point",
    defaultBasis: "all_in",
    defaultPlatform: "eBay",
    hint: "Includes accepted Best Offers, which a plain sold search hides.",
    rights: PASTE_RIGHTS,
  },
  "paste-auction": {
    id: "paste-auction",
    label: "Auction house prices realized",
    // Auction houses quote the HAMMER — the buyer's premium is on top. Getting
    // this wrong understates every one of these sales by ~20%.
    defaultBasis: "hammer",
    defaultPlatform: null,
    hint: "Hammer prices. The buyer's premium is added on top, so leave the basis set to hammer unless the page says otherwise.",
    rights: PASTE_RIGHTS,
  },
  "paste-manual": {
    id: "paste-manual",
    label: "Typed by hand",
    defaultBasis: "all_in",
    defaultPlatform: null,
    hint: "One sale per line, with a heading row: price, date, and a title.",
    rights: PASTE_RIGHTS,
  },
};

export function manualSource(id: string): ManualSource | null {
  return MANUAL_SOURCES[id.trim().toLowerCase()] ?? null;
}

export function isManualSource(id: string): boolean {
  return !!manualSource(id);
}

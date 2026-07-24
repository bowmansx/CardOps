// Multi-source pricing (Beau, 2026-07-20). A "source quote" is one vendor's
// CURRENT value for a card at some grade — NOT a realized sale (that's a comp).
// Each adapter normalizes its vendor's response into SourceQuote[]; the card
// page shows every source separately and a blended consensus on top.

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

export type PriceSourceAdapter = {
  id: string;
  label: string;
  /** Configured/available in this environment (e.g. a token is set)? */
  enabled: () => boolean;
  /** Does this source even cover this card (category gate)? */
  handles: (card: CardForPricing) => boolean;
  fetch: (card: CardForPricing) => Promise<AdapterResult>;
};

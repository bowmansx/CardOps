// Basis helpers (foundation-fixes item 3; cost lines added 2026-07-25).
//
// A card's cost basis has two parts, and they answer different questions:
//
//   ACQUISITION — what the card cost to get. Either its purchase lot's CURRENT
//   average (remaining cost over remaining count), or its stated
//   individual_basis. Exactly two sources; there is no third, and the global
//   card_pool is gone.
//
//   COST LINES — what has been capitalized into it SINCE: grading, appraisal,
//   sales tax, shipping in. Held as rows in card_basis_items and cached on
//   cards.basis_items_total by a trigger, so this stays a pure function over a
//   card row already in memory rather than a second paged read on every money
//   screen.
//
// total = acquisition + cost lines. Every screen goes through these functions
// so the math cannot drift between pages.

export type PurchaseLotBalance = {
  id: string;
  remaining_cost: number | null;
  remaining_count: number | null;
};

/** The shape every basis function needs. `basis_items_total` is optional so a
 *  caller that hasn't selected the column yet degrades to acquisition-only
 *  rather than throwing — but see the note on cardBasis. */
export type BasisCard = {
  purchase_lot_id: string | null;
  individual_basis: number | null;
  basis_items_total?: number | null;
};

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function lotAverages(lots: PurchaseLotBalance[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lots ?? []) {
    const count = Number(l.remaining_count ?? 0);
    m.set(l.id, count > 0 ? Number(l.remaining_cost ?? 0) / count : 0);
  }
  return m;
}

export function lotRemainingTotal(lots: PurchaseLotBalance[] | null | undefined): number {
  return (lots ?? []).reduce((s, l) => s + Number(l.remaining_cost ?? 0), 0);
}

/** What the card cost to ACQUIRE — the lot draw or the stated figure. */
export function cardAcquisitionBasis(card: BasisCard, avgByLot: Map<string, number>): number {
  if (card.purchase_lot_id) return avgByLot.get(card.purchase_lot_id) ?? 0;
  return n(card.individual_basis);
}

/** What has been capitalized into the card since acquisition. */
export function cardCostLines(card: BasisCard): number {
  return n(card.basis_items_total);
}

/**
 * Total cost basis. This is the number that matters for profit.
 *
 * The two components are exposed separately above because reports splits basis
 * into "purchase lot" and "individual" buckets; splitting on `purchase_lot_id`
 * at the call site instead would count a lot card's cost lines in BOTH buckets.
 * Partition by source, never by branch.
 */
export function cardBasis(card: BasisCard, avgByLot: Map<string, number>): number {
  return cardAcquisitionBasis(card, avgByLot) + cardCostLines(card);
}

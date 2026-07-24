// Lot-scoped basis helpers (foundation-fixes item 3). A card's cost basis is:
// linked to a purchase lot → that lot's CURRENT average (remaining cost over
// remaining count); no lot → its stated individual_basis. There is no third
// path — the global card_pool is gone. Every screen that sums basis goes
// through these two functions so the math cannot drift between pages.

export type PurchaseLotBalance = {
  id: string;
  remaining_cost: number | null;
  remaining_count: number | null;
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

export function cardBasis(
  card: { purchase_lot_id: string | null; individual_basis: number | null },
  avgByLot: Map<string, number>,
): number {
  if (card.purchase_lot_id) return avgByLot.get(card.purchase_lot_id) ?? 0;
  const n = Number(card.individual_basis ?? 0);
  return Number.isFinite(n) ? n : 0;
}

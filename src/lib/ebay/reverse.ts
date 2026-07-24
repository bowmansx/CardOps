// Reverse every settlement tied to an eBay order — the ONE implementation both
// cancel paths share (the manual cancel-order route and the sync's cancelled-
// after-settlement detection). Handles both shapes card_sales can hold:
//   single cards  → order_ref = orderId or "orderId:lineItemId" → card_unsell
//   lot children  → order_ref = "…:lot:<cardId>" → resolve the lot via
//                   card_lot_items and call card_lot_unsell ONCE per lot,
//                   which reverses all children AND resets the lot row.
// Un-selling lot children individually would strand card_lots.status='sold'
// with no path back — the exact dead-end prevention rule 8 forbids.
import type { SupabaseClient } from "@supabase/supabase-js";

export type ReverseResult = { reversedCards: number; reversedLots: number; problems: string[] };

export async function reverseOrderSettlement(
  db: SupabaseClient,
  orderId: string,
  sellerId?: string,
): Promise<ReverseResult> {
  const problems: string[] = [];
  let q = db
    .from("card_sales")
    .select("card_id, order_ref")
    .eq("platform", "ebay")
    .or(`order_ref.eq.${orderId},order_ref.like.${orderId}:%`);
  if (sellerId) q = q.eq("user_id", sellerId); // service client bypasses RLS — scope explicitly
  const { data: sales, error: salesErr } = await q;
  if (salesErr) {
    return { reversedCards: 0, reversedLots: 0, problems: [`couldn't look up settlements for ${orderId} (${salesErr.message})`] };
  }

  const lotChildIds: string[] = [];
  const singles: string[] = [];
  for (const s of sales ?? []) {
    if (/:lot:/.test(String(s.order_ref ?? ""))) lotChildIds.push(s.card_id as string);
    else singles.push(s.card_id as string);
  }

  let reversedCards = 0;
  for (const cardId of singles) {
    const { error } = await db.rpc("card_unsell", { p_card_id: cardId });
    if (error) problems.push(`reversal failed for card ${cardId} (${error.message})`);
    else reversedCards++;
  }

  let reversedLots = 0;
  if (lotChildIds.length) {
    const { data: items, error: itemsErr } = await db
      .from("card_lot_items").select("lot_id, card_id").in("card_id", lotChildIds);
    if (itemsErr) {
      problems.push(`couldn't resolve lots for ${lotChildIds.length} lot-child sales (${itemsErr.message})`);
    } else {
      const lotIds = [...new Set((items ?? []).map((i) => i.lot_id as string))];
      if (!lotIds.length) problems.push(`lot-child sales found for ${orderId} but no card_lot_items rows match — reverse by hand`);
      for (const lotId of lotIds) {
        const { error } = await db.rpc("card_lot_unsell", { p_lot_id: lotId });
        if (error) problems.push(`lot reversal failed for ${lotId} (${error.message})`);
        else reversedLots++;
      }
    }
  }

  return { reversedCards, reversedLots, problems };
}

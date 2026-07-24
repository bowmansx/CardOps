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
    .select("id, card_id, order_ref")
    .eq("platform", "ebay")
    .or(`order_ref.eq.${orderId},order_ref.like.${orderId}:%`);
  if (sellerId) q = q.eq("user_id", sellerId); // service client bypasses RLS — scope explicitly
  const { data: sales, error: salesErr } = await q;
  if (salesErr) {
    return { reversedCards: 0, reversedLots: 0, problems: [`couldn't look up settlements for ${orderId} (${salesErr.message})`] };
  }
  if (!sales?.length) return { reversedCards: 0, reversedLots: 0, problems };

  // NEVER auto-reverse a sale whose journal was already PUSHED to the real
  // books: card_unsell deletes the card_sales row, the next ledger rebuild
  // drops its journal lines, and the external journal would be orphaned with
  // no local counterpart and no screen that flags it. Books-invalidating
  // outcomes stay gated on an explicit human step (working rule #1). Fail
  // CLOSED if the push log can't be read.
  const pushRefs = sales.map((s) => `CARDOPS-card_sale-${s.id}`);
  const { data: pushedRows, error: pushErr } = await db
    .from("card_push_log").select("reference").in("reference", pushRefs);
  if (pushErr) {
    return { reversedCards: 0, reversedLots: 0, problems: [`couldn't check the books push log for ${orderId} (${pushErr.message}) — nothing reversed`] };
  }
  if (pushedRows?.length) {
    return {
      reversedCards: 0, reversedLots: 0,
      problems: [
        `${pushedRows.length} sale(s) on ${orderId} were already pushed to the books (${pushedRows.map((r) => r.reference).join(", ")}) — NOT auto-reversed. Reverse the external journal first, then use the cancel screen.`,
      ],
    };
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
      const resolved = [...new Set((items ?? []).map((i) => i.lot_id as string))];
      if (!resolved.length) problems.push(`lot-child sales found for ${orderId} but no card_lot_items rows match — reverse by hand`);
      let lotIds = resolved;
      // Defense in depth on the service client: only unsell lots the seller owns.
      if (sellerId && lotIds.length) {
        const { data: ownLots, error: ownErr } = await db
          .from("card_lots").select("id").in("id", lotIds).eq("user_id", sellerId);
        if (ownErr) {
          problems.push(`couldn't verify lot ownership for ${orderId} (${ownErr.message}) — lots not reversed`);
          lotIds = [];
        } else {
          lotIds = (ownLots ?? []).map((l) => l.id as string);
          if (lotIds.length < resolved.length) {
            problems.push(`${resolved.length - lotIds.length} lot(s) on ${orderId} belong to another user — not reversed`);
          }
        }
      }
      for (const lotId of lotIds) {
        const { error } = await db.rpc("card_lot_unsell", { p_lot_id: lotId });
        if (error) problems.push(`lot reversal failed for ${lotId} (${error.message})`);
        else reversedLots++;
      }
    }
  }

  return { reversedCards, reversedLots, problems };
}

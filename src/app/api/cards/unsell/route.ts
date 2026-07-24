import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

// Reverse a sale (mistaken test sale, or a cancelled order) via the card_unsell
// RPC, which undoes the pool draw and deletes the sale row. POST { cardId }
//
// Whoever may SELL a card may reverse that same card. This used to be owner-only
// while card_sell was owns_card(), so a card_ops user could book a sale and then
// had no way to undo it: the guard trigger blocks a manual status reset, the
// card_sales UPDATE/DELETE policies are owner-only, and the pool policies are
// select-only. One typo stranded their basis and P/L permanently. The RPC itself
// now enforces owns_card(), so this gate only needs to keep out non-card users.
// (2026-07-24)
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { cardId?: string } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });

  const { data, error } = await supabase.rpc("card_unsell", { p_card_id: body.cardId });
  if (error) {
    // "card is not sold" is a benign no-op from the user's view.
    const msg = /not sold/i.test(error.message) ? "That card isn't marked sold." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // If it had an eBay listing ref stuck on 'sold', flip it back to ended.
  const { data: card } = await supabase.from("cards").select("listing_refs").eq("id", body.cardId).maybeSingle();
  const refs = (card?.listing_refs ?? {}) as Record<string, unknown>;
  const ebay = refs.ebay as { status?: string } | undefined;
  if (ebay && ebay.status === "sold") {
    refs.ebay = { ...ebay, status: "ended" };
    await supabase.from("cards").update({ listing_refs: refs }).eq("id", body.cardId);
  }

  await supabase.from("audit_log").insert({
    actor: "web", action: "card_unsold", target: body.cardId,
    payload: data ?? {}, result: "ok",
  }).then(() => {}, () => {});
  return NextResponse.json({ ok: true, ...(data as object) });
}

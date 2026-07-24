import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { sendOfferToInterestedBuyers } from "@/lib/ebay/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Send a private discount offer to everyone watching / carting the listing
// (eBay Negotiation API — the "Send offer to watchers" button in Seller Hub).
// POST { cardId, price, message? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { cardId?: string; price?: number; message?: string }
    | null;
  const price = Number(body?.price);
  if (!body?.cardId || !(price > 0)) {
    return NextResponse.json({ error: "cardId and a positive offer price required." }, { status: 400 });
  }

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const { data: card } = await supabase
    .from("cards").select("id, sku, listing_refs").eq("id", body.cardId).maybeSingle();
  const ref = (card?.listing_refs as Record<string, { listing_id?: string }> | null)?.ebay;
  if (!card || !ref?.listing_id) return NextResponse.json({ error: "Card has no eBay listing." }, { status: 404 });

  const r = await sendOfferToInterestedBuyers(access, ref.listing_id, price, body.message?.trim() || undefined);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  await supabase.from("audit_log").insert({
    actor: "web", action: "ebay_offer_sent", target: (card.sku as string) ?? card.id,
    payload: { listingId: ref.listing_id, price }, result: "ok",
  }).then(() => {}, () => {});
  return NextResponse.json({ ok: true });
}

import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { ebayApi } from "@/lib/ebay/listing";
import { endItem } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Take a listing down. Fixed price → withdraw the offer (Inventory API);
// auction → Trading EndItem (eBay refuses near close with bids; verbatim).
// Card goes back to 'booked' so it can be relisted or sold elsewhere.
// POST { cardId }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { cardId?: string } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const { data: card } = await supabase
    .from("cards").select("id, sku, status, listing_refs").eq("id", body.cardId).maybeSingle();
  const refs = (card?.listing_refs ?? {}) as Record<string, unknown>;
  const ref = refs.ebay as { listing_id?: string; offer_id?: string; format?: string; status?: string } | undefined;
  if (!card || !ref?.listing_id) return NextResponse.json({ error: "Card has no eBay listing." }, { status: 404 });

  if (ref.format === "auction") {
    const r = await endItem(access, ref.listing_id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  } else {
    let offerId = ref.offer_id;
    if (!offerId) {
      const got = await ebayApi<{ offers?: { offerId: string }[] }>(
        access, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(card.sku as string)}`,
      );
      offerId = got.data?.offers?.[0]?.offerId;
    }
    if (!offerId) return NextResponse.json({ error: "Couldn't find the eBay offer for this card." }, { status: 502 });
    const r = await ebayApi(access, "POST", `/sell/inventory/v1/offer/${offerId}/withdraw`, {});
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  }

  refs.ebay = { ...(typeof refs.ebay === "object" ? refs.ebay : {}), status: "ended" };
  // Don't clobber a card a sync just settled (sold → booked would undo it).
  await supabase.from("cards").update({
    listing_refs: refs,
    ...(card.status === "listed" ? { status: "booked" } : {}),
  }).eq("id", card.id).neq("status", "sold");
  await auditOrThrow(supabase, {
    actor: "web", action: "ebay_ended", target: (card.sku as string) ?? card.id,
    payload: { listingId: ref.listing_id }, result: "ok",
  });
  return NextResponse.json({ ok: true });
}

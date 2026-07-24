import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { ebayApi } from "@/lib/ebay/listing";
import { relistItem } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Put an ended/unsold listing back up. Auction → Trading RelistItem (new
// item id). Fixed price → republish the existing offer.
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
  if (card.status === "sold") return NextResponse.json({ error: "Card is sold." }, { status: 400 });

  let listingId: string;
  if (ref.format === "auction") {
    const r = await relistItem(access, ref.listing_id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    listingId = r.itemId;
  } else {
    let offerId = ref.offer_id;
    if (!offerId) {
      const got = await ebayApi<{ offers?: { offerId: string }[] }>(
        access, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(card.sku as string)}`,
      );
      offerId = got.data?.offers?.[0]?.offerId;
    }
    if (!offerId) return NextResponse.json({ error: "Couldn't find the eBay offer for this card." }, { status: 502 });
    const pub = await ebayApi<{ listingId?: string }>(access, "POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
    if (!pub.ok || !pub.data?.listingId) {
      return NextResponse.json({ error: pub.error ?? "republish returned no listingId" }, { status: 502 });
    }
    listingId = pub.data.listingId;
  }

  const url = `https://www.ebay.com/itm/${listingId}`;
  refs.ebay = {
    ...(typeof refs.ebay === "object" ? refs.ebay : {}),
    listing_id: listingId, url, status: "active",
    relisted_from: ref.listing_id, listed_at: new Date().toISOString(),
  };
  // Guard against a sync settling this card between our read and write —
  // never resurrect a sold card to 'listed' (would allow a double sale).
  const { data: updated } = await supabase.from("cards").update({
    listing_refs: refs, status: "listed", listed_at: new Date().toISOString(),
  }).eq("id", card.id).neq("status", "sold").select("id");
  if (!updated?.length) {
    return NextResponse.json({ error: "Card was just sold — not relisting. End the new eBay listing manually." }, { status: 409 });
  }
  await auditOrThrow(supabase, {
    actor: "web", action: "ebay_relisted", target: (card.sku as string) ?? card.id,
    payload: { listingId, from: ref.listing_id }, result: "ok",
  });
  return NextResponse.json({ ok: true, url, listingId });
}

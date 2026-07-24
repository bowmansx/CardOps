import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { ebayApi } from "@/lib/ebay/listing";
import { reviseAuctionPrice } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Change a live listing's price from inside CardOps.
// Fixed price → Inventory bulk_update_price_quantity (no republish needed).
// Auction → Trading ReviseItem (eBay rejects once bids exist; error surfaces).
// POST { cardId, price, binPrice? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { cardId?: string; price?: number; binPrice?: number }
    | null;
  const price = Number(body?.price);
  if (!body?.cardId || !(price > 0)) {
    return NextResponse.json({ error: "cardId and a positive price required." }, { status: 400 });
  }

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  const { data: card } = await supabase
    .from("cards").select("id, sku, listing_refs").eq("id", body.cardId).maybeSingle();
  const ref = (card?.listing_refs as Record<string, { listing_id?: string; offer_id?: string; format?: string; status?: string }> | null)?.ebay;
  if (!card || !ref?.listing_id) return NextResponse.json({ error: "Card has no eBay listing." }, { status: 404 });

  if (ref.format === "auction") {
    const r = await reviseAuctionPrice(access, ref.listing_id, price, Number(body.binPrice) > 0 ? Number(body.binPrice) : null);
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
    const r = await ebayApi<{ responses?: { statusCode?: number; errors?: { message?: string }[] }[] }>(
      access, "POST", "/sell/inventory/v1/bulk_update_price_quantity", {
        requests: [{
          sku: card.sku,
          offers: [{ offerId, price: { currency: "USD", value: price.toFixed(2) } }],
        }],
      },
    );
    const status = r.data?.responses?.[0]?.statusCode ?? (r.ok ? 200 : 500);
    if (!r.ok || status >= 300) {
      const msg = r.data?.responses?.[0]?.errors?.map((e) => e.message).join(" · ") || r.error || `price update ${status}`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  await supabase.from("audit_log").insert({
    actor: "web", action: "ebay_reprice", target: (card.sku as string) ?? card.id,
    payload: { price, binPrice: body.binPrice ?? null }, result: "ok",
  }).then(() => {}, () => {});
  return NextResponse.json({ ok: true });
}

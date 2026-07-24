import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { getBestOffers, respondToBestOffer, type BuyerOffer } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Buyer Best Offers, managed from inside CardOps.
// POST { op: "list_all", itemIds: string[] }            → pending offers per listing
// POST { op: "respond", itemId, offerId,
//        action: "accept"|"decline"|"counter", counterPrice? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { op?: string; itemIds?: string[]; itemId?: string; offerId?: string; action?: string; counterPrice?: number }
    | null;
  if (!body?.op) return NextResponse.json({ error: "op required." }, { status: 400 });

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected." }, { status: 503 });

  if (body.op === "list_all") {
    const ids = (body.itemIds ?? []).filter((s) => /^\d+$/.test(String(s))).slice(0, 25);
    const byItem: Record<string, BuyerOffer[]> = {};
    const results = await Promise.all(ids.map(async (id) => ({ id, r: await getBestOffers(access, id) })));
    for (const { id, r } of results) {
      // "Best Offer not enabled" style errors are normal — just skip the item.
      if (r.ok && r.offers.length) byItem[id] = r.offers;
    }
    return NextResponse.json({ ok: true, byItem });
  }

  if (body.op === "respond") {
    const action = body.action === "accept" ? "Accept" : body.action === "decline" ? "Decline" : body.action === "counter" ? "Counter" : null;
    if (!body.itemId || !body.offerId || !action) {
      return NextResponse.json({ error: "itemId, offerId, action required." }, { status: 400 });
    }
    if (action === "Counter" && !(Number(body.counterPrice) > 0)) {
      return NextResponse.json({ error: "Counter needs a price." }, { status: 400 });
    }
    const r = await respondToBestOffer(access, body.itemId, body.offerId, action, Number(body.counterPrice) || undefined);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    await auditOrThrow(supabase, {
      actor: "web", action: "ebay_offer_" + (body.action ?? ""), target: body.itemId,
      payload: { offerId: body.offerId, counterPrice: body.counterPrice ?? null }, result: "ok",
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}

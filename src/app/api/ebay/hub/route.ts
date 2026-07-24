import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { getMyEbaySelling, type MySelling } from "@/lib/ebay/trading";
import { getOrders, findEligibleOfferListings, type EbayOrder } from "@/lib/ebay/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One aggregate for the eBay Hub page: live listings, orders, offer
// eligibility, CardOps matches, and 30-day sold stats. Each eBay section
// fails independently — one API quirk never blanks the whole hub.

type CardStub = {
  id: string; sku: string | null; player: string | null; year: number | null;
  set_name: string | null; status: string | null;
  listing: { listing_id?: string; offer_id?: string; status?: string; format?: string } | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected (Services page)." }, { status: 503 });

  const errors: Record<string, string> = {};

  const [selling, ordersRes, eligible] = await Promise.all([
    getMyEbaySelling(access),
    getOrders(access, 90),
    findEligibleOfferListings(access),
  ]);
  if (!selling.ok) errors.listings = selling.error;
  if (!ordersRes.ok) errors.orders = ordersRes.error;
  // Offer eligibility is a bonus feature — swallow into errors quietly.
  if (!eligible.ok) errors.offers = eligible.error;

  const active: MySelling[] = selling.ok ? selling.active : [];
  const unsold: MySelling[] = selling.ok ? selling.unsold : [];
  const orders: EbayOrder[] = ordersRes.ok ? ordersRes.orders : [];

  // CardOps matches: any card that has ever had an eBay listing ref.
  const { data: cardRows } = await supabase
    .from("cards")
    .select("id, sku, player, year, set_name, status, listing_refs")
    .not("listing_refs", "eq", "{}")
    .limit(1000);
  const cards: CardStub[] = (cardRows ?? []).map((c) => ({
    id: c.id as string,
    sku: (c.sku as string) ?? null,
    player: (c.player as string) ?? null,
    year: (c.year as number) ?? null,
    set_name: (c.set_name as string) ?? null,
    status: (c.status as string) ?? null,
    listing:
      ((c.listing_refs as Record<string, unknown> | null)?.ebay as CardStub["listing"]) ?? null,
  }));
  const byListingId = new Map<string, CardStub>();
  const bySku = new Map<string, CardStub>();
  for (const c of cards) {
    if (c.listing?.listing_id) byListingId.set(String(c.listing.listing_id), c);
    if (c.sku) bySku.set(c.sku, c);
  }
  const matchCard = (itemId: string | null, sku: string | null): CardStub | null =>
    (itemId && byListingId.get(itemId)) || (sku && bySku.get(sku)) || null;

  // Settled state: which eBay order_refs already exist in card_sales.
  const { data: saleRows } = await supabase
    .from("card_sales")
    .select("order_ref, sale_price, profit_loss, sold_at")
    .eq("platform", "ebay")
    .limit(1000);
  // order_ref is the orderId, or "orderId:lineItemId" for combined orders —
  // strip the suffix so an order shows settled once any of its lines settle.
  const settledOrders = new Set(
    (saleRows ?? []).map((s) => String(s.order_ref ?? "").split(":")[0]).filter(Boolean),
  );
  const cutoff30 = Date.now() - 30 * 86400_000;
  const sold30 = (saleRows ?? []).filter((s) => new Date(s.sold_at as string).getTime() > cutoff30);

  const withCard = (l: MySelling) => {
    const card = matchCard(l.itemId, l.sku);
    return {
      ...l,
      cardId: card?.id ?? null,
      cardTitle: card ? [card.year, card.player, card.set_name].filter(Boolean).join(" ") : null,
      canSendOffer: eligible.ok && eligible.listingIds.includes(l.itemId),
    };
  };

  const awaitingShipment = orders.filter(
    (o) => o.paymentStatus === "PAID" && o.fulfillmentStatus !== "FULFILLED",
  );
  const recentOrders = orders
    .filter((o) => o.paymentStatus === "PAID")
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .slice(0, 50)
    .map((o) => ({
      ...o,
      settled: settledOrders.has(o.orderId),
      cardId: o.lineItems.map((li) => matchCard(li.legacyItemId, li.sku)?.id).find(Boolean) ?? null,
    }));

  const stats = {
    activeCount: active.length,
    activeValue: active.reduce((s, l) => s + (l.binPrice ?? l.price ?? 0), 0),
    watchers: active.reduce((s, l) => s + (l.watchers ?? 0), 0),
    bids: active.reduce((s, l) => s + (l.bids ?? 0), 0),
    awaitingCount: awaitingShipment.length,
    sold30Count: sold30.length,
    sold30Total: sold30.reduce((s, r) => s + Number(r.sale_price ?? 0), 0),
    profit30: sold30.reduce((s, r) => s + Number(r.profit_loss ?? 0), 0),
    // Only count orders that CAN settle — i.e. match a CardOps card and haven't.
    unsettled: recentOrders.filter((o) => !o.settled && o.cardId).length,
  };

  return NextResponse.json({
    active: active.map(withCard),
    unsold: unsold.map(withCard),
    awaitingShipment,
    recentOrders,
    stats,
    errors: Object.keys(errors).length ? errors : undefined,
  });
}

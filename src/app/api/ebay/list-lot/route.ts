import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import { ebayApi, ensurePolicies, readEbayPrefs, ebayCategoryId, LOCATION_KEY } from "@/lib/ebay/listing";
import { categoryKind } from "@/lib/cards/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// List a LOT on eBay as one fixed-price bundle. Photos are pooled from the
// children; category/aspects are generic (a mixed bundle). On sale the eBay
// sync settles it through card_lot_sell (proceeds split across the children).
// POST { lotId, price?, title?, description?, bestOffer? }
type Child = { id: string; player: string | null; year: number | null; set_name: string | null; sport_category: string | null; market_value: number | null; manual_price: number | null; status: string | null; listing_refs: Record<string, { status?: string }> | null };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { lotId?: string; price?: number; title?: string; description?: string; bestOffer?: { enabled?: boolean; autoAccept?: number; autoDecline?: number } }
    | null;
  if (!body?.lotId) return NextResponse.json({ error: "lotId required." }, { status: 400 });

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected (Services page)." }, { status: 503 });

  const { data: lot } = await supabase.from("card_lots").select("id, sku, title, description, status, ask_price, listing_refs").eq("id", body.lotId).maybeSingle();
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  if (lot.status === "sold") return NextResponse.json({ error: "Lot is sold." }, { status: 400 });
  const existing = (lot.listing_refs as Record<string, { listing_id?: string; status?: string }> | null)?.ebay;
  if (existing?.listing_id && existing.status === "active") {
    return NextResponse.json({ error: "Lot already listed.", url: `https://www.ebay.com/itm/${existing.listing_id}` }, { status: 409 });
  }

  const { data: items } = await supabase.from("card_lot_items").select("cards ( id, player, year, set_name, sport_category, market_value, manual_price, status, listing_refs )").eq("lot_id", lot.id);
  const children: Child[] = (items ?? []).map((r) => (Array.isArray(r.cards) ? r.cards[0] : r.cards) as Child).filter(Boolean);
  if (children.length < 1) return NextResponse.json({ error: "Lot has no cards." }, { status: 400 });
  // Every child must be in hand and not otherwise committed — else the bundle
  // sale can't settle (child already sold) or oversells a card that's also
  // listed individually.
  const unavailable = children.filter(
    (c) => c.status === "sold" || c.status === "graded_out" || c.listing_refs?.ebay?.status === "active",
  );
  if (unavailable.length) {
    return NextResponse.json({
      error: `${unavailable.length} card(s) in this lot can't be listed — sold, out for grading, or already listed individually. Remove them from the lot first: ${unavailable.map((c) => [c.year, c.player].filter(Boolean).join(" ")).join(", ")}`,
    }, { status: 409 });
  }

  // Pooled photos from all children (private bucket → 48h signed URLs).
  const childIds = children.map((c) => c.id);
  const { data: photos } = await supabase.from("card_photos").select("bucket, path").in("card_id", childIds).order("created_at");
  const urls: string[] = [];
  for (const p of photos ?? []) {
    const { data: s } = await supabase.storage.from(p.bucket as string).createSignedUrl(p.path as string, 48 * 3600);
    if (s?.signedUrl) urls.push(s.signedUrl);
    if (urls.length >= 12) break;
  }
  if (!urls.length) return NextResponse.json({ error: "None of the lot's cards have photos — scan them first." }, { status: 400 });

  // Dominant category → eBay category; generic aspects for a mixed bundle.
  const counts = new Map<string, number>();
  for (const c of children) { const k = c.sport_category ?? "?"; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const kind = categoryKind(dominant);
  const aspects: Record<string, string[]> = kind === "tcg"
    ? { "Game": [dominant ?? "Trading Card Game"], "Type": ["Card Lot"] }
    : kind === "sport"
      ? { "Sport": [dominant ?? "Trading Cards"], "Type": ["Card Lot"] }
      : { "Type": ["Card Lot"] };

  const sumSingles = children.reduce((s, c) => s + Number(c.manual_price ?? c.market_value ?? 0), 0);
  const price = body.price ?? (lot.ask_price as number | null) ?? (sumSingles > 0 ? Math.round(sumSingles * 0.85 * 100) / 100 : null);
  if (!(Number(price) > 0)) return NextResponse.json({ error: "No price — set a lot ask or add card values." }, { status: 400 });

  const title = ((body.title?.trim() || (lot.title as string) || `Lot of ${children.length} ${dominant && dominant !== "?" ? dominant + " " : ""}cards`).slice(0, 80));
  const description = body.description?.trim() || (lot.description as string) ||
    `Bundle of ${children.length} cards:\n` + children.map((c) => `• ${[c.year, c.player, c.set_name].filter(Boolean).join(" ")}`).join("\n") + "\nSee photos. Ships secure.";

  // Prereqs: ship-from location + business policies.
  const prefs = await readEbayPrefs(supabase, user.id);
  if (!prefs.location_ok) {
    const loc = await ebayApi(access, "GET", `/sell/inventory/v1/location/${LOCATION_KEY}`);
    if (!loc.ok) return NextResponse.json({ needsLocation: true, error: "Ship-from location needed (one-time)." }, { status: 428 });
  }
  const pol = await ensurePolicies(access, supabase, user.id);
  if (!pol.ok) return NextResponse.json({ error: pol.error }, { status: 502 });

  const sku = lot.sku as string;
  const inv = await ebayApi(access, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: "USED_VERY_GOOD",
    product: { title, description, aspects, imageUrls: urls },
  });
  if (!inv.ok) return NextResponse.json({ error: `inventory item: ${inv.error}` }, { status: 502 });

  const offerBody = {
    sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", availableQuantity: 1,
    categoryId: ebayCategoryId(dominant),
    listingDescription: description,
    listingPolicies: {
      fulfillmentPolicyId: pol.prefs.fulfillment_policy_id,
      paymentPolicyId: pol.prefs.payment_policy_id,
      returnPolicyId: pol.prefs.return_policy_id,
      ...(body.bestOffer?.enabled ? { bestOfferTerms: { bestOfferEnabled: true } } : {}),
    },
    pricingSummary: { price: { currency: "USD", value: Number(price).toFixed(2) } },
    merchantLocationKey: LOCATION_KEY,
  };
  const off = await ebayApi<{ offerId?: string }>(access, "POST", "/sell/inventory/v1/offer", offerBody);
  let offerId = off.data?.offerId ?? null;
  if (!off.ok && off.status === 400 && /already exists/i.test(off.error ?? "")) {
    const got = await ebayApi<{ offers?: { offerId: string }[] }>(access, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
    offerId = got.data?.offers?.[0]?.offerId ?? null;
    if (offerId) await ebayApi(access, "PUT", `/sell/inventory/v1/offer/${offerId}`, offerBody);
  }
  if (!offerId) return NextResponse.json({ error: `offer: ${off.error}` }, { status: 502 });

  const pub = await ebayApi<{ listingId?: string }>(access, "POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
  if (!pub.ok || !pub.data?.listingId) return NextResponse.json({ error: `publish: ${pub.error ?? "no listingId"}` }, { status: 502 });

  const listingId = pub.data.listingId;
  const url = `https://www.ebay.com/itm/${listingId}`;
  const refs = (lot.listing_refs && typeof lot.listing_refs === "object" && !Array.isArray(lot.listing_refs) ? lot.listing_refs : {}) as Record<string, unknown>;
  refs.ebay = { ...(typeof refs.ebay === "object" ? refs.ebay : {}), offer_id: offerId, listing_id: listingId, url, status: "active", title, listed_at: new Date().toISOString() };
  await supabase.from("card_lots").update({ listing_refs: refs, status: "listed", ask_price: Number(price) }).eq("id", lot.id);

  const svc = createServiceClient();
  if (svc) {
    try { await svc.from("service_config").update({ enabled: true }).eq("key", "ebay_api"); } catch {}
    try { await svc.from("audit_log").insert({ actor: "web", action: "ebay_lot_listed", target: sku, payload: { listingId, price, cards: children.length }, result: "ok" }); } catch {}
  }
  return NextResponse.json({ ok: true, url, listingId });
}

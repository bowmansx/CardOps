import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole } from "@/lib/cards/roles";
import { getEbayAccess } from "@/lib/ebay/connection";
import {
  ebayApi, buildAspects, buildCondition, ebayCategoryId,
  ensurePolicies, readEbayPrefs, writeEbayPrefs, LOCATION_KEY,
} from "@/lib/ebay/listing";
import { addAuctionItem } from "@/lib/ebay/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Push ONE listing. Fixed price = Inventory API (item → offer → publish),
// optionally with Best Offer terms. Auction = legacy Trading API AddItem
// (the Inventory API is fixed-price-only). Writes listing_refs.ebay +
// status 'listed' on success.
// POST { cardId, title?, description?, price?,
//        format?: "fixed"|"auction",
//        bestOffer?: { enabled: boolean; autoAccept?: number; autoDecline?: number },
//        auction?: { startBid: number; days?: 3|5|7|10; binPrice?: number } }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | {
        cardId?: string; title?: string; description?: string; price?: number;
        format?: string; allowGradedOut?: boolean;
        bestOffer?: { enabled?: boolean; autoAccept?: number; autoDecline?: number };
        auction?: { startBid?: number; days?: number; binPrice?: number };
      }
    | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  const format = body.format === "auction" ? "auction" : "fixed";
  if (format === "auction" && !(Number(body.auction?.startBid) > 0)) {
    return NextResponse.json({ error: "Auction needs a starting bid." }, { status: 400 });
  }

  const access = await getEbayAccess(supabase);
  if (!access) return NextResponse.json({ error: "eBay not connected (Services page)." }, { status: 503 });

  const { data: card } = await supabase.from("cards").select("*").eq("id", body.cardId).maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  if (card.status === "sold") return NextResponse.json({ error: "Card is sold." }, { status: 400 });
  // Out for grading = not in your possession to ship. Block by default; the
  // owner can change its status back (or override once a policy setting exists).
  if (card.status === "graded_out" && !body.allowGradedOut) {
    return NextResponse.json({
      error: "This card is out for grading (status: graded_out) — you can't ship it yet. Change its status back once it returns, or override to list a pre-sale.",
      gradedOut: true,
    }, { status: 409 });
  }
  const existing = (card.listing_refs as Record<string, { listing_id?: string; status?: string }> | null)?.ebay;
  if (existing?.listing_id && existing.status === "active") {
    return NextResponse.json({ error: "Already listed on eBay.", url: `https://www.ebay.com/itm/${existing.listing_id}` }, { status: 409 });
  }
  // A card committed to an active (draft/listed) lot can't be listed on its own
  // — that would let it sell twice (once solo, once in the bundle).
  const { data: activeLot } = await supabase
    .from("card_lot_items")
    .select("lot_id, card_lots!inner(status)")
    .eq("card_id", body.cardId)
    .in("card_lots.status", ["draft", "listed"])
    .limit(1);
  if (activeLot && activeLot.length) {
    return NextResponse.json({ error: "This card is in an active lot — list the lot instead, or remove the card from it first." }, { status: 409 });
  }

  const price = body.price ?? (card.manual_price as number | null) ?? (card.market_value as number | null);
  if (format === "fixed" && !(Number(price) > 0)) {
    return NextResponse.json({ error: "No price — set a manual price or add comps first." }, { status: 400 });
  }

  // One-time prerequisites: ship-from location + business policies.
  const prefs = await readEbayPrefs(supabase, user.id);
  if (!prefs.location_ok) {
    // Probe once — it may exist from an earlier run.
    const loc = await ebayApi(access, "GET", `/sell/inventory/v1/location/${LOCATION_KEY}`);
    if (!loc.ok) return NextResponse.json({ needsLocation: true, error: "Ship-from location needed (one-time)." }, { status: 428 });
  }
  const pol = await ensurePolicies(access, supabase, user.id);
  if (!pol.ok) return NextResponse.json({ error: pol.error }, { status: 502 });

  // Photos → 48h signed URLs (bucket is private; eBay copies at listing time).
  const { data: photos } = await supabase
    .from("card_photos").select("kind, bucket, path").eq("card_id", card.id).order("created_at");
  const urls: string[] = [];
  for (const p of photos ?? []) {
    const { data: s } = await supabase.storage.from(p.bucket as string).createSignedUrl(p.path as string, 48 * 3600);
    if (s?.signedUrl) urls.push(s.signedUrl);
    if (urls.length >= 12) break;
  }
  if (!urls.length) return NextResponse.json({ error: "Card has no stored photos — scan it first." }, { status: 400 });

  const draft = (card.listing_refs as Record<string, { title?: string; description?: string }> | null)?.ebay;
  const builtTitle = [card.year, card.player, card.set_name, card.parallel,
    card.card_number ? `#${card.card_number}` : null,
    card.condition_type === "graded" ? `${card.grader} ${card.grade}` : null,
  ].filter(Boolean).join(" ").slice(0, 80);
  const title = (body.title?.trim() || draft?.title || builtTitle).slice(0, 80);
  let description =
    body.description?.trim() || draft?.description ||
    `${builtTitle}. See photos for condition. Ships secure.`;

  // Discount-in-description (Beau): if listing below the card's computed market
  // value (the honest anchor), state the discount so the claim is always true.
  const anchor = card.market_value as number | null;
  const listPrice = format === "auction" ? Number(body.auction?.binPrice) || null : Number(price) || null;
  if (anchor != null && anchor > 0 && listPrice != null && listPrice < anchor) {
    const off = Math.round(((anchor - listPrice) / anchor) * 100);
    if (off >= 1 && !/below.*market|% (off|under)/i.test(description)) {
      description += `\n\nPriced ~${off}% below recent market value.`;
    }
  }

  const sku = card.sku as string;
  const cond = buildCondition(card as Record<string, unknown>);

  // ── AUCTION path (Trading API — the Inventory API can't do auctions) ──────
  if (format === "auction") {
    let zip = pol.prefs.ship_zip;
    if (!zip) {
      // Older setups saved only the flag — recover the ZIP from eBay itself.
      const loc = await ebayApi<{ location?: { address?: { postalCode?: string } } }>(
        access, "GET", `/sell/inventory/v1/location/${LOCATION_KEY}`,
      );
      zip = loc.data?.location?.address?.postalCode ?? undefined;
      if (zip) await writeEbayPrefs(supabase, user.id, { ship_zip: zip });
    }
    if (!zip) return NextResponse.json({ needsLocation: true, error: "Ship-from location needed (one-time)." }, { status: 428 });

    const days = ([3, 5, 7, 10] as const).includes((body.auction?.days ?? 7) as 3 | 5 | 7 | 10)
      ? ((body.auction?.days ?? 7) as 3 | 5 | 7 | 10)
      : 7;
    const r = await addAuctionItem(access, {
      title,
      description,
      sku,
      categoryId: ebayCategoryId(card.sport_category as string | null),
      conditionId: card.condition_type === "graded" ? "2750" : "4000",
      startBid: Number(body.auction!.startBid),
      days,
      binPrice: Number(body.auction?.binPrice) > 0 ? Number(body.auction!.binPrice) : null,
      postalCode: zip,
      pictureUrls: urls,
      aspects: buildAspects(card as Record<string, unknown>),
      policies: {
        fulfillment: pol.prefs.fulfillment_policy_id!,
        payment: pol.prefs.payment_policy_id!,
        return: pol.prefs.return_policy_id!,
      },
    });
    if (!r.ok) return NextResponse.json({ error: `auction: ${r.error}` }, { status: 502 });

    const url = `https://www.ebay.com/itm/${r.itemId}`;
    const prior0 = card.listing_refs;
    const refs0 = prior0 && typeof prior0 === "object" && !Array.isArray(prior0)
      ? (prior0 as Record<string, unknown>)
      : {};
    refs0.ebay = {
      ...(typeof refs0.ebay === "object" ? refs0.ebay : {}),
      listing_id: r.itemId, url, status: "active", format: "auction",
      title, listed_at: new Date().toISOString(),
    };
    await supabase.from("cards").update({
      listing_refs: refs0, status: "listed", listed_at: new Date().toISOString(),
    }).eq("id", card.id);
    const svc0 = createServiceClient();
    if (svc0) {
      try { await svc0.from("service_config").update({ enabled: true }).eq("key", "ebay_api"); } catch {}
      try {
        await svc0.from("audit_log").insert({
          actor: "web", action: "ebay_listed", target: sku,
          payload: { listingId: r.itemId, format: "auction", startBid: body.auction!.startBid }, result: "ok",
        });
      } catch {}
    }
    return NextResponse.json({ ok: true, url, listingId: r.itemId, warnings: r.warnings ?? undefined });
  }

  // ── FIXED-PRICE path (Inventory API) ──────────────────────────────────────
  // 1) Inventory item
  const inv = await ebayApi(access, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: cond.condition,
    ...(cond.conditionDescriptors ? { conditionDescriptors: cond.conditionDescriptors } : {}),
    product: {
      title,
      description,
      aspects: buildAspects(card as Record<string, unknown>),
      imageUrls: urls,
    },
  });
  if (!inv.ok) return NextResponse.json({ error: `inventory item: ${inv.error}` }, { status: 502 });

  // 2) Offer (create; on "already exists" fetch the existing one)
  let offerId: string | null = null;
  const offerBody = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: ebayCategoryId(card.sport_category as string | null),
    listingDescription: description,
    listingPolicies: {
      fulfillmentPolicyId: pol.prefs.fulfillment_policy_id,
      paymentPolicyId: pol.prefs.payment_policy_id,
      returnPolicyId: pol.prefs.return_policy_id,
      ...(body.bestOffer?.enabled
        ? {
            bestOfferTerms: {
              bestOfferEnabled: true,
              ...(Number(body.bestOffer.autoAccept) > 0
                ? { autoAcceptPrice: { currency: "USD", value: Number(body.bestOffer.autoAccept).toFixed(2) } }
                : {}),
              ...(Number(body.bestOffer.autoDecline) > 0
                ? { autoDeclinePrice: { currency: "USD", value: Number(body.bestOffer.autoDecline).toFixed(2) } }
                : {}),
            },
          }
        : {}),
    },
    pricingSummary: { price: { currency: "USD", value: Number(price).toFixed(2) } },
    merchantLocationKey: LOCATION_KEY,
  };
  const off = await ebayApi<{ offerId?: string }>(access, "POST", "/sell/inventory/v1/offer", offerBody);
  if (off.ok) {
    offerId = off.data?.offerId ?? null;
  } else if (off.status === 400 && /already exists/i.test(off.error ?? "")) {
    const got = await ebayApi<{ offers?: { offerId: string }[] }>(
      access, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
    );
    offerId = got.data?.offers?.[0]?.offerId ?? null;
    if (offerId) await ebayApi(access, "PUT", `/sell/inventory/v1/offer/${offerId}`, offerBody);
  }
  if (!offerId) return NextResponse.json({ error: `offer: ${off.error}` }, { status: 502 });

  // 3) Publish
  const pub = await ebayApi<{ listingId?: string }>(access, "POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
  if (!pub.ok || !pub.data?.listingId) {
    return NextResponse.json({ error: `publish: ${pub.error ?? "no listingId"}` }, { status: 502 });
  }
  const listingId = pub.data.listingId;
  const url = `https://www.ebay.com/itm/${listingId}`;

  // Persist: listing_refs.ebay + status listed; flip the ebay_api toggle on.
  const prior = card.listing_refs;
  const refs = prior && typeof prior === "object" && !Array.isArray(prior)
    ? (prior as Record<string, unknown>)
    : {};
  refs.ebay = {
    ...(typeof refs.ebay === "object" ? refs.ebay : {}),
    offer_id: offerId, listing_id: listingId, url, status: "active",
    title, listed_at: new Date().toISOString(),
  };
  await supabase.from("cards").update({
    listing_refs: refs, status: "listed", listed_at: new Date().toISOString(),
  }).eq("id", card.id);
  const svc = createServiceClient();
  if (svc) {
    try { await svc.from("service_config").update({ enabled: true }).eq("key", "ebay_api"); } catch {}
    try {
      await svc.from("audit_log").insert({
        actor: "web", action: "ebay_listed", target: sku,
        payload: { listingId, price }, result: "ok",
      });
    } catch {}
  }

  return NextResponse.json({ ok: true, url, listingId });
}

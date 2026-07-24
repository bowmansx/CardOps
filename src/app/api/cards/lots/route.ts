import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

// Multi-card lots. GET = list lots + their cards.
// POST { op: "create", cardIds[], title? }
//      { op: "update", lotId, title?, description?, askPrice? }
//      { op: "add"|"remove", lotId, cardIds[] }
//      { op: "sell", lotId, platform?, salePrice, fees?, shipIncome?, shipCost?, orderRef? }
//      { op: "reverse", lotId }   { op: "archive", lotId }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanIds = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && UUID.test(s)).slice(0, 500) : [];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: lots } = await supabase
    .from("card_lots")
    .select("id, sku, title, description, status, ask_price, listing_refs, created_at, card_lot_items(card_id, comp_value_at_add, cards(player, year, set_name, market_value, manual_price))")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(200);
  return NextResponse.json({ lots: lots ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const op = body?.op as string | undefined;

  // Cards already committed to an active (draft/listed) lot can't join another.
  async function assertFree(cardIds: string[], exceptLot?: string) {
    if (!cardIds.length) return null;
    let q = supabase
      .from("card_lot_items")
      .select("card_id, card_lots!inner(id, status)")
      .in("card_id", cardIds)
      .in("card_lots.status", ["draft", "listed"]);
    if (exceptLot) q = q.neq("lot_id", exceptLot);
    const { data } = await q;
    return (data ?? []).length ? (data![0].card_id as string) : null;
  }

  async function addItems(lotId: string, cardIds: string[]) {
    // Snapshot each card's comp value as the allocation weight.
    const { data: cards } = await supabase
      .from("cards").select("id, market_value, manual_price").in("id", cardIds);
    const rows = (cards ?? []).map((c) => ({
      lot_id: lotId, card_id: c.id as string,
      comp_value_at_add: (c.manual_price ?? c.market_value) as number | null,
    }));
    if (rows.length) await supabase.from("card_lot_items").upsert(rows, { onConflict: "lot_id,card_id" });
  }

  if (op === "create") {
    const cardIds = cleanIds(body?.cardIds);
    if (cardIds.length < 2) return NextResponse.json({ error: "Pick at least 2 cards for a lot." }, { status: 400 });
    const busy = await assertFree(cardIds);
    if (busy) return NextResponse.json({ error: "One or more cards are already in an active lot." }, { status: 409 });
    const { data: lot, error } = await supabase
      .from("card_lots").insert({ title: (body?.title as string)?.slice(0, 120) || null }).select("id, sku").single();
    if (error || !lot) return NextResponse.json({ error: error?.message ?? "Couldn't create lot." }, { status: 500 });
    await addItems(lot.id as string, cardIds);
    return NextResponse.json({ ok: true, lotId: lot.id, sku: lot.sku });
  }

  const lotId = typeof body?.lotId === "string" && UUID.test(body.lotId) ? body.lotId : null;
  if (!lotId) return NextResponse.json({ error: "lotId required." }, { status: 400 });

  if (op === "update") {
    const patch: Record<string, unknown> = {};
    if (typeof body?.title === "string") patch.title = body.title.slice(0, 120);
    if (typeof body?.description === "string") patch.description = body.description.slice(0, 4000);
    if (body?.askPrice != null && Number(body.askPrice) >= 0) patch.ask_price = Number(body.askPrice);
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    const { error } = await supabase.from("card_lots").update(patch).eq("id", lotId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Membership may only change while the lot is still draft/listed — editing a
  // sold lot would orphan its settled sales; editing archived is pointless.
  async function assertEditable() {
    const { data: lot } = await supabase.from("card_lots").select("status").eq("id", lotId).maybeSingle();
    if (!lot) return "Lot not found.";
    if (lot.status !== "draft" && lot.status !== "listed") return `Can't change a ${lot.status} lot.`;
    return null;
  }

  if (op === "add") {
    const blocked = await assertEditable();
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    const cardIds = cleanIds(body?.cardIds);
    const busy = await assertFree(cardIds, lotId);
    if (busy) return NextResponse.json({ error: "A card is already in another active lot." }, { status: 409 });
    await addItems(lotId, cardIds);
    return NextResponse.json({ ok: true });
  }
  if (op === "remove") {
    const blocked = await assertEditable();
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    const cardIds = cleanIds(body?.cardIds);
    if (cardIds.length) await supabase.from("card_lot_items").delete().eq("lot_id", lotId).in("card_id", cardIds);
    return NextResponse.json({ ok: true });
  }

  if (op === "archive") {
    const { error } = await supabase.from("card_lots").update({ status: "archived" }).eq("id", lotId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (op === "sell") {
    const salePrice = Number(body?.salePrice);
    if (!(salePrice > 0) || salePrice > 10_000_000) {
      return NextResponse.json({ error: "A positive sale price is required." }, { status: 400 });
    }
    // Same guard the single-card sell action carries: the RPC only checks the
    // sale price, and a negative fee would inflate net proceeds and corrupt
    // every child's P/L (and the books rows built from them).
    const fees = Number(body?.fees) || 0;
    const shipIncome = Number(body?.shipIncome) || 0;
    const shipCost = Number(body?.shipCost) || 0;
    for (const [label, v] of [["fees", fees], ["shipIncome", shipIncome], ["shipCost", shipCost]] as const) {
      if (!Number.isFinite(v) || v < 0 || v > 10_000_000) {
        return NextResponse.json({ error: `${label} must be a non-negative number.` }, { status: 400 });
      }
    }
    const { data, error } = await supabase.rpc("card_lot_sell", {
      p_lot_id: lotId,
      p_platform: typeof body?.platform === "string" ? body.platform : "ebay",
      p_sale_price: salePrice,
      p_fees: fees,
      p_ship_income: shipIncome,
      p_ship_cost: shipCost,
      p_order_ref: (body?.orderRef as string) || `lot-${lotId}-${salePrice}`,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, ...(data as object) });
  }

  if (op === "reverse") {
    const { data, error } = await supabase.rpc("card_lot_unsell", { p_lot_id: lotId });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, ...(data as object) });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}

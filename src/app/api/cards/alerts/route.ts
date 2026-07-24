import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

// Price alerts / watchlist. GET = your alerts + each card's current value.
// POST { op: "set", cardId, kind, target, direction, thresholdPct, windowDays, note? }
//      { op: "clear", cardId }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data } = await supabase
    .from("card_alerts")
    .select("card_id, kind, target_price, direction, threshold_pct, window_days, note, created_at, cards ( player, year, set_name, market_value, manual_price, status )")
    .order("created_at", { ascending: false })
    .limit(500);
  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { op?: string; cardId?: string; kind?: string; target?: number; direction?: string; thresholdPct?: number; windowDays?: number; note?: string }
    | null;
  const cardId = body?.cardId;
  if (!cardId || !UUID.test(cardId)) return NextResponse.json({ error: "cardId required." }, { status: 400 });

  if (body?.op === "clear") {
    await supabase.from("card_alerts").delete().eq("card_id", cardId);
    return NextResponse.json({ ok: true });
  }
  if (body?.op === "set") {
    const note = body.note?.slice(0, 200) ?? null;
    // A %-move watch: fires when the card moves ≥ threshold% within window days.
    if (body.kind === "pct_move") {
      const thresholdPct = Number(body.thresholdPct);
      const windowDays = Math.round(Number(body.windowDays));
      if (!(thresholdPct > 0)) return NextResponse.json({ error: "A positive % move is required." }, { status: 400 });
      if (!(windowDays > 0 && windowDays <= 3650)) return NextResponse.json({ error: "A valid window in days is required." }, { status: 400 });
      const { error } = await supabase.from("card_alerts").upsert(
        { card_id: cardId, kind: "pct_move", threshold_pct: thresholdPct, window_days: windowDays, target_price: null, direction: "above", note },
        { onConflict: "card_id" },
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    // Default: a target-price watch.
    const target = Number(body.target);
    if (!(target > 0)) return NextResponse.json({ error: "A positive target price is required." }, { status: 400 });
    const direction = body.direction === "below" ? "below" : "above";
    const { error } = await supabase.from("card_alerts").upsert(
      { card_id: cardId, kind: "target", target_price: target, direction, threshold_pct: null, window_days: null, note },
      { onConflict: "card_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}

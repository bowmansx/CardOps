// Shareable showcases (Beau, 2026-07-20). Owner/card-access CRUD. A showcase is
// a public, link-shareable gallery of chosen cards (a group, or all live cards).
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newToken = () => randomBytes(9).toString("base64url");

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabase
    .from("card_showcases")
    .select("id, token, title, card_ids, show_prices, for_sale, is_public, contact, created_at")
    .order("created_at", { ascending: false });
  return NextResponse.json({ showcases: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await request.json().catch(() => null)) as
    | { op?: string; id?: string; title?: string; groupId?: string; showPrices?: boolean; forSale?: boolean; isPublic?: boolean; contact?: string }
    | null;

  const fields = {
    title: (b?.title ?? "My Showcase").slice(0, 120),
    show_prices: b?.showPrices !== false,
    for_sale: !!b?.forSale,
    is_public: b?.isPublic !== false,
    contact: b?.contact?.slice(0, 200) ?? null,
  };

  if (b?.op === "update") {
    if (!b.id || !UUID.test(b.id)) return NextResponse.json({ error: "id required." }, { status: 400 });
    const { error } = await supabase
      .from("card_showcases")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", b.id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // create: card_ids from a group, or empty (= all live cards, resolved live).
  // Guard: a chosen group MUST resolve to at least one card — otherwise the
  // empty array is indistinguishable from "all live" and would publicly expose
  // the whole inventory instead of the (empty) group the user picked.
  let cardIds: string[] = [];
  if (b?.groupId && UUID.test(b.groupId)) {
    // Paged: `.limit(2000)` is capped at 1000, which would silently publish only
    // part of a large group. (2026-07-24)
    const { rows: gm } = await readAllSafe<{ card_id: string }>((from, to) =>
      supabase.from("card_group_items").select("card_id").eq("group_id", b.groupId!)
        .order("card_id", { ascending: true }).range(from, to));
    cardIds = gm.map((x) => x.card_id);
    if (!cardIds.length) {
      return NextResponse.json({ error: "That group has no cards yet — add some first, or pick “All live cards”." }, { status: 400 });
    }
  }
  const { data: row, error } = await supabase
    .from("card_showcases")
    .insert({ user_id: user.id, token: newToken(), card_ids: cardIds, ...fields })
    .select("id, token, title, card_ids, show_prices, for_sale, is_public, contact, created_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, showcase: row });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return NextResponse.json({ error: "id required." }, { status: 400 });
  await supabase.from("card_showcases").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

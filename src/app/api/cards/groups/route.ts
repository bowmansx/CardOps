import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

// Card groups / folders. GET = list groups + counts.
// POST { op: "create", name, color? }
//      { op: "rename", groupId, name }  { op: "delete", groupId }
//      { op: "add"|"remove", groupId, cardIds[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanIds = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && UUID.test(s)).slice(0, 500) : [];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: groups } = await supabase
    .from("card_groups").select("id, name, color, sort, card_group_items(count)").order("sort").order("name");
  const shaped = (groups ?? []).map((g) => ({
    id: g.id, name: g.name, color: g.color,
    count: Array.isArray(g.card_group_items) ? (g.card_group_items[0]?.count ?? 0) : 0,
  }));
  return NextResponse.json({ groups: shaped });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { op?: string; name?: string; color?: string; groupId?: string; cardIds?: unknown }
    | null;
  const op = body?.op;

  if (op === "create") {
    const name = body?.name?.trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Name required." }, { status: 400 });
    const { data, error } = await supabase.from("card_groups")
      .insert({ name, color: body?.color?.slice(0, 20) ?? null }).select("id, name, color").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Seed members if cards were passed with create.
    const ids = cleanIds(body?.cardIds);
    if (ids.length) await supabase.from("card_group_items").upsert(ids.map((card_id) => ({ group_id: data.id, card_id })), { onConflict: "group_id,card_id" });
    return NextResponse.json({ ok: true, group: data });
  }

  const groupId = typeof body?.groupId === "string" && UUID.test(body.groupId) ? body.groupId : null;
  if (!groupId) return NextResponse.json({ error: "groupId required." }, { status: 400 });

  if (op === "rename") {
    const name = body?.name?.trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Name required." }, { status: 400 });
    const { error } = await supabase.from("card_groups").update({ name, ...(body?.color ? { color: body.color.slice(0, 20) } : {}) }).eq("id", groupId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (op === "delete") {
    const { error } = await supabase.from("card_groups").delete().eq("id", groupId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (op === "add") {
    const ids = cleanIds(body?.cardIds);
    if (ids.length) await supabase.from("card_group_items").upsert(ids.map((card_id) => ({ group_id: groupId, card_id })), { onConflict: "group_id,card_id" });
    return NextResponse.json({ ok: true, added: ids.length });
  }
  if (op === "remove") {
    const ids = cleanIds(body?.cardIds);
    if (ids.length) await supabase.from("card_group_items").delete().eq("group_id", groupId).in("card_id", ids);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}

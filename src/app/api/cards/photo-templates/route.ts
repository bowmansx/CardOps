// Photo templates (Beau, 2026-07-25) — CAPTURE_WORK_ITEMS.md P3.
// An ordered list of shots the camera walks: "CORNER 2 of 12".
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { PHOTO_ROLES, normalizeShots, type TemplateShot } from "@/lib/cards/templates";

export const dynamic = "force-dynamic";

const MAX_TEMPLATES = 30;

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!hasCardAccess(await currentRole())) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { supabase, userId: user.id };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  const { data, error } = await g.supabase!
    .from("card_photo_templates")
    .select("id, key, name, shots, user_id")
    .eq("archived", false)
    .order("sort", { ascending: true })
    .order("key", { ascending: true })
    .limit(MAX_TEMPLATES + 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    templates: (data ?? []).map((t) => ({
      id: t.id as string,
      key: t.key as string,
      name: t.name as string,
      builtIn: t.user_id === null,
      // Normalized on the way out: a template written before a role existed
      // must not present a shot that card_photos would refuse at the END of a
      // twelve-photo run.
      shots: normalizeShots(t.shots),
    })),
    roles: PHOTO_ROLES,
  });
}

export async function POST(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as { name?: string; shots?: unknown } | null;
  const name = String(b?.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Name the template." }, { status: 400 });

  const shots: TemplateShot[] = normalizeShots(b?.shots);
  if (!shots.length) return NextResponse.json({ error: "A template needs at least one shot." }, { status: 400 });
  if (shots.length > 40) return NextResponse.json({ error: "40 shots is the most a template can hold." }, { status: 400 });

  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (key.length < 2) return NextResponse.json({ error: "That name needs at least two letters or digits." }, { status: 400 });

  // The cap counts a user's OWN templates; the built-ins are not theirs to
  // spend. Overwriting a name they already have doesn't add a row either.
  const { data: existing, error: exErr } = await g.supabase!
    .from("card_photo_templates").select("id").eq("user_id", g.userId).eq("key", key).maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) {
    const { count, error: cErr } = await g.supabase!
      .from("card_photo_templates").select("id", { count: "exact", head: true }).eq("user_id", g.userId);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if ((count ?? 0) >= MAX_TEMPLATES) {
      return NextResponse.json({ error: `You can keep up to ${MAX_TEMPLATES} templates. Delete one first.` }, { status: 400 });
    }
  }

  const { data, error } = await g.supabase!
    .from("card_photo_templates")
    .upsert({ user_id: g.userId, key, name, shots }, { onConflict: "user_id,key" })
    .select("id, key, name, shots")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, template: { ...data, builtIn: false, shots } });
}

export async function DELETE(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which template?" }, { status: 400 });
  // RLS already prevents touching a built-in (user_id is null), but say why
  // rather than reporting a silent no-op as success.
  const { data, error } = await g.supabase!
    .from("card_photo_templates").delete().eq("id", id).eq("user_id", g.userId).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) return NextResponse.json({ error: "That's a built-in template — it can't be deleted." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

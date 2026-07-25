// Named photo-capture presets (Beau, 2026-07-25) — CAPTURE_WORK_ITEMS.md P2.
// "Bulk intake" vs "consignment quality": switching working modes is one tap
// instead of re-tuning six knobs. RLS scopes every row to the caller.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { normalizePhotoPrefs, type PhotoPrefs } from "@/lib/cards/photo-prefs";

export const dynamic = "force-dynamic";

const MAX_PRESETS = 20; // a guardrail, not a product limit

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
  // Small by construction (capped at MAX_PRESETS), so one page is the whole set.
  const { data, error } = await g.supabase!
    .from("card_photo_presets")
    .select("id, name, settings")
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_PRESETS + 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    presets: (data ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      // Normalize on the way out: a preset written before a setting existed
      // must still apply cleanly rather than half-apply.
      settings: normalizePhotoPrefs(p.settings as Partial<Record<keyof PhotoPrefs, unknown>>),
    })),
  });
}

export async function POST(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as { name?: string; settings?: unknown } | null;
  const name = String(b?.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Name the preset." }, { status: 400 });

  // The cap applies to NEW names only — overwriting a preset you already have
  // doesn't add a row, and refusing that would be nonsense.
  const { data: existing, error: exErr } = await g.supabase!
    .from("card_photo_presets").select("id").eq("name", name).maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) {
    const { count, error: countErr } = await g.supabase!
      .from("card_photo_presets").select("id", { count: "exact", head: true });
    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
    if ((count ?? 0) >= MAX_PRESETS) {
      return NextResponse.json({ error: `You can keep up to ${MAX_PRESETS} presets. Delete one first.` }, { status: 400 });
    }
  }

  const settings = normalizePhotoPrefs(b?.settings as Partial<Record<keyof PhotoPrefs, unknown>> | null);
  const { data, error } = await g.supabase!
    .from("card_photo_presets")
    .upsert({ user_id: g.userId, name, settings }, { onConflict: "user_id,name" })
    .select("id, name, settings")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, preset: { ...data, settings } });
}

export async function DELETE(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which preset?" }, { status: 400 });
  const { error } = await g.supabase!.from("card_photo_presets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Per-user CardOps preferences (Beau, 2026-07-24). Currently the automatic
// estimate policy. RLS scopes every row to the caller, so no owner gate.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { normalizePhotoPrefs, PHOTO_PREF_DEFAULTS, type PhotoPrefs } from "@/lib/cards/photo-prefs";

export const dynamic = "force-dynamic";

const AUTO = ["off", "A", "B", "both"];
const DEPTH = ["light", "deep"];
const PHOTO_COLS =
  "capture_mode, photo_quality, auto_snap, burst_count, auto_crop, crop_margin_pct, keep_originals, default_template";
const COLS = `auto_estimate, estimate_model, ${PHOTO_COLS}`;

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
  // Pre-migration safety: if the photo columns aren't applied yet, fall back to
  // the estimate columns rather than 500-ing the settings screen.
  let row = (await g.supabase!.from("card_user_prefs").select(COLS).maybeSingle()).data as Record<string, unknown> | null;
  if (row === null) {
    const legacy = await g.supabase!.from("card_user_prefs").select("auto_estimate, estimate_model").maybeSingle();
    row = legacy.data as Record<string, unknown> | null;
  }
  return NextResponse.json({
    prefs: {
      auto_estimate: row?.auto_estimate ?? "both",
      estimate_model: row?.estimate_model ?? "light",
      // Normalized here so the camera and the settings screen can never
      // disagree about what a stored value means.
      ...normalizePhotoPrefs(row as Partial<Record<keyof PhotoPrefs, unknown>> | null),
    },
  });
}

export async function PUT(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as { auto_estimate?: string; estimate_model?: string } | null;
  const patch: Record<string, unknown> = { user_id: g.userId, updated_at: new Date().toISOString() };
  if (b?.auto_estimate !== undefined) {
    if (!AUTO.includes(String(b.auto_estimate))) return NextResponse.json({ error: "Bad value." }, { status: 400 });
    patch.auto_estimate = b.auto_estimate;
  }
  if (b?.estimate_model !== undefined) {
    if (!DEPTH.includes(String(b.estimate_model))) return NextResponse.json({ error: "Bad value." }, { status: 400 });
    patch.estimate_model = b.estimate_model;
  }
  // Photo prefs: normalize the whole bag, then write only the keys the caller
  // actually sent, so a patch can't silently reset the others to defaults.
  const photoKeys = Object.keys(PHOTO_PREF_DEFAULTS) as (keyof PhotoPrefs)[];
  const sent = photoKeys.filter((k) => (b as Record<string, unknown> | null)?.[k] !== undefined);
  if (sent.length) {
    const clean = normalizePhotoPrefs(b as Partial<Record<keyof PhotoPrefs, unknown>>);
    for (const k of sent) patch[k] = clean[k];
  }

  const { data, error } = await g.supabase!.from("card_user_prefs").upsert(patch, { onConflict: "user_id" }).select(COLS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, prefs: data });
}

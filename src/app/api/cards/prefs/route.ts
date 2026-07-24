// Per-user CardOps preferences (Beau, 2026-07-24). Currently the automatic
// estimate policy. RLS scopes every row to the caller, so no owner gate.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

const AUTO = ["off", "A", "B", "both"];
const DEPTH = ["light", "deep"];
const COLS = "auto_estimate, estimate_model";

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
  const { data } = await g.supabase!.from("card_user_prefs").select(COLS).maybeSingle();
  // No row yet = the documented defaults (on, cheap model).
  return NextResponse.json({ prefs: data ?? { auto_estimate: "both", estimate_model: "light" } });
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
  const { data, error } = await g.supabase!.from("card_user_prefs").upsert(patch, { onConflict: "user_id" }).select(COLS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, prefs: data });
}

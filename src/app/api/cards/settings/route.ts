import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { cardOpsPrefs } from "@/lib/cards/settings";

export const dynamic = "force-dynamic";

// CardOps prefs, kept in user_settings.prefs.cardops. GET returns the merged
// prefs; PATCH deep-merges the patch into prefs.cardops (never clobbers the
// MasterOps prefs — ticker/cal/todo — that share the same jsonb).
async function loadPrefs(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from("user_settings").select("prefs").eq("user_id", userId).maybeSingle();
  return (data?.prefs as Record<string, unknown> | null) ?? {};
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ prefs: cardOpsPrefs(await loadPrefs(supabase, user.id)) });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // CardOps prefs are the owner's (grading fees drive the EV engine, etc.).
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!patch || typeof patch !== "object") return NextResponse.json({ error: "Bad body." }, { status: 400 });

  const prefs = await loadPrefs(supabase, user.id);
  const cur = (prefs.cardops as Record<string, unknown>) ?? {};
  const merged = { ...prefs, cardops: { ...cur, ...patch } };
  const { error } = await supabase.from("user_settings").upsert({ user_id: user.id, prefs: merged }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, prefs: cardOpsPrefs(merged) });
}

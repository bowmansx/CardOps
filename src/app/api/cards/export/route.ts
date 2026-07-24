import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildCsv, BUILTIN_PROFILES, type FormatProfile } from "@/lib/cards/export";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

// GET  /api/cards/export?profile=<name>&status=<opt>&ids=<opt csv of uuids>
// POST /api/cards/export  { profile?, status?, ids?: string[] }
// Both → text/csv download. POST is how the bulk page exports a large
// selection (hundreds of ids won't fit in a GET URL). ids = export exactly
// those cards. Authed + card-access gated by RLS.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function build(
  supabase: SupabaseClient,
  profileName: string,
  status: string | null,
  idsRaw: string[] | null,
): Promise<Response> {
  // idsRaw === null → no id filter (whole inventory). A non-null list that
  // validates to empty means "the caller asked for specific cards but none
  // were valid" — fail closed rather than dumping everything.
  const ids = idsRaw == null ? null : idsRaw.filter((s) => typeof s === "string" && UUID.test(s));
  if (ids != null && ids.length === 0) {
    return Response.json({ error: "No valid card ids in the selection." }, { status: 400 });
  }

  const { data: dbProfile } = await supabase
    .from("card_format_profiles")
    .select("name, column_order, field_map")
    .eq("name", profileName)
    .in("direction", ["export", "both"])
    .eq("active", true)
    .maybeSingle();
  // hasOwn avoids matching inherited props like "constructor"/"__proto__".
  const profile = dbProfile ?? (Object.hasOwn(BUILTIN_PROFILES, profileName) ? BUILTIN_PROFILES[profileName] : null);
  if (!profile) return Response.json({ error: `Unknown profile "${profileName}".` }, { status: 404 });

  // Page through (stable id order) so an export is never silently truncated.
  const PAGE = 1000;
  const MAX = 100_000;
  const all: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    let q = supabase.from("cards").select("*").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (status) q = q.eq("status", status);
    if (ids) q = q.in("id", ids);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    all.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }

  const csv = buildCsv(all, profile as FormatProfile);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cardops-${profileName}-${stamp}.csv"`,
    },
  });
}

async function gate(): Promise<{ supabase: SupabaseClient } | { error: Response }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Not signed in." }, { status: 401 }) };
  if (!hasCardAccess(await currentRole())) {
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { supabase };
}

export async function GET(req: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  return build(
    g.supabase,
    url.searchParams.get("profile") || "generic_full",
    url.searchParams.get("status"),
    idsParam == null ? null : idsParam.split(",").map((s) => s.trim()),
  );
}

export async function POST(req: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as
    | { profile?: string; status?: string; ids?: unknown }
    | null;
  const ids = Array.isArray(body?.ids) ? (body!.ids as unknown[]).map(String) : null;
  return build(g.supabase, body?.profile || "generic_full", body?.status ?? null, ids);
}

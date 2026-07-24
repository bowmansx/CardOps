// CardOps businesses (Beau, 2026-07-24). Each CardOps user manages their OWN
// businesses — what a card is attributed to, carrying the tax treatment and the
// bookkeeping connection (Zoho org today, QuickBooks later). RLS scopes every row
// to the caller (card_businesses.user_id = auth.uid()), so no owner gate here:
// a card user manages their own, which is what makes CardOps standalone.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { getConnector } from "@/lib/cards/connectors";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = "id, name, short_code, type, zoho_books_org_id, connector, active, created_at";
const TYPES = ["llc", "s_corp", "c_corp", "partnership", "sole_prop", "personal", "trust"];

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!hasCardAccess(await currentRole())) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { supabase };
}

function clean(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 120);
  const short_code = String(b.short_code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const type = TYPES.includes(String(b.type ?? "")) ? String(b.type) : null;
  const org = String(b.zoho_books_org_id ?? "").trim().slice(0, 40) || null;
  return { name, short_code, type, zoho_books_org_id: org };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  const { data } = await g.supabase!.from("card_businesses").select(COLS).order("short_code");
  return NextResponse.json({ businesses: data ?? [] });
}

export async function POST(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const v = clean(b);
  if (!v.name) return NextResponse.json({ error: "Give the business a name." }, { status: 400 });
  if (!v.short_code) return NextResponse.json({ error: "Give it a short code (letters/numbers)." }, { status: 400 });

  // user_id fills from the column default (auth.uid()); RLS enforces it.
  const { data, error } = await g.supabase!.from("card_businesses").insert(v).select(COLS).maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `You already have a business with code ${v.short_code}.` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, business: data });
}

export async function PATCH(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = String(b?.id ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "id required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (b?.name !== undefined || b?.short_code !== undefined || b?.type !== undefined || b?.zoho_books_org_id !== undefined) {
    const v = clean({ ...b });
    if (b?.name !== undefined) { if (!v.name) return NextResponse.json({ error: "Name can't be empty." }, { status: 400 }); patch.name = v.name; }
    if (b?.short_code !== undefined) { if (!v.short_code) return NextResponse.json({ error: "Short code can't be empty." }, { status: 400 }); patch.short_code = v.short_code; }
    if (b?.type !== undefined) patch.type = v.type;
    if (b?.zoho_books_org_id !== undefined) patch.zoho_books_org_id = v.zoho_books_org_id;
  }
  if (typeof b?.active === "boolean") patch.active = b.active;
  // Which bookkeeping backend this business syncs to (null = CardOps' books only).
  if (b?.connector !== undefined) {
    const c = String(b.connector ?? "");
    patch.connector = c && getConnector(c) ? c : null;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await g.supabase!.from("card_businesses").update(patch).eq("id", id).select(COLS).maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "You already have a business with that code." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, business: data });
}

export async function DELETE(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return NextResponse.json({ error: "id required." }, { status: 400 });
  const { error } = await g.supabase!.from("card_businesses").delete().eq("id", id);
  if (error) {
    // FK from cards/receipts/journal — a business in use can't be removed, only retired.
    if (error.code === "23503") {
      return NextResponse.json({ error: "This business is used by cards or bookkeeping records — mark it inactive instead." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

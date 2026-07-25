// Cost-basis breakdown (Beau, 2026-07-25). The line items that make up a
// card's Total Cost Basis: grading, appraisal, sales tax, shipping in — plus
// whatever kinds the user invents.
//
// The DB is the authority here: guard_card_basis_item enforces same-owner,
// resolves the kind, refuses a sold card and floors the total at zero, and
// sync_card_basis_items_total keeps cards.basis_items_total exact. This route
// carries requests and surfaces failures; it does not re-implement the rules.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 500; // per card; a guardrail, not a product limit

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!hasCardAccess(await currentRole())) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { supabase, userId: user.id };
}

/** GET ?cardId=… → the card's cost lines plus the kinds it can use. */
export async function GET(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const cardId = new URL(request.url).searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "Which card?" }, { status: 400 });

  // Paged to completion: this feeds a displayed SUM, so a silent 1000-row cut
  // would render a confident wrong number (prevention rules 4 and 5).
  const items = await readAllSafe<{
    id: string; kind_key: string; label: string; amount: number;
    incurred_on: string | null; note: string | null;
  }>(
    (from, to) => g.supabase!
      .from("card_basis_items")
      .select("id, kind_key, label, amount, incurred_on, note")
      .eq("card_id", cardId)
      .order("incurred_on", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, to),
    MAX_ITEMS,
  );

  const { data: kinds, error: kindErr } = await g.supabase!
    .from("card_basis_item_kinds")
    .select("key, label")
    .eq("archived", false)
    .order("sort", { ascending: true })
    .order("key", { ascending: true });
  if (kindErr) return NextResponse.json({ error: kindErr.message }, { status: 500 });

  return NextResponse.json({
    items: items.rows,
    kinds: kinds ?? [],
    total: items.rows.reduce((s, i) => s + Number(i.amount ?? 0), 0),
    // The caller MUST render these rather than a total computed from part of
    // the data — an incomplete read is not a smaller number, it's an unknown one.
    partial: !!items.error,
    truncated: items.truncated,
  });
}

/** POST — add a line, or create a custom kind. */
export async function POST(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as {
    op?: string; cardId?: string; kind_key?: string; label?: string;
    amount?: number | string; incurred_on?: string | null; note?: string | null;
  } | null;

  if (b?.op === "kind") {
    const label = String(b.label ?? "").trim().slice(0, 60);
    if (!label) return NextResponse.json({ error: "Name the cost type." }, { status: 400 });
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    if (key.length < 2) return NextResponse.json({ error: "That name needs at least two letters or digits." }, { status: 400 });
    const { data, error } = await g.supabase!
      .from("card_basis_item_kinds")
      .upsert({ user_id: g.userId, key, label }, { onConflict: "user_id,key" })
      .select("key, label")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, kind: data });
  }

  if (!b?.cardId) return NextResponse.json({ error: "Which card?" }, { status: 400 });
  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  if (!b.kind_key) return NextResponse.json({ error: "Pick a cost type." }, { status: 400 });

  const { data, error } = await g.supabase!
    .from("card_basis_items")
    .insert({
      card_id: b.cardId,
      user_id: g.userId,
      kind_key: b.kind_key,
      label: (b.label ?? "").trim() || b.kind_key,
      amount: Math.round(amount * 100) / 100,
      incurred_on: b.incurred_on || null,
      note: (b.note ?? "")?.toString().trim() || null,
    })
    .select("id, kind_key, label, amount, incurred_on, note")
    .single();
  // The guards raise plain-language messages ("this card is sold — …"), so
  // pass them through rather than replacing them with a generic failure.
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data });
}

/** PATCH — edit a line. Beau: "these can be edited/added later." */
export async function PATCH(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const b = (await request.json().catch(() => null)) as {
    id?: string; amount?: number | string; label?: string; incurred_on?: string | null; note?: string | null;
  } | null;
  if (!b?.id) return NextResponse.json({ error: "Which line?" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.amount !== undefined) {
    const amount = Number(b.amount);
    if (!Number.isFinite(amount)) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
    patch.amount = Math.round(amount * 100) / 100;
  }
  if (b.label !== undefined) patch.label = String(b.label).trim().slice(0, 60) || null;
  if (b.incurred_on !== undefined) patch.incurred_on = b.incurred_on || null;
  if (b.note !== undefined) patch.note = String(b.note ?? "").trim() || null;

  const { data, error } = await g.supabase!
    .from("card_basis_items").update(patch).eq("id", b.id)
    .select("id, kind_key, label, amount, incurred_on, note").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "That line is gone." }, { status: 404 });
  return NextResponse.json({ ok: true, item: data });
}

export async function DELETE(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which line?" }, { status: 400 });
  const { error } = await g.supabase!.from("card_basis_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

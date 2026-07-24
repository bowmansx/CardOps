import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { CARD_STATUSES } from "@/lib/cards/types";

export const dynamic = "force-dynamic";

// Bulk-edit selected cards: status / storage / zone / pricing strategy in one
// shot. Allowlisted fields only; RLS still decides what the caller may write
// (card_ops can update but never delete — archiving via status is the
// sanctioned path).
// POST { ids: string[], patch: { status?, storage_location?, zone?, location_code?, pricing_strategy? } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Free-text fields where an empty value legitimately clears the column.
const TEXT_FIELDS = ["storage_location", "zone", "location_code"] as const;
const MAX_IDS = 1000; // matches the bulk page's card load

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const role = await currentRole();
  if (!hasCardAccess(role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { ids?: unknown; patch?: Record<string, unknown> }
    | null;
  const allIds = Array.isArray(body?.ids)
    ? body!.ids.filter((s): s is string => typeof s === "string" && UUID.test(s))
    : [];
  if (!allIds.length) return NextResponse.json({ error: "No cards selected." }, { status: 400 });
  if (allIds.length > MAX_IDS) {
    return NextResponse.json({ error: `Too many cards (${allIds.length}). Select ${MAX_IDS} or fewer at a time.` }, { status: 400 });
  }
  const ids = allIds;

  const patch: Record<string, string | null> = {};
  const p = body?.patch ?? {};
  if (typeof p.status === "string" && p.status) {
    if (!CARD_STATUSES.includes(p.status as (typeof CARD_STATUSES)[number])) {
      return NextResponse.json({ error: `Bad status "${p.status}".` }, { status: 400 });
    }
    if (p.status === "sold") {
      return NextResponse.json({ error: "Use the sell flow for sales — it draws basis and books P/L." }, { status: 400 });
    }
    patch.status = p.status;
  }
  for (const f of TEXT_FIELDS) {
    if (typeof p[f] === "string") {
      const v = (p[f] as string).trim().slice(0, 120);
      patch[f] = v || null; // empty string clears the field
    }
  }
  // pricing_strategy is NOT NULL + FK to card_pricing_strategies(key): a blank
  // or unknown value would 500 on a constraint, so validate against real keys.
  if (typeof p.pricing_strategy === "string" && p.pricing_strategy) {
    const { data: strat } = await supabase
      .from("card_pricing_strategies").select("key").eq("key", p.pricing_strategy).maybeSingle();
    if (!strat) return NextResponse.json({ error: `Unknown pricing strategy "${p.pricing_strategy}".` }, { status: 400 });
    patch.pricing_strategy = p.pricing_strategy;
  }
  // Tax classification — owner-only, like the business assignment (it drives the
  // owner-only books/journal, so staff must not silently change how a card is taxed).
  if (typeof p.tax_treatment === "string" && p.tax_treatment) {
    if (role !== "owner") return NextResponse.json({ error: "Only the owner can set a card's tax treatment." }, { status: 403 });
    if (!["dealer", "investment", "hobby"].includes(p.tax_treatment)) {
      return NextResponse.json({ error: `Bad tax treatment "${p.tax_treatment}".` }, { status: 400 });
    }
    patch.tax_treatment = p.tax_treatment;
  }
  // Reassign the owning business — owner-only (entities are owner-gated) and
  // validated against a real entity so the FK never 500s.
  if (typeof p.entity_id === "string" && p.entity_id) {
    if (role !== "owner") return NextResponse.json({ error: "Only the owner can reassign a card's business." }, { status: 403 });
    if (!UUID.test(p.entity_id)) return NextResponse.json({ error: "Bad business id." }, { status: 400 });
    const { data: ent } = await supabase.from("card_businesses").select("id").eq("id", p.entity_id).maybeSingle();
    if (!ent) return NextResponse.json({ error: "Unknown business." }, { status: 400 });
    patch.entity_id = p.entity_id;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  // Never bulk-touch sold cards — their books are settled.
  const { data, error } = await supabase
    .from("cards")
    .update(patch)
    .in("id", ids)
    .neq("status", "sold")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const updated = data?.length ?? 0;
  const skipped = ids.length - updated; // sold cards (or ones RLS hid)

  // Audit via the service client so card_ops edits are still attributable
  // (audit_log INSERT is owner-only under RLS).
  const svc = createServiceClient();
  await auditOrThrow(svc ?? supabase, {
    actor: "web", action: "cards_bulk_edit", target: `${user.id} · ${ids.length} selected`,
    payload: { patch, updated, skipped }, result: "ok",
  });
  return NextResponse.json({ ok: true, updated, skipped });
}

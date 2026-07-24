// Connector setup for one business (Beau, 2026-07-24). GET returns the backend
// options, the business's current wiring, its saved account map, and — when a
// backend + org are configured — that backend's real chart of accounts so the
// user can map ours -> theirs. PUT saves the mapping. Nothing posts here.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { connectorOptions, getConnector, SUGGESTED_ACCOUNTS, type ExternalAccount } from "@/lib/cards/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  // OWNER ONLY, not hasCardAccess. The Zoho credential is process-wide
  // (ZOHO_REFRESH_TOKEN), not a per-user grant, and the org id on a business row
  // is free text the caller chose. A card_ops member could therefore point their
  // own business at the owner's org id and use this route to read the owner's
  // real chart of accounts. Re-open this to members only once each user holds
  // their OWN OAuth grant. (2026-07-24)
  if ((await currentRole()) !== "owner") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { supabase };
}

export async function GET(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const supabase = g.supabase!;
  const businessId = new URL(request.url).searchParams.get("businessId");
  if (!businessId || !UUID.test(businessId)) return NextResponse.json({ error: "businessId required." }, { status: 400 });

  // RLS scopes this to the caller's own business.
  const { data: biz } = await supabase
    .from("card_businesses").select("id, name, short_code, connector, zoho_books_org_id").eq("id", businessId).maybeSingle();
  if (!biz) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const provider = (biz.connector as string | null) ?? null;
  const { data: mapRows } = await supabase
    .from("card_account_map").select("account_key, external_account_id, external_account_name")
    .eq("business_id", businessId).eq("provider", provider ?? "zoho");

  // Which internal keys this business's ledger actually uses (map those first).
  // Paged, and the error is NOT discarded: the mapping form is built solely from
  // usedKeys ∪ map, so a key missing here gets no field, can never be mapped, and
  // its entries are then refused by the push forever. `.limit(5000)` didn't do
  // what it looked like — PostgREST caps a request at 1000 rows. (2026-07-24)
  const PAGE = 1000;
  const keys = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("journal_entries").select("account").eq("entity_id", businessId)
      .order("account", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: `Couldn't read the ledger: ${error.message}` }, { status: 500 });
    for (const r of data ?? []) keys.add(r.account as string);
    if (!data || data.length < PAGE) break;
  }
  const usedKeys = [...keys].sort();

  // Pull their real chart of accounts when the backend is wired up.
  let accounts: ExternalAccount[] = [];
  let accountsError: string | null = null;
  const conn = provider ? getConnector(provider) : undefined;
  const orgId = (biz.zoho_books_org_id as string | null) ?? null;
  if (conn?.listAccounts && conn.enabled() && (!conn.needsOrg || orgId)) {
    try {
      accounts = await conn.listAccounts(orgId ?? "");
    } catch (e) {
      accountsError = e instanceof Error ? e.message : "Couldn't read the chart of accounts.";
    }
  }

  return NextResponse.json({
    business: biz,
    connectors: connectorOptions(),
    map: Object.fromEntries((mapRows ?? []).map((r) => [r.account_key, { id: r.external_account_id, name: r.external_account_name }])),
    usedKeys,
    suggested: SUGGESTED_ACCOUNTS,
    accounts,
    accountsError,
  });
}

export async function PUT(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const supabase = g.supabase!;
  const b = (await request.json().catch(() => null)) as
    | { businessId?: string; provider?: string; map?: Record<string, { id?: string; name?: string } | null> }
    | null;
  const businessId = String(b?.businessId ?? "");
  if (!UUID.test(businessId)) return NextResponse.json({ error: "businessId required." }, { status: 400 });
  const provider = b?.provider && getConnector(b.provider) ? b.provider : "zoho";
  const map = b?.map ?? {};

  const rows: Record<string, unknown>[] = [];
  const clearKeys: string[] = [];
  for (const [key, v] of Object.entries(map)) {
    if (!v?.id) { clearKeys.push(key); continue; }
    rows.push({
      business_id: businessId, provider, account_key: key,
      external_account_id: String(v.id).slice(0, 64),
      external_account_name: v.name ? String(v.name).slice(0, 160) : null,
      updated_at: new Date().toISOString(),
    });
  }

  if (clearKeys.length) {
    await supabase.from("card_account_map").delete().eq("business_id", businessId).eq("provider", provider).in("account_key", clearKeys);
  }
  if (rows.length) {
    const { error } = await supabase.from("card_account_map").upsert(rows, { onConflict: "business_id,provider,account_key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: rows.length, cleared: clearKeys.length });
}

// Push CardOps' ledger into a business's bookkeeping app (Beau, 2026-07-24).
//
// This is the one place CardOps writes to someone's real books. An adversarial
// review found several ways the first version could double-post, so it now works
// CLAIM-FIRST:
//
//   1. every read it depends on FAILS CLOSED — a failed read can never be
//      mistaken for "nothing has been posted yet"
//   2. the ledger is read with full pagination — a truncated read could otherwise
//      leave a FRAGMENT that balances on its own (a dealer sale is two
//      self-balancing halves: cash/fees/revenue and COGS/inventory), which would
//      post revenue with no cost of goods sold
//   3. entries must be complete (contiguous lines), balanced, in-org and fully
//      mapped — anything else is refused, never half-posted
//   4. each entry is CLAIMED in card_push_log *before* it is sent, so the unique
//      index is a real lock that fires BEFORE money moves; a concurrent run (two
//      tabs, or MasterOps + the CardOps app) loses the race and skips
//   5. a send whose outcome is unknown is quarantined as 'uncertain' and never
//      auto-retried — a duplicate in real books is worse than a visible gap
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { buildPushEntries, getConnector, type AccountMap, type LedgerRow } from "@/lib/cards/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 40; // entries per call, comfortably inside maxDuration; caller re-runs for the rest
const PAGE = 1000; // PostgREST caps rows per request — page explicitly rather than trusting a limit

const fail = (msg: string, status = 503) => NextResponse.json({ error: msg }, { status });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // OWNER ONLY — this is the one path that writes to REAL books, using the
  // process-wide ZOHO_REFRESH_TOKEN. The "never post to a different org" guard
  // in zoho.ts compares two values both derived from the caller's own business
  // row, so it cannot stop a member who typed the owner's org id. Until each
  // user holds their own OAuth grant, only the owner may push. (2026-07-24)
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await request.json().catch(() => null)) as { businessId?: string; confirm?: boolean } | null;
  const businessId = String(b?.businessId ?? "");
  if (!UUID.test(businessId)) return NextResponse.json({ error: "businessId required." }, { status: 400 });
  if (b?.confirm !== true) return NextResponse.json({ error: "Confirmation required." }, { status: 400 });

  // — business (RLS scopes to the caller) —
  const { data: biz, error: bizErr } = await supabase
    .from("card_businesses").select("id, short_code, connector, zoho_books_org_id").eq("id", businessId).maybeSingle();
  if (bizErr) return fail("Couldn't load the business — nothing was posted.");
  if (!biz) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const provider = (biz.connector as string | null) ?? "";
  const conn = getConnector(provider);
  if (!conn) return NextResponse.json({ error: "This business isn't connected to a bookkeeping app." }, { status: 400 });
  if (!conn.enabled()) return fail(`${conn.label} isn't configured in this environment.`);
  if (!conn.pushEntry) return NextResponse.json({ error: `${conn.label} can't post directly — use the CSV export.` }, { status: 400 });
  const orgId = (biz.zoho_books_org_id as string | null) ?? "";
  if (conn.needsOrg && !orgId) return NextResponse.json({ error: `Set ${biz.short_code}'s organization id first.` }, { status: 400 });

  // — account map (fail closed: an empty map would silently make everything "unmapped") —
  const { data: mapRows, error: mapErr } = await supabase
    .from("card_account_map").select("account_key, external_account_id")
    .eq("business_id", businessId).eq("provider", provider);
  if (mapErr) return fail("Couldn't load the account mapping — nothing was posted.");
  const accountMap: AccountMap = Object.fromEntries((mapRows ?? []).map((r) => [r.account_key as string, r.external_account_id as string]));

  // — ledger, fully paginated so no transaction is ever split mid-entry —
  const rows: LedgerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("journal_entries")
      .select("entity_id, entry_date, source, source_ref, line, account, debit, credit, memo")
      .eq("entity_id", businessId)
      .order("source_ref", { ascending: true }).order("line", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return fail("Couldn't read the ledger — nothing was posted.");
    rows.push(...((data ?? []) as LedgerRow[]));
    if (!data || data.length < PAGE) break;
    if (rows.length > 200_000) return fail("Ledger too large to push in one pass — contact support.");
  }

  const { entries } = buildPushEntries(rows, {
    businesses: new Map([[businessId, { org: orgId || null, code: String(biz.short_code) }]]),
    accountMapFor: () => accountMap,
  });

  // Eligible = right org, balanced, COMPLETE, every account mapped.
  const eligible = entries.filter(
    (e) => e.external_org_id === orgId && e.balanced && e.complete && e.lines.every((l) => l.account_id),
  );
  const notReady = entries.length - eligible.length;
  const batch = eligible.slice(0, BATCH);

  let posted = 0, skipped = 0, refused = 0, uncertain = 0;
  let aborted = false;
  const errors: string[] = [];

  for (const entry of batch) {
    // (4) CLAIM FIRST. The unique index on (business_id, provider, reference) is
    // the lock — if someone already claimed or posted this, we lose and skip.
    const { error: claimErr } = await supabase.from("card_push_log").insert({
      business_id: businessId, provider, reference: entry.reference,
      status: "pending", pushed_by: user.id,
    });
    if (claimErr) {
      if (claimErr.code === "23505") { skipped++; continue; } // already claimed/posted
      errors.push(`${entry.reference}: couldn't claim (${claimErr.message}) — stopping.`);
      aborted = true;
      break; // fail closed rather than post something we can't record
    }

    const res = await conn.pushEntry(entry, { orgId });

    if (res.ok) {
      posted++;
      await supabase.from("card_push_log")
        .update({ status: "posted", external_id: res.externalId ?? null, updated_at: new Date().toISOString() })
        .eq("business_id", businessId).eq("provider", provider).eq("reference", entry.reference);
    } else if (!res.attempted) {
      // Never sent — release the claim so it can be fixed and retried.
      refused++;
      errors.push(`${entry.reference}: ${res.error ?? "refused"}`);
      await supabase.from("card_push_log").delete()
        .eq("business_id", businessId).eq("provider", provider).eq("reference", entry.reference);
    } else {
      // (5) Sent, outcome unknown. Keep the claim so it is NEVER auto-retried.
      uncertain++;
      errors.push(`${entry.reference}: sent but unconfirmed (${res.error ?? "unknown"}) — check ${biz.short_code}'s books before retrying.`);
      await supabase.from("card_push_log")
        .update({ status: "uncertain", error: res.error ?? "unknown", updated_at: new Date().toISOString() })
        .eq("business_id", businessId).eq("provider", provider).eq("reference", entry.reference);
    }
  }

  return NextResponse.json({
    ok: true,
    business: biz.short_code,
    provider,
    pushed: posted,
    skipped_already_posted: skipped,
    refused,
    uncertain,
    aborted: aborted || undefined,
    not_ready: notReady,
    remaining: Math.max(0, eligible.length - batch.length),
    errors,
  });
}

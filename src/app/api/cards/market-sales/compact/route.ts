import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readAll } from "@/lib/supabase/page";
import { storedToSales, type StoredSale } from "@/lib/cards/market-sales";
import { rollupSales, type SaleForRollup } from "@/lib/cards/rollup";
import type { SaleProvenance } from "@/lib/cards/observed-sale";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// COMPACTION (2026-07-29) — individual sales into statistics that outlive them.
//
// Storage arithmetic forces the two-tier store: eBay does ~400-500K card
// transactions a day and The Card API's Pro plan permits 25M stored records, so
// individual sales cannot be kept forever. `rollup.ts` holds the pure maths;
// this is the job that feeds it.
//
// ADDITIVE ONLY. IT DELETES NOTHING.
//
// That is a deliberate limit, not an unfinished edge. Compaction is only useful
// if the hot rows eventually go, but deciding WHEN to drop a card's observed
// sales is a decision with no undo — the rollup keeps the statistics and loses
// the tap-through to individual listings, which is the evidence a provenance
// chip opens. Building the delete alongside the write would mean the first run
// that had a bug also destroyed the thing it was computed from. So the rollups
// accumulate beside the sales and stay verifiable against them, and dropping the
// hot rows is a separate, explicit decision for Beau.
//
// SERVICE ROLE, so RLS does not apply — see `reference/audit-2026-07-24.md`, the
// first of the two recurring bug classes. The scoping that matters here is not
// per-user: `card_market_sales` is shared by design and hangs off the identity.
// What matters is that a rollup is written for the right IDENTITY, which is why
// the loop is keyed on identity_id rather than on anything user-shaped.

/** Sales at least this old are stable enough to compact. */
const HOT_DAYS = 90;
/** Identities per run, so one invocation cannot run past its time budget. */
const IDENTITY_CAP = 200;

type Row = StoredSale & { identity_id: string; provenance?: SaleProvenance | null };

export async function POST(request: Request) {
  // Same posture as the other crons: the shared secret is the only caller check,
  // and while CRON_SECRET is unset on this project every call 401s. That is the
  // cutover interlock doing its job, not a bug (see CLAUDE.md).
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "no service client" }, { status: 500 });

  const cutoff = new Date(Date.now() - HOT_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Which identities have sales old enough to compact. A bounded page, because
  // this only needs enough work for one run — the next run takes the next slice.
  const { data: idRows, error: idErr } = await svc
    .from("card_market_sales")
    .select("identity_id")
    .not("identity_id", "is", null)
    .lte("sold_at", cutoff)
    .order("identity_id", { ascending: true })
    .limit(5000);
  if (idErr) return NextResponse.json({ error: idErr.message }, { status: 500 });

  const identities = [...new Set((idRows ?? []).map((r) => r.identity_id as string))];
  const slice = identities.slice(0, IDENTITY_CAP);

  let written = 0, identitiesDone = 0, undatedTotal = 0;
  const errors: string[] = [];
  let truncatedRead = false;

  for (const identityId of slice) {
    // ONE USER'S FAILURE MUST NOT STOP THE LOOP (rule 11) — here, one identity's.
    try {
      // readAll, not a bare limit: this feeds an AGGREGATE, and a partial read
      // would produce a median computed from part of the data while looking
      // exactly like a complete one (rule 5).
      const { rows, truncated } = await readAll<Row>((from, to) =>
        svc
          .from("card_market_sales")
          .select("identity_id, price, sold_at, grader, grade, platform, title, source, external_id, price_basis, is_graded, provenance")
          .eq("identity_id", identityId)
          .eq("pre_auto_split", false)
          .lte("sold_at", cutoff)
          .order("sold_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (truncated) truncatedRead = true;
      if (!rows.length) continue;

      // storedToSales resolves each row's basis — from the stored column where
      // there is one, else from the source that fetched it.
      const observed = storedToSales(rows);
      const forRollup: SaleForRollup[] = observed.map((o, i) => ({
        ...o,
        source: rows[i].source ?? "thecardapi",
        provenance: rows[i].provenance ?? "vendor",
      }));

      const { rows: rollups, undated } = rollupSales(identityId, forRollup, "week");
      undatedTotal += undated;
      if (!rollups.length) continue;

      const { error } = await svc
        .from("card_market_rollups")
        .upsert(rollups, { onConflict: "identity_id,period,period_start,grader,grade" });
      // Checked and surfaced, never assumed (rule 1). A silently failing upsert
      // here would look identical to "nothing needed compacting".
      if (error) { errors.push(`${identityId}: ${error.message}`); continue; }
      written += rollups.length;
      identitiesDone++;
    } catch (e) {
      errors.push(`${identityId}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff,
    identities_seen: identities.length,
    identities_done: identitiesDone,
    rollups_written: written,
    // A cap that says nothing reads as "everything is compacted" (rule 10).
    ...(identities.length > slice.length
      ? { capped_at: IDENTITY_CAP, identities_remaining: identities.length - slice.length }
      : {}),
    ...(undatedTotal ? { undated_sales_skipped: undatedTotal } : {}),
    ...(truncatedRead ? { partial_read: true } : {}),
    ...(errors.length ? { failed: errors.length, errors: errors.slice(0, 5) } : {}),
    // Stated in the response so nobody has to read the source to learn it.
    note: "Additive only — no sales were deleted. Dropping hot rows is a separate decision.",
  });
}

// EXECUTE A VENDOR'S DELETION CLAUSE (2026-08-02).
//
// The one destructive operation in the pricing stack, and the shape reflects
// that. `deleteOnTerminationDays` has been declared on the rights contract since
// it landed — The Card API §5 gives 30 days from cancellation — and nothing
// could carry it out. A licence term the code states and cannot perform reads,
// to anyone auditing this, as a commitment made and then ignored.
//
// THE GUARDS, and none of them is ceremony:
//
//   - PREVIEW BY DEFAULT. Without `confirm: true` this counts and deletes
//     nothing. A destructive operation whose blast radius is only visible
//     afterwards is not one anybody can consent to.
//   - OWNER ONLY. This crosses every tenant's rows; card_ops access is not
//     enough.
//   - NEVER FROM A CRON. There is no secret-header path in here on purpose.
//     Nothing in this app deletes on a schedule.
//   - VENDOR ROWS ONLY. Scope is (source AND provenance='vendor'). A user's own
//     sales and pasted comps sit in the same table and a vendor's terms have no
//     reach over them; sweeping them up would destroy work under cover of
//     compliance.
//   - ROLLUPS ARE REPORTED, NOT DELETED. Whether a statistic derived from a
//     vendor's rows is still that vendor's data is unsettled, and guessing
//     either way is wrong.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole } from "@/lib/cards/roles";
import { sourceRights } from "@/lib/cards/price-sources";
import { VENDOR_PROVENANCE, purgeNarrative, type PurgeScope } from "@/lib/cards/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Rows removed per statement. Bounded so one call can't hold a long transaction. */
const BATCH = 500;
/** Ceiling on a single request's deletions; the caller re-runs to continue. */
const MAX_PER_RUN = 20_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Owner only — this deletes rows belonging to every tenant's shared history.
  if ((await currentRole()) !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    { source?: string; confirm?: boolean } | null;
  const source = body?.source?.trim();
  if (!source) return NextResponse.json({ error: "source required." }, { status: 400 });

  // A source nobody declared has no terms to execute, and deleting by an
  // arbitrary string would let a typo empty the table.
  const rights = sourceRights(source);
  if (!rights) {
    return NextResponse.json({ error: `Unknown source "${source}" — no declared terms to act on.` }, { status: 400 });
  }

  // ── Count first, always ─────────────────────────────────────────────────
  const [vendor, mine, rollups] = await Promise.all([
    supabase.from("card_market_sales").select("id", { count: "exact", head: true })
      .eq("source", source).eq("provenance", VENDOR_PROVENANCE),
    supabase.from("card_market_sales").select("id", { count: "exact", head: true })
      .eq("source", source).neq("provenance", VENDOR_PROVENANCE),
    supabase.from("card_market_rollups").select("id", { count: "exact", head: true })
      .contains("sources", [source]),
  ]);

  // Rule 3/4: a failed count is not a count of zero, and a purge sized from a
  // failed read would report a blast radius it never measured.
  const failed = [vendor.error, mine.error, rollups.error].filter(Boolean);
  if (failed.length) {
    return NextResponse.json(
      { error: `Couldn't measure what a purge would touch (${failed[0]!.message}). Nothing was deleted.` },
      { status: 500 },
    );
  }

  const scope: PurgeScope = {
    sourceId: source,
    vendorSales: vendor.count ?? 0,
    userRowsKept: mine.count ?? 0,
    rollupsCarrying: rollups.count ?? 0,
    truncated: (vendor.count ?? 0) > MAX_PER_RUN,
  };

  if (!body?.confirm) {
    return NextResponse.json({
      preview: true, scope, narrative: purgeNarrative(scope),
      rights: { deleteOnTerminationDays: rights.deleteOnTerminationDays },
    });
  }

  // ── Confirmed: delete in bounded batches ────────────────────────────────
  //
  // THE SERVICE CLIENT, and it is required rather than convenient.
  // `card_market_sales` has no INSERT/UPDATE/DELETE policy at all — writes are
  // service-role only by design, because the price cron owns them. Under the
  // user client this delete matches zero rows and returns NO ERROR, so the
  // counter would report thousands of deletions having removed nothing and the
  // loop would re-read the same batch until it hit the ceiling.
  //
  // The audit's warning about service-role code (scope by user_id explicitly)
  // is satisfied differently here: the scope is SOURCE, and it is deliberately
  // cross-tenant. A vendor's termination clause covers every row fetched from
  // them, whoever's card it hangs off. `provenance='vendor'` is what keeps it
  // off anybody's own records.
  const admin = createServiceClient();
  if (!admin) {
    // No service key in this environment. Refusing is the only honest option:
    // running on the user client would delete nothing and report success, which
    // is worse than failing, because the obligation would look discharged.
    return NextResponse.json(
      { error: "No service key configured, so nothing can be deleted here. The obligation is NOT discharged." },
      { status: 503 },
    );
  }
  let deleted = 0;
  let more = false;
  for (;;) {
    // Select then delete by id. A bare `.delete().eq(...).limit()` is not
    // supported by PostgREST, and deleting the whole predicate at once would
    // hold one enormous transaction.
    const { data: batch, error: readErr } = await admin
      .from("card_market_sales").select("id")
      .eq("source", source).eq("provenance", VENDOR_PROVENANCE)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (readErr) {
      return NextResponse.json(
        { error: `Stopped after ${deleted} rows: ${readErr.message}`, deleted, partial: true },
        { status: 500 },
      );
    }
    const ids = (batch ?? []).map((r) => (r as { id: string }).id);
    if (!ids.length) break;

    // `.select("id")` makes the delete RETURN what it removed. Rule 7: the
    // count moves only once the effect is confirmed, and a delete that silently
    // affects nothing is the exact failure this guards — without it, a policy
    // change years from now turns this route into a no-op that still reports
    // success.
    const { data: gone, error: delErr } = await admin
      .from("card_market_sales").delete().in("id", ids).select("id");
    if (delErr) {
      return NextResponse.json(
        { error: `Stopped after ${deleted} rows: ${delErr.message}`, deleted, partial: true },
        { status: 500 },
      );
    }
    const removed = (gone ?? []).length;
    if (removed === 0) {
      return NextResponse.json(
        {
          error: `The delete removed nothing despite matching ${ids.length} rows — refusing to loop. Nothing further was attempted.`,
          deleted, partial: true,
        },
        { status: 500 },
      );
    }
    deleted += removed;

    if (deleted >= MAX_PER_RUN) { more = true; break; }
  }

  return NextResponse.json({
    preview: false,
    deleted,
    /** True when the run hit its ceiling — the caller must re-run to finish. */
    more,
    kept: { userRows: scope.userRowsKept, rollups: scope.rollupsCarrying },
    narrative:
      `Deleted ${deleted} sale${deleted === 1 ? "" : "s"} fetched from ${source}.` +
      (scope.userRowsKept ? ` Kept ${scope.userRowsKept} of your own rows.` : "") +
      (scope.rollupsCarrying ? ` ${scope.rollupsCarrying} compacted summaries still list ${source} — decide on those separately.` : "") +
      (more ? " The run hit its per-request ceiling; run it again to continue." : ""),
  });
}

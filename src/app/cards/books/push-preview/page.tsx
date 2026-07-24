import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readAllSafe } from "@/lib/supabase/page";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { buildPushEntries, type AccountMap, type LedgerRow } from "@/lib/cards/connectors";
import { releaseClaim } from "./actions";
import { PushToBooks } from "@/components/cards/PushToBooks";

export const dynamic = "force-dynamic";

// Sync preview (Beau, 2026-07-21, reworked 2026-07-24). Shows exactly what CardOps
// would post into each business's bookkeeping app — and, once a business is
// connected and mapped, lets you post it with an explicit confirmation. Entries
// already posted are marked and never sent twice.
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function PushPreviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasCardAccess(await currentRole())) redirect("/cards");

  // All three of these must be COMPLETE, and none of them were.
  //
  // The ledger was read `.order(entry_date desc).limit(4000)` — PostgREST caps a
  // request at 1000, so everything older than the cut simply vanished from the
  // preview. That undercounts "ready", which is interpolated straight into the
  // confirm dialog ("Post N entries … writes to your real bookkeeping"), and if
  // a business's entries all fell past the cut it reported ready === 0 and
  // DISABLED that business's Post button — making those entries unpostable from
  // the only UI that posts them. Ordering by (source_ref, line) also matches the
  // server's own paged read, so preview and push agree. card_push_log was
  // unbounded too, which would have shown already-posted entries as still ready.
  // (2026-07-24)
  const [{ data: bizRows }, ledger, { data: mapRows }, pushLog] = await Promise.all([
    supabase.from("card_businesses").select("id, name, short_code, connector, zoho_books_org_id"),
    readAllSafe<Record<string, unknown>>((from, to) =>
      supabase.from("journal_entries")
        .select("entity_id, entry_date, source, source_ref, line, account, debit, credit, memo")
        .order("source_ref", { ascending: true }).order("line", { ascending: true })
        .order("id", { ascending: true }) // advance halves tie on (source_ref, line)
        .range(from, to)),
    supabase.from("card_account_map").select("business_id, provider, account_key, external_account_id"),
    readAllSafe<{ business_id: string; reference: string; status: string; error: string | null; provider: string }>((from, to) =>
      supabase.from("card_push_log").select("business_id, reference, status, error, provider")
        .order("business_id", { ascending: true }).order("reference", { ascending: true })
        .range(from, to)),
  ]);
  const rows = ledger.rows;
  const pushed = pushLog.rows;
  const readError = ledger.error ?? pushLog.error;

  const bizList = bizRows ?? [];
  const businesses = new Map<string, { org: string | null; code: string }>(
    bizList.map((b) => [b.id as string, { org: (b.zoho_books_org_id as string | null) ?? null, code: b.short_code as string }]),
  );
  const bizById = new Map(bizList.map((b) => [b.id as string, b]));

  // Each business's account map, keyed by the backend that business uses.
  const maps = new Map<string, AccountMap>();
  for (const r of mapRows ?? []) {
    const biz = bizById.get(r.business_id as string);
    if (!biz || ((biz.connector as string | null) ?? "zoho") !== r.provider) continue;
    const m = maps.get(r.business_id as string) ?? {};
    m[r.account_key as string] = r.external_account_id as string;
    maps.set(r.business_id as string, m);
  }

  const { entries, businessesWithoutOrg, unmappedAccounts } = buildPushEntries(rows as unknown as LedgerRow[], {
    businesses,
    accountMapFor: (id) => (id ? maps.get(id) : undefined),
  });

  // Status-aware sets: only status='posted' earns the green chip. A stranded
  // pending/uncertain claim used to render as "posted" forever — the worst
  // possible lie on a money screen. Any log row still BLOCKS a re-claim
  // (unique index), so stuck refs are excluded from "ready" too.
  const alreadyPosted = new Set(pushed.filter((p) => p.status === "posted").map((p) => `${p.business_id}::${p.reference}`));
  const claimBlocked = new Set(pushed.map((p) => `${p.business_id}::${p.reference}`));
  const stuck = pushed.filter((p) => p.status === "pending" || p.status === "uncertain");
  const isPosted = (e: (typeof entries)[number]) => !!e.business_id && alreadyPosted.has(`${e.business_id}::${e.reference}`);
  const isStuck = (e: (typeof entries)[number]) =>
    !!e.business_id && claimBlocked.has(`${e.business_id}::${e.reference}`) && !alreadyPosted.has(`${e.business_id}::${e.reference}`);
  // What the Post buttons will actually send — excludes posted AND stuck claims.
  const sendable = (e: (typeof entries)[number]) =>
    !!e.business_id && !!e.external_org_id && e.balanced && e.complete
    && e.lines.every((l) => l.account_id)
    && !claimBlocked.has(`${e.business_id}::${e.reference}`);
  const postable = entries.filter(sendable).length;

  // Per-business readiness, for the Post buttons.
  const perBiz = new Map<string, { code: string; connector: string | null; ready: number; total: number }>();
  for (const e of entries) {
    if (!e.business_id) continue;
    const b = bizById.get(e.business_id);
    const cur = perBiz.get(e.business_id) ?? { code: e.business_code, connector: (b?.connector as string | null) ?? null, ready: 0, total: 0 };
    cur.total += 1;
    if (sendable(e)) cur.ready += 1;
    perBiz.set(e.business_id, cur);
  }

  const shown = entries.slice(0, 60);
  const chip = "rounded-full border border-hairline bg-white px-2 py-0.5 text-[10px] font-semibold text-ink/60";

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sync to your books</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/businesses" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Businesses</Link>
            <Link href="/cards/books" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Books</Link>
          </span>
        </header>

        <div className="mt-3 rounded-xl border border-hairline bg-white px-3 py-2.5 text-[11px] leading-snug text-ink/60">
          CardOps keeps its own books either way. This is the <b>mirror</b> — one journal per transaction, routed to each
          business&apos;s bookkeeping app. Nothing posts until you press <b>Post</b>, entries already sent are skipped, and
          anything unbalanced or not fully mapped is refused rather than half-posted.
        </div>

        {readError && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2.5 text-[11px] leading-snug text-danger">
            <b>Couldn&apos;t read the full ledger</b> — the counts below are incomplete, so don&apos;t treat
            &ldquo;ready&rdquo; as the real number. Reload before posting. ({readError})
          </div>
        )}

        {/* Readiness */}
        <div className="mt-3 grid grid-cols-3 divide-x divide-hairline overflow-hidden rounded-xl border border-hairline bg-white text-center">
          <div className="px-2 py-2.5"><div className="figures text-lg font-bold text-ink">{entries.length}</div><div className="text-[10px] uppercase tracking-wider text-ink/50">entries</div></div>
          <div className="px-2 py-2.5"><div className="figures text-lg font-bold text-ink">{alreadyPosted.size}</div><div className="text-[10px] uppercase tracking-wider text-ink/50">already posted</div></div>
          <div className="px-2 py-2.5"><div className={"figures text-lg font-bold " + (postable ? "text-pos" : "text-ink/40")}>{postable}</div><div className="text-[10px] uppercase tracking-wider text-ink/50">ready</div></div>
        </div>

        {/* Per-business post controls */}
        {perBiz.size > 0 && (
          <div className="mt-2 space-y-1.5">
            {[...perBiz.entries()].map(([id, b]) => (
              <div key={id} className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-ink">{b.code}</div>
                  <div className="figures text-[10px] text-ink/45">
                    {b.connector ? `syncs to ${b.connector}` : "not connected"} · {b.total} entries
                  </div>
                </div>
                {b.connector ? (
                  <PushToBooks businessId={id} code={b.code} label={b.connector} ready={b.ready} />
                ) : (
                  <Link href={`/cards/businesses/${id}/connect`} className="shrink-0 text-[11px] font-semibold text-flag hover:underline">Connect →</Link>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stuck claims — pending (crashed mid-push) or uncertain (sent, outcome
            unknown). Each needs a human decision: check the books, then either
            leave it (it IS posted) or release it to retry. */}
        {stuck.length > 0 && (
          <div className="mt-2 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="text-[11px] font-semibold text-amber-700">
              {stuck.length} stuck {stuck.length === 1 ? "claim" : "claims"} — verify in the business&apos;s books before releasing:
            </div>
            {stuck.map((s) => (
              <div key={`${s.business_id}::${s.reference}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="figures text-[11px] text-ink/70">{s.reference}</span>
                  <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-bold text-amber-700">{s.status}</span>
                  {s.error && <div className="truncate text-[10px] text-ink/45">{s.error}</div>}
                </div>
                <form action={releaseClaim}>
                  <input type="hidden" name="businessId" value={s.business_id} />
                  <input type="hidden" name="provider" value={s.provider} />
                  <input type="hidden" name="reference" value={s.reference} />
                  <button type="submit" className="shrink-0 rounded-lg border border-amber-600/50 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-500/10">
                    Release &amp; retry
                  </button>
                </form>
              </div>
            ))}
            <p className="text-[10px] leading-snug text-ink/45">
              <b>pending</b> = the push crashed before an outcome was recorded. <b>uncertain</b> = sent but Zoho&apos;s
              answer was lost. If the journal EXISTS in the books, leave it (releasing would post it twice) — it will
              show as posted once re-marked; if it does NOT exist, release it and Post again.
            </p>
          </div>
        )}

        {(businessesWithoutOrg.length > 0 || unmappedAccounts.length > 0) && (
          <div className="mt-2 space-y-2 rounded-xl border border-hairline bg-white p-3">
            <div className="text-[11px] font-semibold text-ink/70">Before these can post:</div>
            {businessesWithoutOrg.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">No org id</span>
                {businessesWithoutOrg.map((c) => <span key={c} className={chip}>{c}</span>)}
              </div>
            )}
            {unmappedAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">Unmapped</span>
                {unmappedAccounts.map((a) => <span key={a} className={chip}>{a}</span>)}
                <span className="text-[10px] text-ink/40">— map these on the business&apos;s Connect screen.</span>
              </div>
            )}
          </div>
        )}

        {/* Entries */}
        {entries.length === 0 ? (
          <p className="mt-6 text-center text-sm text-ink/45">No ledger entries yet — book a receipt or a sale first.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {shown.map((j, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-hairline bg-white">
                <div className="flex items-center justify-between border-b border-hairline bg-paper/50 px-3 py-1.5">
                  <span className="text-[11px] font-bold text-ink">{j.business_code}
                    <span className="ml-1.5 font-normal text-ink/45">{j.external_org_id ? `org ${j.external_org_id}` : "no org"}</span>
                    {isPosted(j) && <span className="ml-1.5 rounded bg-pos/12 px-1 py-px text-[9px] font-bold text-pos">posted</span>}
                    {isStuck(j) && <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-bold text-amber-700">claimed — verify</span>}
                  </span>
                  <span className="figures text-[10px] text-ink/40">{j.date} · {j.reference}</span>
                </div>
                <div>
                  {j.lines.map((l, k) => (
                    <div key={k} className="flex items-center gap-2 border-b border-hairline px-3 py-1 text-[11px] last:border-0">
                      <span className="flex-1 text-ink/70">{l.account_name}
                        {!l.account_id && <span className="ml-1 text-[9px] text-amber-600">·map</span>}
                      </span>
                      <span className="figures w-20 text-right text-ink">{l.side === "debit" ? money(l.amount) : ""}</span>
                      <span className="figures w-20 text-right text-ink/60">{l.side === "credit" ? money(l.amount) : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {entries.length > shown.length && (
              <p className="text-center text-[11px] text-ink/40">Showing {shown.length} of {entries.length} entries.</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

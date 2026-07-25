// Credits & AI margin (owner-only, 2026-07-25). The internal screen that
// makes the credit system priceable: per-feature, what we CHARGED (credits)
// vs what it actually COST (ai_usage dollars) — the number that says whether
// "12 credits for a deep estimate" is generous or suicidal, from data.
//
// Shadow mode: everything here records; nothing is enforced until the
// enforcement toggle flips (and billing exists). Test grants exercise the
// same FIFO/expiry path a real purchase will.
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentRole } from "@/lib/cards/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readAll } from "@/lib/supabase/page";
import { grantTestCredits, setEnforcement } from "./actions";

export const dynamic = "force-dynamic";

type UsageRow = {
  user_id: string; vendor: string; cost_model: string; feature: string;
  units: number; input_tokens: number; output_tokens: number;
  cache_write_tokens: number; cache_read_tokens: number;
  cost_usd: number | null; credits_charged: number;
};
type LedgerRow = {
  id: number; delta: number; kind: string; reason: string | null;
  remaining: number | null; shortfall: number; expires_at: string | null; created_at: string;
};

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;

export default async function CreditsPage() {
  if ((await currentRole()) !== "owner") redirect("/cards");
  const supabase = await createClient();
  const svc = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  // null when unreadable — never rendered as "0 credits" (rule 4).
  const { data: balanceData, error: balErr } = await supabase.rpc("credit_balance");
  const balance = balErr ? null : Number(balanceData ?? 0);

  // Aggregates read COMPLETE or flagged (rules 4/5) — a margin computed from a
  // truncated read would be a lie with decimals.
  let usage: UsageRow[] = [];
  let usageTruncated = false;
  let enforcement = false;
  let ledger: LedgerRow[] = [];
  let fixedMonthly = 0;
  if (svc) {
    const res = await readAll<UsageRow>(
      (from, to) => svc.from("usage_events")
        .select("user_id, vendor, cost_model, feature, units, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, credits_charged")
        .order("id", { ascending: true }).range(from, to),
      100_000,
    ).catch(() => ({ rows: [] as UsageRow[], truncated: true }));
    usage = res.rows; usageTruncated = res.truncated;

    // Fixed monthly floor — the subscription costs that exist whether or not
    // anyone runs anything. These belong in a PLAN FEE, not in per-call
    // credits: recovering a fixed cost per call underprices at low volume and
    // overcharges at high volume.
    const { data: svcRows } = await svc
      .from("service_config").select("key, enabled, monthly_cost_est").eq("enabled", true);
    fixedMonthly = (svcRows ?? []).reduce((s, r) => s + Number(r.monthly_cost_est ?? 0), 0);

    const { data: flag } = await svc
      .from("service_config").select("enabled").eq("key", "credit_enforcement").maybeSingle();
    enforcement = Boolean(flag?.enabled);

    if (user) {
      // Display list, labeled most-recent — a plain limit is correct here (rule 2).
      const { data: led } = await svc.from("credit_ledger")
        .select("id, delta, kind, reason, remaining, shortfall, expires_at, created_at")
        .eq("user_id", user.id).order("id", { ascending: false }).limit(15);
      ledger = (led ?? []) as LedgerRow[];
    }
  }

  // Per-feature rollup. A null cost_usd means two different things and must
  // not be averaged together: on a METERED vendor it's a missing rate (flag
  // it); on a SUBSCRIPTION vendor it's correct by design (the real cost is the
  // monthly fee, recovered in the plan fee, not per call).
  const byFeature = new Map<string, {
    vendor: string; costModel: string; runs: number; units: number;
    credits: number; pricedCredits: number; cost: number; unpriced: number; tokens: number;
  }>();
  for (const u of usage) {
    const key = `${u.vendor}::${u.feature}`;
    const f = byFeature.get(key) ?? {
      vendor: u.vendor, costModel: u.cost_model, runs: 0, units: 0,
      credits: 0, pricedCredits: 0, cost: 0, unpriced: 0, tokens: 0,
    };
    f.runs += 1;
    f.units += u.units;
    f.credits += u.credits_charged;
    f.tokens += u.input_tokens + u.output_tokens + u.cache_write_tokens + u.cache_read_tokens;
    if (u.cost_usd != null) {
      f.cost += Number(u.cost_usd);
      // $/credit must divide priced cost by the credits from THOSE SAME runs.
      // Counting every run's credits against only the priced runs' dollars
      // understates cost per credit — i.e. flatters the margin (the exact
      // number this screen exists to get right).
      f.pricedCredits += u.credits_charged;
    } else if (u.cost_model === "metered") f.unpriced += 1;
    byFeature.set(key, f);
  }
  const features = [...byFeature.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const totals = features.reduce(
    (t, [, f]) => ({ runs: t.runs + f.runs, credits: t.credits + f.credits, cost: t.cost + f.cost, unpriced: t.unpriced + f.unpriced }),
    { runs: 0, credits: 0, cost: 0, unpriced: 0 },
  );

  // Cost to serve OTHERS vs your own consumption. Same events, split by who
  // spent them — your own usage is a business expense, not a cost of serving
  // customers, and pooling the two makes unit economics fiction.
  const mine = usage.filter((u) => u.user_id === user?.id);
  const theirs = usage.filter((u) => u.user_id !== user?.id);
  const sumCost = (rows: UsageRow[]) => rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-3xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Credits &amp; AI margin</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">
          Retail (credits charged) vs measured cost (real tokens × API rates). Shadow mode records everything;
          the enforcement toggle is what will make balances binding.
        </p>

        {usageTruncated && (
          <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            Usage records couldn&apos;t be read completely — the numbers below are partial.
          </div>
        )}

        {/* Status strip */}
        <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded border border-ink/10 bg-ink/5 p-3">
            <div className="text-[11px] uppercase tracking-wide text-ink/50">Your balance</div>
            <div className="mt-1 text-xl font-bold">
              {balance === null ? <span className="text-amber-300">unavailable</span> : `${balance.toLocaleString()} credits`}
            </div>
            {balance === null && <div className="text-[11px] text-amber-300">balance couldn&apos;t be read — not zero</div>}
          </div>
          <div className="rounded border border-ink/10 bg-ink/5 p-3">
            <div className="text-[11px] uppercase tracking-wide text-ink/50">Marginal cost (all-time)</div>
            <div className="mt-1 text-xl font-bold">
              {/* $0.00 is only a fact when at least one run was actually priced. */}
              {totals.runs > 0 && totals.cost === 0 && totals.unpriced > 0
                ? <span className="text-amber-300">unpriced</span>
                : usd(totals.cost)}
            </div>
            <div className="text-[11px] text-ink/45">scales with use → credits</div>
            {totals.unpriced > 0 && <div className="text-[11px] text-amber-300">+ {totals.unpriced} unpriced run{totals.unpriced === 1 ? "" : "s"} (no rate for model) — excluded, not counted as $0</div>}
          </div>
          <div className="rounded border border-ink/10 bg-ink/5 p-3">
            <div className="text-[11px] uppercase tracking-wide text-ink/50">Enforcement</div>
            <div className="mt-1 text-xl font-bold">{enforcement ? "ON — balances bind" : "OFF — shadow mode"}</div>
            <form action={setEnforcement.bind(null, !enforcement)}>
              <button type="submit" className="mt-1 text-xs text-ink/60 underline underline-offset-4 hover:text-ink">
                {enforcement ? "Switch to shadow mode" : "Turn enforcement on"}
              </button>
            </form>
          </div>
        </section>

        {/* The fixed / marginal split — the structural answer to "how do I
            separate my expenses from users' usage". */}
        <section className="mt-6 rounded border border-ink/10 bg-ink/5 p-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Two kinds of expense</h2>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink/50">Fixed floor / month</div>
              <div className="text-lg font-bold">{usd(fixedMonthly)}</div>
              <p className="mt-1 text-xs text-ink/50">
                Enabled subscriptions (Services page). Exists whether or not anyone runs anything —
                recover it in a <strong>plan fee</strong>, not per call.
              </p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink/50">Marginal, all-time</div>
              <div className="text-lg font-bold">{usd(totals.cost)}</div>
              <p className="mt-1 text-xs text-ink/50">
                Pay-per-use vendors. Scales with usage — this is what <strong>credits</strong> cover.
              </p>
            </div>
          </div>
          <div className="mt-3 border-t border-ink/10 pt-2 text-xs text-ink/55">
            Cost to serve others: <strong>{usd(sumCost(theirs))}</strong> across {theirs.length} run{theirs.length === 1 ? "" : "s"}
            {" · "}Your own consumption: <strong>{usd(sumCost(mine))}</strong> across {mine.length} run{mine.length === 1 ? "" : "s"}
            <span className="block text-ink/40">Your own usage is a business expense, not a cost of serving customers — kept separate so unit economics stay honest.</span>
          </div>
        </section>

        {/* Margin table */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Cost per credit, by feature</h2>
          {features.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">No AI runs recorded yet — run an estimate and this fills in.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded border border-ink/10">
              <table className="w-full text-sm">
                <thead className="bg-ink/5 text-left text-[11px] uppercase tracking-wide text-ink/50">
                  <tr>
                    <th className="px-3 py-2">Vendor · feature</th>
                    <th className="px-3 py-2">Cost shape</th>
                    <th className="px-3 py-2 text-right">Runs</th>
                    <th className="px-3 py-2 text-right">Tokens</th>
                    <th className="px-3 py-2 text-right">Credits charged</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-right">$ / credit</th>
                  </tr>
                </thead>
                <tbody>
                  {features.map(([key, f]) => (
                    <tr key={key} className="border-t border-ink/10">
                      <td className="px-3 py-2 font-mono text-xs">{key.replace("::", " · ")}{f.unpriced > 0 ? <span className="ml-1 text-amber-300" title="metered runs with no rate on file">⚠{f.unpriced}</span> : null}</td>
                      <td className="px-3 py-2 text-xs text-ink/60">{f.costModel}</td>
                      <td className="px-3 py-2 text-right">{f.runs}</td>
                      <td className="px-3 py-2 text-right">{f.tokens > 0 ? f.tokens.toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-right">{f.credits.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{f.costModel === "metered" ? usd(f.cost) : <span className="text-ink/40" title="fixed monthly fee — see the floor above">in floor</span>}</td>
                      <td className="px-3 py-2 text-right">
                        {f.costModel === "metered" && f.pricedCredits > 0
                          ? <span title={f.unpriced > 0 ? `over ${f.runs - f.unpriced} priced run(s); ${f.unpriced} unpriced excluded` : undefined}>{usd(f.cost / f.pricedCredits)}</span>
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-ink/45">
            $ / credit is the pricing number: whatever you sell a credit for must clear it with margin.
            Cache savings lower it over time — that margin is yours, not a price cut.
          </p>
        </section>

        {/* Test grant */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Grant test credits (you)</h2>
          <form action={grantTestCredits} className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-xs text-ink/60">
              Amount
              <input name="amount" type="number" min={1} max={100000} defaultValue={500} required
                className="mt-1 block w-28 rounded border border-ink/20 bg-transparent px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="text-xs text-ink/60">
              Expires in (days, 0 = never)
              <input name="expires_days" type="number" min={0} max={730} defaultValue={0}
                className="mt-1 block w-28 rounded border border-ink/20 bg-transparent px-2 py-1.5 text-sm text-ink" />
            </label>
            <button type="submit" className="rounded bg-flag px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90">
              Grant
            </button>
          </form>
          <p className="mt-1 text-xs text-ink/45">
            0 days = a purchase-style grant (never expires). With days = a plan-style grant (expires) — spends draw the soonest-expiring bucket first.
          </p>
        </section>

        {/* Recent ledger */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Your ledger — most recent 15</h2>
          {ledger.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">No entries yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded border border-ink/10">
              <table className="w-full text-sm">
                <thead className="bg-ink/5 text-left text-[11px] uppercase tracking-wide text-ink/50">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2 text-right">Remaining</th>
                    <th className="px-3 py-2">Expires</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((l) => (
                    <tr key={l.id} className="border-t border-ink/10">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-ink/60">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">{l.kind}{l.shortfall > 0 ? <span className="ml-1 text-amber-300" title="uncovered part of this spend">short {l.shortfall}</span> : null}</td>
                      <td className={`px-3 py-2 text-right font-mono ${l.delta < 0 ? "text-red-300" : "text-emerald-300"}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                      <td className="px-3 py-2 text-right font-mono">{l.remaining ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-ink/60">{l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "never"}</td>
                      <td className="px-3 py-2 text-xs text-ink/60">{l.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

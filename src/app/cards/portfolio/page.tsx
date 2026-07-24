import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

// Portfolio value over time. Reads the nightly snapshots and appends today's
// live total so the chart is never empty and starts the moment history begins.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyc = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type Point = { date: string; cost: number; value: number };

export default async function PortfolioPage() {
  const supabase = await createClient();

  const [{ data: snaps }, { data: pool }, moverRows] = await Promise.all([
    supabase.from("card_portfolio_snapshots")
      .select("snapshot_date, cost_basis, market_value").order("snapshot_date", { ascending: true }).limit(400),
    supabase.from("card_pool").select("total_cost").eq("name", "main").maybeSingle(),
    // Movers: cards with a 30-day-ago snapshot to compare against.
    // "Biggest movers" is a ranking, so it needs every candidate — a 1000-row cut
    // in arbitrary order would rank an arbitrary subset. (2026-07-24)
    readAllSafe<Record<string, unknown>>((from, to) =>
      supabase.from("cards")
        .select("id, player, year, set_name, market_value, manual_price, value_30d")
        .not("status", "in", "(archived,sold)").not("value_30d", "is", null)
        .order("id", { ascending: true }).range(from, to)),
  ]);

  // Biggest 30-day movers (by %).
  const movers = (moverRows.rows)
    .map((c) => {
      const cur = Number((c.manual_price ?? c.market_value) ?? 0);
      const then = Number(c.value_30d ?? 0);
      if (!(then > 0) || !(cur > 0)) return null;
      return { id: c.id as string, title: [c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(card)", cur, pct: ((cur - then) / then) * 100 };
    })
    .filter((m): m is { id: string; title: string; cur: number; pct: number } => m != null && Math.abs(m.pct) >= 1);
  const gainers = [...movers].sort((a, b) => b.pct - a.pct).slice(0, 5);
  const losers = [...movers].sort((a, b) => a.pct - b.pct).slice(0, 5).filter((m) => m.pct < 0);

  // Today's live total (paged) — so the newest point is current, not stale.
  let marketValue = 0, individualBasis = 0;
  for (let from = 0; from < 20000; from += 1000) {
    const { data: v } = await supabase
      .from("cards").select("market_value, manual_price, use_pool_basis, individual_basis")
      .not("status", "in", "(archived,sold)").order("id", { ascending: true }).range(from, from + 999);
    for (const r of v ?? []) {
      marketValue += Number((r.manual_price ?? r.market_value) ?? 0);
      if (!r.use_pool_basis) individualBasis += Number(r.individual_basis ?? 0);
    }
    if (!v || v.length < 1000) break;
  }
  const todayCost = Number(pool?.total_cost ?? 0) + individualBasis;
  const today = new Date().toISOString().slice(0, 10);

  const points: Point[] = (snaps ?? []).map((s) => ({
    date: s.snapshot_date as string, cost: Number(s.cost_basis), value: Number(s.market_value),
  }));
  if (points[points.length - 1]?.date !== today) {
    points.push({ date: today, cost: Math.round(todayCost * 100) / 100, value: Math.round(marketValue * 100) / 100 });
  } else {
    points[points.length - 1] = { date: today, cost: Math.round(todayCost * 100) / 100, value: Math.round(marketValue * 100) / 100 };
  }

  const cur = points[points.length - 1];
  const first = points[0];
  const ret = cur.cost > 0 ? ((cur.value - cur.cost) / cur.cost) * 100 : null;
  const chgValue = cur.value - first.value; // absolute change since history began
  const chgDays = points.length;

  // ── Chart geometry (one $ axis; market value = gold area, cost basis = muted
  //    reference line). Evenly spaced by index. ──────────────────────────────
  const W = 680, H = 200, PL = 8, PR = 8, PT = 12, PB = 22;
  const iw = W - PL - PR, ih = H - PT - PB;
  const vals = points.flatMap((p) => [p.value, p.cost]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || Math.max(hi * 0.1, 1);
  const yLo = Math.max(0, lo - pad), yHi = hi + pad;
  const x = (i: number) => PL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PT + ih - ((v - yLo) / (yHi - yLo || 1)) * ih;
  const line = (key: "value" | "cost") => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const area = `${line("value")} L${x(points.length - 1).toFixed(1)},${(PT + ih).toFixed(1)} L${x(0).toFixed(1)},${(PT + ih).toFixed(1)} Z`;

  const Stat = ({ label, val, tone }: { label: string; val: string; tone?: "pos" | "neg" }) => (
    <div>
      <div className={"figures text-xl font-bold " + (tone === "pos" ? "text-pos" : tone === "neg" ? "text-danger" : "text-ink")}>{val}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink/50">{label}</div>
    </div>
  );

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>

        <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl border border-hairline bg-white p-4">
          <Stat label="Market value" val={moneyc(cur.value)} />
          <Stat label="Cost basis" val={moneyc(cur.cost)} />
          <Stat label="Return" val={ret == null ? "—" : `${ret >= 0 ? "+" : ""}${ret.toFixed(0)}%`} tone={ret == null ? undefined : ret >= 0 ? "pos" : "neg"} />
        </div>

        {/* Value over time */}
        <div className="mt-3 rounded-xl border border-hairline bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Value over time</span>
            <span className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1 text-ink/60"><span className="inline-block h-2 w-3 rounded-sm bg-flag" /> Market value</span>
              <span className="flex items-center gap-1 text-ink/60"><span className="inline-block h-0 w-3 border-t-2 border-dashed border-ink/40" /> Cost basis</span>
            </span>
          </div>

          {points.length <= 1 ? (
            <div className="py-8 text-center">
              <div className="figures text-2xl font-bold text-flag">{moneyc(cur.value)}</div>
              <p className="mt-1 text-[11px] text-ink/45">History starts today — the chart fills in as the nightly snapshot runs.</p>
            </div>
          ) : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Portfolio market value and cost basis over time">
                <line x1={PL} y1={PT + ih} x2={W - PR} y2={PT + ih} stroke="var(--color-hairline)" strokeWidth="1" />
                <path d={area} fill="var(--color-flag)" fillOpacity="0.14" />
                <path d={line("value")} fill="none" stroke="var(--color-flag)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <path d={line("cost")} fill="none" stroke="var(--color-ink)" strokeOpacity="0.4" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />
                {/* end markers */}
                <circle cx={x(points.length - 1)} cy={y(cur.value)} r="3.5" fill="var(--color-flag)" stroke="var(--color-paper)" strokeWidth="2" />
              </svg>
              <div className="flex items-baseline justify-between text-[10px] text-ink/40">
                <span className="figures">{first.date}</span>
                <span className={"figures font-bold " + (chgValue >= 0 ? "text-pos" : "text-danger")}>
                  {chgValue >= 0 ? "+" : ""}{money(chgValue)} over {chgDays} day{chgDays === 1 ? "" : "s"}
                </span>
                <span className="figures">{cur.date}</span>
              </div>
            </>
          )}
        </div>

        {/* 30-day movers */}
        {(gainers.length > 0 || losers.length > 0) && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoverList title="Top gainers · 30d" items={gainers} />
            <MoverList title="Biggest drops · 30d" items={losers} />
          </div>
        )}

        <p className="mt-3 text-[11px] leading-snug text-ink/40">
          A snapshot is recorded each night with your priced inventory. Market value = manual price where set, else computed market value; cost basis = pool basis + individually-based cards.
        </p>
      </div>
    </main>
  );
}

function MoverList({ title, items }: { title: string; items: { id: string; title: string; cur: number; pct: number }[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">{title}</div>
      <div className="mt-1.5 space-y-1">
        {items.map((m) => (
          <Link key={m.id} href={`/cards/${m.id}`} className="flex items-baseline justify-between gap-2 hover:opacity-80">
            <span className="min-w-0 truncate text-xs text-ink/75">{m.title}</span>
            <span className="figures flex shrink-0 items-baseline gap-2 text-xs">
              <span className="text-ink/50">{money(m.cur)}</span>
              <span className={"font-bold " + (m.pct >= 0 ? "text-pos" : "text-danger")}>{m.pct >= 0 ? "+" : ""}{m.pct.toFixed(0)}%</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

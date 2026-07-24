"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, Loader2 } from "lucide-react";

type Mover = { id: string; title: string; pct: number; from: number; to: number };
type Deviation = { id: string; title: string; pct: number; expected: number; actual: number };
type Data = { window_days: number; movers: Mover[]; deviations: Deviation[]; tracked: number };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const WINDOWS = [7, 30, 90, 365] as const;

export function MoversView() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    fetch(`/api/cards/movers?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d))
      .catch(() => {})
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [days]);

  const gainers = (data?.movers ?? []).filter((m) => m.pct > 0);
  const losers = (data?.movers ?? []).filter((m) => m.pct < 0);

  const Row = ({ m }: { m: Mover }) => (
    <Link href={`/cards/${m.id}`} className="flex items-center gap-3 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-paper">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{m.title}</div>
        <div className="figures text-[11px] text-ink/50">{money(m.from)} → {money(m.to)}</div>
      </div>
      <span className={"figures shrink-0 text-sm font-bold " + (m.pct > 0 ? "text-pos" : "text-danger")}>
        {m.pct > 0 ? "+" : ""}{m.pct.toFixed(1)}%
      </span>
    </Link>
  );

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Activity size={22} className="text-flag" /> Movers</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>

        <div className="mt-3 flex items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setDays(w)}
              className={"rounded-full border px-3 py-1 text-xs font-semibold " + (days === w ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60")}>
              {w}d
            </button>
          ))}
          {busy && <Loader2 size={14} className="animate-spin text-flag" />}
          {data && <span className="figures ml-auto text-[11px] text-ink/40">{data.tracked} cards with price history</span>}
        </div>

        {!busy && data && data.tracked === 0 && (
          <div className="mt-4 rounded-xl border border-hairline bg-white p-6 text-center text-sm text-ink/50">
            No price history yet. Values need to change over time (or a nightly reprice) before moves can be measured.
          </div>
        )}

        {gainers.length > 0 && (
          <section className="mt-4">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-pos"><TrendingUp size={13} /> Gainers</div>
            <div className="overflow-hidden rounded-xl border border-hairline bg-white">{gainers.map((m) => <Row key={m.id} m={m} />)}</div>
          </section>
        )}
        {losers.length > 0 && (
          <section className="mt-4">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-danger"><TrendingDown size={13} /> Fallers</div>
            <div className="overflow-hidden rounded-xl border border-hairline bg-white">{losers.map((m) => <Row key={m.id} m={m} />)}</div>
          </section>
        )}

        {(data?.deviations.length ?? 0) > 0 && (
          <section className="mt-5">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-flag">Off their usual trend (&gt;5%)</div>
            <div className="overflow-hidden rounded-xl border border-hairline bg-white">
              {data!.deviations.map((d) => (
                <Link key={d.id} href={`/cards/${d.id}`} className="flex items-center gap-3 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{d.title}</div>
                    <div className="figures text-[11px] text-ink/50">trend ≈ {money(d.expected)} · now {money(d.actual)}</div>
                  </div>
                  <span className={"figures shrink-0 text-sm font-bold " + (d.pct > 0 ? "text-pos" : "text-danger")}>
                    {d.pct > 0 ? "+" : ""}{d.pct.toFixed(1)}%
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-5 text-[11px] leading-snug text-ink/40">
          Moves are measured from your saved price history. Set a per-card <b>% -move alert</b> on any card, or let the daily
          digest ping you about the biggest movers.
        </p>
      </div>
    </main>
  );
}

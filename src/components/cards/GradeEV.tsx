"use client";

import { useEffect, useState } from "react";
import { Loader2, Scale, TrendingUp } from "lucide-react";

type Path = {
  grader: string; expected: number; low: number; high: number; confidence: number;
  gradedValue: number | null; fee: number; net: number | null; delta: number | null;
  /** Share of the estimate's outcomes that lose money against selling raw. */
  downsideP?: number | null;
  /** How much of the estimate the value ladder could actually price. */
  priced?: number;
  line?: string | null;
  outcomes?: { grade: number; p: number; value: number | null; net: number | null }[];
  basis: "actual" | "modeled" | null;
};
type EV = { ready: boolean; reason?: string; raw: number | null; paths?: Path[]; best?: Path | null; worthIt?: boolean };

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Grade-or-Flip EV — the profit-maximizing move on a raw card, net of each
 * grader's fee: grade it (and with whom) or sell it raw. Lazy-loads so the
 * card page stays instant.
 */
export function GradeEV({ cardId }: { cardId: string }) {
  const [ev, setEv] = useState<EV | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/cards/grade-ev?cardId=${cardId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't compute.");
        if (live) setEv(d as EV);
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : "Couldn't compute.");
      }
    })();
    return () => { live = false; };
  }, [cardId]);

  if (err) return null; // silent — it's a bonus panel
  if (!ev) {
    return (
      <section className="mt-4 flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2.5 text-xs text-ink/40">
        <Loader2 size={13} className="animate-spin" /> Weighing grade-or-flip…
      </section>
    );
  }
  if (!ev.ready) {
    if (ev.reason === "already_graded") return null;
    const msg = ev.reason === "no_estimate"
      ? "Run the grade estimate above to see if this card is worth grading."
      : "Add sales evidence (Value lab) to unlock the grade-or-flip math.";
    return (
      <section className="mt-4 rounded-xl border border-hairline bg-white px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Scale size={13} className="text-flag" /> Grade or flip
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink/50">{msg}</p>
      </section>
    );
  }

  const paths = ev.paths ?? [];
  const best = ev.best ?? null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
      <div className="flex items-center gap-1.5 border-b border-hairline px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
        <Scale size={13} className="text-flag" /> Grade or flip
      </div>

      {/* Verdict */}
      <div className="border-b border-hairline px-3 py-2.5">
        {ev.worthIt && best ? (
          <div className="flex items-start gap-2">
            <TrendingUp size={16} className="mt-0.5 shrink-0 text-pos" />
            <div>
              <div className="text-sm font-bold text-pos">Grade with {best.grader} — likely ~{best.grader === "BGS" ? best.expected.toFixed(1) : best.expected}</div>
              <div className="text-[11px] text-ink/60">
                Net <span className="figures font-semibold text-ink">{money(best.net)}</span> after ~{money(best.fee)} fees —
                that&apos;s <span className="figures font-bold text-pos">+{money(best.delta)}</span> over selling raw ({money(ev.raw)}).
              
              {best.downsideP != null && best.downsideP > 0 && (
                <div className="mt-1 text-[11px] font-semibold text-danger">
                  {Math.round(best.downsideP * 100)}% of the estimated grades lose money against selling raw.
                </div>
              )}
              {best.priced != null && best.priced < 0.999 && (
                <div className="mt-1 text-[11px] text-ink/45">
                  Only {Math.round(best.priced * 100)}% of the estimate could be priced from comps &mdash; the rest of the grade range has no ladder value.
                </div>
              )}
</div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-bold text-ink">Sell it raw ({money(ev.raw)})</div>
            <div className="text-[11px] text-ink/55">At its likely grades, grading doesn&apos;t clear the fees. Flip as-is.</div>
          </div>
        )}
      </div>

      {/* Per-grader breakdown */}
      <div className="px-3 py-2">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-1 border-b border-hairline pb-1 text-[9px] font-bold uppercase tracking-wider text-ink/40">
          <span>Grader</span><span className="text-right">Est grade</span><span className="text-right">Net</span><span className="text-right">vs raw</span>
        </div>
        {paths.map((p) => {
          const isBest = best?.grader === p.grader && ev.worthIt;
          return (
            <div key={p.grader} className={"grid grid-cols-[1.4fr_1fr_1fr_1fr] items-baseline gap-1 py-1 text-xs " + (isBest ? "font-bold" : "")}>
              <span className="text-ink/80">
                {p.grader}
                {p.basis === "modeled" && <span className="ml-1 text-[9px] font-normal text-ink/30">est</span>}
              </span>
              <span className="figures text-right text-ink/60">
                {p.grader === "BGS" ? p.expected.toFixed(1) : p.expected}
                <span className="ml-1 text-[9px] text-ink/30">{p.low}-{p.high}</span>
              </span>
              <span className="figures text-right text-ink">{money(p.net)}</span>
              <span className={"figures text-right font-semibold " + (p.delta == null ? "text-ink/30" : p.delta > 0 ? "text-pos" : "text-danger")}>
                {p.delta == null ? "—" : `${p.delta > 0 ? "+" : ""}${money(p.delta)}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="bg-paper/50 px-3 py-1.5 text-[10px] leading-snug text-ink/40">
        Uses your AI grade estimate across the value ladder, minus the grading fee
        you have configured. Set your own fees in Settings.
        Decision support, not a guarantee.
      </p>
    </section>
  );
}


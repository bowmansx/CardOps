"use client";

import { useState } from "react";
import { Award, Loader2, RefreshCw } from "lucide-react";

type CompanyEst = { low: number; high: number; confidence: number; rationale: string };
export type StoredEstimate = {
  image_quality: string;
  key_observations: string;
  psa: CompanyEst; bgs: CompanyEst; sgc: CompanyEst; cgc: CompanyEst;
  caveats: string;
  at?: string;
};

const COMPANIES: { key: keyof Pick<StoredEstimate, "psa" | "bgs" | "sgc" | "cgc">; label: string }[] = [
  { key: "psa", label: "PSA" },
  { key: "bgs", label: "BGS" },
  { key: "sgc", label: "SGC" },
  { key: "cgc", label: "CGC" },
];

/**
 * Per-company AI grade estimate (Beau, 2026-07-18): runs the card's stored
 * photos against the deep-researched grading rubric and shows estimated grade
 * RANGES per company with rationale + confidence. Pre-grading intel — never a
 * guarantee, and it says so.
 */
export function GradeEstimate({ cardId, initial }: { cardId: string; initial: StoredEstimate | null }) {
  const [est, setEst] = useState<StoredEstimate | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/cards/grade-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, force: est != null }),
      });
      // Timeouts return plain text, not JSON — never crash on that.
      const text = await r.text();
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`Request failed (HTTP ${r.status}) — likely a timeout; try again.`);
      }
      if (!r.ok) throw new Error((d.error as string) || "Estimate failed.");
      setEst(d.estimate as StoredEstimate);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Estimate failed.");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (c: CompanyEst) => (c.low === c.high ? `${c.low}` : `${c.low}–${c.high}`);

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Award size={13} className="text-flag" /> Grade estimate (AI)
        </h2>
        <button
          onClick={run}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-flag/50 px-3 py-1 text-xs font-bold text-flag disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : est ? <RefreshCw size={13} /> : <Award size={13} />}
          {busy ? "Studying the card…" : est ? "Re-estimate" : "Estimate by company"}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-danger">{err}</p>}

      {est && (
        <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
          {COMPANIES.map(({ key, label }) => {
            const c = est[key];
            return (
              <div key={key} className="border-b border-hairline px-3 py-2 last:border-b-0">
                <div className="flex items-center justify-between">
                  <span className="figures text-sm font-bold text-ink">{label}</span>
                  <span className="flex items-center gap-2">
                    <span className="figures rounded bg-flag/12 px-1.5 py-0.5 text-sm font-bold text-flag">{fmt(c)}</span>
                    <span className="figures text-[10px] text-ink/40">{Math.round(c.confidence * 100)}%</span>
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-ink/55">{c.rationale}</p>
              </div>
            );
          })}
          <div className="bg-paper/50 px-3 py-2">
            <p className="text-[11px] leading-snug text-ink/60">{est.key_observations}</p>
            <p className="mt-1 text-[10px] leading-snug text-ink/40">
              {est.caveats} · Photo: {est.image_quality}
              {est.at ? ` · estimated ${new Date(est.at).toLocaleDateString()}` : ""}
            </p>
            <p className="mt-1 text-[10px] font-semibold text-warn/80">Pre-grading intel — never a guarantee.</p>
          </div>
        </div>
      )}
    </section>
  );
}

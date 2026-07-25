"use client";

import { useCallback, useMemo, useState } from "react";
import { Brain, Loader2, ChevronDown, Coins } from "lucide-react";
import { estimateCost, type EstimateConfig, type AiDepth } from "@/lib/cards/credits";

type Sale = { title: string | null; price: number; grader: string | null; grade: string | number | null; platform: string | null; date: string | null };
type Estimate = {
  mode: string; value: number | null; low: number | null; high: number | null;
  confidence: string | null; rationale: string | null;
  sources?: { own?: { count: number; median: number | null; sample?: Sale[] }; comparables?: { label: string; stats: { count: number; median: number | null } }[] } | null;
  credits_spent?: number; model?: string | null; created_at?: string | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const MODES = [
  { key: "standard_plus", title: "A · Standard + context", blurb: "Your pricing standard, AI-adjusted with comparables and player/market context." },
  { key: "all_sales_plus", title: "B · All sales + context", blurb: "Ignores the template — reasons over ALL of the card's sales. Best for rare / low-pop cards." },
] as const;

const confTone: Record<string, string> = { high: "text-pos", medium: "text-amber-600", low: "text-danger" };

// `judgment` marks a toggle that adds the MODEL'S OPINION, not fetched data.
// Those are free and say so, because charging for data we never fetch — or
// letting a name imply a source that doesn't exist — is how trust dies.
function Toggle({
  on, set, label, hint, judgment,
}: {
  on: boolean; set: (v: boolean) => void; label: string; hint: string; judgment?: boolean;
}) {
  return (
    <label
      title={hint}
      className="flex items-center gap-1 rounded-full border border-hairline bg-white px-2 py-0.5 text-[11px]"
    >
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-3 w-3 accent-flag" /> {label}
      {judgment && <span className="text-[9px] uppercase tracking-wide text-ink/35">judgment</span>}
    </label>
  );
}

export function CardEstimates({
  cardId, aiOn, initial, initialBalance,
}: {
  // initialBalance is null when the balance couldn't be read — shown as "—",
  // never as 0 credits (rule 4).
  cardId: string; aiOn: boolean; initial: Record<string, Estimate>; initialBalance: number | null;
}) {
  const [estimates, setEstimates] = useState<Record<string, Estimate>>(initial ?? {});
  const [balance, setBalance] = useState(initialBalance);
  const [comparables, setComparables] = useState(true);
  const [macro, setMacro] = useState(true);
  const [news, setNews] = useState(false);
  const [pop, setPop] = useState(false);
  const [ai, setAi] = useState<AiDepth>("light");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const configFor = useCallback(
    (mode: string): EstimateConfig => ({ mode: mode as EstimateConfig["mode"], comparables, macro, news, pop, ai }),
    [comparables, macro, news, pop, ai],
  );
  const cost = useMemo(() => ({
    standard_plus: estimateCost(configFor("standard_plus")).credits,
    all_sales_plus: estimateCost(configFor("all_sales_plus")).credits,
  }), [configFor]);

  async function run(mode: string) {
    setBusy(mode); setErr(null);
    try {
      const r = await fetch("/api/cards/estimate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, mode, config: configFor(mode) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Estimate failed.");
      setEstimates((p) => ({ ...p, [mode]: d.estimate }));
      setBalance(d.balance ?? null);
      setOpen(mode);
      // Estimate shown but something money-shaped went wrong — say so rather
      // than leaving a silent divergence (rules 4/8).
      if (d.cache_warning) setErr(d.cache_warning);
      else if (d.debit_warning) setErr(d.debit_warning);
    } catch (e) { setErr(e instanceof Error ? e.message : "Estimate failed."); } finally { setBusy(null); }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
      <div className="flex items-center justify-between px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Brain size={13} className="text-flag" /> CardOps Estimated Price
        </h2>
        <span className="figures inline-flex items-center gap-1 text-[10px] text-ink/45" title={balance === null ? "Balance couldn't be read" : undefined}>
          <Coins size={11} /> {balance === null ? "—" : balance} credits
        </span>
      </div>

      {/* Cost dials — the user controls their spend */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline bg-paper/40 px-3 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">Context</span>
        <Toggle on={comparables} set={setComparables} label="Comparables"
          hint="Fetches live sales for similar cards (same set/parallel, and this player's other cards)." />
        <Toggle on={news} set={setNews} label="Player news"
          hint="Reads real headlines collected and scored daily for this player. If there are none, the estimate says so." />
        <Toggle on={macro} set={setMacro} label="Market" judgment
          hint="Model judgment only — no market-index data is fetched. Free." />
        <Toggle on={pop} set={setPop} label="Scarcity" judgment
          hint="Model judgment only — no population-report data is fetched. Free." />
        <span className="mx-1 h-3 w-px bg-hairline" />
        <select value={ai} onChange={(e) => setAi(e.target.value as AiDepth)} className="rounded-lg border border-hairline bg-white px-2 py-0.5 text-[11px] outline-none focus:border-flag">
          <option value="light">Light AI</option>
          <option value="deep">Deep AI</option>
        </select>
      </div>

      {!aiOn && <p className="border-t border-hairline px-3 py-2 text-[11px] text-ink/45">AI is off — turn it on in the Services page to run estimates.</p>}
      {err && <p className="border-t border-hairline px-3 py-2 text-[11px] text-danger">{err}</p>}

      {MODES.map((m) => {
        const e = estimates[m.key];
        const sample = e?.sources?.own?.sample ?? [];
        return (
          <div key={m.key} className="border-t border-hairline px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-ink">{m.title}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-ink/45">{m.blurb}</p>
              </div>
              <button onClick={() => run(m.key)} disabled={busy !== null || !aiOn}
                className="shrink-0 rounded-lg border border-flag px-2.5 py-1 text-[11px] font-bold text-flag disabled:opacity-50">
                {busy === m.key ? <Loader2 size={12} className="animate-spin" /> : e ? `Refresh · ${cost[m.key as keyof typeof cost]}` : `Estimate · ${cost[m.key as keyof typeof cost]}`}
              </button>
            </div>

            {e && (
              <>
                <div className="mt-2 flex items-end gap-3">
                  <div className="figures text-2xl font-bold text-flag">{money(e.value)}</div>
                  <div className="pb-0.5 text-[11px] text-ink/50">
                    <div className="figures">range {money(e.low)} – {money(e.high)}</div>
                    <div>confidence <span className={"font-semibold " + (confTone[e.confidence ?? ""] ?? "text-ink/50")}>{e.confidence ?? "—"}</span></div>
                  </div>
                </div>
                {e.rationale && <p className="mt-1.5 text-[11px] leading-snug text-ink/70">{e.rationale}</p>}
                <button onClick={() => setOpen(open === m.key ? null : m.key)} className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-ink/45 hover:text-flag">
                  {e.sources?.own?.count ?? 0} sales used{sample.length ? " · show" : ""} <ChevronDown size={11} className={"transition-transform " + (open === m.key ? "rotate-180" : "")} />
                </button>
                {open === m.key && sample.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-lg border border-hairline">
                    {sample.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 border-b border-hairline px-2 py-1 text-[10px] last:border-0">
                        <span className="min-w-0 flex-1 truncate text-ink/60" title={s.title ?? ""}>{s.title ?? "(sale)"}</span>
                        <span className="text-ink/40">{s.grader ? `${s.grader} ${s.grade ?? ""}` : "raw"}</span>
                        <span className="text-ink/40">{s.platform ?? ""}</span>
                        <span className="figures w-16 text-right font-semibold text-ink">{money(s.price)}</span>
                        <span className="figures w-16 text-right text-ink/40">{s.date ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      <p className="border-t border-hairline px-3 py-2 text-[10px] leading-snug text-ink/40">
        An estimate blends the card&apos;s sales with comparables and market context — guidance for hard-to-price cards, not a guaranteed sale price. Each run spends credits (shown on the button).
      </p>
    </section>
  );
}

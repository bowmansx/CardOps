"use client";

import { useState } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";

export type CardPrefs = { auto_estimate: string; estimate_model: string };

const AUTO: [string, string][] = [
  ["both", "On — both estimates"],
  ["A", "On — standard only (cheaper)"],
  ["B", "On — all-sales only"],
  ["off", "Off"],
];
const DEPTH: [string, string][] = [
  ["light", "Cheap & fast (default)"],
  ["deep", "Deeper model (costs more)"],
];

const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";

export function AutoEstimateSettings({ initial }: { initial: CardPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(patch: Partial<CardPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next); setBusy(true); setErr(null); setSaved(false);
    try {
      const r = await fetch("/api/cards/prefs", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  }

  const off = prefs.auto_estimate === "off";

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Sparkles size={13} className="text-flag" /> Automatic estimates
        </span>
        {busy ? <Loader2 size={13} className="animate-spin text-ink/40" /> : saved ? <span className="flex items-center gap-1 text-[10px] text-pos"><Check size={11} /> saved</span> : null}
      </div>
      <p className="text-[11px] leading-snug text-ink/50">
        Prices your cards on their own once a day, so a card is never sitting there blank. Cards that already
        have a recent estimate are skipped rather than re-run.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/50">Run automatically</span>
          <select value={prefs.auto_estimate} onChange={(e) => save({ auto_estimate: e.target.value })} className={field}>
            {AUTO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/50">Model</span>
          <select value={prefs.estimate_model} onChange={(e) => save({ estimate_model: e.target.value })} disabled={off} className={field + (off ? " opacity-50" : "")}>
            {DEPTH.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[10px] text-ink/40">
        {off
          ? "Off — estimates only run when you press Estimate on a card."
          : "You can still run an estimate by hand on any card at any time."}
      </p>
      {err && <p className="text-[11px] text-danger">{err}</p>}
    </div>
  );
}

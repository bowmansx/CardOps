"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { CardOpsPrefs, DescLength, DescTone } from "@/lib/cards/settings";

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50";
const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag";

export function CardOpsSettings({ initial }: { initial: CardOpsPrefs }) {
  const [fees, setFees] = useState(initial.grading_fees);
  const [tone, setTone] = useState<DescTone>(initial.description_tone);
  const [length, setLength] = useState<DescLength>(initial.description_length);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const feeField = (k: keyof typeof fees, lbl: string) => (
    <label className="block">
      <span className={label}>{lbl}</span>
      <input type="number" step="1" min="0" value={fees[k]}
        onChange={(e) => setFees((f) => ({ ...f, [k]: Number(e.target.value) }))} className={field} />
    </label>
  );

  async function save() {
    setBusy(true); setErr(null); setSaved(false);
    try {
      const r = await fetch("/api/cards/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grading_fees: fees, description_tone: tone, description_length: length }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed.");
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-hairline bg-white p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-flag/80">Grading fees</h2>
        <p className="mt-0.5 mb-2 text-[11px] leading-snug text-ink/45">
          Drives the Grade-or-Flip EV engine. Set your real per-submission cost (economy/bulk tier) + typical round-trip shipping.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {feeField("PSA", "PSA ($)")}
          {feeField("BGS", "BGS ($)")}
          {feeField("SGC", "SGC ($)")}
          {feeField("CGC", "CGC ($)")}
          {feeField("ship", "Shipping round-trip ($)")}
        </div>
      </section>

      <section className="rounded-xl border border-hairline bg-white p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-flag/80">AI descriptions</h2>
        <p className="mt-0.5 mb-2 text-[11px] leading-snug text-ink/45">Defaults for the “Write with AI” listing writer.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Tone</span>
            <select value={tone} onChange={(e) => setTone(e.target.value as DescTone)} className={field}>
              <option value="professional">Professional</option>
              <option value="enthusiast">Enthusiast</option>
              <option value="minimal">Minimal</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Length</span>
            <select value={length} onChange={(e) => setLength(e.target.value as DescLength)} className={field}>
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </label>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-flag px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? "Saved" : "Save settings"}
        </button>
        {err && <span className="text-xs text-danger">{err}</span>}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";

// Per-card books control (Beau, 2026-07-21): set THIS card's tax treatment (and,
// for the owner, its business) one card at a time — the card-to-card input for a
// mixed inventory. Goes through the bulk route with a single id.
const TREATMENTS: [string, string][] = [
  ["dealer", "Dealer"],
  ["investment", "Investment"],
  ["hobby", "Hobby"],
];

export function CardBooksControl({
  cardId,
  treatment,
  entityId,
  entities = [],
}: {
  cardId: string;
  treatment: string;
  entityId: string | null;
  entities?: { id: string; short_code: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(treatment || "dealer");
  const [e, setE] = useState(entityId ?? "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    // finally, not a clear on each exit: a dropped connection rejects fetch
    // itself, which used to skip every setBusy(false) and strand the control.
    try {
      const r = await fetch("/api/cards/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [cardId], patch: body }),
      });
      const txt = await r.text();
      let d: { error?: string };
      try { d = JSON.parse(txt); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
      if (!r.ok) throw new Error(d.error || "Couldn't update.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setTreatment(next: string) {
    if (next === t) return;
    const prev = t;
    setT(next);
    try { await patch({ tax_treatment: next }); } catch (er) { setT(prev); setErr(er instanceof Error ? er.message : "Couldn't update."); }
  }
  async function setEntity(next: string) {
    const prev = e;
    setE(next);
    try { await patch({ entity_id: next }); } catch (er) { setE(prev); setErr(er instanceof Error ? er.message : "Couldn't update."); }
  }

  return (
    <section className="mt-4 rounded-xl border border-hairline bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Books · tax treatment</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TREATMENTS.map(([key, label]) => (
          <button key={key} onClick={() => setTreatment(key)} disabled={busy}
            className={"flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold " +
              (key === t ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60 hover:border-flag")}>
            {key === t && <Check size={11} />} {label}
          </button>
        ))}
        {busy && <Loader2 size={14} className="animate-spin self-center text-flag" />}
      </div>
      {entities.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink/40">Business</div>
          <select value={e} onChange={(ev) => setEntity(ev.target.value)} disabled={busy}
            className="w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-flag">
            {!entities.some((ent) => ent.id === e) && <option value={e}>— current —</option>}
            {entities.map((ent) => <option key={ent.id} value={ent.id}>{ent.short_code} · {ent.name}</option>)}
          </select>
        </div>
      )}
      <p className="mt-1.5 text-[10px] leading-snug text-ink/40">
        Dealer = ordinary income; Investment = capital gain/loss; Hobby = income taxable, costs not deductible. Confirm treatment with your CPA.
      </p>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </section>
  );
}

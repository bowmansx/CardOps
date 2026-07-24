"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Check } from "lucide-react";

// Owner control on the card page: change a card's status, or reverse a sale.
// Live-state changes go through the bulk route (validates + blocks 'sold');
// reversing a sale goes through the money-aware unsell route.

// Statuses you can set by hand. 'sold' is intentionally absent — sales run
// through the Sell flow; un-selling runs through Reverse sale.
const SETTABLE = ["intake", "review", "booked", "listed", "hold", "graded_out", "archived"] as const;

export function CardStatusControl({ cardId, status }: { cardId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmReverse, setConfirmReverse] = useState(false);

  async function readJson(r: Response) {
    const t = await r.text();
    try { return JSON.parse(t); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
  }

  async function setStatus(next: string) {
    if (next === status) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [cardId], patch: { status: next } }),
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Couldn't change status.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't change status.");
    } finally {
      setBusy(false);
    }
  }

  async function reverse() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/unsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Couldn't reverse the sale.");
      setConfirmReverse(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't reverse the sale.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-hairline bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Status</div>

      {status === "sold" ? (
        <div className="mt-2">
          <p className="text-[11px] leading-snug text-ink/55">
            This card is marked <span className="font-bold text-ink">sold</span>. Reversing puts it back in
            inventory, deletes the sale from your books, and restores the pool basis it drew.
          </p>
          {confirmReverse ? (
            <div className="mt-2 flex items-center gap-2">
              <button onClick={reverse} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                Yes, reverse the sale
              </button>
              <button onClick={() => setConfirmReverse(false)} disabled={busy}
                className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-ink/60">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmReverse(true)}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-bold text-danger">
              <RotateCcw size={13} /> Reverse sale (put back in inventory)
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SETTABLE.map((s) => (
            <button key={s} onClick={() => setStatus(s)} disabled={busy || s === status}
              className={"flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-100 " +
                (s === status ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60 hover:border-flag disabled:opacity-40")}>
              {s === status && <Check size={11} />} {s}
            </button>
          ))}
          {busy && <Loader2 size={14} className="animate-spin self-center text-flag" />}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </section>
  );
}

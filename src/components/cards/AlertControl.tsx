"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, Loader2, X, Activity } from "lucide-react";

type Alert = {
  kind?: string;
  target_price: number | null;
  direction: string;
  threshold_pct?: number | null;
  window_days?: number | null;
  note: string | null;
} | null;

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Watch a card for a target price OR a % move over a window. The watchlist reads
// current value live; the daily cron fires the %-move and target crossings.
export function AlertControl({ cardId, marketValue, initial }: { cardId: string; marketValue: number | null; initial: Alert }) {
  const router = useRouter();
  const [alert, setAlert] = useState<Alert>(initial);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"target" | "pct_move">(initial?.kind === "pct_move" ? "pct_move" : "target");
  const [target, setTarget] = useState(initial?.target_price != null ? String(initial.target_price) : marketValue != null ? String(marketValue) : "");
  const [direction, setDirection] = useState(initial?.direction ?? (marketValue != null ? "below" : "above"));
  const [thresholdPct, setThresholdPct] = useState(initial?.threshold_pct != null ? String(initial.threshold_pct) : "15");
  const [windowDays, setWindowDays] = useState(initial?.window_days != null ? String(initial.window_days) : "7");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/cards/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text();
    let d: { error?: string }; try { d = JSON.parse(t); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
    if (!r.ok) throw new Error(d.error || "Failed.");
  }
  async function save() {
    setBusy(true); setErr(null);
    try {
      if (mode === "pct_move") {
        await post({ op: "set", cardId, kind: "pct_move", thresholdPct: Number(thresholdPct), windowDays: Number(windowDays) });
        setAlert({ kind: "pct_move", target_price: null, direction: "above", threshold_pct: Number(thresholdPct), window_days: Number(windowDays), note: null });
      } else {
        await post({ op: "set", cardId, kind: "target", target: Number(target), direction });
        setAlert({ kind: "target", target_price: Number(target), direction, note: null });
      }
      setEditing(false);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }
  async function clear() {
    setBusy(true); setErr(null);
    try { await post({ op: "clear", cardId }); setAlert(null); setEditing(false); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  const crossed = alert?.kind !== "pct_move" && alert && marketValue != null && alert.target_price != null &&
    (alert.direction === "below" ? marketValue <= alert.target_price : marketValue >= alert.target_price);

  if (!editing) {
    return (
      <section className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-hairline bg-white px-3 py-2.5">
        {alert ? (
          <>
            <span className="flex items-center gap-2 text-sm">
              {crossed ? <BellRing size={15} className="text-pos" /> : alert.kind === "pct_move" ? <Activity size={15} className="text-flag" /> : <Bell size={15} className="text-flag" />}
              <span className={crossed ? "font-bold text-pos" : "text-ink/70"}>
                {alert.kind === "pct_move"
                  ? `Watching · ±${alert.threshold_pct}% in ${alert.window_days}d`
                  : `Watching · ${alert.direction === "below" ? "≤" : "≥"} ${money(alert.target_price)}${crossed ? " — hit!" : ""}`}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <button onClick={() => setEditing(true)} className="text-xs font-semibold text-flag underline-offset-2 hover:underline">Edit</button>
              <button onClick={clear} disabled={busy} className="text-xs font-semibold text-ink/40 hover:text-danger">Remove</button>
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2 text-sm text-ink/50"><Bell size={15} className="text-ink/40" /> Not watching this card</span>
            <button onClick={() => setEditing(true)} className="text-xs font-bold text-flag underline-offset-2 hover:underline">Set alert</button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-flag/40 bg-flag/5 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex overflow-hidden rounded-lg border border-hairline text-[11px] font-semibold">
          {(["target", "pct_move"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={"px-2.5 py-1 " + (mode === m ? "bg-flag text-white" : "bg-white text-ink/50")}>
              {m === "target" ? "Target price" : "% move"}
            </button>
          ))}
        </div>
        <button onClick={() => setEditing(false)} className="text-ink/40"><X size={14} /></button>
      </div>

      {mode === "target" ? (
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-hairline text-xs font-semibold">
            {(["below", "above"] as const).map((d) => (
              <button key={d} onClick={() => setDirection(d)} className={"px-2.5 py-1.5 " + (direction === d ? "bg-flag text-white" : "bg-white text-ink/50")}>
                {d === "below" ? "Drops to ≤" : "Rises to ≥"}
              </button>
            ))}
          </div>
          <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" step="0.01" placeholder="$"
            className="figures w-24 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm outline-none focus:border-flag" />
          <button onClick={save} disabled={busy || !(Number(target) > 0)}
            className="flex items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />} Watch
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink/60">Alert if it moves ±</span>
          <input value={thresholdPct} onChange={(e) => setThresholdPct(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal"
            className="figures w-14 rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag" />
          <span className="text-xs text-ink/60">% within</span>
          <input value={windowDays} onChange={(e) => setWindowDays(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
            className="figures w-14 rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag" />
          <span className="text-xs text-ink/60">days</span>
          <button onClick={save} disabled={busy || !(Number(thresholdPct) > 0) || !(Number(windowDays) > 0)}
            className="flex items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Watch
          </button>
        </div>
      )}
      {marketValue != null && mode === "target" && <p className="mt-1 text-[10px] text-ink/45">Current value {money(marketValue)}.</p>}
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </section>
  );
}

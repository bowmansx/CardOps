"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Square, Loader2, Download, Wand2, XCircle, Layers } from "lucide-react";
import { CARD_STATUSES, STATUS_TONE } from "@/lib/cards/types";

type Row = {
  id: string; sku: string | null; player: string | null; year: number | null;
  set_name: string | null; card_number: string | null; sport_category: string | null;
  status: string; storage_location: string | null; location_code: string | null;
  condition_type: string | null; grader: string | null; grade: string | null;
  manual_price: number | null; market_value: number | null;
};

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BulkManager({ cards, profiles, strategies }: {
  cards: Row[]; profiles: string[]; strategies: string[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // pending edits
  const [newStatus, setNewStatus] = useState("");
  const [newStorage, setNewStorage] = useState("");
  const [newStrategy, setNewStrategy] = useState("");
  const [profile, setProfile] = useState(profiles[0] ?? "generic_full");

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (!term) return true;
      return [c.player, c.set_name, c.sku, c.sport_category, c.storage_location, String(c.year ?? "")]
        .some((v) => v?.toLowerCase().includes(term));
    });
  }, [cards, q, statusFilter]);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => sel.has(c.id));
  const toggleAll = () => {
    setSel((p) => {
      const n = new Set(p);
      if (allVisibleSelected) visible.forEach((c) => n.delete(c.id));
      else visible.forEach((c) => n.add(c.id));
      return n;
    });
  };
  const toggle = (id: string) =>
    setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Storage only changes when a value is typed — a blank field is "leave
  // alone", never "wipe" (that footgun cleared storage on abandoned edits).
  const hasEdit = Boolean(newStatus || newStorage.trim() || newStrategy);

  async function apply() {
    setBusy(true);
    setMsg(null);
    try {
      const patch: Record<string, string> = {};
      if (newStatus) patch.status = newStatus;
      if (newStorage.trim()) patch.storage_location = newStorage.trim();
      if (newStrategy) patch.pricing_strategy = newStrategy;
      const r = await fetch("/api/cards/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...sel], patch }),
      });
      const text = await r.text();
      let d: { error?: string; updated?: number; skipped?: number };
      try { d = JSON.parse(text); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
      if (!r.ok) throw new Error(d.error || "Bulk edit failed.");
      const skip = d.skipped ? ` (${d.skipped} skipped — sold or locked)` : "";
      setMsg({ kind: "ok", text: `Updated ${d.updated ?? 0} card${d.updated === 1 ? "" : "s"}${skip}.` });
      setNewStatus(""); setNewStorage(""); setNewStrategy("");
      setSel(new Set());
      router.refresh(); // re-pull fresh rows from the server component
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Bulk edit failed." });
    } finally {
      setBusy(false);
    }
  }

  async function createLot() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/cards/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "create", cardIds: [...sel] }),
      });
      const text = await r.text();
      let d: { lotId?: string; sku?: string; error?: string };
      try { d = JSON.parse(text); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
      if (!r.ok) throw new Error(d.error || "Couldn't create lot.");
      router.push("/cards/lots");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't create lot." });
      setBusy(false);
    }
  }

  async function exportSelected() {
    setBusy(true);
    setMsg(null);
    try {
      // POST (not a GET link) so hundreds of ids don't overflow the URL.
      const r = await fetch("/api/cards/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, ids: [...sel] }),
      });
      if (!r.ok) {
        const t = await r.text();
        let e: string | undefined;
        try { e = (JSON.parse(t) as { error?: string }).error; } catch { /* non-JSON */ }
        throw new Error(e || `Export failed (HTTP ${r.status}).`);
      }
      const blob = await r.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `cardops-${profile}-selected.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Export failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      {/* Filters */}
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter player, set, SKU, storage…"
          className="flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-white px-2 py-2 text-sm outline-none focus:border-flag">
          <option value="">All statuses</option>
          {CARD_STATUSES.filter((s) => s !== "archived").map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Action bar — sticks while scrolling the list */}
      <div className="sticky top-0 z-10 mt-3 rounded-xl border border-hairline bg-paper/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <button onClick={toggleAll} className="flex items-center gap-1.5 text-xs font-semibold text-ink/70">
            {allVisibleSelected ? <CheckSquare size={14} className="text-flag" /> : <Square size={14} />}
            {allVisibleSelected ? "Clear visible" : "Select visible"}
          </button>
          <span className="flex items-center gap-2">
            <span className="figures text-xs font-bold text-flag">{sel.size} selected</span>
            {sel.size > 0 && (
              <button onClick={() => setSel(new Set())} aria-label="Clear selection"
                className="flex items-center gap-1 text-[11px] font-semibold text-ink/40 hover:text-ink">
                <XCircle size={12} /> Clear
              </button>
            )}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
            className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-flag">
            <option value="">Status → keep</option>
            {CARD_STATUSES.filter((s) => s !== "sold").map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={newStorage} onChange={(e) => setNewStorage(e.target.value)}
            placeholder="Storage → (blank = leave)"
            className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-flag" />
          <select value={newStrategy} onChange={(e) => setNewStrategy(e.target.value)}
            className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-flag">
            <option value="">Pricing → keep</option>
            {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="mt-2 flex gap-2">
          <button onClick={apply} disabled={busy || !sel.size || !hasEdit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-flag py-2 text-xs font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Apply to {sel.size}
          </button>
          <select value={profile} onChange={(e) => setProfile(e.target.value)}
            className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-flag">
            {profiles.map((p) => <option key={p}>{p}</option>)}
          </select>
          <button onClick={createLot} disabled={busy || sel.size < 2}
            className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-2 text-xs font-bold text-ink disabled:opacity-40"
            title="Bundle the selected cards into one sellable lot">
            <Layers size={13} /> Lot
          </button>
          <button onClick={exportSelected} disabled={busy || !sel.size}
            className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-2 text-xs font-bold text-ink disabled:opacity-40">
            <Download size={13} /> Export
          </button>
        </div>
        {msg && (
          <p className={"mt-2 text-[11px] font-semibold " + (msg.kind === "ok" ? "text-pos" : "text-danger")}>{msg.text}</p>
        )}
      </div>

      {/* Rows */}
      {!visible.length ? (
        <div className="mt-3 rounded-xl border border-hairline bg-white">
          <p className="figures px-4 py-10 text-center text-sm text-ink/40">No cards match.</p>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-white">
          {visible.map((c) => {
            const on = sel.has(c.id);
            return (
              <button key={c.id} onClick={() => toggle(c.id)}
                className={"flex w-full items-center gap-3 border-b border-hairline px-3 py-2 text-left last:border-b-0 " + (on ? "bg-flag/8" : "hover:bg-paper")}>
                {on ? <CheckSquare size={16} className="shrink-0 text-flag" /> : <Square size={16} className="shrink-0 text-ink/25" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {[c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(untitled)"}
                  </div>
                  <div className="figures truncate text-[11px] text-ink/50">
                    {[c.sku, c.storage_location ?? c.location_code, c.condition_type === "graded" ? `${c.grader} ${c.grade}` : null]
                      .filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="figures shrink-0 text-xs font-semibold">{money(c.manual_price ?? c.market_value)}</span>
                <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold " + (STATUS_TONE[c.status] ?? "bg-ink/10 text-ink/50")}>
                  {c.status}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

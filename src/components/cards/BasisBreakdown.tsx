"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Loader2, AlertTriangle, Check } from "lucide-react";

type Item = {
  id: string; kind_key: string; label: string; amount: number;
  incurred_on: string | null; note: string | null;
};
type Kind = { key: string; label: string };

const money = (n: number) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inp = "w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-flag";

/**
 * Total Cost Basis, with the breakdown that makes it up.
 *
 * Acquisition (what the card cost to get) is passed in — it comes from the
 * card's purchase lot or its stated figure, and is edited elsewhere. Everything
 * here is what has been capitalized into the card SINCE: grading, appraisal,
 * sales tax, shipping in. Total = acquisition + these.
 */
export function BasisBreakdown({
  cardId,
  acquisition,
  fromLot,
  basisEntered,
  sold,
}: {
  cardId: string;
  acquisition: number;
  fromLot: boolean;
  basisEntered: boolean;
  sold: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [partial, setPartial] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState("grading_fee");
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState("");
  const [newKind, setNewKind] = useState("");
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      try {
        const r = await fetch(`/api/cards/basis-items?cardId=${encodeURIComponent(cardId)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't load the breakdown.");
        setItems(d.items ?? []);
        setKinds(d.kinds ?? []);
        setPartial(!!d.partial || !!d.truncated);
        if (d.kinds?.[0]) setKind((k) => (d.kinds.some((x: Kind) => x.key === k) ? k : d.kinds[0].key));
        setLoaded(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't load the breakdown.");
      }
    })();
  }, [open, loaded, cardId]);

  const lines = items.reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const total = acquisition + lines;

  async function add() {
    const n = Number(amount);
    if (!Number.isFinite(n)) { setErr("Enter an amount."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/basis-items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId, kind_key: kind, amount: n, incurred_on: on || null,
          label: kinds.find((k) => k.key === kind)?.label,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't add that line.");
      setItems((xs) => [...xs, d.item]);
      setAmount(""); setOn("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add that line.");
    } finally { setBusy(false); }
  }

  async function edit(id: string, value: string) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const before = items;
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, amount: n } : x)));
    const r = await fetch("/api/cards/basis-items", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, amount: n }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setItems(before); // never leave a number on screen the database refused
      setErr(d?.error || "Couldn't save that change.");
    }
  }

  async function remove(id: string) {
    const before = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    const r = await fetch(`/api/cards/basis-items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setItems(before);
      setErr(d?.error || "Couldn't remove that line.");
    }
  }

  async function addKind() {
    const label = newKind.trim();
    if (!label) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/basis-items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "kind", label }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't add that cost type.");
      setKinds((xs) => [...xs.filter((x) => x.key !== d.kind.key), d.kind]);
      setKind(d.kind.key); setNewKind(""); setNaming(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add that cost type.");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        {open ? <ChevronDown size={15} className="text-ink/40" /> : <ChevronRight size={15} className="text-ink/40" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/50">Total Cost Basis</span>
        <span className="figures ml-auto text-base font-bold text-ink">{money(total)}</span>
      </button>

      {/* A card nobody has priced is not a free card. Say which it is. */}
      {!basisEntered && !fromLot && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          No cost basis entered yet — this shows as $0, which isn&apos;t the same as free. Add what you paid below.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-2">
          {partial && (
            <p className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
              Some cost lines couldn&apos;t be read — this total is incomplete.
            </p>
          )}

          <div className="flex items-baseline justify-between border-b border-hairline pb-1.5 text-[12px]">
            <span className="text-ink/60">{fromLot ? "Acquisition (purchase lot share)" : "What you paid"}</span>
            <span className="figures font-semibold text-ink">{money(acquisition)}</span>
          </div>

          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-[12px]">
              <span className="flex-1 truncate text-ink/70">
                {i.label}
                {i.incurred_on && <span className="ml-1 text-ink/35">{i.incurred_on}</span>}
              </span>
              <input
                type="number" step="0.01" defaultValue={i.amount} disabled={sold}
                onBlur={(e) => { if (Number(e.target.value) !== Number(i.amount)) edit(i.id, e.target.value); }}
                className="figures w-24 rounded-lg border border-hairline px-2 py-1 text-right text-sm text-ink outline-none focus:border-flag disabled:opacity-60"
              />
              {!sold && (
                <button type="button" onClick={() => remove(i.id)} aria-label={`Remove ${i.label}`}
                  className="rounded p-1 text-ink/30 hover:text-danger">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}

          {items.length === 0 && loaded && (
            <p className="text-[11px] text-ink/45">No cost lines yet. Grading, appraisal, sales tax, shipping in — anything you capitalize into this card.</p>
          )}
          {!loaded && !err && <Loader2 size={14} className="animate-spin text-ink/30" />}

          {sold ? (
            <p className="rounded-lg bg-ink/5 px-2 py-1.5 text-[11px] text-ink/55">
              This card is sold, so its basis is locked — the profit on record was calculated from it.
              Un-sell it first if the basis genuinely needs to change.
            </p>
          ) : (
            <div className="space-y-1.5 border-t border-hairline pt-2">
              <div className="flex gap-1.5">
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={inp + " flex-1"}>
                  {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
                <input type="number" step="0.01" inputMode="decimal" placeholder="0.00"
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className={inp + " figures w-24 text-right"} />
              </div>
              <div className="flex gap-1.5">
                <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={inp + " flex-1"} />
                <button type="button" onClick={add} disabled={busy || !amount}
                  className="flex items-center gap-1 rounded-lg bg-flag px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
                </button>
              </div>
              {naming ? (
                <div className="flex gap-1.5">
                  <input value={newKind} onChange={(e) => setNewKind(e.target.value)} autoFocus maxLength={60}
                    placeholder="e.g. Consignment prep" className={inp + " flex-1"} />
                  <button type="button" onClick={addKind} disabled={busy || !newKind.trim()}
                    className="rounded-lg bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">
                    <Check size={12} />
                  </button>
                  <button type="button" onClick={() => { setNaming(false); setNewKind(""); }}
                    className="px-2 text-[11px] font-semibold text-ink/50">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setNaming(true)} className="text-[11px] font-semibold text-flag">
                  + New cost type
                </button>
              )}
            </div>
          )}

          {err && <p className="text-[11px] text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}

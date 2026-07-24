"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Layers, DollarSign, RotateCcw, Trash2, Sparkles, X, ShoppingCart } from "lucide-react";

type LotCard = {
  card_id: string;
  comp_value_at_add: number | null;
  cards: { player: string | null; year: number | null; set_name: string | null; market_value: number | null; manual_price: number | null } | null;
};
type Lot = {
  id: string; sku: string; title: string | null; description: string | null;
  status: string; ask_price: number | null; listing_refs: Record<string, unknown>;
  card_lot_items: LotCard[];
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

async function readJson(r: Response) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
}

export function LotsManager() {
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [sellOpen, setSellOpen] = useState<string | null>(null);
  const [sellPrice, setSellPrice] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch("/api/cards/lots");
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Couldn't load lots.");
      setLots((d.lots as Lot[]) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load lots.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sumOfSingles = (lot: Lot) =>
    lot.card_lot_items.reduce((s, li) => s + Number(li.comp_value_at_add ?? li.cards?.manual_price ?? li.cards?.market_value ?? 0), 0);

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setRowErr((p) => { const n = { ...p }; delete n[id]; return n; });
    try { await fn(); await load(); }
    catch (e) { setRowErr((p) => ({ ...p, [id]: e instanceof Error ? e.message : "Failed." })); }
    finally { setBusyId(null); }
  }

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/cards/lots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await readJson(r);
    if (!r.ok) throw new Error(d.error || "Failed.");
    return d;
  }

  function listOnEbay(lotId: string) {
    // eBay routes are single-homed on MasterOps — link over from the standalone app.
    if (typeof window !== "undefined" && window.location.host.startsWith("card-ops")) {
      window.location.href = "https://master-ops-iota.vercel.app/cards/lots";
      return;
    }
    void act(lotId, async () => {
      const r = await fetch("/api/ebay/list-lot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lotId }) });
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "List failed.");
      if (d.url) window.open(d.url as string, "_blank");
    });
  }

  if (err) return (
    <div className="mt-6 rounded-xl border border-danger/40 bg-danger/5 p-4">
      <p className="text-sm text-danger">{err}</p>
      <button onClick={() => void load()} className="mt-2 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-semibold">Retry</button>
    </div>
  );
  if (!lots) return <div className="mt-10 flex items-center justify-center gap-2 text-sm text-ink/50"><Loader2 size={16} className="animate-spin" /> Loading lots…</div>;
  if (!lots.length) return (
    <div className="mt-4 rounded-xl border border-hairline bg-white p-6 text-center">
      <Layers size={22} className="mx-auto text-ink/25" />
      <p className="mt-2 text-sm text-ink/50">No lots yet.</p>
      <Link href="/cards/bulk" className="mt-2 inline-block text-xs font-bold text-flag underline-offset-2 hover:underline">Select cards on the Bulk page → Lot</Link>
    </div>
  );

  return (
    <div className="mt-4 space-y-3">
      {lots.map((lot) => {
        const busy = busyId === lot.id;
        const singles = sumOfSingles(lot);
        const suggested = Math.round(singles * 0.85 * 100) / 100; // lots sell under sum-of-singles
        return (
          <div key={lot.id} className="overflow-hidden rounded-xl border border-hairline bg-white">
            <div className="flex items-baseline justify-between gap-2 border-b border-hairline px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-bold">{lot.title || `Lot ${lot.sku}`}</span>
                <span className="figures ml-2 text-[11px] text-ink/40">{lot.card_lot_items.length} cards · {lot.sku}</span>
              </div>
              <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                (lot.status === "sold" ? "bg-pos/15 text-pos" : lot.status === "listed" ? "bg-flag/15 text-flag" : "bg-ink/10 text-ink/50")}>
                {lot.status}
              </span>
            </div>

            <div className="px-3 py-2">
              {lot.card_lot_items.map((li) => (
                <div key={li.card_id} className="flex items-baseline justify-between gap-2 py-0.5">
                  <Link href={`/cards/${li.card_id}`} className="truncate text-[12px] text-ink/70 underline-offset-2 hover:text-ink hover:underline">
                    {[li.cards?.year, li.cards?.player, li.cards?.set_name].filter(Boolean).join(" ") || "(card)"}
                  </Link>
                  <span className="figures shrink-0 text-[11px] text-ink/45">{money(li.comp_value_at_add ?? li.cards?.manual_price ?? li.cards?.market_value)}</span>
                </div>
              ))}
              <div className="mt-1.5 flex items-baseline justify-between border-t border-hairline pt-1.5 text-[11px]">
                <span className="text-ink/50">Sum of singles</span>
                <span className="figures font-semibold text-ink/70">{money(singles)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline bg-paper/30 px-3 py-2">
              {lot.status === "sold" ? (
                <button disabled={busy} onClick={() => act(lot.id, async () => { await post({ op: "reverse", lotId: lot.id }); })}
                  className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-bold text-danger disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reverse sale
                </button>
              ) : sellOpen === lot.id ? (
                <span className="flex items-center gap-1.5">
                  <input value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} type="number" step="0.01" autoFocus placeholder="Sale $"
                    className="figures w-24 rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-flag" />
                  <button disabled={busy || !(Number(sellPrice) > 0)}
                    onClick={() => act(lot.id, async () => { await post({ op: "sell", lotId: lot.id, salePrice: Number(sellPrice) }); setSellOpen(null); setSellPrice(""); })}
                    className="rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Settle</button>
                  <button onClick={() => setSellOpen(null)} className="text-ink/40"><X size={14} /></button>
                </span>
              ) : (
                <>
                  <button disabled={busy} onClick={() => { setSellOpen(lot.id); setSellPrice(String(lot.ask_price ?? suggested)); }}
                    className="flex items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                    <DollarSign size={12} /> Mark sold
                  </button>
                  {(() => {
                    const eb = (lot.listing_refs as Record<string, { url?: string; status?: string }> | null)?.ebay;
                    return eb?.status === "active" && eb.url ? (
                      <a href={eb.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-pos/40 bg-pos/5 px-3 py-1.5 text-xs font-bold text-pos">
                        On eBay ↗
                      </a>
                    ) : (
                      <button disabled={busy} onClick={() => listOnEbay(lot.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-bold text-ink/70 disabled:opacity-50">
                        <ShoppingCart size={12} /> List on eBay
                      </button>
                    );
                  })()}
                  <button disabled={busy} onClick={() => act(lot.id, async () => {
                    const price = prompt("Ask price for the lot:", String(lot.ask_price ?? suggested));
                    if (price != null) await post({ op: "update", lotId: lot.id, askPrice: Number(price) });
                  })}
                    className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 disabled:opacity-50">
                    Ask {lot.ask_price != null ? money(lot.ask_price) : `~${money(suggested)}`}
                  </button>
                  <button disabled={busy} onClick={() => act(lot.id, async () => { await post({ op: "archive", lotId: lot.id }); })}
                    title="Break up the lot (frees the cards)"
                    className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-ink/40 hover:text-danger disabled:opacity-50">
                    <Trash2 size={12} /> Break up
                  </button>
                </>
              )}
              {busy && sellOpen !== lot.id && <Loader2 size={13} className="animate-spin text-flag" />}
            </div>
            {rowErr[lot.id] && <p className="px-3 pb-2 text-[11px] text-danger">{rowErr[lot.id]}</p>}
          </div>
        );
      })}
      <p className="flex items-center gap-1.5 text-[10px] text-ink/35">
        <Sparkles size={11} /> Suggested lot ask = 85% of sum-of-singles (lots sell under the parts). Selling splits proceeds by each card&apos;s value.
      </p>
    </div>
  );
}

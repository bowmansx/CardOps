"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Receipt as RIcon, Loader2, Plus, Trash2, ArrowRight, Camera } from "lucide-react";
import { downscale } from "@/lib/cards/img";

type Entity = { id: string; short_code: string; name: string };
export type Receipt = {
  id: string; entity_id: string | null; receipt_date: string; vendor: string | null; amount: number;
  note: string | null; disposition: "pool" | "cards" | "advance"; treatment: string | null; to_entity_id: string | null;
  advance_disposition: string | null; advance_treatment: string | null; posted: boolean;
};

const TREATMENTS: [string, string][] = [["dealer", "Dealer"], ["investment", "Investment"], ["hobby", "Hobby"]];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function ReceiptsManager({ initial, entities }: { initial: Receipt[]; entities: Entity[] }) {
  const codeOf = (id: string | null) => entities.find((e) => e.id === id)?.short_code ?? "—";
  const [list, setList] = useState<Receipt[]>(initial);
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposition, setDisposition] = useState<"pool" | "cards" | "advance">("pool");
  const [treatment, setTreatment] = useState("dealer");
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [toEntityId, setToEntityId] = useState("");
  const [advDisp, setAdvDisp] = useState<"pool" | "cards">("pool");
  const [advTreatment, setAdvTreatment] = useState("dealer");
  const [note, setNote] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function scan(file: File) {
    setScanning(true); setErr(null);
    try {
      // Downscale to a JPEG first: phone receipt photos are routinely 3–8 MB,
      // over the vision API's per-image limit, so the raw file would fail to read.
      const dataUrl = await downscale(file, 1600);
      const b64 = dataUrl.split(",")[1] ?? "";
      const r = await fetch("/api/cards/receipts/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // replacePath: drop the prior not-yet-saved image if this is a re-scan.
        body: JSON.stringify({ imageBase64: b64, mediaType: "image/jpeg", replacePath: imagePath ?? undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Scan failed.");
      if (d.amount) setAmount(String(d.amount));
      if (d.vendor) setVendor(d.vendor);
      if (d.receipt_date) setDate(d.receipt_date);
      if (d.image_path) setImagePath(d.image_path);
    } catch (e) { setErr(e instanceof Error ? e.message : "Scan failed."); } finally { setScanning(false); }
  }

  async function add() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount), vendor: vendor || undefined, receipt_date: date, disposition, entity_id: entityId,
          treatment,
          to_entity_id: disposition === "advance" ? toEntityId : undefined,
          advance_disposition: disposition === "advance" ? advDisp : undefined,
          advance_treatment: disposition === "advance" ? advTreatment : undefined,
          note: note || undefined, image_path: imagePath || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setList((p) => [d.receipt as Receipt, ...p]);
      setAmount(""); setVendor(""); setNote(""); setImagePath(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this receipt and its journal entries?")) return;
    setList((p) => p.filter((x) => x.id !== id));
    await fetch(`/api/cards/receipts?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/50";
  const otherEntities = entities.filter((e) => e.id !== entityId);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><RIcon size={20} className="text-flag" /> Cost Receipts</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/books" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Books</Link>
            <Link href="/cards" className="text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] leading-snug text-ink/50">
          A cost receipt goes to the <b>pool</b>, to <b>specific cards</b>, or is an <b>advance</b> to another business —
          which then books the money on its own side. Each posts a balanced entry to the internal ledger.
        </p>

        {entities.length === 0 ? (
          <div className="mt-4 rounded-xl border border-hairline bg-white p-6 text-center text-sm text-ink/50">No businesses to book against.</div>
        ) : (
          <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-white p-4">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) scan(e.target.files[0]); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={scanning}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-flag/50 bg-flag/5 py-2.5 text-sm font-semibold text-flag disabled:opacity-50">
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              {scanning ? "Reading receipt…" : imagePath ? "Photo attached — scan another" : "Scan a receipt photo"}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className={lbl}>Amount</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="40.00" className={"figures " + field} /></label>
              <label className="block"><span className={lbl}>Date</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={"figures " + field} /></label>
            </div>
            <label className="block"><span className={lbl}>Vendor / note (optional)</span>
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Dave & Adam's — a case" className={field} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className={lbl}>Paid by (business)</span>
                <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={field}>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.short_code} · {e.name}</option>)}
                </select></label>
              <label className="block"><span className={lbl}>Goes toward</span>
                <select value={disposition} onChange={(e) => setDisposition(e.target.value as typeof disposition)} className={field}>
                  <option value="pool">The pool (bulk basis)</option>
                  <option value="cards">Specific card(s)</option>
                  <option value="advance">Advance to another business</option>
                </select></label>
            </div>
            {disposition !== "advance" && (
              <label className="block"><span className={lbl}>Held as (tax treatment)</span>
                <select value={treatment} onChange={(e) => setTreatment(e.target.value)} className={field}>
                  {TREATMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
            )}
            {disposition === "advance" && (
              <div className="space-y-2 rounded-lg border border-flag/30 bg-flag/5 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-flag/80">The receiving business books it</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className={lbl}>Advance to</span>
                    <select value={toEntityId} onChange={(e) => setToEntityId(e.target.value)} className={field}>
                      <option value="">Pick a business…</option>
                      {otherEntities.map((e) => <option key={e.id} value={e.id}>{e.short_code} · {e.name}</option>)}
                    </select></label>
                  <label className="block"><span className={lbl}>They book it as</span>
                    <select value={advDisp} onChange={(e) => setAdvDisp(e.target.value as typeof advDisp)} className={field}>
                      <option value="pool">Their pool basis</option>
                      <option value="cards">Their specific purchase(s)</option>
                    </select></label>
                </div>
                <label className="block"><span className={lbl}>They hold it as (tax treatment)</span>
                  <select value={advTreatment} onChange={(e) => setAdvTreatment(e.target.value)} className={field}>
                    {TREATMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select></label>
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-ink/40">Posts a balanced journal entry{disposition === "advance" ? " on both businesses" : ""}.</span>
              <button onClick={add} disabled={busy || !(Number(amount) > 0) || (disposition === "advance" && !toEntityId)}
                className="flex items-center gap-1.5 rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add receipt
              </button>
            </div>
            {err && <p className="text-[11px] text-danger">{err}</p>}
          </div>
        )}

        <div className="mt-4 space-y-1.5">
          {list.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  {money(Number(r.amount))}
                  <span className="text-[11px] font-normal text-ink/50">
                    · {codeOf(r.entity_id)}
                    {r.disposition === "advance" ? (
                      <span className="inline-flex items-center gap-0.5"> <ArrowRight size={10} /> {codeOf(r.to_entity_id)} ({r.advance_disposition}{r.advance_treatment ? ` · ${r.advance_treatment}` : ""})</span>
                    ) : ` → ${r.disposition} · ${r.treatment ?? "dealer"}`}
                  </span>
                </div>
                <div className="figures text-[10px] text-ink/45">{r.receipt_date}{r.vendor ? ` · ${r.vendor}` : ""}{r.posted ? " · booked" : ""}</div>
              </div>
              <button onClick={() => del(r.id)} className="shrink-0 text-ink/30 hover:text-danger"><Trash2 size={15} /></button>
            </div>
          ))}
          {!list.length && <p className="mt-6 text-center text-sm text-ink/45">No receipts yet.</p>}
        </div>
      </div>
    </main>
  );
}

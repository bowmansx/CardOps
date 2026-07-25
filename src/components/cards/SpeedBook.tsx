"use client";

import { useState } from "react";
import { Camera, Zap, X, CheckCircle2, Loader2 } from "lucide-react";
import { SPORT_CATEGORIES, ZONES, PRICING_STRATEGY_OPTIONS } from "@/lib/cards/types";
import { commitSpeedBatch, applyBatchStrategy, type SpeedItem } from "@/app/cards/intake/actions";
import { Lightbox } from "./Lightbox";
import { CameraSheet, type CapturedShot } from "./CameraSheet";

// Speed Book: front-only rapid capture with NO external API calls (works
// dormant). New shots inherit the current category/zone defaults. Committing a
// batch REQUIRES a lot cost (pool-integrity guardrail).
export function SpeedBook({
  strategies = [...PRICING_STRATEGY_OPTIONS],
  entities = [],
}: {
  strategies?: { key: string; label: string }[];
  entities?: { id: string; short_code: string; name: string }[];
}) {
  const [cam, setCam] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [zone, setZone] = useState<string>("BULK");
  const [strategy, setStrategy] = useState<string>("standard");
  const [entity, setEntity] = useState<string>("");
  const [treatment, setTreatment] = useState<string>("dealer");
  const [items, setItems] = useState<(SpeedItem & { thumb: string })[]>([]);
  const [asking, setAsking] = useState(false);
  const [lotCost, setLotCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ n: number; poolTotal?: number } | null>(null);
  const [view, setView] = useState<string | null>(null);

  // Speed Book now uses the same in-app scanner as the other intake paths, so
  // bulk capture gets the alignment guide, auto-snap, the edge margin and the
  // retained uncropped frame instead of a bare OS-camera hand-off.
  function capture(shot: CapturedShot) {
    setItems((xs) => [...xs, {
      front: shot.url, thumb: shot.url, front_original: shot.original ?? undefined,
      sport_category: category || undefined, zone,
    }]);
  }
  function remove(i: number) { setItems((xs) => xs.filter((_, j) => j !== i)); }

  async function book() {
    setErr(null); setBusy(true);
    const res = await commitSpeedBatch(items.map(({ front, front_original, sport_category, zone }) => ({ front, front_original, sport_category, zone })), Number(lotCost));
    if (!res.ok) { setBusy(false); setErr(res.error ?? "Batch failed."); return; }
    // Stamp the chosen pricing standard across the lot (default column is
    // 'standard'; this applies whatever was picked).
    if (res.ids?.length && (strategy !== "standard" || entity || treatment !== "dealer")) await applyBatchStrategy(res.ids, strategy, undefined, entity || undefined, treatment);
    setBusy(false);
    if (res.warning) setErr(res.warning); // booked, but say so if a photo didn't store
    setDone({ n: res.inserted ?? items.length, poolTotal: res.poolTotal });
    setItems([]); setLotCost(""); setAsking(false);
  }

  if (done) {
    return (
      <div className="mt-8 rounded-2xl border border-pos/30 bg-pos/5 p-6 text-center">
        <CheckCircle2 size={40} className="mx-auto text-pos" />
        <p className="mt-3 font-bold text-ink">Booked {done.n} cards.</p>
        {done.poolTotal != null && <p className="figures mt-1 text-xs text-ink/60">Pool total now ${done.poolTotal.toFixed(2)}</p>}
        <button onClick={() => setDone(null)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-flag px-5 py-3 font-bold text-white active:scale-95">
          <Zap size={17} /> New batch
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-hairline bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Category (applies to new shots)</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
            <option value="">—</option>
            {SPORT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Zone</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Pricing standard (whole lot — editable later)</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
            {strategies.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {entities.length > 0 && (
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Business — which company owns these?</span>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
              <option value="">Card Operations (default)</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.short_code} · {e.name}</option>)}
            </select>
          </label>
        )}
        {entities.length > 0 && (
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Tax treatment — how these get booked</span>
            <select value={treatment} onChange={(e) => setTreatment(e.target.value)} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
              <option value="dealer">Dealer (inventory / ordinary income)</option>
              <option value="investment">Investment (capital gain/loss)</option>
              <option value="hobby">Hobby (income taxable, costs not deductible)</option>
            </select>
          </label>
        )}
      </div>

      {view && <Lightbox src={view} onClose={() => setView(null)} />}

      {cam && (
        <CameraSheet
          title="Speed Book — front of each card"
          multi
          onClose={() => setCam(false)}
          onCapture={capture}
        />
      )}
      <button onClick={() => setCam(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-flag py-5 text-lg font-bold text-white active:scale-95">
        <Camera size={22} /> Capture ({items.length})
      </button>

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {items.map((it, i) => (
              <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-lg border border-hairline">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.thumb} alt="" onClick={() => setView(it.thumb)} className="h-full w-full cursor-zoom-in object-cover" />
                <button onClick={() => remove(i)} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-ink"><X size={12} /></button>
              </div>
            ))}
          </div>
          {!asking ? (
            <button onClick={() => setAsking(true)} className="w-full rounded-xl border border-flag py-3 font-bold text-flag active:scale-95">
              Finish &amp; book {items.length} →
            </button>
          ) : (
            <div className="space-y-3 rounded-2xl border border-flag/30 bg-flag/5 p-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/60">Lot cost for these {items.length} cards (required)</span>
                <input type="number" step="0.01" min="0" value={lotCost} onChange={(e) => setLotCost(e.target.value)} autoFocus
                  placeholder="e.g. 40.00" className="figures w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag" />
              </label>
              <p className="text-[11px] text-ink/50">This adds one entry to the pool ledger — the basis is shared across the lot.</p>
              {err && <p className="text-xs text-danger">{err}</p>}
              <div className="flex gap-2">
                <button onClick={book} disabled={busy || !(Number(lotCost) > 0)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-flag py-3 font-bold text-white disabled:opacity-50">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : null} Book to pool
                </button>
                <button onClick={() => setAsking(false)} className="rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink/60">Back</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

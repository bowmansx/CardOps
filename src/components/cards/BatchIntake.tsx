"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, Zap, X, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { SPORT_CATEGORIES, ZONES, PRICING_STRATEGY_OPTIONS } from "@/lib/cards/types";
import {
  commitSpeedBatch,
  applyBatchStrategy,
  applyBatchScan,
  type SpeedItem,
  type IntakeInput,
} from "@/app/cards/intake/actions";
import { CameraSheet } from "./CameraSheet";
import { Lightbox } from "./Lightbox";

type Phase = "setup" | "booking" | "scanning" | "done";

/**
 * Batch (AI) intake (Beau, 2026-07-18): set the defaults ONCE (category, zone,
 * pricing standard, lot cost) → rapid-fire the scanner through a whole stack →
 * one atomic Speed-Book commit → then the AI reads every card in the
 * background and parks them in `review`, one pile to walk through and edit.
 * Leaving mid-scan is safe: cards are already booked; unscanned ones just
 * stay blank until edited (or re-scanned from their card page).
 */
export function BatchIntake({
  locations = [],
  strategies = [...PRICING_STRATEGY_OPTIONS],
  entities = [],
}: {
  locations?: string[];
  strategies?: { key: string; label: string }[];
  entities?: { id: string; short_code: string; name: string }[];
}) {
  const [category, setCategory] = useState<string>("");
  const [zone, setZone] = useState<string>("BULK");
  const [strategy, setStrategy] = useState<string>("standard");
  const [storage, setStorage] = useState<string>("");
  const [entity, setEntity] = useState<string>("");
  const [treatment, setTreatment] = useState<string>("dealer");
  const [lotCost, setLotCost] = useState("");
  const [items, setItems] = useState<(SpeedItem & { thumb: string })[]>([]);
  const [cam, setCam] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [scanDone, setScanDone] = useState(0);
  const [scanFail, setScanFail] = useState(0);
  const [aiOff, setAiOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ n: number; poolTotal?: number } | null>(null);
  const abortRef = useRef(false);

  // Background pre-scan: AI reads each card AS you shoot (concurrency-capped so
  // the phone stays responsive), so by the time you hit Book most reads are done.
  // book() reuses these and falls back to an inline scan for anything missing.
  const MAX_CONCURRENT = 3;
  const activeRef = useRef(0);
  const waitRef = useRef<Array<() => void>>([]);
  const preRef = useRef(new Map<string, Promise<IntakeInput | null>>());
  const [preDone, setPreDone] = useState<Set<string>>(new Set()); // urls whose pre-read finished

  // "AI is off" and "the scan failed" both used to land here as a bare null,
  // so a whole batch could come back needing manual entry with no clue that a
  // single toggle was the cause. Record the reason once.
  async function scanFront(url: string): Promise<IntakeInput | null> {
    try {
      const r = await fetch("/api/cards/intake/scan", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front: url }),
      });
      const d = await r.json();
      if (d?.aiOff) { setAiOff(true); return null; }
      return r.ok && d.card ? (d.card as IntakeInput) : null;
    } catch {
      return null;
    }
  }
  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (activeRef.current >= MAX_CONCURRENT) await new Promise<void>((res) => waitRef.current.push(res));
    activeRef.current++;
    try { return await fn(); }
    finally { activeRef.current--; const n = waitRef.current.shift(); if (n) n(); }
  }

  function addShot(url: string) {
    setItems((xs) => [...xs, { front: url, thumb: url, sport_category: category || undefined, zone }]);
    // Kick off the AI read now, in the background.
    if (!preRef.current.has(url)) {
      preRef.current.set(url, withSlot(() => scanFront(url)).then((card) => { setPreDone((s) => new Set(s).add(url)); return card; }));
    }
  }
  function remove(i: number) {
    setItems((xs) => xs.filter((_, j) => j !== i));
  }

  async function book() {
    setErr(null);
    setPhase("booking");
    let booked = false; // did the atomic commit succeed? (governs error recovery)
    try {
      const payload = items.map(({ front, sport_category, zone }) => ({ front, sport_category, zone }));
      const res = await commitSpeedBatch(payload, Number(lotCost));
      if (!res.ok) {
        setErr(res.error ?? "Batch failed.");
        setPhase("setup");
        return;
      }
      const ids = res.ids ?? [];
      booked = true;
      setBooked({ n: res.inserted ?? items.length, poolTotal: res.poolTotal });

      // Stamp the chosen pricing standard + storage place across the whole batch.
      if (ids.length) {
        const applied = await applyBatchStrategy(ids, strategy, storage, entity || undefined, treatment);
        if (!applied.ok) setErr("Booked, but couldn't apply the pricing standard / storage — set them on the review pile.");
      }

      // Background AI pass: sequential so the phone stays responsive; each card
      // that reads successfully moves to `review`.
      setPhase("scanning");
      abortRef.current = false;
      for (let i = 0; i < ids.length; i++) {
        if (abortRef.current) break;
        const front = items[i]?.front;
        if (!front) {
          setScanFail((n) => n + 1);
          continue;
        }
        // Reuse the background pre-read if we started one; else read it now.
        const pre = preRef.current.get(front);
        const card = pre ? await pre : await scanFront(front);
        if (card) {
          const ok = await applyBatchScan(ids[i], card);
          if (ok.ok) setScanDone((n) => n + 1);
          else setScanFail((n) => n + 1);
        } else {
          // aiOff or scan error — card stays quick-booked for manual edit.
          setScanFail((n) => n + 1);
        }
      }
      setPhase("done");
    } catch (e) {
      // A server action can REJECT (expired session, network drop). Never leave
      // the UI stuck on a spinner: surface the error and land somewhere usable.
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      if (booked) setPhase("done"); // cards are booked; the rest can be edited/re-scanned
      else setPhase("setup");
    }
  }

  function reset() {
    setItems([]);
    setLotCost("");
    setScanDone(0);
    setScanFail(0);
    setBooked(null);
    setErr(null);
    setPhase("setup");
    preRef.current.clear();
    setPreDone(new Set());
  }

  if (phase === "scanning" || phase === "done" || phase === "booking") {
    const total = booked?.n ?? items.length;
    return (
      <div className="mt-8 space-y-4 rounded-2xl border border-hairline bg-white p-6 text-center">
        {phase === "booking" ? (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-flag" />
            <p className="font-bold text-ink">Booking {items.length} cards…</p>
          </>
        ) : (
          <>
            <CheckCircle2 size={36} className="mx-auto text-pos" />
            <p className="font-bold text-ink">Booked {total} cards to the pool.</p>
            {booked?.poolTotal != null && (
              <p className="figures text-xs text-ink/60">Pool total now ${booked.poolTotal.toFixed(2)}</p>
            )}
            <div className="flex items-center justify-center gap-2 text-sm text-ink/80">
              {phase === "scanning" ? (
                <>
                  <Sparkles size={15} className="text-flag" />
                  AI reading card {Math.min(scanDone + scanFail + 1, total)} of {total}…
                </>
              ) : (
                <>
                  <Sparkles size={15} className={aiOff ? "text-ink/40" : "text-pos"} />
                  AI filled {scanDone} of {total}
                  {scanFail > 0 ? ` (${scanFail} need manual details)` : ""} — they&apos;re in the
                  <Link href="/cards?status=review" className="ml-1 font-bold text-flag underline underline-offset-2">review pile</Link>.
                </>
              )}
            </div>
            {/* One toggle explains a whole batch of "needs manual details" —
                say so instead of letting it read as an AI that just failed. */}
            {aiOff && phase !== "scanning" && (
              <div className="mx-auto mt-2 max-w-sm rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-800">
                Nothing was auto-filled because <strong>AI card scan is off</strong>.{" "}
                <Link href="/cards/services" className="underline underline-offset-2">Turn it on in Services</Link>, then use “Re-read (AI)” on the cards in the review pile.
              </div>
            )}
            {phase === "scanning" && (
              <>
                <div className="mx-auto h-1.5 w-56 overflow-hidden rounded-full bg-ink/10">
                  <div className="h-full bg-flag transition-all" style={{ width: `${((scanDone + scanFail) / Math.max(1, total)) * 100}%` }} />
                </div>
                <p className="text-[11px] text-ink/40">Safe to leave — cards are already booked; the rest just stay blank.</p>
              </>
            )}
            {err && <p className="text-xs font-semibold text-danger">{err}</p>}
            {phase === "done" && (
              <button onClick={reset} className="mt-2 inline-flex items-center gap-2 rounded-xl bg-flag px-5 py-3 font-bold text-white active:scale-95">
                <Zap size={17} /> New batch
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-hairline bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Category (new shots)</span>
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
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Pricing standard</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag">
            {strategies.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Lot cost $ (required)</span>
          <input type="number" step="0.01" min="0" value={lotCost} onChange={(e) => setLotCost(e.target.value)} placeholder="e.g. 40.00"
            className="figures w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag" />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50">Storage location — where is this stack going? (pick or type new)</span>
          <input value={storage} onChange={(e) => setStorage(e.target.value)} list="batch-storage-locations"
            placeholder="e.g. Black shelf · Box 3"
            className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag" />
          <datalist id="batch-storage-locations">
            {locations.map((l) => <option key={l} value={l} />)}
          </datalist>
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

      <button onClick={() => setCam(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-flag py-5 text-lg font-bold text-white active:scale-95">
        <Camera size={22} /> Scan cards ({items.length})
      </button>

      {items.length > 0 && (() => {
        const ready = items.filter((it) => it.front && preDone.has(it.front)).length;
        return (
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink/55">
            <Sparkles size={12} className="text-flag" />
            {ready < items.length
              ? `AI pre-reading as you shoot… ${ready}/${items.length}`
              : `AI pre-read all ${items.length} — booking will be instant`}
          </div>
        );
      })()}

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
          {err && <p className="text-xs text-danger">{err}</p>}
          <button onClick={book} disabled={!(Number(lotCost) > 0)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-flag py-3.5 font-bold text-white disabled:opacity-50">
            <Sparkles size={17} /> Book {items.length} &amp; AI-read them
          </button>
          {!(Number(lotCost) > 0) && <p className="text-center text-[11px] text-ink/40">Enter the lot cost above to book (pool-integrity guardrail).</p>}
        </>
      )}

      {view && <Lightbox src={view} onClose={() => setView(null)} />}

      {cam && (
        <CameraSheet
          title="Batch scan — front of each card"
          multi
          onClose={() => setCam(false)}
          onCapture={addShot}
        />
      )}
    </div>
  );
}

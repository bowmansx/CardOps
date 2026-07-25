"use client";

import { useState } from "react";
import { Camera, Zap, X, CheckCircle2, Loader2 } from "lucide-react";
import { SPORT_CATEGORIES, ZONES, PRICING_STRATEGY_OPTIONS } from "@/lib/cards/types";
import { commitSpeedBatch, applyBatchStrategy, type SpeedItem } from "@/app/cards/intake/actions";
import { Lightbox } from "./Lightbox";
import { CameraSheet, type CapturedShot } from "./CameraSheet";
import { recordCardPhotos } from "@/app/cards/intake/actions";
import { usePhotoPrefs } from "@/lib/cards/use-photo-prefs";
import { uploadCardPhotos, type PhotoShot } from "@/lib/cards/upload";
import { createClient } from "@/lib/supabase/client";

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
  const photoPrefs = usePhotoPrefs();
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
  // `problems` rides ALONG with the done state. It used to go into `err`,
  // which the success screen never renders — so a whole batch of photos could
  // fail and the user would see an unqualified "Booked 40 cards."
  const [done, setDone] = useState<{ n: number; poolTotal?: number; problems?: string[] } | null>(null);
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
    // The cards and the purchase lot land ATOMICALLY at commitSpeedBatch.
    // Everything after that runs against records that already exist, so a
    // failure there may never be reported as "nothing was booked" - that reads
    // as an invitation to tap Book again, and speed_book_commit has no
    // idempotency key, so a second tap writes a SECOND lot and a second set of
    // cards. Basis would silently double.
    let committed = false;
    const problems: string[] = [];
    try {
      // Identity fields only - a 40-card stack is now no larger on the wire
      // than a single card. The photos follow, straight from the browser.
      const res = await commitSpeedBatch(
        items.map(({ sport_category, zone }) => ({ sport_category, zone })),
        Number(lotCost),
      );
      if (!res.ok) { setErr(res.error ?? "Batch failed."); return; }
      committed = true;

      // Stamp the chosen pricing standard across the lot (default column is
      // 'standard'; this applies whatever was picked).
      if (res.ids?.length && (strategy !== "standard" || entity || treatment !== "dealer")) {
        const applied = await applyBatchStrategy(res.ids, strategy, undefined, entity || undefined, treatment);
        // Checked, not fired and forgotten: a failure here silently reverts the
        // picked tax treatment and owning business to their defaults.
        if (!applied.ok) problems.push(`pricing standard / business not applied: ${applied.error ?? "unknown error"}`);
      }

      // Photos, per card. The cards are booked; a failure here costs an image,
      // never the booking, so it is collected and reported.
      const ids = res.ids ?? [];
      if (ids.length) {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) {
          problems.push("your session ended before the photos uploaded");
        } else {
          for (let i = 0; i < ids.length; i++) {
            const it = items[i];
            if (!it?.front) continue;
            const shots: PhotoShot[] = [];
            let srcIndex: number | undefined;
            if (it.front_original) { srcIndex = 0; shots.push({ dataUrl: it.front_original, kind: "front", variant: "original" }); }
            shots.push({
              dataUrl: it.front, kind: "front",
              variant: it.front_original ? "processed" : "original",
              derivedFromIndex: srcIndex,
              cropGeometry: it.front_original
                ? { margin_pct: photoPrefs.auto_crop === "tight" ? 0 : photoPrefs.crop_margin_pct, deskewed: false }
                : null,
            });
            const up = await uploadCardPhotos(user.id, ids[i], shots);
            if (up.failures.length) problems.push(`card ${i + 1}: ${up.failures.join("; ")}`);
            if (up.photos.length) {
              const rec = await recordCardPhotos(ids[i], up.photos);
              if (!rec.ok) problems.push(`card ${i + 1}: ${rec.error}`);
              else if (rec.warning) problems.push(`card ${i + 1}: ${rec.warning}`);
            }
          }
        }
      }
      if (res.warning) problems.push(res.warning);

      // Problems travel WITH the done state. Putting them in `err` meant they
      // rendered on a panel the success screen replaces - set, then invisible.
      setDone({ n: res.inserted ?? items.length, poolTotal: res.poolTotal, problems });
      setItems([]); setLotCost(""); setAsking(false);
    } catch (e) {
      const why = e instanceof Error && e.message ? e.message : "the connection dropped";
      if (committed) {
        // The cards ARE booked. Land on the done screen saying what is missing.
        problems.push(why);
        setDone({ n: items.length, poolTotal: undefined, problems });
        setItems([]); setLotCost(""); setAsking(false);
      } else {
        // The batch is NOT cleared: a rejection must never cost you the stack
        // you just photographed.
        setErr(`${why} - the batch didn't go through and nothing was booked. Your cards are still here - tap Book to try again.`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-8 rounded-2xl border border-pos/30 bg-pos/5 p-6 text-center">
        <CheckCircle2 size={40} className="mx-auto text-pos" />
        <p className="mt-3 font-bold text-ink">Booked {done.n} cards.</p>
        {done.poolTotal != null && <p className="figures mt-1 text-xs text-ink/60">Lot cost ${done.poolTotal.toFixed(2)}</p>}
        {!!done.problems?.length && (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-left">
            <p className="text-[11px] font-bold text-amber-800">
              The cards are booked, but {done.problems.length} thing{done.problems.length === 1 ? "" : "s"} didn&apos;t finish:
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
              {done.problems.slice(0, 6).map((p, i) => <li key={i}>· {p}</li>)}
              {done.problems.length > 6 && <li>· …and {done.problems.length - 6} more</li>}
            </ul>
            <p className="mt-1.5 text-[10px] text-amber-800/80">
              Speed Book cards carry no name or number, so a card with no photo is hard to identify later —
              find them under Cards and re-shoot before the pile grows.
            </p>
          </div>
        )}
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
          prefs={photoPrefs}
          title="Speed Book — front of each card"
          shotLabel="front"
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, Loader2, CheckCircle2, ScanLine, RotateCcw, AlertTriangle } from "lucide-react";
import { SPORT_CATEGORIES, ZONES, GRADERS, PRICING_STRATEGY_OPTIONS } from "@/lib/cards/types";
import { commitIntakeCard, type IntakeInput } from "@/app/cards/intake/actions";
import { CameraSheet } from "./CameraSheet";
import { Lightbox } from "./Lightbox";

const CONF = 0.85; // INTAKE_CONFIDENCE_THRESHOLD
const inp = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";
const lbl = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50";

type Fields = IntakeInput & { confidences?: Record<string, number>; overall_confidence?: number };
type Step = "capture" | "review";

export function FullIntake({
  strategies = [...PRICING_STRATEGY_OPTIONS],
  entities = [],
}: {
  strategies?: { key: string; label: string }[];
  entities?: { id: string; short_code: string; name: string }[];
}) {
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [cam, setCam] = useState<null | "front" | "back">(null);
  // Front-only (default) scans the moment the front lands; Front + back
  // chains straight into the back camera and scans with both.
  const [withBack, setWithBack] = useState(false);
  const [view, setView] = useState<string | null>(null); // full-screen photo
  const [step, setStep] = useState<Step>("capture");
  const [busy, setBusy] = useState<null | "scanning" | "saving">(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiOff, setAiOff] = useState(false);
  // The full uncropped frames. A crop must never be the only record of an edge.
  const [frontOriginal, setFrontOriginal] = useState<string | null>(null);
  const [backOriginal, setBackOriginal] = useState<string | null>(null);
  const [f, setF] = useState<Fields>({});
  const [savedCount, setSavedCount] = useState(0);

  function set<K extends keyof Fields>(k: K, v: Fields[K]) { setF((p) => ({ ...p, [k]: v })); }

  // Read the card via vision. Fires AUTOMATICALLY the moment the FRONT photo is
  // taken (Beau, 2026-07-18: "take a photo and it fills in"), and can also be
  // run manually by the Scan button (to retry, or after adding a back photo).
  async function runScan(frontUrl: string | null, backUrl: string | null) {
    if (!frontUrl || busy) return;
    setErr(null); setBusy("scanning");
    try {
      const res = await fetch("/api/cards/intake/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: frontUrl, back: backUrl }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Scan failed.");
      if (d.aiOff) {
        // The server tells us WHY and we used to throw it away, so "Re-read
        // (AI)" looked like a dead button. A fail-closed path the user can't
        // see is indistinguishable from a broken one (rules 4 and 8).
        setAiOff(true);
        setErr(d.message ?? "AI scan is off — fill the card in manually.");
        setF({});
      } else {
        setAiOff(false);
        setErr(null);
        setF({ ...d.card });
      }
      setStep("review");
    } catch (e) { setErr(e instanceof Error ? e.message : "Scan failed."); }
    finally { setBusy(null); }
  }

  function manual() { setAiOff(true); setF({}); setStep("review"); }

  async function save() {
    setErr(null); setBusy("saving");
    const res = await commitIntakeCard({
      ...f,
      // Persist the model's confidence for audit / later re-check.
      vision_confidence: f.confidences ? { ...f.confidences, overall: f.overall_confidence } : undefined,
      front: front ?? undefined,
      back: back ?? undefined,
    });
    setBusy(null);
    if (!res.ok) { setErr(res.error ?? "Save failed."); return; }
    setSavedCount((n) => n + 1);
    reset();
  }
  function reset() {
    setFront(null); setBack(null); setF({}); setAiOff(false); setStep("capture"); setErr(null);
  }

  const conf = (f.confidences ?? {}) as Record<string, number>;
  const low = (k: string) => conf[k] != null && conf[k] < CONF;
  const graded = f.condition_type === "graded";

  return (
    <div className="mt-5 space-y-4">
      {savedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-pos/30 bg-pos/5 px-3 py-2 text-sm text-pos">
          <CheckCircle2 size={16} /> {savedCount} card{savedCount === 1 ? "" : "s"} booked this session.
        </div>
      )}

      {step === "capture" && (
        <div className="space-y-3 rounded-2xl border border-hairline bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Photograph the card</span>
            <span className="flex overflow-hidden rounded-lg border border-hairline text-[11px] font-semibold">
              {([false, true] as const).map((wb) => (
                <button key={String(wb)} type="button" onClick={() => setWithBack(wb)}
                  className={"px-2.5 py-1 " + (withBack === wb ? "bg-flag text-white" : "bg-white text-ink/50")}>
                  {wb ? "Front + back" : "Front only"}
                </button>
              ))}
            </span>
          </div>
          <p className="-mt-1 text-xs text-ink/50">
            {withBack
              ? "Front, then the back camera opens automatically — it reads once both are in."
              : "Tap the box — it reads the moment the front lands."}
          </p>
          <div className={withBack ? "grid grid-cols-2 gap-3" : "mx-auto w-1/2"}>
            {(withBack ? (["front", "back"] as const) : (["front"] as const)).map((kind) => {
              const val = kind === "front" ? front : back;
              return (
                <button key={kind} type="button" onClick={() => setCam(kind)}
                  className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-hairline bg-paper">
                  {val ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- data-URL camera preview; next/image can't optimize it */
                    <img src={val} alt={kind} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-xs text-ink/50"><Camera size={22} /> {kind}</span>
                  )}
                </button>
              );
            })}
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex gap-2">
            <button onClick={() => runScan(front, back)} disabled={!front || busy !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-flag py-3 font-bold text-white disabled:opacity-50">
              {busy === "scanning" ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />}
              {busy === "scanning" ? "Reading…" : front ? "Re-scan" : "Scan"}
            </button>
            <button onClick={manual} disabled={busy !== null}
              className="rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink/60">Enter manually</button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-3 rounded-2xl border border-hairline bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Review &amp; confirm</span>
            {aiOff
              ? <span className="figures rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold text-ink/50">manual</span>
              : <span className="figures rounded bg-pos/15 px-1.5 py-0.5 text-[10px] font-semibold text-pos">AI-filled</span>}
          </div>

          {/* "manual" alone doesn't say WHY or what to do about it. When the
              kill-switch is the reason, say so and link to the fix — otherwise
              re-reading just re-renders the same grey chip forever. */}
          {aiOff && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-800">
              AI scan is <strong>off</strong>, so nothing was filled in and <em>Re-read (AI)</em> can&apos;t do anything.
              {" "}<Link href="/cards/services" className="underline underline-offset-2">Turn on “AI card scan (Anthropic)” in Services</Link>, then re-read.
            </div>
          )}

          {/* Photos: tap a thumbnail for full-screen + zoom; Retake swaps the
              shot without touching your field edits. */}
          <div className="flex items-start gap-3">
            {([["front", front], ["back", back]] as const).filter(([, v]) => v).map(([kind, url]) => (
              <div key={kind} className="text-center">
                <button type="button" onClick={() => setView(url as string)} className="block overflow-hidden rounded-lg border border-hairline">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url as string} alt={kind} className="h-24 w-auto object-cover" />
                </button>
                <button type="button" onClick={() => setCam(kind)} className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-flag">
                  <Camera size={10} /> Retake {kind}
                </button>
                {/* The uncropped frame, when the camera took one. Lets you check
                    with your own eyes that the crop didn't clip a corner —
                    which is the only reason auto-crop is safe to trust. */}
                {(kind === "front" ? frontOriginal : backOriginal) && (
                  <button
                    type="button"
                    onClick={() => setView((kind === "front" ? frontOriginal : backOriginal) as string)}
                    className="mt-0.5 block w-full text-[10px] text-ink/45 underline underline-offset-2"
                  >
                    uncropped
                  </button>
                )}
              </div>
            ))}
            <div className="ml-auto flex flex-col items-end gap-1.5">
              {withBack && !back && (
                <button type="button" onClick={() => setCam("back")} className="flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-[10px] font-semibold text-ink/60">
                  <Camera size={10} /> Add back
                </button>
              )}
              <button
                type="button"
                onClick={() => runScan(front, back)}
                disabled={!front || busy !== null}
                className="flex items-center gap-1 rounded-lg border border-flag/40 px-2 py-1 text-[10px] font-bold text-flag disabled:opacity-50"
                title="Re-run the AI on the current photos (overwrites the fields)"
              >
                {busy === "scanning" ? <Loader2 size={10} className="animate-spin" /> : <ScanLine size={10} />} Re-read (AI)
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Player" k="player" f={f} set={set} low={low("player")} full />
            <Field label="Year" k="year" f={f} set={set} low={low("year")} />
            <Field label="Category" k="sport_category" f={f} set={set} select={SPORT_CATEGORIES as unknown as string[]} />
            <Field label="Set" k="set_name" f={f} set={set} low={low("set_name")} />
            <Field label="Card #" k="card_number" f={f} set={set} low={low("card_number")} />
            <Field label="Parallel" k="parallel" f={f} set={set} />
            <Field label="Rarity (TCG)" k="rarity" f={f} set={set} />
            <Field label="Brand" k="brand" f={f} set={set} />
          </div>
          <div className="flex gap-2 text-sm">
            {(["raw", "graded"] as const).map((ct) => (
              <label key={ct} className="flex items-center gap-1.5">
                <input type="radio" checked={(f.condition_type ?? "raw") === ct} onChange={() => set("condition_type", ct)} className="accent-[#E8590C]" /> {ct}
              </label>
            ))}
          </div>
          {graded && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Grader" k="grader" f={f} set={set} select={GRADERS as unknown as string[]} low={low("grader")} />
              <Field label="Grade" k="grade" f={f} set={set} low={low("grade")} />
              <Field label="Cert #" k="cert_number" f={f} set={set} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Zone" k="zone" f={f} set={set} select={ZONES as unknown as string[]} />
            <Field label="Location" k="location_code" f={f} set={set} />
          </div>
          <label className="block">
            <span className={lbl}>Cost $ — what you paid for THIS card (required; 0 for a free card)</span>
            <input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={f.cost ?? ""}
              onChange={(e) => set("cost", e.target.value)}
              className={inp}
            />
          </label>
          <label className="block">
            <span className={lbl}>Pricing standard — how this card&apos;s value gets determined (editable later)</span>
            <select
              value={f.pricing_strategy ?? "standard"}
              onChange={(e) => set("pricing_strategy", e.target.value)}
              className={inp}
            >
              {strategies.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {entities.length > 0 && (
            <label className="block">
              <span className={lbl}>Business — which company owns this card?</span>
              <select value={f.entity_id ?? ""} onChange={(e) => set("entity_id", e.target.value)} className={inp}>
                <option value="">Card Operations (default)</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.short_code} · {e.name}</option>)}
              </select>
            </label>
          )}
          {entities.length > 0 && (
            <label className="block">
              <span className={lbl}>Tax treatment — how this card gets booked</span>
              <select value={f.tax_treatment ?? "dealer"} onChange={(e) => set("tax_treatment", e.target.value)} className={inp}>
                <option value="dealer">Dealer (inventory / ordinary income)</option>
                <option value="investment">Investment (capital gain/loss)</option>
                <option value="hobby">Hobby (income taxable, costs not deductible)</option>
              </select>
            </label>
          )}
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={busy !== null}
              className="flex-1 rounded-xl bg-flag py-3 font-bold text-white disabled:opacity-50">
              {busy === "saving" ? "Saving…" : "Book card"}
            </button>
            <button onClick={reset} className="rounded-xl border border-hairline bg-white px-4 font-semibold text-ink/60" title="Discard"><RotateCcw size={16} /></button>
          </div>
        </div>
      )}

      {view && <Lightbox src={view} onClose={() => setView(null)} />}

      {cam && (
        <CameraSheet
          key={cam} // remount per shot → fresh camera stream for the back (day-review fix)
          title={`Photograph the ${cam}`}
          onClose={() => setCam(null)}
          onCapture={(shot) => {
            const url = shot.url;
            const kind = cam;
            // Keep the uncropped frame alongside the framed one. Persisting it
            // needs the card_photos columns from DESIGN_PHOTO_SYSTEM §4 — until
            // then it is held here rather than silently thrown away.
            if (shot.original) {
              if (kind === "front") setFrontOriginal(shot.original);
              else setBackOriginal(shot.original);
            }
            // Retake from the REVIEW screen: just swap the photo — never
            // wipe the user's field edits with an auto re-scan (they can
            // tap "Re-read (AI)" if they want fresh extraction).
            if (step === "review") {
              if (kind === "front") setFront(url); else setBack(url);
              setCam(null);
              return;
            }
            if (kind === "front") {
              setFront(url);
              if (withBack) {
                setCam("back"); // chain straight into the back shot
              } else {
                setCam(null);
                runScan(url, back);
              }
            } else {
              setBack(url);
              setCam(null);
              runScan(front, url);
            }
          }}
        />
      )}
    </div>
  );
}

// Module scope (day-review fix): declared inside the component, every parent
// re-render recreated the type and REMOUNTED each input — dropping focus and
// the keyboard on every keystroke in the review form.
function Field(props: {
  label: string; k: keyof Fields; f: Fields;
  set: <K extends keyof Fields>(k: K, v: Fields[K]) => void;
  select?: string[]; low?: boolean; full?: boolean;
}) {
  const v = (props.f[props.k] as string) ?? "";
  return (
    <label className={"block " + (props.full ? "col-span-2" : "")}>
      <span className={lbl + " flex items-center gap-1"}>
        {props.label}
        {props.low && <AlertTriangle size={10} className="text-warn" aria-label="low confidence" />}
      </span>
      {props.select
        ? <select value={v} onChange={(e) => props.set(props.k, e.target.value as never)} className={inp + (props.low ? " border-warn/50" : "")}>
            <option value="">—</option>
            {props.select.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        : <input value={v} onChange={(e) => props.set(props.k, e.target.value as never)} className={inp + (props.low ? " border-warn/50" : "")} />}
    </label>
  );
}

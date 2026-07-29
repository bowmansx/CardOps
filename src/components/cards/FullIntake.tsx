"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, Loader2, ScanLine, RotateCcw, AlertTriangle } from "lucide-react";
import { SPORT_CATEGORIES, ZONES, GRADERS, PRICING_STRATEGY_OPTIONS } from "@/lib/cards/types";
import { commitIntakeCard, recordCardPhotos, type IntakeInput } from "@/app/cards/intake/actions";
import { CameraSheet } from "./CameraSheet";
import { IntakeSessionList } from "./IntakeSessionList";
import {
  addToSession, removeFromSession, sessionLabel, type SessionCard,
} from "@/lib/cards/intake-session";
import { usePhotoPrefs } from "@/lib/cards/use-photo-prefs";
import { uploadCardPhotos, type PhotoShot } from "@/lib/cards/upload";
import { createClient } from "@/lib/supabase/client";
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
  const photoPrefs = usePhotoPrefs();
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
  // The cards booked in this sitting. Intake used to keep only a COUNT, so the
  // card you had just done vanished the moment it succeeded - a typo noticed
  // two cards later meant leaving intake to go and find it.
  const [session, setSession] = useState<SessionCard[]>([]);
  const savedCount = session.length;
  // A card that IS booked but whose photos didn't attach. Holding this is what
  // turns a dead end into a retry: the images stay in state and the retry
  // targets the existing card instead of booking another one.
  const [pending, setPendingPhotos] = useState<{ cardId: string; label: string } | null>(null);

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
    // Did the card actually land? Everything after step 1 runs AFTER the card
    // exists, and a rejection there must never be reported as "nothing was
    // booked" — that reads as an invitation to press the button again, which
    // would book a second card.
    let bookedId: string | null = null;
    try {
      // STEP 1 - create the card. Fields only; no image bytes cross the wire,
      // so this can't run into the server-action body limit however many
      // photos or whatever quality the user picked.
      const res = await commitIntakeCard({
        ...f,
        // Persist the model's confidence for audit / later re-check.
        vision_confidence: f.confidences ? { ...f.confidences, overall: f.overall_confidence } : undefined,
      });
      if (!res.ok || !res.id) { setErr(res.error ?? "Save failed."); return; }
      // Bound once: the narrowing above does not survive into the setState
      // callbacks below, which are closures.
      const cardId: string = res.id;
      const cardSku: string | null = res.sku ?? null;
      bookedId = cardId;

      // STEP 2 - the browser puts the bytes straight into storage, inside the
      // user's own folder, which is the boundary card_photo_visible() already
      // enforces. The card exists by now, so nothing is orphaned under an id
      // that never became a card.
      const shots = buildShots();
      const problems: string[] = [];
      if (shots.length) {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) {
          problems.push("your session ended before the photos uploaded");
        } else {
          const up = await uploadCardPhotos(user.id, res.id, shots);
          problems.push(...up.failures);
          // STEP 3 - record whatever landed. A photo that uploaded but was
          // never recorded is an object no screen shows and no quota counts.
          if (up.photos.length) {
            const rec = await recordCardPhotos(res.id, up.photos);
            if (!rec.ok) problems.push(rec.error ?? "the photos couldn't be recorded");
            else if (rec.warning) problems.push(rec.warning);
          }
        }
      }

      if (problems.length) {
        // EVERY problem, not just the last one - an earlier setErr used to be
        // overwritten by a later one, understating what was lost. The photos
        // stay in state and the card id is remembered, so "Retry photos"
        // targets the card that already exists instead of booking a new one.
        setPendingPhotos({ cardId: res.id, label: cardTitle(f) });
        setErr(`Card booked, but its photos didn't attach: ${problems.join(" \u00b7 ")}`);
        // Recorded as photos-MISSING, so the session list can say so rather
        // than showing it as complete alongside the others.
        setSession((l) => addToSession(l, {
          id: cardId, sku: cardSku, label: sessionLabel(f) ?? "",
          thumb: front, at: Date.now(), photosAttached: false,
        }));
        return; // deliberately NOT reset() - the images are the only copy
      }

      setSession((l) => addToSession(l, {
        id: cardId, sku: cardSku, label: sessionLabel(f) ?? "",
        thumb: front, at: Date.now(), photosAttached: true,
      }));
      reset();
    } catch (e) {
      // A server action can REJECT - expired session, dropped connection, a
      // body the platform refused. Without this the button sat on "Saving..."
      // for ever with nothing said and no way back.
      if (bookedId) {
        // The card EXISTS. Saying "nothing was booked" here would invite a
        // retry that books a duplicate.
        setPendingPhotos({ cardId: bookedId, label: cardTitle(f) });
        setErr(
          "The card was booked, but attaching its photos failed" +
          (e instanceof Error && e.message ? ` (${e.message})` : "") +
          ". Tap Retry photos - do not tap Book card again, that would create a second card.",
        );
        setSession((l) => addToSession(l, {
          id: bookedId as string, sku: null, label: sessionLabel(f) ?? "",
          thumb: front, at: Date.now(), photosAttached: false,
        }));
      } else {
        setErr(
          (e instanceof Error && e.message ? e.message + " - " : "") +
          "The save didn't go through and nothing was booked. Your photos and details are still here - tap Book card to try again.",
        );
      }
    } finally {
      setBusy(null);
    }
  }

  /** The shots this card would upload, originals first so a crop can link back. */
  function buildShots() {
    const shots: PhotoShot[] = [];
    const push = (kind: "front" | "back", url: string | null, original: string | null) => {
      if (!url) return;
      let srcIndex: number | undefined;
      if (original) {
        srcIndex = shots.length;
        shots.push({ dataUrl: original, kind, variant: "original" });
      }
      shots.push({
        dataUrl: url,
        kind,
        variant: original ? "processed" : "original",
        derivedFromIndex: srcIndex,
        // The margin ACTUALLY applied, not the preference: with cropping set to
        // 'tight' the preference still holds a percentage that was never used.
        cropGeometry: original
          ? { margin_pct: photoPrefs.auto_crop === "tight" ? 0 : photoPrefs.crop_margin_pct, deskewed: false }
          : null,
      });
    };
    push("front", front, frontOriginal);
    push("back", back, backOriginal);
    return shots;
  }

  /** Re-attach photos to a card that IS booked. Never creates a second card. */
  async function retryPhotos() {
    if (!pending) return;
    setErr(null); setBusy("saving");
    try {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) { setErr("You're signed out - sign in again, then tap Retry photos."); return; }
      const up = await uploadCardPhotos(user.id, pending.cardId, buildShots());
      const problems = [...up.failures];
      if (up.photos.length) {
        const rec = await recordCardPhotos(pending.cardId, up.photos);
        if (!rec.ok) problems.push(rec.error ?? "the photos couldn't be recorded");
        else if (rec.warning) problems.push(rec.warning);
      }
      if (problems.length) { setErr(`Still couldn't attach the photos: ${problems.join(" \u00b7 ")}`); return; }
      // It worked - the card is no longer missing its evidence.
      setSession((l) => l.map((c) => (c.id === pending.cardId ? { ...c, photosAttached: true } : c)));
      setPendingPhotos(null);
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach the photos.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Take a card back out of inventory.
   *
   * ARCHIVES, never deletes. The row already exists and may already have photos
   * in storage; CLAUDE.md makes archiving the sanctioned path and card_ops
   * cannot delete at all. Goes through /api/cards/bulk so the change is
   * allowlisted and audited like every other status move.
   */
  async function archiveCard(id: string) {
    setErr(null);
    try {
      const r = await fetch("/api/cards/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [id], patch: { status: "archived" } }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.updated) {
        setErr(d?.error ?? "Couldn't archive that card - it is still in your inventory.");
        return;
      }
      setSession((l) => removeFromSession(l, id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't archive that card.");
    }
  }

  /** Reopen the camera for a card that is already booked. */
  function rephotograph(c: SessionCard) {
    setPendingPhotos({ cardId: c.id, label: c.label || "this card" });
    setFront(null); setBack(null); setFrontOriginal(null); setBackOriginal(null);
    setStep("capture");
    setErr(null);
    setCam("front");
  }

  function reset() {
    setFront(null); setBack(null); setFrontOriginal(null); setBackOriginal(null);
    setF({}); setAiOff(false); setStep("capture"); setPendingPhotos(null);
  }

  function cardTitle(x: Fields) {
    return [x.year, x.player, x.set_name].filter(Boolean).join(" ") || "That card";
  }

  const conf = (f.confidences ?? {}) as Record<string, number>;
  const low = (k: string) => conf[k] != null && conf[k] < CONF;
  const graded = f.condition_type === "graded";

  return (
    <div className="mt-5 space-y-4">
      {savedCount > 0 && (
        <IntakeSessionList cards={session} onRemove={archiveCard} onAddPhotos={rephotograph} />
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
            <span className={lbl}>
              Total Cost Basis $ <span className="font-normal normal-case tracking-normal text-ink/40">
                — optional. Grading, tax and other costs go on the card page after booking.
              </span>
            </span>
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
          {pending && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2">
              <p className="text-[11px] text-amber-800">
                <strong>{pending.label}</strong> is booked \u2014 only its photos are missing.
              </p>
              <div className="mt-1.5 flex gap-2">
                <button onClick={retryPhotos} disabled={busy !== null}
                  className="rounded-lg bg-flag px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
                  {busy ? "Retrying\u2026" : "Retry photos"}
                </button>
                <button onClick={() => { setPendingPhotos(null); reset(); }} disabled={busy !== null}
                  className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] font-semibold text-ink/60">
                  Skip \u2014 book the next card
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={busy !== null || !!pending}
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
          prefs={photoPrefs}
          key={cam} // remount per shot → fresh camera stream for the back (day-review fix)
          title={`Photograph the ${cam}`}
          shotLabel={cam}
          shotStep={withBack ? (cam === "front" ? "1 of 2" : "2 of 2") : undefined}
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Check, AlertTriangle, LayoutGrid } from "lucide-react";
import { CameraSheet } from "./CameraSheet";
import { sessionToShots, existingSlots, nextOpen, reorder, type CapturedShot } from "@/lib/cards/session";
import type { SessionItem } from "./SessionMenu";
import { usePhotoPrefs } from "@/lib/cards/use-photo-prefs";
import { uploadCardPhotos, type PhotoShot } from "@/lib/cards/upload";
import { recordCardPhotos } from "@/app/cards/intake/actions";
import { createClient } from "@/lib/supabase/client";
import { missingShots, shotStep, type PhotoTemplate, type TemplateShot } from "@/lib/cards/templates";

/**
 * Photograph a card against a TEMPLATE — front and back, all four corners,
 * surface at an angle, whatever the template asks for — and attach the shots
 * to a card that already exists.
 *
 * This is also the recovery path for a card booked without its photos: intake
 * used to tell you to "add it from the card page" when no such thing existed.
 */
export function AddPhotos({ cardId, haveRoles }: { cardId: string; haveRoles: string[] }) {
  const router = useRouter();
  const prefs = usePhotoPrefs();
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [chosen, setChosen] = useState<PhotoTemplate | null>(null);
  const [queue, setQueue] = useState<TemplateShot[]>([]);
  // One slot per queue entry, in lock step with it. NOT a growing list of
  // uploads: the menu can delete and reorder mid-session, and only a parallel
  // array keeps "which photo belongs to which shot" answerable afterwards.
  const [captured, setCaptured] = useState<(CapturedShot | null)[]>([]);
  const [index, setIndex] = useState(0);
  const [inspect, setInspect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [donePhotos, setDonePhotos] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/cards/photo-templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTemplates(d?.templates ?? []))
      .catch(() => {}); // templates are a convenience; failing to list them must not block the camera
  }, []);

  // Which template to offer first: the saved default, else the shortest.
  const suggested = templates.find((t) => t.key === prefs.default_template) ?? templates[0] ?? null;

  function start(t: PhotoTemplate, onlyMissing: boolean) {
    const shots = onlyMissing ? missingShots(t, haveRoles) : t.shots;
    if (!shots.length) { setErr(`This card already has every shot in "${t.name}".`); return; }
    setErr(null); setChosen(t);
    setQueue(shots); setCaptured(shots.map(() => null)); setIndex(0); setOpen(true);
  }

  const current = queue[index] ?? null;
  const already = existingSlots(queue, haveRoles);
  const items: SessionItem[] = queue.map((s, i) => ({
    ...s, taken: captured[i]?.url ?? null, existing: already[i],
  }));

  async function finish(shots: PhotoShot[]) {
    setOpen(false);
    setChosen(null); setQueue([]); setCaptured([]); setIndex(0);
    if (!shots.length) return;
    setBusy(true); setErr(null);
    try {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) { setErr("You're signed out — sign in again and the shots you took will need re-taking."); return; }
      const up = await uploadCardPhotos(user.id, cardId, shots);
      const problems = [...up.failures];
      if (up.photos.length) {
        const rec = await recordCardPhotos(cardId, up.photos);
        if (!rec.ok) problems.push(rec.error ?? "the photos couldn't be recorded");
        else if (rec.warning) problems.push(rec.warning);
      }
      setDonePhotos(up.photos.length);
      if (problems.length) setErr(`${up.photos.length} of ${shots.length} attached. ${problems.join(" · ")}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach the photos.");
    } finally {
      setBusy(false);
    }
  }

  /** Move to the next slot that still wants a photo; finish when none do. */
  function advance(caps: (CapturedShot | null)[]) {
    const next = nextOpen(caps, index);
    if (next < 0) void finish(sessionToShots(queue, caps));
    else setIndex(next);
  }

  function removeAt(i: number) {
    const q = queue.filter((_, k) => k !== i);
    const c = captured.filter((_, k) => k !== i);
    setQueue(q); setCaptured(c);
    // Deleting every shot is how you abandon a session — nothing was kept, so
    // nothing uploads.
    if (!q.length) { setOpen(false); setChosen(null); setIndex(0); return; }
    // Removing a slot BEFORE the current one shifts it down; removing the
    // current one lets the next slide into its place.
    setIndex(Math.min(i < index ? index - 1 : index, q.length - 1));
  }

  function move(from: number, to: number) {
    const staying = queue[index];
    const q = reorder(queue, from, to);
    setQueue(q); setCaptured(reorder(captured, from, to));
    // Follow the SHOT, not the slot — reordering the list must not silently
    // switch which photo you are about to take.
    const at = q.indexOf(staying);
    if (at >= 0) setIndex(at);
  }

  return (
    <div className="mt-4 rounded-xl border border-hairline bg-white p-3">
      <div className="flex items-center gap-2">
        <LayoutGrid size={15} className="text-flag" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/50">Add photos</span>
        {haveRoles.length > 0 && (
          <span className="figures ml-auto text-[11px] text-ink/40">{haveRoles.length} on file</span>
        )}
      </div>

      {donePhotos > 0 && !err && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-pos">
          <Check size={13} /> {donePhotos} photo{donePhotos === 1 ? "" : "s"} attached.
        </p>
      )}
      {err && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {err}
        </p>
      )}

      <div className="mt-2 space-y-1.5">
        {templates.map((t) => {
          const missing = missingShots(t, haveRoles);
          const complete = missing.length === 0;
          return (
            <div key={t.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => start(t, missing.length > 0 && missing.length < t.shots.length)}
                disabled={busy || complete}
                className={"flex flex-1 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold disabled:opacity-45 " +
                  (t.id === suggested?.id ? "border-flag/50 bg-flag/5 text-ink" : "border-hairline text-ink/70")}
              >
                <Camera size={12} className="shrink-0 text-flag" />
                {t.name}
                <span className="ml-auto font-normal text-ink/45">
                  {complete
                    ? "complete"
                    : missing.length < t.shots.length
                      ? `${missing.length} of ${t.shots.length} left`
                      : `${t.shots.length} shots`}
                </span>
              </button>
            </div>
          );
        })}
        {templates.length === 0 && (
          <p className="text-[11px] text-ink/45">No templates yet — paste the templates migration and they&apos;ll appear here.</p>
        )}
      </div>

      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink/50">
          <Loader2 size={13} className="animate-spin" /> Attaching…
        </p>
      )}

      {open && chosen && current && (
        <CameraSheet
          // One mount for the whole run. It used to remount per shot, which
          // tore down and re-acquired the camera between every frame of a
          // 12-shot template — and would now also throw away the menu.
          key={chosen.id}
          prefs={prefs}
          title={chosen.name}
          shotLabel={current.label}
          shotStep={shotStep(index, queue.length)}
          shotHint={current.hint}
          shotTarget={current}
          session={{
            items,
            index,
            onJump: setIndex,
            onDelete: removeAt,
            onReorder: move,
            onKeep: () => advance(captured),
            onDone: () => void finish(sessionToShots(queue, captured)),
            inspect,
            onInspectChange: setInspect,
          }}
          onClose={() => {
            // Closing early keeps what was already taken — walking away from
            // shot 9 of 12 must not throw the first eight away.
            setOpen(false);
            void finish(sessionToShots(queue, captured));
          }}
          onCapture={(shot) => {
            const caps = [...captured];
            caps[index] = shot;
            setCaptured(caps);
            advance(caps);
          }}
        />
      )}
    </div>
  );
}

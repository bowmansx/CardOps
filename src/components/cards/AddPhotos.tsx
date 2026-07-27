"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Check, AlertTriangle, LayoutGrid } from "lucide-react";
import { CameraSheet } from "./CameraSheet";
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
  const [taken, setTaken] = useState<PhotoShot[]>([]);
  // Position in the QUEUE. Not derived from `taken.length`: a shot can add
  // two entries there (the uncropped frame and the crop), which would make
  // a 12-shot template finish after six photos.
  const [index, setIndex] = useState(0);
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
    setErr(null); setChosen(t); setQueue(shots); setTaken([]); setIndex(0); setOpen(true);
  }

  const current = queue[index] ?? null;

  async function finish(shots: PhotoShot[]) {
    setOpen(false);
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
      setChosen(null); setQueue([]); setTaken([]); setIndex(0);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach the photos.");
    } finally {
      setBusy(false);
    }
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
          // Remount per shot so the guide and the label track the queue.
          key={`${chosen.id}-${index}`}
          prefs={prefs}
          title={chosen.name}
          shotLabel={current.label}
          shotStep={shotStep(index, queue.length)}
          shotHint={current.hint}
          shotTarget={current}
          onClose={() => {
            // Closing early keeps what was already taken — walking away from
            // shot 9 of 12 must not throw the first eight away.
            setOpen(false);
            if (taken.length) void finish(taken);
          }}
          onCapture={(shot) => {
            const next: PhotoShot[] = [...taken];
            let srcIndex: number | undefined;
            if (shot.original) {
              srcIndex = next.length;
              next.push({ dataUrl: shot.original, kind: current.role, variant: "original" });
            }
            next.push({
              dataUrl: shot.url,
              kind: current.role,
              variant: shot.original ? "processed" : "original",
              derivedFromIndex: srcIndex,
              cropGeometry: shot.original ? { margin_pct: shot.meta.marginPct, deskewed: false } : null,
              captureMeta: shot.meta,
            });
            setTaken(next);
            setIndex(index + 1);
            if (index + 1 >= queue.length) void finish(next);
          }}
        />
      )}
    </div>
  );
}

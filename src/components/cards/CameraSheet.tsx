"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, Loader2, Images, Check, Wand2, PanelLeft, RotateCcw, Layers, Sparkles } from "lucide-react";
import { SessionMenu, type SessionItem } from "./SessionMenu";
import type { CapturedShot } from "@/lib/cards/session";
import { downscale } from "@/lib/cards/img";
import {
  CARD_ASPECT, SLAB_ASPECT, withMargin, sharpness, frameDelta,
  shouldAutoSnap, pickSharpest, type Rect,
} from "@/lib/cards/camera";
import { detectCard, releaseScratch, type Detection } from "@/lib/cards/edges";
import { guideToTarget, type TemplateShot } from "@/lib/cards/templates";
import { clipFraction, globalMedian, readGlare, glareAdvice } from "@/lib/cards/exposure";
import { QUALITY_SPECS, PHOTO_PREF_DEFAULTS, type PhotoPrefs } from "@/lib/cards/photo-prefs";
import {
  EMPTY_CAPTURE, offerFrame, finishSweep, probeQuadToVideo, warpVideoFrame,
  bufferToDataUrl, type SweepCapture, type SweepOutput,
} from "@/lib/cards/sweep-frames";
import { sweepProgress, sweepWideEnough, SWEEP_DEFAULTS } from "@/lib/cards/sweep";
import { stackAdvice, surfaceAdvice } from "@/lib/cards/stack";

// Card-scanner aspect guides (w/h): raw card 2.5"x3.5", PSA-style slab ~3.32"x5.44".
const GUIDES = { raw: CARD_ASPECT, slab: SLAB_ASPECT } as const;
type GuideKind = keyof typeof GUIDES;

// Auto-snap sampling. (Margin, burst size and output quality now come from the
// user's saved photo preferences — see lib/cards/photo-prefs.)
const PROBE_W = 96;      // downscaled probe frame, keeps the loop cheap
const HISTORY = 8;

// Edge detection runs on its own, wider probe covering the WHOLE frame — the
// card can sit anywhere, and the overlay has to land on it wherever it is.
// 192px measures ~0.25ms a frame on a laptop; a phone is a few ms, which is a
// small slice of a 150ms budget.
const DETECT_W = 192;
const DETECT_MS = 150;
// A side needs this much real edge under it before it counts as locked.
const LIT = 0.55;
// How far outside the guide to search, so a card overhanging it slightly is
// still measured whole. Wide enough to forgive framing, tight enough that the
// table edge stays out.
const DETECT_MARGIN = 0.12;

export type { CapturedShot } from "@/lib/cards/session";

/**
 * In-app camera via getUserMedia — the reliable way to "take a photo" inside an
 * installed PWA on iOS (where <input capture> silently opens the library).
 *
 * Scanner mode (default): a card-shaped frame guide overlays the viewfinder and
 * the capture is CROPPED to the guide — clean, straight, no table背景. Toggle
 * between raw-card and slab guide sizes.
 *
 * multi: stays open after each shot (flash + running count) for rapid batch
 * capture; Done closes. Library picks skip the crop (no guide context).
 */
export function CameraSheet({
  title,
  prefs: prefsIn,
  shotLabel,
  shotStep,
  shotHint,
  shotGuide,
  shotTarget,
  session,
  onCapture,
  onClose,
  multi = false,
}: {
  title: string;
  /** The user's saved capture settings. Defaults apply when absent, so every
   *  caller doesn't have to fetch them. */
  prefs?: Partial<PhotoPrefs>;
  /** Which shot this is — rendered LARGE over the viewfinder. A small title bar
   *  is not enough when your hands are full and you're going front/back/front:
   *  you need to know which side it wants without reading. */
  shotLabel?: string;
  /** Optional "2 of 4" progress, for template runs. */
  shotStep?: string;
  /** The target framing and angle for THIS shot, when the template states
   *  them. Drives the live "move closer" guidance and the on-target lock. */
  shotTarget?: Pick<TemplateShot, "targetFill" | "targetTilt" | "tolerance" | "sweep">;
  /** One line of instruction for THIS shot, e.g. "Fill the frame with the
   *  corner". Templates carry these; without one the frame is just a label. */
  shotHint?: string;
  /** The frame guide this shot wants, when the template states one. */
  shotGuide?: "raw" | "slab";
  /**
   * The whole run, when this camera is working through a template. Passing it
   * turns the sheet from a WIZARD into a SESSION: a menu you can open mid-shoot
   * to delete a shot, reorder the run, or jump back and retake one.
   *
   * Absent for one-off captures, which stay exactly as they were.
   */
  session?: {
    items: SessionItem[];
    index: number;
    onJump: (i: number) => void;
    onDelete: (i: number) => void;
    onReorder: (from: number, to: number) => void;
    /** Keep the shot already taken here and move on without re-shooting. */
    onKeep: () => void;
    /** Finish the run now with whatever has been taken. */
    onDone: () => void;
    inspect: boolean;
    onInspectChange: (v: boolean) => void;
  };
  onCapture: (shot: CapturedShot) => void;
  onClose: () => void;
  multi?: boolean;
}) {
  const prefs: PhotoPrefs = { ...PHOTO_PREF_DEFAULTS, ...(prefsIn ?? {}) };
  const quality = QUALITY_SPECS[prefs.photo_quality];
  // The user can prefer their phone's own camera app — its HDR and noise
  // reduction beat anything we can do to a raw frame. That trade is real, so
  // we hand off entirely rather than pretending the guide still applies.
  const osMode = prefs.capture_mode === "os_camera";

  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const osCamRef = useRef<HTMLInputElement>(null);
  // Has the user asked for the SCAN yet? The camera and the guide come up
  // straight away — you cannot frame a card against a black screen — but
  // detection, the readout, auto-snap and the light sampling all wait for this.
  // Framing is what you do first and it needs the picture; scanning is what you
  // commit to, and it should not begin while the phone is still swinging up
  // from your side.
  //
  // DERIVED, not synced. usePhotoPrefs returns the defaults first and the saved
  // values a moment later, so an effect mirroring the pref into state both
  // trips react-hooks/set-state-in-effect and can un-start a running camera.
  // An OR cannot: once tapped it stays started, and a late `true` starts it.
  const [manualStart, setManualStart] = useState(false);
  const started = manualStart || prefs.scan_on_open;
  const [ready, setReady] = useState(false);
  // What the sensor is actually delivering, and what a shot would come out at.
  // A preset that promises more than the camera has is the defect this exists
  // to make visible.
  const [delivered, setDelivered] = useState<{ src: string; out: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // DERIVED so a template can carry it without an effect: the shot names the
  // guide it wants (a slab is not the shape of the card inside it), and a
  // manual tap still wins for the rest of the session.
  const [manualGuide, setManualGuide] = useState<GuideKind | null>(null);
  const guide: GuideKind = manualGuide ?? shotGuide ?? "raw";
  const [guideRect, setGuideRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);
  const [auto, setAuto] = useState(prefs.auto_snap);
  const [locked, setLocked] = useState(false); // sharp + steady right now
  const probeRef = useRef<HTMLCanvasElement | null>(null);
  const detectRef = useRef<HTMLCanvasElement | null>(null);
  // The live edge read. Null means "no card found" and the overlay shows
  // nothing at all — a wrong outline is worse than no outline.
  const [det, setDet] = useState<Detection | null>(null);
  // Mirrored into a ref so the auto-snap interval can read the CURRENT detection
  // without listing `det` as a dependency — which would tear down and rebuild
  // that interval several times a second.
  const detRef = useRef<Detection | null>(null);
  const [detSize, setDetSize] = useState<{ w: number; h: number; src: Rect } | null>(null);
  const prevGrayRef = useRef<Uint8ClampedArray | null>(null);
  const histRef = useRef<{ sharp: number; delta: number }[]>([]);
  const busyRef = useRef(false); // one capture at a time
  // Read inside the auto-snap interval, which closes over its first render.
  const guideRef = useRef(true);
  const cooldownRef = useRef(0); // don't re-fire on the same card
  /**
   * After an automatic shot, wait for the card to actually CHANGE before firing
   * again.
   *
   * The 1200ms cooldown was never enough to mean "don't re-fire on the same
   * card", which is what it was for: a card left in frame re-locks in about a
   * second and the session fills with duplicates of it. That was a footgun while
   * auto-snap was opt-in; making it the default (2026-07-29) would have made it
   * the normal experience of leaving a card on the desk.
   *
   * Cleared when the detector loses the card, or when the scene moves enough to
   * be a different one. TIME is the wrong axis here — "has the subject changed"
   * is the actual question.
   */
  const awaitingNewCardRef = useRef(false);
  const [menu, setMenu] = useState(false);
  // A rolling window of how much of the frame is blown out, and how the
  // exposure is drifting. Whether Beau's glare could EVER be swept around is a
  // property of his light, not of any code - so it gets measured rather than
  // assumed. See lib/cards/exposure.
  const glareRef = useRef<{ clip: number; median: number }[]>([]);
  const [glare, setGlare] = useState<ReturnType<typeof readGlare> | null>(null);

  // ── THE SWEEP ─────────────────────────────────────────────────────────────
  // Beau: "can it collectively map around the glare... then could it
  // automatically take those scans and create different final photos?"
  //
  // Fed from the EXISTING detection loop rather than a second timer. That loop
  // already computes the quad, the sharpness and the median every tick, and a
  // phone does not need another interval running while the user waves it around.
  //
  // The capture lives in a REF because the detection interval closes over it: a
  // state value would be stale on every tick after the first, and the sweep would
  // never accumulate past one frame. `sweepUi` is the render mirror.
  const sweepRef = useRef<SweepCapture>(EMPTY_CAPTURE);
  const sweepingRef = useRef(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepUi, setSweepUi] = useState<{ kept: number; target: number; hint: string | null; complete: boolean } | null>(null);
  const [sweepOut, setSweepOut] = useState<SweepOutput | null>(null);
  // How many keepers the run gathered, kept SEPARATELY from the capture so the
  // frame buffers can be released the instant they have been composited. They are
  // eight canonical rects — about 22 MB — and holding them alive just to render a
  // count is 22 MB pinned for as long as the result panel is open.
  const [sweepKept, setSweepKept] = useState(0);
  const [sweepBusy, setSweepBusy] = useState(false);
  const warpScratchRef = useRef<HTMLCanvasElement | null>(null);
  // Which slot the user has already looked at, so the inspect overlay shows
  // once per visit rather than on every render.
  const [seen, setSeen] = useState<number | null>(null);

  // "Show me a shot I already have before re-taking it." Jumping back to a
  // taken shot puts the photo on screen first - the point of going back is
  // usually to LOOK, and pointing the live camera at it answers the wrong
  // question.
  const cur = session?.items[session.index] ?? null;
  const review = !!(session?.inspect && cur?.taken && seen !== session.index);

  /** Drop everything a finished sweep was holding. */
  function clearSweep() {
    sweepRef.current = EMPTY_CAPTURE;
    setSweepOut(null);
    setSweepUi(null);
    // Sized to the full sensor, so on a 4K phone this canvas alone is ~33 MB.
    // Zeroing it lets the backing store go rather than surviving until the next
    // sweep that may never come.
    const c = warpScratchRef.current;
    if (c) { c.width = 0; c.height = 0; }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Position the guide over the video's DISPLAYED rect so what you frame is
  // exactly what crops (WYSIWYG) — recomputed on ready/resize/guide change.
  const layoutGuide = useCallback(() => {
    const v = videoRef.current;
    const box = boxRef.current;
    if (!v || !box || !v.videoWidth) return;
    const vr = v.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const aspect = GUIDES[guide];
    let h = vr.height * 0.74;
    let w = h * aspect;
    if (w > vr.width * 0.94) {
      w = vr.width * 0.94;
      h = w / aspect;
    }
    setGuideRect({
      left: vr.left - br.left + (vr.width - w) / 2,
      top: vr.top - br.top + (vr.height - h) / 2,
      width: w,
      height: h,
    });
  }, [guide]);

  useEffect(() => {
    if (osMode) return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
        const stream = await navigator.mediaDevices.getUserMedia({
          // ASK FOR EVERYTHING THE SENSOR HAS.
          //
          // This said 1920, and that quietly made three of the four quality
          // presets fiction. The guide crop's long edge tops out around 1421px
          // of a 1920 stream, and frameToUrl only ever DOWNSCALES
          // (Math.min(1, maxEdge / …)) — so Standard (1600), High (2400) and
          // Archive (4000) all produced the same ~1421px image at different
          // JPEG qualities, while the storage estimate billed Archive at 3MB a
          // shot for it. Someone choosing "Archive — grading evidence" was
          // getting a 1.4MP crop.
          //
          // `ideal` degrades gracefully: a phone that cannot do 4K gives its
          // best, exactly as before. Most rear cameras since ~2019 can.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        setErr("Couldn't open the camera. Pick a photo from your library instead.");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [osMode]);

  useEffect(() => {
    layoutGuide();
    window.addEventListener("resize", layoutGuide);
    return () => window.removeEventListener("resize", layoutGuide);
  }, [ready, layoutGuide]);

  // Report what a shot would ACTUALLY come out at, from the real crop rect and
  // the real track size - not from the preset's ceiling.
  useEffect(() => {
    const v = videoRef.current;
    if (!ready || osMode || !v?.videoWidth || !guideRect) { setDelivered(null); return; }
    const g = guideInVideoPixels();
    const long = g
      ? Math.max(g.w, g.h) * (prefs.auto_crop === "off" ? 0 : 1 + prefs.crop_margin_pct / 100)
      : Math.max(v.videoWidth, v.videoHeight);
    setDelivered({
      src: `${v.videoWidth}×${v.videoHeight}`,
      out: Math.round(Math.min(long, quality.maxEdge)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, osMode, guideRect, prefs.auto_crop, prefs.crop_margin_pct, quality.maxEdge]);

  /**
   * Draw a region of the video into a JPEG data URL, bounded by maxEdge.
   *
   * Returns the size it actually produced, because maxEdge is a CEILING and
   * never an upscale - `Math.min(1, ...)`. The difference between what a
   * preset asks for and what the sensor had to give is the whole reason
   * "Archive" quietly meant nothing for months, and it is only visible if
   * something records it.
   */
  function frameToUrl(
    sx: number, sy: number, sw: number, sh: number, maxEdge = quality.maxEdge,
  ): { url: string; w: number; h: number } | null {
    const v = videoRef.current;
    if (!v) return null;
    const outScale = Math.min(1, maxEdge / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * outScale);
    canvas.height = Math.round(sh * outScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL("image/jpeg", quality.jpegQuality), w: canvas.width, h: canvas.height };
  }

  /** The guide, expressed in intrinsic video pixels. */
  function guideInVideoPixels(): { x: number; y: number; w: number; h: number } | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !guideRect || !boxRef.current) return null;
    const vr = v.getBoundingClientRect();
    const box = boxRef.current.getBoundingClientRect();
    const scale = v.videoWidth / vr.width;
    return {
      x: Math.max(0, (guideRect.left + box.left - vr.left) * scale),
      y: Math.max(0, (guideRect.top + box.top - vr.top) * scale),
      w: guideRect.width * scale,
      h: guideRect.height * scale,
    };
  }

  function shoot(isAuto = false, sharpScore: number | null = null) {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const bounds = { w: v.videoWidth, h: v.videoHeight };
    const g = guideInVideoPixels();

    // Crop per the user's setting: 'off' keeps the whole frame, 'tight' cuts to
    // the guide, 'margin' (default) leaves background around the card so its
    // real edge sits INSIDE the photo rather than on the boundary.
    const marginPct = prefs.auto_crop === "tight" ? 0 : prefs.crop_margin_pct;
    const crop = g && prefs.auto_crop !== "off"
      ? withMargin({ x: g.x, y: g.y, w: g.w, h: g.h }, marginPct, bounds)
      : { x: 0, y: 0, w: bounds.w, h: bounds.h };
    const shot = frameToUrl(crop.x, crop.y, crop.w, crop.h);
    if (!shot) return;

    // Keep the full frame alongside the crop, so a crop is never the only
    // record of an edge. Skipped when nothing was cropped (the frame IS the
    // original) or when the user has turned originals off to save space.
    const cropped = !!g && prefs.auto_crop !== "off";
    const original = cropped && prefs.keep_originals
      ? frameToUrl(0, 0, bounds.w, bounds.h)?.url ?? null
      : null;

    if (multi) {
      setShots((n) => n + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 140);
    }
    // Do NOT stop() here — the unmount cleanup owns the stream. Stopping early
    // froze the video, and a chained front→back flow would capture the frozen
    // FRONT frame as the "back" (day-review finding).
    onCapture({
      url: shot.url, original,
      meta: {
        mode: "in_app", auto: isAuto, sharp: sharpScore,
        marginPct: cropped ? marginPct : 0,
        px: { w: shot.w, h: shot.h },
        srcPx: { w: bounds.w, h: bounds.h },
      },
    });
  }

  function startSweep() {
    sweepRef.current = EMPTY_CAPTURE;
    setSweepOut(null);
    setSweepUi({ kept: 0, target: SWEEP_DEFAULTS.target, hint: null, complete: false });
    sweepingRef.current = true;
    setSweeping(true);
  }

  /** Abandon a run. The frames are dropped — they are the largest thing here. */
  function cancelSweep() {
    sweepingRef.current = false;
    setSweeping(false);
    sweepRef.current = EMPTY_CAPTURE;
    setSweepUi(null);
  }

  /**
   * Composite the run.
   *
   * Stops the sweep FIRST, so a tick arriving mid-composite cannot add a frame to
   * a buffer that is being read. Then yields once before the heavy pass, so the
   * "working" state actually paints — a synchronous stack on a phone freezes the
   * frame for long enough to look broken.
   */
  const completeSweep = useCallback(async () => {
    if (!sweepingRef.current) return;
    sweepingRef.current = false;
    setSweeping(false);
    setSweepBusy(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const cap = sweepRef.current;
      const out = finishSweep(cap);
      setSweepKept(cap.state.kept.length);
      // Whether the sweep was WIDE, not merely complete: a phone that crept
      // along can meet its quota with the reflection barely having moved.
      const narrow = !!out && !sweepWideEnough(cap.state);
      // RELEASE BEFORE PAINTING. The two composites are all the panel needs; the
      // source frames are the largest allocation the camera makes and nothing
      // reads them again.
      sweepRef.current = EMPTY_CAPTURE;
      setSweepOut(out);
      if (narrow) {
        setSweepUi((u) => (u ? { ...u, hint: "That sweep was narrow — a wider arc gives it more to work with." } : u));
      }
    } finally {
      setSweepBusy(false);
    }
  }, []);

  /** Hand a composite to the caller as a normal shot. */
  function deliverComposite(which: "clean" | "surface") {
    const out = sweepOut;
    const v = videoRef.current;
    if (!out || !v) return;
    const src = which === "clean" ? out.clean : out.surface;
    const url = bufferToDataUrl(src.data, out.w, out.h);
    if (!url) { setErr("Couldn't encode that composite."); return; }
    onCapture({
      url,
      // No separate original: the composite IS derived, and the frames it came
      // from are gone by design. `stacked` records that honestly rather than
      // letting a merged image pass as a single exposure.
      original: null,
      meta: {
        mode: "in_app", auto: true, sharp: null, marginPct: 0,
        px: { w: out.w, h: out.h },
        srcPx: { w: v.videoWidth, h: v.videoHeight },
        stacked: {
          kind: which,
          frames: src.report.framesUsed,
          meanDepth: Math.round(src.report.meanDepth * 10) / 10,
          unresolved: Math.round(src.report.unresolved * 1000) / 1000,
          improved: Math.round(src.report.improved * 1000) / 1000,
          uncovered: Math.round(src.report.uncovered * 1000) / 1000,
        },
      },
    });
    clearSweep();
    setShots((n) => n + 1);
  }

  // A SWEEP SHOT ARMS ITSELF. The template asked for a sweep, so making the user
  // find a button to obey it defeats the point of the template carrying the
  // technique at all.
  //
  // Guarded on `started`, so it cannot begin while the phone is still swinging up
  // from someone's side, and on the light reading: a source too broad to escape
  // makes a sweep fifteen wasted seconds, and auto-starting one into that is
  // worse than never offering it. `sweepArmedFor` keeps it to ONCE per shot —
  // without it, cancelling a sweep would immediately restart it and there would
  // be no way out.
  const sweepArmedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${session?.index ?? 0}:${shotLabel ?? ""}`;
    if (!shotTarget?.sweep || !started || !ready || osMode) return;
    if (sweepArmedFor.current === key) return;
    if (glare?.verdict === "fixed") return;
    sweepArmedFor.current = key;
    // Starting a sweep IS setState, and here that is the point: what arms it is
    // the camera coming ready and the light reading, not an event a handler could
    // own. `sweepArmedFor` makes it once per shot, so the extra render the rule
    // warns about happens once and cannot cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the trigger is camera readiness, not an event a handler owns; sweepArmedFor makes it once per shot
    startSweep();
    // startSweep only touches refs and setState; re-running on its identity
    // would re-arm the sweep on every render.
  }, [shotTarget?.sweep, started, ready, osMode, session?.index, shotLabel, glare?.verdict]);

  /** Best of a short burst — kills the odd blurred frame at almost no cost. */
  async function burstShoot() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const frames: { sharp: number; at: number }[] = [];
      for (let i = 0; i < prefs.burst_count; i++) {
        frames.push({ sharp: probe()?.sharp ?? 0, at: i });
        if (i < prefs.burst_count - 1) await new Promise((r) => setTimeout(r, 45));
      }
      const best = pickSharpest(frames);
      shoot(true, best?.sharp ?? null);
      cooldownRef.current = Date.now() + 1200; // let the next card come into frame
      // ...and don't fire again until it IS a next card. Only for batch runs: a
      // template advances to a different shot of its own accord, and requiring
      // the card to leave between the front and its corners would be absurd.
      if (multi && !session) awaitingNewCardRef.current = true;
      histRef.current = [];
    } finally {
      busyRef.current = false;
    }
  }

  /** Sample the guide area at low res: sharpness + movement since last frame. */
  function probe(): { sharp: number; delta: number } | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const g = guideInVideoPixels() ?? { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
    const c = (probeRef.current ??= document.createElement("canvas"));
    const w = PROBE_W;
    const h = Math.max(1, Math.round((g.h / g.w) * w));
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, g.x, g.y, g.w, g.h, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    const prev = prevGrayRef.current;
    const delta = prev && prev.length === gray.length ? frameDelta(prev, gray) : Number.POSITIVE_INFINITY;
    prevGrayRef.current = gray;
    return { sharp: sharpness(gray, w, h), delta };
  }

  /**
   * Grayscale the GUIDE AREA at detection resolution.
   *
   * NOT the whole frame. quadFromLines takes the OUTERMOST edge of each
   * family, so anything rectangular enclosing the card wins it: a sorting mat,
   * a tray, a binder page — or, far more commonly, the toploader the card is
   * sitting in. A toploader's aspect is 0.72 against a card's 0.71, close
   * enough that the size guess still fires and the HUD prints a confident
   * wrong distance with all four sides lit. Measured: 3.79 in for the holder
   * against 4.92 for the card.
   *
   * Detecting inside the guide keeps the reading about the object that will
   * actually be photographed, which is the same rect shoot() crops to. The
   * margin lets the card's real edge sit inside the search area even when it
   * overhangs the guide slightly.
   */
  function detectProbe(): { gray: Uint8ClampedArray; rgba: Uint8ClampedArray; w: number; h: number; src: Rect } | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const g = guideInVideoPixels();
    const bounds = { w: v.videoWidth, h: v.videoHeight };
    const src = g ? withMargin({ x: g.x, y: g.y, w: g.w, h: g.h }, DETECT_MARGIN, bounds)
                  : { x: 0, y: 0, w: bounds.w, h: bounds.h };
    if (src.w < 8 || src.h < 8) return null;
    const c = (detectRef.current ??= document.createElement("canvas"));
    const w = DETECT_W;
    const h = Math.max(1, Math.round((src.h / src.w) * w));
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, src.x, src.y, src.w, src.h, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, q = 0; i < data.length; i += 4, q++) {
      gray[q] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    // The RGBA was already fetched and was being discarded. Clipping has to be
    // read from COLOUR - a warm lamp reflection is (255,255,140), two channels
    // dead and a luma of 242, invisible to anything computed off `gray`.
    return { gray, rgba: data, w, h, src };
  }

  // Live edge detection. Runs whenever the camera is open — it drives the
  // lock-on outline and the distance/angle readout, neither of which depend on
  // auto-snap being on.
  useEffect(() => {
    if (!ready || osMode || !guideRect || !started) return;
    let alive = true;
    const id = setInterval(() => {
      if (!alive || busyRef.current) return;
      const p = detectProbe();
      if (!p) { setDet(null); return; }
      // The probe is a CROP, so its own long edge says nothing about the
      // lens. Scale the real frame's FOV down by how much of the frame this
      // crop covers, and hand detectCard the equivalent field for these pixels.
      const v = videoRef.current;
      const cover = v && v.videoWidth ? Math.max(p.src.w / v.videoWidth, p.src.h / v.videoHeight) : 1;
      const fov = (2 * Math.atan(Math.tan((65 * Math.PI) / 360) * Math.max(0.05, cover)) * 180) / Math.PI;
      const d = detectCard(p.gray, p.w, p.h, { fovDegrees: fov });
      setDet(d);
      detRef.current = d;
      setDetSize({ w: p.w, h: p.h, src: p.src });

      // Measured over the CARD when we have one, over the whole probe when we
      // do not - which is exactly when it matters most, because glare washing
      // out the edges is one of the reasons detectCard returns nothing.
      const region = d
        ? (() => {
            const xs = [d.quad.tl.x, d.quad.tr.x, d.quad.br.x, d.quad.bl.x];
            const ys = [d.quad.tl.y, d.quad.tr.y, d.quad.br.y, d.quad.bl.y];
            const x = Math.min(...xs), y = Math.min(...ys);
            return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
          })()
        : null;
      const clip = clipFraction(p.rgba, p.w, p.h, region);
      const med = globalMedian(p.rgba, p.w, p.h, region);
      if (clip && med != null) {
        const win = glareRef.current;
        win.push({ clip: clip.fraction, median: med });
        // ~6 seconds at this cadence: long enough to have swung the phone
        // somewhere, short enough that moving to a new light shows up quickly.
        if (win.length > 40) win.shift();
        setGlare(readGlare(win));
      }

      // Offer this frame to a running sweep. Everything it needs was computed
      // above for other reasons, so a sweep costs one warp per KEEPER and
      // nothing at all per rejected frame.
      if (sweepingRef.current) {
        const vid = videoRef.current;
        const quadV = d ? probeQuadToVideo(d.quad, p.w, p.h, p.src) : null;
        // The guide's own proportions, not a constant — it is what the user
        // framed against, so a slab run rectifies to a slab and not to a card.
        const aspect = guideRect && guideRect.height > 0 ? guideRect.width / guideRect.height : CARD_ASPECT;
        const r = offerFrame(
          sweepRef.current,
          { quad: quadV, sharp: sharpness(p.gray, p.w, p.h), clip: clip?.fraction ?? null, median: med },
          quadV,
          (q, ow, oh) => {
            if (!vid) return null;
            const scratch = (warpScratchRef.current ??= document.createElement("canvas"));
            return warpVideoFrame(vid, scratch, q, ow, oh);
          },
          aspect,
        );
        sweepRef.current = r.capture;
        const prog = sweepProgress(r.capture.state, r.decision);
        setSweepUi({ kept: prog.kept, target: prog.target, hint: prog.hint, complete: prog.complete });
        // Composite the moment the quota is met, rather than waiting for a tap.
        // The frames are already in memory and the user's next move is to lower
        // the phone — asking them to hold it steady for one more tap is how a
        // finished sweep gets thrown away.
        if (prog.complete) void completeSweep();
      }
    }, DETECT_MS);
    return () => { alive = false; clearInterval(id); releaseScratch(); };
    // detectProbe reads refs and guideRect; re-creating the interval on every
    // render of it would restart the loop constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, osMode, guideRect, started]);

  // How many sides are actually locked. Read in three places below, and the
  // single most important thing on the screen: it is the answer to "is it even
  // seeing the card", which is what someone is asking when they wave a phone
  // around and nothing appears to happen.
  const litCount = det ? det.support.filter((v) => v >= LIT).length : 0;
  // Is the view actually changing? The light reading is only worth anything if
  // the ANGLE moved - a bar that fills while the phone rests on the table
  // proves nothing and would earn a confident verdict off no evidence.
  const [moving, setMoving] = useState(false);

  // Live aim toward the template's target for this shot. Pure function,
  // so what the HUD says is testable without a camera.
  const aim = guideToTarget(shotTarget, { fill: det?.fill ?? null, tilt: det?.tilt ?? null });
  // No target stated means nothing to wait for, so auto-snap behaves as before.
  guideRef.current = shotTarget?.targetFill == null && shotTarget?.targetTilt == null ? true : aim.onTarget;

  /**
   * Detection-probe pixels → coordinates inside the overlay box.
   * Two hops, because the probe is a CROP of the video: probe → video pixels
   * via the crop rect, then video pixels → the video's displayed rect.
   */
  function toScreen(pt: { x: number; y: number }) {
    const v = videoRef.current;
    const box = boxRef.current;
    if (!v || !box || !detSize || !v.videoWidth) return { x: 0, y: 0 };
    const vr = v.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const vx = detSize.src.x + (pt.x / detSize.w) * detSize.src.w;
    const vy = detSize.src.y + (pt.y / detSize.h) * detSize.src.h;
    return {
      x: vr.left - br.left + (vx / v.videoWidth) * vr.width,
      y: vr.top - br.top + (vy / v.videoHeight) * vr.height,
    };
  }

  // Auto-snap: sample ~8x/sec, fire once the frame has been sharp AND still for
  // several consecutive samples. Consecutive matters — a single sharp frame
  // happens while sweeping the phone across a table and would fire on whatever
  // was underneath.
  useEffect(() => {
    if (!auto || !ready || menu || review || !started) return;
    let alive = true;
    const id = setInterval(() => {
      if (!alive || busyRef.current || Date.now() < cooldownRef.current) return;
      const p = probe();
      if (!p) return;
      const hist = histRef.current;
      hist.push(p);
      // frameDelta is already computed here for auto-snap; the threshold is
      // deliberately well above the noise floor of a hand-held-but-static shot.
      setMoving(p.delta > 6);
      if (hist.length > HISTORY) hist.shift();

      // The card has to leave, or the scene has to change substantially, before
      // another automatic shot. A big delta means the card was picked up or
      // swapped; losing detection means it left the frame.
      if (awaitingNewCardRef.current) {
        if (p.delta > 18 || !detRef.current) {
          awaitingNewCardRef.current = false;
          histRef.current = [];
        }
        setLocked(false);
        return;
      }
      // Sharp and still is not enough when the template asked for a specific
      // framing — firing early gets a perfectly exposed photo of the wrong
      // distance, which is exactly what a template exists to prevent.
      const go = shouldAutoSnap(hist) && guideRef.current;
      setLocked(go);
      if (go) void burstShoot();
    }, 120);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, guide, guideRect, menu, review, started]);

  async function fromFile(file: File) {
    const url = await downscale(file);
    if (multi) setShots((n) => n + 1);
    // A library pick has no camera frame behind it, so there is no uncropped
    // original to keep — say so honestly rather than implying one exists.
    onCapture({ url, original: null, meta: { mode: "library", auto: false, sharp: null, marginPct: 0 } });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" style={{ colorScheme: "dark" }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {session && (
            <button
              onClick={() => setMenu(true)}
              aria-label="Open session menu"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-white bg-black px-2 py-1 text-[14px] font-semibold text-white"
            >
              <PanelLeft size={13} />
              {session.items.filter((i) => i.taken || i.existing).length}/{session.items.length}
            </button>
          )}
          <span className="truncate">{title}</span>
          {multi && shots > 0 && <span className="figures ml-2 rounded bg-white/15 px-1.5 py-0.5 text-[14px]">{shots}</span>}
        </span>
        <span className="flex items-center gap-2">
          {!osMode && <button
            onClick={() => { const next = !auto; setAuto(next); if (!next) { setLocked(false); histRef.current = []; } }}
            aria-pressed={auto}
            title="Snap automatically once the card is sharp and still"
            className={"flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-bold " +
              (auto ? "border-[#e8b923] bg-[#e8b923] text-black" : "border-white bg-black text-white")}
          >
            <Wand2 size={13} /> Auto
          </button>}
          {!osMode && <span className="flex overflow-hidden rounded-lg border border-white bg-black text-[13px] font-bold">
            {(["raw", "slab"] as const).map((g) => (
              <button key={g} onClick={() => setManualGuide(g)}
                className={"px-3 py-1.5 " + (guide === g ? "bg-white text-black" : "text-white")}>
                {g === "raw" ? "Card" : "Slab"}
              </button>
            ))}
          </span>}
          <button onClick={() => { stop(); onClose(); }} aria-label="Close camera" className="rounded-lg p-1 hover:bg-white/10">
            <X size={22} />
          </button>
        </span>
      </div>

      <div ref={boxRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted onLoadedMetadata={layoutGuide} className="max-h-full max-w-full" />
        {/* THE LOCK-ON. Each side lights thin yellow the moment there is real
            edge under it, so three lit and one dark tells you exactly which
            way to move your thumb. Nothing draws unless a card was actually
            found — a wrong outline is worse than no outline. */}
        {det && detSize && ready && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
            {det.edges.map((seg, i) => {
              const a = toScreen(seg[0]);
              const b = toScreen(seg[1]);
              const lit = det.support[i] >= LIT;
              return (
                <line
                  key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={lit ? "#ffd400" : "#ffffff"}
                  strokeOpacity={lit ? 1 : 0.35}
                  // 2px was a hairline on a 500ppi phone. The whole point of
                  // this overlay is being seen at arm's length.
                  strokeWidth={lit ? 4 : 2}
                  strokeDasharray={lit ? undefined : "5 6"}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
        )}

        {/* Distance and angle. Each reads a dash rather than a stale number
            when the geometry can't support it — a confident wrong distance on
            grading evidence is worse than an empty one. */}
        {ready && !osMode && started && (
          /*
           * THE READOUT, SIZED FOR A PHONE AT ARM'S LENGTH.
           *
           * This first shipped at 10-12px in white/45 on black/45, which is
           * legible on a laptop 50cm away and is three grey smudges on a
           * phone held over a card in daylight - Beau's words were "i cannot
           * read it at all". Every number here is glanced at WHILE holding
           * something in the other hand, which is the opposite of the
           * conditions it was designed under.
           *
           * So: full-opacity white on solid black, one panel instead of four
           * stacked boxes, and the numbers at a size that survives sunlight.
           */
          <span className="pointer-events-none absolute bottom-3 left-1/2 flex w-[92vw] max-w-md -translate-x-1/2 flex-col items-center gap-2">
            {/* ONE instruction at a time. "Move closer and tilt back and hold
                still" is a HUD nobody acts on; distance comes first because
                the angle barely matters until the card is the right size. */}
            {aim.message && (
              <span className="rounded-xl bg-[#e8b923] px-5 py-2 text-[17px] font-black uppercase tracking-wide text-black shadow-lg">
                {aim.message}
              </span>
            )}
            {aim.onTarget && (
              <span className="rounded-xl bg-emerald-400 px-5 py-2 text-[17px] font-black uppercase tracking-wide text-black shadow-lg">
                On target
              </span>
            )}

            {/* STATE, IN WORDS, ALWAYS. An empty panel of dashes does not
                distinguish "looking for the card" from "this is broken", and
                someone waving a phone around deserves to know which. */}
            <span className={"w-full rounded-t-2xl px-3 py-1.5 text-center text-[13px] font-bold uppercase tracking-wider " +
              (!det ? "bg-white/15 text-white"
                : litCount === 4 ? "bg-emerald-400 text-black"
                : "bg-[#e8b923] text-black")}>
              {!det ? "Looking for the card…"
                : litCount === 4 ? "Card locked"
                : `Found ${litCount} of 4 edges`}
            </span>

            <span className="-mt-2 flex w-full items-stretch justify-around rounded-b-2xl bg-black py-2 shadow-lg">
              {/* EDGES FIRST. "Is it even seeing the card" is the question
                  being asked when someone waves a phone around and nothing
                  seems to happen, and it was buried at the end of the row in
                  the smallest colour on screen. */}
              <span className="flex flex-1 flex-col items-center">
                <span className={"text-[26px] font-black leading-none tabular-nums " +
                  (!det ? "text-white" : litCount === 4 ? "text-emerald-400" : "text-[#ffd400]")}>
                  {det ? `${litCount}/4` : "—"}
                </span>
                <span className="mt-1 text-[13px] font-bold uppercase tracking-widest text-white">Edges</span>
              </span>

              <span className="w-px shrink-0 bg-white/15" />

              <span className="flex flex-1 flex-col items-center">
                <span className={"text-[26px] font-black leading-none tabular-nums " +
                  (det?.inches == null ? "text-white"
                    : aim.fill === "ok" ? "text-emerald-400"
                    : aim.fill === "none" ? "text-white" : "text-[#ffd400]")}>
                  {det?.inches != null ? det.inches.toFixed(1) : "—"}
                </span>
                <span className="mt-1 text-[13px] font-bold uppercase tracking-widest text-white">
                  Inches
                  {det?.fill != null && shotTarget?.targetFill != null &&
                    ` ${Math.round(det.fill * 100)}/${Math.round(shotTarget.targetFill * 100)}%`}
                </span>
              </span>

              <span className="w-px shrink-0 bg-white/15" />

              <span className="flex flex-1 flex-col items-center">
                <span className={"text-[26px] font-black leading-none tabular-nums " +
                  (det?.tilt == null ? "text-white"
                    : aim.tilt === "ok" ? "text-emerald-400"
                    : aim.tilt === "none" ? "text-white" : "text-[#ffd400]")}>
                  {det?.tilt != null ? `${det.tilt.toFixed(0)}\u00b0` : "—"}
                </span>
                <span className="mt-1 text-[13px] font-bold uppercase tracking-widest text-white">
                  Angle{shotTarget?.targetTilt != null && ` / ${shotTarget.targetTilt}\u00b0`}
                </span>
              </span>
            </span>

            {/* The verdict on the LIGHT, not on the photo. Shown only when
                there is real glare and enough samples to have earned an
                opinion - see readGlare, which returns "unknown" freely. */}
            {/* Collecting. Beau: "i have no idea if i'm getting the app the
                info it needs as i move around" - and he was right, there was
                nothing on screen until a verdict existed. `moving` is the
                honest half: the reading only means something if the ANGLE
                changed, so a still phone is told to move rather than left to
                fill a bar that proves nothing. */}
            {glare && glare.verdict === "unknown" && glare.n > 0 && (
              <span className="w-full rounded-xl bg-black px-3 py-2 shadow-lg">
                <span className="flex items-center justify-between text-[14px] font-bold uppercase tracking-wider text-white">
                  <span>Reading your light</span>
                  <span className="tabular-nums text-white">{Math.min(glare.n, 8)}/8</span>
                </span>
                <span className="mt-1.5 block h-2 w-full overflow-hidden rounded-full bg-white/20">
                  <span
                    className="block h-full rounded-full bg-[#e8b923] transition-[width] duration-200"
                    style={{ width: `${Math.min(100, (glare.n / 8) * 100)}%` }}
                  />
                </span>
                <span className="mt-1.5 block text-center text-[14px] font-semibold text-white">
                  {moving ? "Good — keep moving around the card" : "Move the phone around the card"}
                </span>
              </span>
            )}

            {glare && glareAdvice(glare) && (
              <span className={"w-full rounded-xl px-3 py-2 text-center text-[13px] font-semibold leading-snug shadow-lg " +
                (glare.verdict === "fixed" ? "bg-amber-400 text-black" : "bg-black text-white")}>
                {glareAdvice(glare)}
                <span className="ml-1 tabular-nums opacity-70">
                  ({Math.round(glare.peak * 100)}% blown out)
                </span>
              </span>
            )}

            {/* What this shot will ACTUALLY come out at. Only shown when it
                DISAGREES with the preset - the rest of the time it is noise on
                a screen that has no room for any. */}
            {delivered && delivered.out < quality.maxEdge && (
              <span className="rounded-lg bg-black px-3 py-1 text-[14px] font-semibold tabular-nums text-white">
                {delivered.out}px shot \u00b7 {quality.label} wanted {quality.maxEdge}
              </span>
            )}
          </span>
        )}

        {guideRect && ready && (
          <>
            {/* Turns green the moment the frame is sharp and steady, so you can
                see the lock happen instead of guessing why it did or didn't fire. */}
            <div
              className={"pointer-events-none absolute rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-colors " +
                (auto && locked ? "border-emerald-400" : "border-[#c9a227]")}
              style={guideRect}
            />
            {/* Which side/shot, big and unmissable, sitting just above the
                frame so it's in view while you line the card up. */}
            {shotLabel && (
              <span
                className="pointer-events-none absolute flex flex-col items-center gap-0.5"
                style={{ left: guideRect.left, width: guideRect.width, top: Math.max(4, guideRect.top - 46) }}
              >
                <span className="rounded-lg bg-[#e8b923] px-4 py-1.5 text-xl font-black uppercase tracking-widest text-black shadow-lg">
                  {shotLabel}
                </span>
                {shotStep && (
                  <span className="rounded bg-black/75 px-2 py-0.5 text-[13px] font-bold text-white">{shotStep}</span>
                )}
                {shotHint && (
                  <span className="max-w-full rounded-lg bg-black px-2.5 py-1 text-center text-[13px] font-semibold leading-snug text-white">
                    {shotHint}
                  </span>
                )}
              </span>
            )}
            {/* Sits just BELOW the guide, not at the bottom of the screen —
                down there it stacked under the readout panel, which is how
                three unreadable black boxes ended up on top of each other. */}
            {auto && started && (
              <span
                className={"pointer-events-none absolute -translate-x-1/2 rounded-xl px-4 py-1.5 text-[14px] font-bold shadow-lg " +
                  (locked ? "bg-emerald-400 text-black" : "bg-black text-white")}
                style={{ left: guideRect.left + guideRect.width / 2, top: guideRect.top + guideRect.height + 10 }}
              >
                {locked ? "Hold still…" : "Fill the frame · hold steady"}
              </span>
            )}
          </>
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {osMode && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-10 text-center text-white">
            <Camera size={34} className="text-white" />
            <p className="text-sm font-semibold text-white">Using your phone&apos;s camera</p>
            <p className="text-[14px] text-white">
              Tap the shutter to open it. Better in low light — but no guide frame, no auto-snap,
              and the photo is kept whole rather than cropped to the card.
            </p>
          </div>
        )}
        {/*
          * START SCAN — sitting in the viewfinder, exactly where the readout
          * will appear once tapped.
          *
          * Beau: "make the start scan button be at the bottom of the regular
          * scanning overlay.... so you can see your camera space and position
          * your camera and item into position... then you hit start scan."
          *
          * So the camera and the guide come up immediately and you frame the
          * card against them; what waits is the SCAN — detection, the readout,
          * auto-snap and the light sampling. Framing is the thing you do
          * first, and it needs the picture; scanning is the thing you commit
          * to, and it should not begin while the phone is still swinging up
          * from your side.
          *
          * Deliberately in the same position and width as the readout panel.
          * Tap it and the numbers take its place, so nothing jumps — and if
          * this button is readable while the readout is not, the difference is
          * the content, not the position.
          */}
        {ready && !osMode && !started && (
          <div className="absolute bottom-3 left-1/2 flex w-[92vw] max-w-md -translate-x-1/2 flex-col items-center gap-2">
            <button
              onClick={() => { setManualStart(true); setAuto(true); }}
              className="w-full rounded-2xl bg-[#e8b923] py-4 text-lg font-black uppercase tracking-wide text-black shadow-lg active:scale-95"
            >
              Start scan
            </button>
            <span className="rounded-lg bg-black px-3 py-2 text-center text-[14px] font-bold leading-snug text-white">
              Line the card up, then tap — it shoots by itself once the card locks.
            </span>
          </div>
        )}

        {/*
          * SWEEP — offered only once scanning has started, because it needs the
          * detector: without corners a frame cannot be registered and cannot be
          * stacked.
          *
          * Deliberately NOT offered when the light reading says `fixed`. A source
          * too broad to escape sits in the same place at every angle, so a sweep
          * is fifteen wasted seconds and a composite that changes nothing —
          * `exposure.ts` exists to be able to say that before anyone tries.
          */}
        {ready && !osMode && started && !sweeping && !sweepOut && !sweepBusy && glare?.verdict !== "fixed" && (
          <button
            onClick={startSweep}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-xl bg-black px-3 py-2 text-[14px] font-bold text-white active:scale-95"
          >
            <Layers size={14} className="text-[#e8b923]" /> Sweep for glare
          </button>
        )}

        {/* Live sweep coaching. The counter alone is what makes people think it is
            broken — they hold the phone still and nothing moves. */}
        {sweeping && sweepUi && (
          <div className="absolute bottom-3 left-1/2 flex w-[92vw] max-w-md -translate-x-1/2 flex-col items-center gap-2">
            <div className="w-full rounded-2xl bg-black px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-black uppercase tracking-wide text-[#e8b923]">Sweeping</span>
                <span className="figures text-[15px] font-bold text-white">{sweepUi.kept}/{sweepUi.target}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-[#e8b923] transition-[width] duration-200"
                  style={{ width: `${Math.round((sweepUi.kept / sweepUi.target) * 100)}%` }}
                />
              </div>
              {sweepUi.hint && (
                <p className="mt-1.5 text-[13px] font-semibold leading-snug text-white">{sweepUi.hint}</p>
              )}
            </div>
            <div className="flex w-full gap-2">
              <button onClick={cancelSweep} className="flex-1 rounded-xl border border-white/30 py-2 text-[14px] font-bold text-white">
                Cancel
              </button>
              {/* Usable early: three good frames already composite, and refusing
                  would throw away work the user did. */}
              <button
                onClick={() => void completeSweep()}
                disabled={sweepUi.kept < 2}
                className="flex-1 rounded-xl bg-[#e8b923] py-2 text-[14px] font-black text-black disabled:opacity-40"
              >
                Use {sweepUi.kept} now
              </button>
            </div>
          </div>
        )}

        {sweepBusy && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/90 text-white">
            <Loader2 className="animate-spin" size={26} />
            <p className="text-[13px] font-semibold">Merging the sweep…</p>
          </div>
        )}

        {!ready && !err && !osMode && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Loader2 className="animate-spin" size={28} />
          </div>
        )}
        {err && <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-sm text-white">{err}</p>}
      </div>

      {/*
        * THE TWO RESULTS. One sweep, two photos, and they are answers to
        * different questions — which is why both are offered rather than the app
        * picking.
        *
        * Every claim here is qualified by its own report. A composite that could
        * not clear the glare is still the best available image, and it is offered
        * — but it is not described as clean.
        */}
      {sweepOut && (
        <div className="absolute inset-0 z-20 flex flex-col bg-black px-4 py-3">
          <p className="text-center text-[14px] font-semibold uppercase tracking-wider text-white">
            One sweep · {sweepOut.clean.report.framesUsed} of {sweepKept} shots used
          </p>

          <div className="mt-2 grid min-h-0 flex-1 grid-cols-2 gap-3">
            {([
              {
                key: "clean" as const, res: sweepOut.clean, icon: <Sparkles size={12} />,
                title: "Glare removed", sub: "The card",
                ok: sweepOut.cleanWorthKeeping, advice: stackAdvice(sweepOut.clean.report),
              },
              {
                key: "surface" as const, res: sweepOut.surface, icon: <Layers size={12} />,
                title: "Surface map", sub: "Scratches & print lines",
                ok: sweepOut.surfaceWorthKeeping, advice: surfaceAdvice(sweepOut.surface.report),
              },
            ]).map((panel) => {
              const url = bufferToDataUrl(panel.res.data, sweepOut.w, sweepOut.h, 0.8);
              return (
                <div key={panel.key} className="flex min-h-0 flex-col">
                  <p className="flex items-center gap-1 text-[14px] font-bold text-white">
                    <span className="text-[#e8b923]">{panel.icon}</span> {panel.title}
                  </p>
                  <p className="text-[13px] leading-snug text-white">{panel.sub}</p>
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- in-memory data URL */
                    <img src={url} alt={panel.title} className="my-1.5 min-h-0 flex-1 rounded-lg object-contain" />
                  ) : (
                    <p className="my-1.5 flex-1 text-[13px] text-white">Couldn&apos;t render this one.</p>
                  )}
                  {/* The caveat sits ON the image it describes, not in a footnote. */}
                  {panel.advice && (
                    <p className="mb-1 text-[13px] leading-snug text-amber-300">{panel.advice}</p>
                  )}
                  <button
                    onClick={() => deliverComposite(panel.key)}
                    className={
                      "rounded-xl py-2 text-[14px] font-black active:scale-95 " +
                      (panel.ok ? "bg-[#e8b923] text-black" : "border border-white/30 text-white")
                    }
                  >
                    {panel.ok ? "Use this" : "Use anyway"}
                  </button>
                </div>
              );
            })}
          </div>

          {sweepUi?.hint && <p className="mt-1.5 text-center text-[13px] text-amber-300">{sweepUi.hint}</p>}

          <div className="mt-2 flex gap-2">
            <button
              onClick={clearSweep}
              className="flex-1 rounded-xl border border-white/30 py-2 text-[14px] font-bold text-white"
            >
              Discard both
            </button>
            <button
              onClick={() => { setSweepOut(null); startSweep(); }}
              className="flex-1 rounded-xl border border-white/30 py-2 text-[14px] font-bold text-white"
            >
              Sweep again
            </button>
          </div>
        </div>
      )}

      {/* Inspect what you already have. Two ways out and both explicit - no
          dead end, and no silent overwrite of a shot you were only checking. */}
      {review && cur?.taken && (
        <div className="absolute inset-0 z-20 flex flex-col bg-black px-6 py-4">
          <p className="text-center text-[14px] font-semibold uppercase tracking-wider text-white">
            Already taken - {cur.label}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- in-memory data URL */}
          <img src={cur.taken} alt={cur.label} className="mx-auto my-3 min-h-0 flex-1 rounded-lg object-contain" />
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setSeen(session?.index ?? null)}
              className="flex items-center gap-1.5 rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white"
            >
              <RotateCcw size={15} /> Retake
            </button>
            <button
              onClick={() => { setSeen(null); session?.onKeep(); }}
              className="flex items-center gap-1.5 rounded-xl bg-[#c9a227] px-4 py-2 text-sm font-bold text-black"
            >
              <Check size={16} /> Keep it
            </button>
          </div>
        </div>
      )}

      {menu && session && (
        <SessionMenu
          items={session.items}
          index={session.index}
          onClose={() => setMenu(false)}
          onJump={(i) => { setMenu(false); setSeen(null); session.onJump(i); }}
          onDelete={session.onDelete}
          onReorder={session.onReorder}
          inspect={session.inspect}
          onInspectChange={session.onInspectChange}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) fromFile(e.target.files[0]); e.target.value = ""; }}
      />
      <input
        ref={osCamRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) fromFile(e.target.files[0]); e.target.value = ""; }}
      />
      <div className="grid grid-cols-3 items-center px-6 py-6">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 justify-self-start rounded-lg bg-white/15 px-3 py-2 text-[14px] font-bold text-white"
        >
          <Images size={18} /> Library
        </button>
        <button
          onClick={() => (osMode ? osCamRef.current?.click() : shoot(false))}
          disabled={!ready && !osMode}
          aria-label="Take photo"
          className="h-16 w-16 justify-self-center rounded-full border-4 border-white bg-white transition active:scale-95 disabled:opacity-40"
        >
          <Camera size={24} className="mx-auto text-white" />
        </button>
        {multi ? (
          <button
            onClick={() => { stop(); onClose(); }}
            className="flex items-center gap-1.5 justify-self-end rounded-xl bg-[#c9a227] px-4 py-2 text-sm font-bold text-black active:scale-95"
          >
            <Check size={16} /> Done{shots > 0 ? ` (${shots})` : ""}
          </button>
        ) : session ? (
          // Reordering and retaking mean a run no longer ends by simply
          // reaching the last slot - there has to be a way to say "that is
          // enough" that is not closing the camera and hoping.
          <button
            onClick={() => { stop(); session.onDone(); }}
            disabled={!session.items.some((i) => i.taken)}
            className="flex items-center gap-1.5 justify-self-end rounded-xl bg-[#c9a227] px-4 py-2 text-sm font-bold text-black active:scale-95 disabled:opacity-40"
          >
            <Check size={16} /> Done ({session.items.filter((i) => i.taken).length})
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

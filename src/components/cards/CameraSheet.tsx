"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, Loader2, Images, Check, Wand2 } from "lucide-react";
import { downscale } from "@/lib/cards/img";
import {
  CARD_ASPECT, SLAB_ASPECT, withMargin, sharpness, frameDelta,
  shouldAutoSnap, pickSharpest,
} from "@/lib/cards/camera";

// Card-scanner aspect guides (w/h): raw card 2.5"x3.5", PSA-style slab ~3.32"x5.44".
const GUIDES = { raw: CARD_ASPECT, slab: SLAB_ASPECT } as const;
type GuideKind = keyof typeof GUIDES;

// Breathing room around the crop so the card's real edge sits INSIDE the photo.
// ~4% of card width ≈ 2-3mm. Corners and edges are the grade; a crop flush to
// the edge hides chipping and can't be told apart from a card that is genuinely
// cut that way.
const MARGIN_PCT = 0.04;

// Auto-snap sampling.
const PROBE_W = 96;      // downscaled probe frame, keeps the loop cheap
const BURST = 3;         // frames per auto capture; sharpest wins
const HISTORY = 8;

export type CapturedShot = {
  /** The framed, margin-preserved card image — what the app shows and scans. */
  url: string;
  /** The FULL uncropped frame. Kept so a crop can never be the only record of
   *  an edge. Null for library picks, which have no camera frame behind them. */
  original: string | null;
  meta: { mode: "in_app" | "library"; auto: boolean; sharp: number | null; marginPct: number };
};

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
  onCapture,
  onClose,
  multi = false,
}: {
  title: string;
  onCapture: (shot: CapturedShot) => void;
  onClose: () => void;
  multi?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideKind>("raw");
  const [guideRect, setGuideRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);
  const [auto, setAuto] = useState(false);
  const [locked, setLocked] = useState(false); // sharp + steady right now
  const probeRef = useRef<HTMLCanvasElement | null>(null);
  const prevGrayRef = useRef<Uint8ClampedArray | null>(null);
  const histRef = useRef<{ sharp: number; delta: number }[]>([]);
  const busyRef = useRef(false); // one capture at a time
  const cooldownRef = useRef(0); // don't re-fire on the same card

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
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
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
  }, []);

  useEffect(() => {
    layoutGuide();
    window.addEventListener("resize", layoutGuide);
    return () => window.removeEventListener("resize", layoutGuide);
  }, [ready, layoutGuide]);

  /** Draw a region of the video into a JPEG data URL, bounded by maxEdge. */
  function frameToUrl(sx: number, sy: number, sw: number, sh: number, maxEdge: number): string | null {
    const v = videoRef.current;
    if (!v) return null;
    const outScale = Math.min(1, maxEdge / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * outScale);
    canvas.height = Math.round(sh * outScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
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

    // The framed shot keeps a MARGIN around the guide, so the card's real edge
    // sits inside the photo rather than on its boundary.
    const crop = g
      ? withMargin({ x: g.x, y: g.y, w: g.w, h: g.h }, MARGIN_PCT, bounds)
      : { x: 0, y: 0, w: bounds.w, h: bounds.h };
    const url = frameToUrl(crop.x, crop.y, crop.w, crop.h, 1600);
    if (!url) return;

    // And we ALWAYS keep the full frame. A crop must never be the only record
    // of an edge — if a corner is ever in question, the uncropped original is
    // what settles it.
    const original = g ? frameToUrl(0, 0, bounds.w, bounds.h, 1600) : null;

    if (multi) {
      setShots((n) => n + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 140);
    }
    // Do NOT stop() here — the unmount cleanup owns the stream. Stopping early
    // froze the video, and a chained front→back flow would capture the frozen
    // FRONT frame as the "back" (day-review finding).
    onCapture({
      url, original,
      meta: { mode: "in_app", auto: isAuto, sharp: sharpScore, marginPct: MARGIN_PCT },
    });
  }

  /** Best of a short burst — kills the odd blurred frame at almost no cost. */
  async function burstShoot() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const frames: { sharp: number; at: number }[] = [];
      for (let i = 0; i < BURST; i++) {
        frames.push({ sharp: probe()?.sharp ?? 0, at: i });
        if (i < BURST - 1) await new Promise((r) => setTimeout(r, 45));
      }
      const best = pickSharpest(frames);
      shoot(true, best?.sharp ?? null);
      cooldownRef.current = Date.now() + 1200; // let the next card come into frame
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

  // Auto-snap: sample ~8x/sec, fire once the frame has been sharp AND still for
  // several consecutive samples. Consecutive matters — a single sharp frame
  // happens while sweeping the phone across a table and would fire on whatever
  // was underneath.
  useEffect(() => {
    if (!auto || !ready) return;
    let alive = true;
    const id = setInterval(() => {
      if (!alive || busyRef.current || Date.now() < cooldownRef.current) return;
      const p = probe();
      if (!p) return;
      const hist = histRef.current;
      hist.push(p);
      if (hist.length > HISTORY) hist.shift();
      const go = shouldAutoSnap(hist);
      setLocked(go);
      if (go) void burstShoot();
    }, 120);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, guide, guideRect]);

  async function fromFile(file: File) {
    const url = await downscale(file);
    if (multi) setShots((n) => n + 1);
    // A library pick has no camera frame behind it, so there is no uncropped
    // original to keep — say so honestly rather than implying one exists.
    onCapture({ url, original: null, meta: { mode: "library", auto: false, sharp: null, marginPct: 0 } });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" style={{ colorScheme: "dark" }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-semibold">
          {title}
          {multi && shots > 0 && <span className="figures ml-2 rounded bg-white/15 px-1.5 py-0.5 text-xs">{shots}</span>}
        </span>
        <span className="flex items-center gap-2">
          <button
            onClick={() => { const next = !auto; setAuto(next); if (!next) { setLocked(false); histRef.current = []; } }}
            aria-pressed={auto}
            title="Snap automatically once the card is sharp and still"
            className={"flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold " +
              (auto ? "border-[#c9a227] bg-[#c9a227]/25 text-white" : "border-white/25 text-white/50")}
          >
            <Wand2 size={13} /> Auto
          </button>
          <span className="flex overflow-hidden rounded-lg border border-white/25 text-[11px] font-semibold">
            {(["raw", "slab"] as const).map((g) => (
              <button key={g} onClick={() => setGuide(g)}
                className={"px-2.5 py-1 " + (guide === g ? "bg-white/25 text-white" : "text-white/50")}>
                {g === "raw" ? "Card" : "Slab"}
              </button>
            ))}
          </span>
          <button onClick={() => { stop(); onClose(); }} aria-label="Close camera" className="rounded-lg p-1 hover:bg-white/10">
            <X size={22} />
          </button>
        </span>
      </div>

      <div ref={boxRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted onLoadedMetadata={layoutGuide} className="max-h-full max-w-full" />
        {guideRect && ready && (
          <>
            {/* Turns green the moment the frame is sharp and steady, so you can
                see the lock happen instead of guessing why it did or didn't fire. */}
            <div
              className={"pointer-events-none absolute rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-colors " +
                (auto && locked ? "border-emerald-400" : "border-[#c9a227]")}
              style={guideRect}
            />
            {auto && (
              <span className="pointer-events-none absolute bottom-4 rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white/85">
                {locked ? "Hold still…" : "Fill the frame · hold steady"}
              </span>
            )}
          </>
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {!ready && !err && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Loader2 className="animate-spin" size={28} />
          </div>
        )}
        {err && <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-sm text-white/80">{err}</p>}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) fromFile(e.target.files[0]); e.target.value = ""; }}
      />
      <div className="grid grid-cols-3 items-center px-6 py-6">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 justify-self-start text-xs font-semibold text-white/70 hover:text-white"
        >
          <Images size={18} /> Library
        </button>
        <button
          onClick={() => shoot(false)}
          disabled={!ready}
          aria-label="Take photo"
          className="h-16 w-16 justify-self-center rounded-full border-4 border-white bg-white/25 transition active:scale-95 disabled:opacity-40"
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
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

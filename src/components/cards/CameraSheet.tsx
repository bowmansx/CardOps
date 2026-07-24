"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, Loader2, Images, Check } from "lucide-react";
import { downscale } from "@/lib/cards/img";

// Card-scanner aspect guides (w/h): raw card 2.5"x3.5", PSA-style slab ~3.32"x5.44".
const GUIDES = { raw: 2.5 / 3.5, slab: 3.32 / 5.44 } as const;
type GuideKind = keyof typeof GUIDES;

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
  onCapture: (dataUrl: string) => void;
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

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // Map the on-screen guide back to intrinsic video pixels and crop to it.
    const vr = v.getBoundingClientRect();
    const scale = v.videoWidth / vr.width;
    let sx = 0, sy = 0, sw = v.videoWidth, sh = v.videoHeight;
    if (guideRect) {
      const box = boxRef.current!.getBoundingClientRect();
      sx = Math.max(0, (guideRect.left + box.left - vr.left) * scale);
      sy = Math.max(0, (guideRect.top + box.top - vr.top) * scale);
      sw = Math.min(v.videoWidth - sx, guideRect.width * scale);
      sh = Math.min(v.videoHeight - sy, guideRect.height * scale);
    }
    const maxEdge = 1600;
    const outScale = Math.min(1, maxEdge / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * outScale);
    canvas.height = Math.round(sh * outScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    if (multi) {
      setShots((n) => n + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 140);
      onCapture(url);
    } else {
      // Do NOT stop() here — the unmount cleanup owns the stream. Stopping
      // early froze the video, and a chained front→back flow would capture
      // the frozen FRONT frame as the "back" (day-review finding).
      onCapture(url);
    }
  }

  async function fromFile(file: File) {
    const url = await downscale(file);
    if (multi) {
      setShots((n) => n + 1);
      onCapture(url);
    } else {
      onCapture(url);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" style={{ colorScheme: "dark" }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-semibold">
          {title}
          {multi && shots > 0 && <span className="figures ml-2 rounded bg-white/15 px-1.5 py-0.5 text-xs">{shots}</span>}
        </span>
        <span className="flex items-center gap-2">
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
          <div
            className="pointer-events-none absolute rounded-xl border-2 border-[#c9a227] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            style={guideRect}
          />
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
          onClick={shoot}
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

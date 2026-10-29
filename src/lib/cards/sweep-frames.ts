// GLUING THE SWEEP TO THE CAMERA (2026-07-29).
//
// `sweep.ts` decides which frames to keep, `homography.ts` registers them and
// `stack.ts` composites them. This is the accumulator between: it holds the
// warped keepers and turns a finished run into the two final images.
//
// WARPED AT CAPTURE TIME, NOT AT THE END, and that is a memory decision rather
// than a stylistic one. Eight full 4K frames is roughly 270 MB of RGBA — enough
// to have a phone kill the tab, and enough to matter on the 16 GB machine this is
// developed on. Warping immediately and discarding the source keeps the peak at
// eight canonical rects, around 22 MB, because the canonical rect is the size the
// card actually occupies rather than the size of the sensor.
//
// Pure over pixel buffers. The DOM work — reading the video into a canvas — stays
// in the component; everything here is testable without a camera.
import type { Point } from "./homography";
import { warpQuadToRect, outputSizeFor } from "./homography";
import type { StackFrame, StackResult } from "./stack";
import { stackFrames, stackSurface, stackWorthKeeping, surfaceWorthKeeping } from "./stack";
import type { SweepState, SweepSample, SweepOpts, SweepDecision } from "./sweep";
import { EMPTY_SWEEP, SWEEP_DEFAULTS, sweepStep } from "./sweep";
import type { Rect } from "./exposure";
import type { Quad } from "./edges";

/**
 * A detected quad, expressed in the FULL FRAME's pixels.
 *
 * Detection runs on a downsampled crop of the guide area — see `detectProbe` —
 * so its coordinates mean nothing to the full frame until they are mapped back
 * through that crop. Warping with unmapped probe coordinates would sample a
 * postage stamp from the top-left corner of the video, which is a mistake that
 * produces a plausible-looking image of the wrong thing.
 */
export function probeQuadToVideo(quad: Quad, probeW: number, probeH: number, src: Rect): Point[] | null {
  if (probeW < 1 || probeH < 1) return null;
  const sx = src.w / probeW, sy = src.h / probeH;
  const map = (p: Point): Point => ({ x: src.x + p.x * sx, y: src.y + p.y * sy });
  return [map(quad.tl), map(quad.tr), map(quad.br), map(quad.bl)];
}

export type SweepCapture = {
  state: SweepState;
  /** Warped keepers, all sharing `size`. */
  frames: StackFrame[];
  /**
   * The canonical rect every frame is warped into.
   *
   * Fixed by the FIRST keeper and never changed. Re-deriving it per frame would
   * give each one a different size and nothing could be stacked — the whole point
   * of registration is one shared coordinate space.
   */
  size: { w: number; h: number } | null;
};

export const EMPTY_CAPTURE: SweepCapture = { state: EMPTY_SWEEP, frames: [], size: null };

/**
 * Offer one live frame to the sweep.
 *
 * `grab` is only called when the frame is actually WORTH keeping, so the
 * expensive read-and-warp never runs on a frame the controller was going to
 * reject. At 30fps rejecting cheaply is most of what this does.
 *
 * Returns a replaced capture, never a mutated one, so a React caller sees the
 * change and a dropped frame cannot corrupt a run in flight.
 */
export function offerFrame(
  cap: SweepCapture,
  sample: SweepSample,
  quadInVideo: Point[] | null,
  grab: (quad: Point[], outW: number, outH: number) => { data: Uint8ClampedArray } | null,
  aspect: number,
  opts: SweepOpts = SWEEP_DEFAULTS,
): { capture: SweepCapture; decision: SweepDecision } {
  const stepped = sweepStep(cap.state, sample, opts);
  if (!stepped.decision.keep || !quadInVideo) {
    return { capture: { ...cap, state: stepped.state }, decision: stepped.decision };
  }

  // First keeper fixes the output size for the whole run.
  const size = cap.size ?? outputSizeFor(quadInVideo, aspect);
  const warped = grab(quadInVideo, size.w, size.h);
  if (!warped) {
    // The warp failed — a degenerate quad, or a canvas that would not read. Roll
    // the keeper back rather than leaving the controller believing it has a frame
    // it does not, which would let a sweep "complete" with nothing in it.
    return { capture: { ...cap, state: { ...cap.state, seen: stepped.state.seen } }, decision: { keep: false, reason: "no-card" } };
  }

  return {
    capture: {
      state: stepped.state,
      frames: [...cap.frames, { data: warped.data, median: sample.median }],
      size,
    },
    decision: stepped.decision,
  };
}

export type SweepOutput = {
  /** Glare rejected — the photo of the card. */
  clean: StackResult;
  /** Glare sought — the photo of its surface. */
  surface: StackResult;
  w: number;
  h: number;
  /** Is the clean composite better than the best single frame? */
  cleanWorthKeeping: boolean;
  /** Did light actually rake across the card? */
  surfaceWorthKeeping: boolean;
};

/**
 * Turn a finished run into both final images.
 *
 * Returns null with nothing to composite. Note it does NOT require the run to be
 * complete: a sweep abandoned after three good frames still yields a usable
 * composite, and refusing to produce one would throw away work the user did.
 */
export function finishSweep(cap: SweepCapture): SweepOutput | null {
  if (!cap.size || !cap.frames.length) return null;
  const { w, h } = cap.size;
  const clean = stackFrames(cap.frames, w, h);
  const surface = stackSurface(cap.frames, w, h);
  if (!clean || !surface) return null;
  return {
    clean, surface, w, h,
    cleanWorthKeeping: stackWorthKeeping(clean.report),
    surfaceWorthKeeping: surfaceWorthKeeping(surface.report),
  };
}

/**
 * Release the frame buffers.
 *
 * Worth an explicit call. These are the largest allocations the camera makes, and
 * on a phone holding them past the point of use is the difference between a
 * second sweep working and the tab being killed.
 */
export function releaseCapture(): SweepCapture {
  return EMPTY_CAPTURE;
}

/**
 * Warp a video frame into the canonical rect, via a canvas.
 *
 * The one DOM-touching function here, kept beside the pure ones because the
 * coordinate handoff is the part that goes wrong: the canvas must be read at FULL
 * frame size so the warp samples real detail, then discarded immediately.
 *
 * `willReadFrequently` is set because this runs once per keeper during a sweep,
 * and without it browsers keep the surface GPU-side and every read stalls the
 * pipeline.
 */
export function warpVideoFrame(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
  quad: Point[],
  outW: number,
  outH: number,
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  scratch.width = vw; scratch.height = vh;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, vw, vh);
  let full: ImageData;
  try {
    full = ctx.getImageData(0, 0, vw, vh);
  } catch {
    // A tainted canvas — a cross-origin stream. Nothing to recover, and a thrown
    // exception here would kill the sweep mid-run.
    return null;
  }
  return warpQuadToRect(full.data, vw, vh, quad, outW, outH);
}

/** RGBA buffer → a JPEG data URL, for handing a composite to `onCapture`. */
export function bufferToDataUrl(
  data: Uint8ClampedArray, w: number, h: number, quality = 0.92,
): string | null {
  if (data.length < w * h * 4) return null;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  // A composite carries alpha 0 where no frame covered a pixel. Painting white
  // underneath keeps those from becoming BLACK in a JPEG, which has no alpha —
  // a black wedge along an edge reads as a damaged card.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const img = new ImageData(new Uint8ClampedArray(data), w, h);
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  tmp.getContext("2d")?.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
  return c.toDataURL("image/jpeg", quality);
}

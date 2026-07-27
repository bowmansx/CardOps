// Is the glare in this frame something a sweep could ever remove? (2026-07-27)
//
// Beau asked whether the camera could collect many frames and map around the
// glare. It can — but only for a light source small enough that swinging your
// viewing angle moves the reflection off a given spot. To clear a point you
// have to change your viewing angle by the FULL angular width of the source:
// a bare bulb is ~2 degrees and a small move clears it; a 60cm ceiling
// diffuser two metres up is ~17 degrees and needs a real sweep; an overcast
// window or a ceiling of panels is 40-90 degrees wide and NO sweep anyone can
// physically perform will clear it.
//
// So the first thing to build is not a compositor. It is the measurement that
// says which of those Beau's desk is, because building the compositor to find
// out is the expensive way round. Two numbers, taken per frame, cost nothing:
//
//   - clipping that is PRESENT AT EVERY ANGLE and unmoved as the phone moves
//     is a source reflection filling the frame. A lighting problem. No merge
//     code fixes it, and the honest answer is "use a different lamp".
//   - clipping that MOVES as the angle changes is sweep-recoverable. A
//     software problem, and worth building for.
//
// Pure functions over pixel buffers, so both are testable without a camera.

export type Rect = { x: number; y: number; w: number; h: number };

/** Clamp a rect to the buffer, or null when nothing of it is inside. */
function clampRect(r: Rect | null | undefined, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r?.x ?? 0));
  const y0 = Math.max(0, Math.floor(r?.y ?? 0));
  const x1 = Math.min(w, Math.ceil((r?.x ?? 0) + (r?.w ?? w)));
  const y1 = Math.min(h, Math.ceil((r?.y ?? 0) + (r?.h ?? h)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * What fraction of this region is blown out.
 *
 * MEASURED ON max(R,G,B), NOT ON LUMA, and the difference is not academic. A
 * warm desk lamp's reflection reads about (255, 255, 140): red and green are
 * completely dead — that detail is gone and no amount of processing recovers
 * it — yet its luma is 242, comfortably under any sensible luma threshold. A
 * luma test would call the single most common form of indoor glare "fine".
 * The same test falsely flags an unclipped neutral 250, which is merely
 * bright.
 *
 * Returns null rather than 0 when there is nothing to measure. No reading and
 * a reading of zero are different facts, and a guidance UI must never show a
 * clean number it did not take.
 *
 * A FLOOR, NOT A MEASUREMENT, when read off the detection probe. That buffer
 * is a ~5.6x downsample of the frame, and the browser low-passes as it scales
 * — so a clipped blob smaller than about six source pixels is averaged down
 * below the threshold and vanishes. Real clipping is always at least this.
 */
export function clipFraction(
  rgba: Uint8ClampedArray, w: number, h: number, rect?: Rect | null,
  { level = 254 } = {},
): { fraction: number; sampled: number } | null {
  const r = clampRect(rect, w, h);
  if (!r || rgba.length < w * h * 4) return null;
  let clipped = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * w + x) * 4;
      const m = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (m >= level) clipped++;
      n++;
    }
  }
  if (!n) return null;
  return { fraction: clipped / n, sampled: n };
}

/**
 * The region's median brightness — the cheap proxy for exposure drift.
 *
 * WHY IT MATTERS FOR STACKING. Combining frames assumes the same diffuse point
 * has the same value in every one of them. Phone auto-exposure breaks that
 * assumption continuously as you sweep, and iOS Safari exposes no exposure
 * lock at all — WebKit's constraint vocabulary simply omits it. So the only
 * available fix is to normalise photometrically after the fact, and that only
 * works if the drift is small enough to model. Watching this number across a
 * sweep is how you find out whether it is.
 *
 * Median rather than mean: a growing glare blob drags a mean upward and would
 * be read as the exposure falling.
 */
export function globalMedian(
  rgba: Uint8ClampedArray, w: number, h: number, rect?: Rect | null,
  { step = 2 } = {},
): number | null {
  const r = clampRect(rect, w, h);
  if (!r || rgba.length < w * h * 4) return null;
  // A 256-bin histogram is exact for 8-bit data and needs no sort.
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y += step) {
    for (let x = r.x; x < r.x + r.w; x += step) {
      const i = (y * w + x) * 4;
      // Rounded, not truncated. The coefficients do not sum to exactly 1 in
      // floating point, so `| 0` turns a flat 128 into 127 and biases every
      // reading half a level low — which matters when the whole use of this
      // number is watching it drift by a few levels.
      const l = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
      hist[l]++;
      n++;
    }
  }
  if (!n) return null;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen * 2 >= n) return v;
  }
  return 255;
}

export type GlareVerdict = "clearable" | "partly" | "fixed" | "unknown";

export type GlareReading = {
  /** Highest clipped fraction seen. */
  peak: number;
  /** Lowest clipped fraction seen. */
  floor: number;
  /** How many readings this is built from. */
  n: number;
  /** Exposure drift across the run, in median levels. */
  drift: number;
  verdict: GlareVerdict;
};

/** Below this, there is no glare worth reasoning about. */
const NEGLIGIBLE = 0.002;

/**
 * Read a run of per-frame samples and say whether a sweep could clear it.
 *
 * THE WHOLE POINT IS THE `fixed` VERDICT. Clipping that never drops as the
 * phone moves is a reflection of a source too broad to escape, and telling
 * someone to sweep harder is telling them to waste fifteen seconds. That
 * answer is worth more than a composite.
 *
 * `unknown` is returned honestly and often: too few samples, or a run where
 * the phone never actually moved, cannot distinguish a fixed reflection from
 * one nobody tried to move off. Silence beats a guess.
 */
export function readGlare(samples: { clip: number; median: number }[]): GlareReading {
  const n = samples.length;
  const clips = samples.map((s) => s.clip);
  const meds = samples.map((s) => s.median);
  const peak = n ? Math.max(...clips) : 0;
  const floor = n ? Math.min(...clips) : 0;
  const drift = n ? Math.max(...meds) - Math.min(...meds) : 0;

  let verdict: GlareVerdict = "unknown";
  if (n >= 8) {
    if (peak < NEGLIGIBLE) verdict = "clearable";           // nothing to clear
    else if (floor < NEGLIGIBLE) verdict = "clearable";     // some angle was clean
    else if (floor > peak * 0.6) verdict = "fixed";         // never budged
    else verdict = "partly";
  }
  return { peak, floor, n, drift, verdict };
}

/** What to tell the user, in words, about their light. */
export function glareAdvice(r: GlareReading): string | null {
  switch (r.verdict) {
    case "clearable":
      return r.peak < NEGLIGIBLE ? null : "Your light is small enough to sweep around.";
    case "partly":
      return "Some of the glare moves as you do, some doesn't — a sweep will clear part of it.";
    case "fixed":
      // The honest answer, and the one that saves the most time.
      return "This glare doesn't move as you do — the light source is too broad to sweep around. A smaller lamp, or a window off to one side, will do more than any amount of scanning.";
    default:
      return null;
  }
}

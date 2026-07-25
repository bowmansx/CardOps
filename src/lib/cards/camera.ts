// Camera math (Beau, 2026-07-25). Pure, unit-tested, no DOM — CameraSheet does
// the I/O. Three jobs: the edge-safety margin, the focus/stability metrics that
// make auto-snap possible, and the burst pick.

export const CARD_ASPECT = 2.5 / 3.5;    // raw card
export const SLAB_ASPECT = 3.32 / 5.44;  // PSA-style slab

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Grow a crop rect by `marginPct` of its own size, clamped to the frame.
 *
 * WHY THIS EXISTS: corners and edges ARE the grade. Cropping exactly to the
 * guide puts the card's edge ON the image boundary, which (a) hides chipping
 * and (b) makes a crop indistinguishable from a card that really is cut that
 * way. A visible band of background around all four edges is what proves the
 * edge in the photo is the card's real edge. ~4% of card width ≈ 2-3mm.
 */
export function withMargin(rect: Rect, marginPct: number, bounds: { w: number; h: number }): Rect {
  const mx = rect.w * marginPct;
  const my = rect.h * marginPct;
  const x = Math.max(0, rect.x - mx);
  const y = Math.max(0, rect.y - my);
  const right = Math.min(bounds.w, rect.x + rect.w + mx);
  const bottom = Math.min(bounds.h, rect.y + rect.h + my);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Focus proxy: variance of the Laplacian over a grayscale buffer. Browsers
 * don't expose autofocus-lock state, so this is the standard stand-in — a
 * sharp image has strong second derivatives, a blurred one doesn't. Higher is
 * sharper; the scale is arbitrary and only comparable between frames of the
 * same scene, which is exactly how it's used.
 */
export function sharpness(gray: Uint8ClampedArray | Uint8Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // 4-neighbour Laplacian
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean absolute difference between two same-sized grayscale frames: hand shake. */
export function frameDelta(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

export type AutoSnapOpts = {
  minSharpness: number;   // below this we assume out of focus
  maxDelta: number;       // above this the hands are still moving
  stableFrames: number;   // how many consecutive good frames before firing
};

export const AUTO_SNAP_DEFAULTS: AutoSnapOpts = {
  minSharpness: 60,
  maxDelta: 3.5,
  stableFrames: 4,
};

/**
 * Decide whether to fire. Deliberately requires N CONSECUTIVE good frames:
 * a single sharp frame happens mid-sweep across a table and would fire on
 * whatever happened to be under the lens.
 */
export function shouldAutoSnap(
  recent: { sharp: number; delta: number }[],
  opts: AutoSnapOpts = AUTO_SNAP_DEFAULTS,
): boolean {
  if (recent.length < opts.stableFrames) return false;
  const window = recent.slice(-opts.stableFrames);
  return window.every((f) => f.sharp >= opts.minSharpness && f.delta <= opts.maxDelta);
}

/**
 * Best of a burst: the sharpest frame wins. This is the half of "3x and merge"
 * that's worth doing — it reliably kills the odd blurred shot. True multi-frame
 * merging (align + average) is what phone ISPs do with dedicated silicon; in
 * JS it needs subpixel alignment and buys little on a flat, evenly-lit card.
 */
export function pickSharpest<T extends { sharp: number }>(frames: T[]): T | null {
  if (!frames.length) return null;
  return frames.reduce((best, f) => (f.sharp > best.sharp ? f : best));
}

// GLARE REMOVAL BY STACKING (2026-07-29).
//
// Beau: "can it collectively map around the glare... then could it automatically
// take those scans and create different final photos?"
//
// Yes, and the physics is what makes it work. Glare is SPECULAR — a mirror image
// of the light source — so it sits at whatever spot satisfies the reflection
// angle and MOVES when you move. The card's own ink is DIFFUSE: it scatters
// evenly and looks the same from every angle. Sweep the phone and the glare
// slides across the card while the artwork stays put. So for any given point,
// some frame in the sweep saw it without the reflection, and the job is to find
// which.
//
// `exposure.ts` (2026-07-27) built the measurement first, deliberately, because
// a light source too broad to escape cannot be swept around at all and the
// honest answer there is "use a smaller lamp". Read its verdict BEFORE running
// this: on `fixed`, compositing is wasted effort and a wasted fifteen seconds of
// someone's time.
//
// HOW A PIXEL IS PICKED. Specular reflection adds the source's own colour —
// usually near-white — on top of the diffuse colour. Adding white raises all
// three channels, so it raises the SMALLEST of them. A saturated diffuse pixel
// has a low min(R,G,B); wash it with white and that min climbs. So min(R,G,B) is
// a cheap, physically-grounded specularity score, and the least-specular frame
// at each position is the one that saw the ink.
//
// THE WHOLE PIXEL IS TAKEN FROM ONE FRAME, never a per-channel minimum. Taking
// each channel's min independently would pull R from one frame and B from
// another and shift the card's colour — on a product photo that is worse than
// the glare, because it is a wrong number rather than an obvious flaw.
//
// Pure functions over pixel buffers. No DOM, testable without a camera.
import type { Rect } from "./exposure";

/** One registered frame — already warped to the common rectangle. */
export type StackFrame = {
  /** RGBA, where alpha 0 marks a pixel whose source fell outside the frame. */
  data: Uint8ClampedArray;
  /**
   * Median luma of this frame, from `globalMedian`.
   *
   * Used to undo auto-exposure drift before comparing frames. `exposure.ts`
   * records why this is unavoidable: iOS Safari exposes no exposure lock at all
   * — WebKit's constraint vocabulary omits it — so the frames WILL drift and
   * normalising after the fact is the only available fix.
   */
  median?: number | null;
};

/** Above this, min(R,G,B) means the pixel is washed with source light. */
const SPECULAR = 200;
/** At or above this a channel is clipped, and that detail is gone for good. */
const CLIPPED = 254;

export type StackReport = {
  /** Output dimensions. */
  w: number;
  h: number;
  /**
   * Distinct frames that WON at least one pixel — not frames that were usable.
   *
   * The distinction bites: identical frames tie on every pixel and the tie goes
   * to the first, so three copies of the same shot legitimately report 1. Use
   * `improved` to ask whether the phone actually moved; this only says how many
   * frames the output was drawn from.
   */
  framesUsed: number;
  /**
   * Fraction of valid pixels where EVERY frame was specular.
   *
   * The number that decides whether this composite may be presented as clean.
   * A pixel glared in all frames cannot be recovered by any amount of stacking,
   * and a composite that still has glare must say so rather than merely looking
   * processed (rules 4 and 10).
   */
  unresolved: number;
  /** Fraction of valid pixels where at least two frames disagreed enough to matter. */
  improved: number;
  /** Pixels no frame covered at all — registration or framing missed them. */
  uncovered: number;
  /** Mean number of frames that were usable per pixel. */
  meanDepth: number;
};

export type StackResult = {
  data: Uint8ClampedArray;
  report: StackReport;
};

/**
 * Composite registered frames into one image with the specular hits rejected.
 *
 * Frames must already share a coordinate space — see `warpQuadToRect`. Passing
 * unregistered frames produces a soft double-exposure, not an error, which is
 * why registration is a separate explicit step rather than something guessed at
 * here.
 *
 * Returns null only when there is nothing to work with. One frame is not an
 * error: it comes back unchanged, with `improved: 0` saying plainly that no
 * stacking happened.
 */
export function stackFrames(frames: StackFrame[], w: number, h: number): StackResult | null {
  if (!frames.length || w < 1 || h < 1) return null;
  const px = w * h;
  if (frames.some((f) => f.data.length < px * 4)) return null;

  // PHOTOMETRIC NORMALISATION. Scale every frame to the median of the medians,
  // so a frame the camera happened to expose darker isn't chosen everywhere just
  // for being dark. Without this the "least specular" test degenerates into
  // "darkest frame wins" and the composite is just the worst-exposed frame.
  const meds = frames.map((f) => f.median).filter((m): m is number => typeof m === "number" && m > 0);
  const target = meds.length ? median(meds) : null;
  const gain = frames.map((f) =>
    target && typeof f.median === "number" && f.median > 0
      // Clamped: a wild median (a frame mostly filled with glare) would otherwise
      // apply a huge gain and blow out the very pixels we are trying to save.
      ? clamp(target / f.median, 0.6, 1.6)
      : 1,
  );

  const out = new Uint8ClampedArray(px * 4);
  const used = new Set<number>();
  let unresolved = 0, improved = 0, uncovered = 0, depthSum = 0, valid = 0;

  for (let p = 0; p < px; p++) {
    const o = p * 4;
    let bestF = -1, bestScore = Infinity, worstScore = -Infinity, depth = 0;

    for (let f = 0; f < frames.length; f++) {
      const d = frames[f].data;
      if (d[o + 3] === 0) continue; // this frame didn't cover this pixel
      depth++;
      const g = gain[f];
      const r = d[o] * g, gr = d[o + 1] * g, b = d[o + 2] * g;
      const score = Math.min(r, gr, b);
      if (score < bestScore) { bestScore = score; bestF = f; }
      if (score > worstScore) worstScore = score;
    }

    if (bestF < 0) { uncovered++; continue; } // no frame saw it
    valid++;
    depthSum += depth;
    used.add(bestF);

    const d = frames[bestF].data;
    const g = gain[bestF];
    out[o] = Math.round(d[o] * g);
    out[o + 1] = Math.round(d[o + 1] * g);
    out[o + 2] = Math.round(d[o + 2] * g);
    out[o + 3] = 255;

    // Even the best frame was washed out here — no angle in this sweep saw the
    // ink, so this pixel is not recoverable and the report has to admit it.
    if (bestScore >= SPECULAR) unresolved++;
    // A real spread between best and worst means stacking actually did something
    // at this pixel, rather than every frame agreeing and the merge being a
    // no-op dressed up as processing.
    else if (depth > 1 && worstScore - bestScore > 12) improved++;
  }

  const denom = valid || 1;
  return {
    data: out,
    report: {
      w, h,
      framesUsed: used.size,
      unresolved: unresolved / denom,
      improved: improved / denom,
      uncovered: uncovered / px,
      meanDepth: depthSum / denom,
    },
  };
}

/**
 * THE SAME SWEEP, RUN BACKWARDS: keep the specular pixel instead of rejecting it.
 *
 * Beau: "could it automatically take those scans and create different final
 * photos?" This is the second one, and it is the more valuable of the two for
 * grading.
 *
 * Flat, even light is what you want for a LISTING photo — it shows the artwork
 * and hides the surface. Raking light is the opposite: a reflection skimming
 * across a card is what makes a scratch, a print line, a crease or a dinged
 * corner visible at all, because those are surface-normal defects and only show
 * when the light glances off them. Graders tilt a card under a lamp for exactly
 * this reason.
 *
 * A sweep already collects every angle. Taking the MOST specular sample at each
 * position composites the raking view from all of them at once — a surface map no
 * single frame contains, from capture the user already performed.
 *
 * Not a photo of the card as it looks. A photo of its surface, and it should be
 * labelled that way wherever it appears.
 */
export function stackSurface(frames: StackFrame[], w: number, h: number): StackResult | null {
  if (!frames.length || w < 1 || h < 1) return null;
  const px = w * h;
  if (frames.some((f) => f.data.length < px * 4)) return null;

  // No photometric normalisation here, deliberately, and it is the opposite
  // choice from `stackFrames`. There, gain correction stops a merely-dark frame
  // winning everywhere. Here we are hunting the brightest specular response, and
  // scaling frames toward a common median would flatten precisely the differences
  // that reveal the surface.
  const out = new Uint8ClampedArray(px * 4);
  const used = new Set<number>();
  let uncovered = 0, depthSum = 0, valid = 0, lit = 0;

  for (let p = 0; p < px; p++) {
    const o = p * 4;
    let bestF = -1, bestScore = -Infinity, depth = 0;
    for (let f = 0; f < frames.length; f++) {
      const d = frames[f].data;
      if (d[o + 3] === 0) continue;
      depth++;
      const score = Math.min(d[o], d[o + 1], d[o + 2]);
      if (score > bestScore) { bestScore = score; bestF = f; }
    }
    if (bestF < 0) { uncovered++; continue; }
    valid++;
    depthSum += depth;
    used.add(bestF);
    const d = frames[bestF].data;
    out[o] = d[o]; out[o + 1] = d[o + 1]; out[o + 2] = d[o + 2]; out[o + 3] = 255;
    if (bestScore >= SPECULAR) lit++;
  }

  const denom = valid || 1;
  return {
    data: out,
    report: {
      w, h,
      framesUsed: used.size,
      // Reused with the OPPOSITE meaning, and named in the docs rather than
      // silently: here a high figure means the sweep raked plenty of light across
      // the card, which is what makes a surface map useful.
      unresolved: lit / denom,
      improved: lit / denom,
      uncovered: uncovered / px,
      meanDepth: depthSum / denom,
    },
  };
}

/**
 * Is a surface map worth showing?
 *
 * It needs light to have actually swept ACROSS the card. A sweep performed in
 * flat, even light produces a surface map identical to the ordinary photo — no
 * raking reflection ever landed anywhere — and presenting that as a defect view
 * invites someone to conclude a card is clean when nothing was ever illuminated
 * at a revealing angle.
 */
export function surfaceWorthKeeping(r: StackReport, { minLit = 0.02 } = {}): boolean {
  return r.meanDepth >= 2 && r.unresolved >= minLit && r.uncovered < 0.02;
}

/** What to tell the user about a surface map. Null when it is usable as-is. */
export function surfaceAdvice(r: StackReport): string | null {
  if (r.uncovered > 0.02) {
    return `${pct(r.uncovered)} of the card wasn't in every shot, so part of the surface wasn't mapped.`;
  }
  if (r.meanDepth < 2) return "A surface map needs several angles — one shot can't rake light across the card.";
  if (r.unresolved < 0.02) {
    // The trap this exists to close: a flat-light sweep yields a surface map that
    // looks clean because nothing was ever lit at a revealing angle.
    return "No light raked across the card during that sweep, so this shows no more than the ordinary photo. Tilt it toward a lamp and sweep again — scratches only show when light glances off them.";
  }
  return null;
}

/**
 * Is the stacked result actually better than the single best frame?
 *
 * Worth asking explicitly. A sweep where the phone barely moved yields a
 * composite that is a slightly noisier copy of one frame, and shipping that as
 * "enhanced" is a claim the pixels do not support. `improved` below a floor means
 * keep the original.
 */
export function stackWorthKeeping(r: StackReport, { minImproved = 0.01 } = {}): boolean {
  return r.framesUsed > 1 && r.improved >= minImproved && r.uncovered < 0.02;
}

/**
 * What to tell the user about a composite, in words. Null when it is simply fine.
 *
 * ORDERED BY WHAT CAN HONESTLY BE CONCLUDED, which is not the same as ordering by
 * severity. Each branch below is a genuinely different situation:
 *
 *   1. Frames didn't overlap — a framing failure, and it explains a bad result
 *      better than any number computed from the pixels it did manage to cover.
 *   2. Only one frame was AVAILABLE — then nothing about the glare is knowable.
 *      "Every angle caught it" would be a claim about one angle.
 *   3. Several frames were available and the glare survived all of them — now the
 *      reflection is genuinely inescapable, and saying so points at the lamp.
 *   4. Several frames, glare cleared, but they barely differed — the merge was
 *      almost a no-op.
 *
 * `meanDepth` gates step 2, not `framesUsed`. `framesUsed` counts frames that
 * WON, and identical frames tie so one wins everywhere — three copies of the same
 * shot report framesUsed 1 while genuinely proving the glare didn't move. Depth
 * is what says whether there was a sweep to draw a conclusion from, the same way
 * `readGlare` gates its verdict on sample count rather than on outcome.
 */
export function stackAdvice(r: StackReport): string | null {
  if (r.uncovered > 0.02) {
    return `${pct(r.uncovered)} of the card wasn't in every shot — keep the whole card in frame through the sweep.`;
  }
  if (r.meanDepth < 2) {
    return "Only one shot to work with, so nothing was merged. Keep the card in frame and move the phone through a wider arc.";
  }
  if (r.unresolved > 0.02) {
    return `Glare still covers ${pct(r.unresolved)} of the card — every angle caught it there. A smaller light, or one off to the side, is the only fix for that patch.`;
  }
  if (r.improved < 0.01) {
    return "The shots were nearly identical, so merging changed almost nothing. A wider sweep gives it more to work with.";
  }
  return null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Fraction of a region that is clipped, over an already-stacked RGBA buffer.
 *
 * Distinct from `clipFraction` in `exposure.ts`, which reads a live detection
 * probe — a heavy downsample whose low-pass filtering makes its answer a FLOOR.
 * This reads the full-resolution composite, so it is a measurement, and it
 * respects the alpha validity channel that warping produces.
 */
export function clippedFraction(
  rgba: Uint8ClampedArray, w: number, h: number, rect?: Rect | null,
): { fraction: number; sampled: number } | null {
  const x0 = Math.max(0, Math.floor(rect?.x ?? 0));
  const y0 = Math.max(0, Math.floor(rect?.y ?? 0));
  const x1 = Math.min(w, Math.ceil((rect?.x ?? 0) + (rect?.w ?? w)));
  const y1 = Math.min(h, Math.ceil((rect?.y ?? 0) + (rect?.h ?? h)));
  if (x1 <= x0 || y1 <= y0 || rgba.length < w * h * 4) return null;
  let clipped = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] === 0) continue;
      if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) >= CLIPPED) clipped++;
      n++;
    }
  }
  return n ? { fraction: clipped / n, sampled: n } : null;
}

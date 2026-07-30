// THE SWEEP (2026-07-29) — deciding which frames are worth keeping.
//
// Beau: "we could even have a photo session template that walks you through a
// scanning technique."
//
// `stack.ts` composites frames; this decides which ones it gets. That is not a
// detail. A phone delivers 30 frames a second and a composite holds every keeper
// in memory at once, so grabbing everything would blow the memory budget on a
// 16GB machine while contributing almost nothing: sixty frames from a phone that
// barely moved are sixty copies of the same view, and the stacker would find
// nothing to choose between them.
//
// WHAT MAKES A FRAME WORTH KEEPING IS THAT THE VIEW CHANGED. Glare clears only
// when the viewing angle moves by the full angular width of the light source
// (see `exposure.ts`), so the useful axis is angular travel, not elapsed time and
// not frame count. A keeper is a frame taken from a meaningfully different angle
// than the last keeper — which is why the gate is corner displacement rather
// than a timer.
//
// Pure state machine. No DOM, no camera, no timers — the caller feeds it frames
// and it answers. Testable end to end without hardware.
import type { Point } from "./homography";
import { orderQuad } from "./homography";

/** What the caller measures per live frame. All of it already exists. */
export type SweepSample = {
  /** The card's four corners in this frame, or null if detection failed. */
  quad: Point[] | null;
  /** From `sharpness` in camera.ts — higher is sharper. */
  sharp: number;
  /** From `clipFraction` — the glare fraction right now. */
  clip: number | null;
  /** From `globalMedian` — for the drift the stacker has to correct. */
  median: number | null;
};

export type SweepState = {
  /** Quads of the frames kept so far, in order. */
  kept: { quad: Point[]; sharp: number; median: number | null }[];
  /** Frames seen, including rejected ones — for an honest progress readout. */
  seen: number;
  /** Cumulative angular travel, as a fraction of the card's diagonal. */
  travel: number;
};

export const EMPTY_SWEEP: SweepState = { kept: [], seen: 0, travel: 0 };

export type SweepOpts = {
  /** Keepers to gather before the sweep is complete. */
  target: number;
  /**
   * How far corners must move, as a fraction of the card diagonal, before a
   * frame counts as a new angle.
   *
   * Tuned to a purpose rather than to feel: it has to be large enough that the
   * reflection actually moves off a given point, and small enough to be
   * achievable hand-held in a few seconds. 6% of the diagonal is roughly a
   * centimetre of phone travel at normal distance.
   */
  minMove: number;
  /** Frames below this are motion-blurred; a blurred keeper poisons the stack. */
  minSharp: number;
};

export const SWEEP_DEFAULTS: SweepOpts = { target: 8, minMove: 0.06, minSharp: 8 };

export type SweepDecision =
  | { keep: false; reason: "no-card" | "blurred" | "too-similar" | "complete" }
  | { keep: true; complete: boolean };

/**
 * How far this quad sits from another, as a fraction of the card's diagonal.
 *
 * Mean corner displacement, normalised by size so the threshold means the same
 * thing whether the card fills the frame or sits in the middle of it. Corners
 * are ordered first: comparing an unordered quad against an ordered one measures
 * the labelling, not the movement, and would report a huge move for a frame that
 * never budged.
 */
export function quadDistance(a: Point[], b: Point[]): number | null {
  const oa = orderQuad(a), ob = orderQuad(b);
  if (!oa || !ob) return null;
  const diag = Math.hypot(oa[0].x - oa[2].x, oa[0].y - oa[2].y);
  if (!(diag > 0)) return null;
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += Math.hypot(oa[i].x - ob[i].x, oa[i].y - ob[i].y);
  return sum / 4 / diag;
}

/**
 * Feed one live frame. Returns whether to keep it, and the new state.
 *
 * The state is REPLACED, never mutated, so a caller holding it in React state
 * sees the change and a dropped frame can't corrupt a run in flight.
 */
export function sweepStep(
  state: SweepState, sample: SweepSample, opts: SweepOpts = SWEEP_DEFAULTS,
): { state: SweepState; decision: SweepDecision } {
  const seen = state.seen + 1;
  const bump = (decision: SweepDecision): { state: SweepState; decision: SweepDecision } =>
    ({ state: { ...state, seen }, decision });

  if (state.kept.length >= opts.target) return bump({ keep: false, reason: "complete" });
  // Without corners the frame cannot be registered, so it cannot be stacked —
  // keeping it would put an unalignable frame in the pile.
  if (!sample.quad || sample.quad.length !== 4) return bump({ keep: false, reason: "no-card" });
  // A blurred keeper poisons the stack: its smeared highlight looks like diffuse
  // colour to a min-operator, so the stacker would PREFER it exactly where the
  // glare is worst.
  if (sample.sharp < opts.minSharp) return bump({ keep: false, reason: "blurred" });

  const last = state.kept[state.kept.length - 1];
  let moved = 0;
  if (last) {
    const d = quadDistance(sample.quad, last.quad);
    if (d == null) return bump({ keep: false, reason: "no-card" });
    if (d < opts.minMove) return bump({ keep: false, reason: "too-similar" });
    moved = d;
  }

  const kept = [...state.kept, { quad: sample.quad, sharp: sample.sharp, median: sample.median }];
  return {
    state: { kept, seen, travel: state.travel + moved },
    decision: { keep: true, complete: kept.length >= opts.target },
  };
}

export type SweepProgress = {
  kept: number;
  target: number;
  /** 0..1 for a progress bar. */
  fraction: number;
  complete: boolean;
  /** Angular travel so far, in card diagonals. */
  travel: number;
  /** What to tell the user right now, or null when they are simply doing fine. */
  hint: string | null;
};

/**
 * Progress and live coaching.
 *
 * The hint is what makes a sweep learnable. The failure mode without it is
 * someone holding the phone dead still, watching a counter not move, and
 * concluding the feature is broken — the counter is correct and the instruction
 * is missing.
 */
export function sweepProgress(
  state: SweepState, last: SweepDecision | null, opts: SweepOpts = SWEEP_DEFAULTS,
): SweepProgress {
  const kept = state.kept.length;
  const complete = kept >= opts.target;
  let hint: string | null = null;

  if (complete) hint = null;
  else if (last?.keep === false) {
    switch (last.reason) {
      case "no-card": hint = "Get the whole card in frame."; break;
      case "blurred": hint = "Hold steadier — that one was blurred."; break;
      // The most important hint, and the one a naive implementation never gives:
      // the sweep is not stalled because something is wrong, it is stalled
      // because nothing has changed.
      case "too-similar": hint = kept === 0
        ? "Move the phone slowly through an arc — tilt it as you go."
        : "Keep moving — it needs a new angle, not another shot from here.";
        break;
      default: hint = null;
    }
  } else if (kept > 0 && kept < opts.target) {
    hint = "Good — keep sweeping.";
  } else if (kept === 0) {
    hint = "Move the phone slowly through an arc — tilt it as you go.";
  }

  return { kept, target: opts.target, fraction: Math.min(1, kept / opts.target), complete, travel: state.travel, hint };
}

/**
 * Was this sweep wide enough to be worth stacking?
 *
 * Distinct from being COMPLETE. A run can collect its full quota of keepers from
 * a phone that crept along, each frame just past the movement gate, and total
 * travel still too small for the reflection to have gone anywhere. Complete says
 * enough frames; this says enough angle.
 *
 * The threshold is deliberately just over target x minMove — the minimum a
 * qualifying run can accumulate — so it rejects only a sweep that scraped the
 * gate every single time.
 */
export function sweepWideEnough(state: SweepState, opts: SweepOpts = SWEEP_DEFAULTS): boolean {
  return state.kept.length >= 2 && state.travel >= (opts.target - 1) * opts.minMove * 1.2;
}

/**
 * The frames to hand the stacker, sharpest first.
 *
 * Sharpest first matters because ties in the stacker go to the earliest frame:
 * where two frames are equally unspecular at a pixel, the sharper one should win.
 */
export function sweepKeepers(state: SweepState): { quad: Point[]; sharp: number; median: number | null }[] {
  return [...state.kept].sort((a, b) => b.sharp - a.sharp);
}

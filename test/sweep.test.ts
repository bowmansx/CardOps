import { describe, it, expect } from "vitest";
import {
  sweepStep, sweepProgress, sweepWideEnough, sweepKeepers, quadDistance,
  EMPTY_SWEEP, SWEEP_DEFAULTS, type SweepSample, type SweepState,
} from "@/lib/cards/sweep";
import type { Point } from "@/lib/cards/homography";

/** A card quad shifted by (dx,dy). Diagonal is 500, so 30px ≈ 6%. */
const quadAt = (dx = 0, dy = 0): Point[] => [
  { x: 100 + dx, y: 100 + dy }, { x: 400 + dx, y: 100 + dy },
  { x: 400 + dx, y: 500 + dy }, { x: 100 + dx, y: 500 + dy },
];

const sample = (o: Partial<SweepSample> = {}): SweepSample => ({
  quad: quadAt(), sharp: 20, clip: 0.01, median: 128, ...o,
});

/** Run a whole sweep, moving `step` px between frames. */
function run(frames: number, step: number, opts = SWEEP_DEFAULTS) {
  let state: SweepState = EMPTY_SWEEP;
  let last = null as ReturnType<typeof sweepStep>["decision"] | null;
  for (let i = 0; i < frames; i++) {
    const r = sweepStep(state, sample({ quad: quadAt(i * step, 0) }), opts);
    state = r.state; last = r.decision;
  }
  return { state, last };
}

describe("quadDistance", () => {
  it("is zero for an unmoved card", () => {
    expect(quadDistance(quadAt(), quadAt())).toBe(0);
  });

  it("normalises by the card's own size, so the threshold means one thing", () => {
    // 50px on a 500px diagonal is 10%, whatever the card's absolute size.
    expect(quadDistance(quadAt(), quadAt(50, 0))).toBeCloseTo(0.1, 3);
  });

  // Comparing an unordered quad against an ordered one measures the LABELLING,
  // not the movement, and would report a huge move for a frame that never budged.
  it("orders corners first, so a relabelled quad reads as no movement", () => {
    const q = quadAt();
    const shuffled = [q[2], q[3], q[0], q[1]];
    expect(quadDistance(q, shuffled)).toBe(0);
  });

  it("returns null for a degenerate quad", () => {
    const flat = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    expect(quadDistance(flat, flat)).toBeNull();
  });
});

describe("sweepStep — what earns a keeper", () => {
  it("keeps the first detected frame", () => {
    const r = sweepStep(EMPTY_SWEEP, sample());
    expect(r.decision).toEqual({ keep: true, complete: false });
    expect(r.state.kept).toHaveLength(1);
  });

  // An unregisterable frame cannot be stacked, so keeping it would put an
  // unalignable frame in the pile.
  it("rejects a frame with no card and counts it as seen", () => {
    const r = sweepStep(EMPTY_SWEEP, sample({ quad: null }));
    expect(r.decision).toEqual({ keep: false, reason: "no-card" });
    expect(r.state.seen).toBe(1);
    expect(r.state.kept).toHaveLength(0);
  });

  // A blurred keeper POISONS the stack: its smeared highlight reads as diffuse
  // colour to a min-operator, so the stacker prefers it exactly where the glare
  // is worst.
  it("rejects a blurred frame", () => {
    expect(sweepStep(EMPTY_SWEEP, sample({ sharp: 2 })).decision).toEqual({ keep: false, reason: "blurred" });
  });

  // The whole premise: glare only clears when the ANGLE changes, so another shot
  // from the same place is worth nothing.
  it("rejects a frame from the same angle as the last keeper", () => {
    const first = sweepStep(EMPTY_SWEEP, sample()).state;
    const r = sweepStep(first, sample({ quad: quadAt(5, 0) })); // 1% — under the gate
    expect(r.decision).toEqual({ keep: false, reason: "too-similar" });
    expect(r.state.kept).toHaveLength(1);
  });

  it("keeps a frame once the view has genuinely moved", () => {
    const first = sweepStep(EMPTY_SWEEP, sample()).state;
    const r = sweepStep(first, sample({ quad: quadAt(40, 0) })); // 8% — over the gate
    expect(r.decision).toEqual({ keep: true, complete: false });
    expect(r.state.kept).toHaveLength(2);
  });

  it("compares against the LAST keeper, not the first", () => {
    // Three steps of 8% each: every one should qualify against its predecessor.
    const { state } = run(3, 40);
    expect(state.kept).toHaveLength(3);
  });

  it("completes at the target and then rejects everything after", () => {
    const { state, last } = run(SWEEP_DEFAULTS.target, 40);
    expect(state.kept).toHaveLength(SWEEP_DEFAULTS.target);
    expect(last).toEqual({ keep: true, complete: true });
    const after = sweepStep(state, sample({ quad: quadAt(9999, 0) }));
    expect(after.decision).toEqual({ keep: false, reason: "complete" });
  });

  // A caller holding this in React state must see the change, and a dropped
  // frame must not corrupt a run in flight.
  it("never mutates the state it was given", () => {
    const before = sweepStep(EMPTY_SWEEP, sample()).state;
    const snapshot = JSON.stringify(before);
    sweepStep(before, sample({ quad: quadAt(40, 0) }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("accumulates travel only from frames it kept", () => {
    let state = sweepStep(EMPTY_SWEEP, sample()).state;
    state = sweepStep(state, sample({ quad: quadAt(5, 0) })).state;  // rejected
    expect(state.travel).toBe(0);
    state = sweepStep(state, sample({ quad: quadAt(50, 0) })).state; // kept, 10%
    expect(state.travel).toBeCloseTo(0.1, 3);
  });
});

describe("sweepProgress — the coaching is the feature", () => {
  // The failure mode without this: someone holds the phone dead still, watches a
  // counter not move, and concludes the feature is broken. The counter is right
  // and the instruction is missing.
  it("tells a stalled user to MOVE rather than leaving them guessing", () => {
    const first = sweepStep(EMPTY_SWEEP, sample()).state;
    const r = sweepStep(first, sample({ quad: quadAt(2, 0) }));
    const p = sweepProgress(r.state, r.decision);
    expect(p.hint).toContain("Keep moving");
    expect(p.hint).toContain("new angle");
  });

  it("gives a first-time user the technique before they have any keepers", () => {
    const r = sweepStep(EMPTY_SWEEP, sample({ quad: null }));
    expect(sweepProgress(r.state, r.decision).hint).toContain("card in frame");
    expect(sweepProgress(EMPTY_SWEEP, null).hint).toContain("arc");
  });

  it("names blur specifically, since the fix differs from the fix for stalling", () => {
    const r = sweepStep(EMPTY_SWEEP, sample({ sharp: 1 }));
    expect(sweepProgress(r.state, r.decision).hint).toContain("steadier");
  });

  it("goes quiet once complete rather than nagging", () => {
    const { state, last } = run(SWEEP_DEFAULTS.target, 40);
    const p = sweepProgress(state, last);
    expect(p.complete).toBe(true);
    expect(p.fraction).toBe(1);
    expect(p.hint).toBeNull();
  });

  it("reports a fraction a progress bar can use", () => {
    const { state, last } = run(3, 40);
    const p = sweepProgress(state, last);
    expect(p.kept).toBe(3);
    expect(p.fraction).toBeCloseTo(3 / SWEEP_DEFAULTS.target, 5);
  });
});

describe("sweepWideEnough — complete is not the same as wide", () => {
  // A run can collect every keeper from a phone that crept along, each frame just
  // past the gate, with total travel still too small for the reflection to have
  // gone anywhere.
  it("rejects a full run that scraped the movement gate every time", () => {
    const step = 500 * SWEEP_DEFAULTS.minMove + 0.5; // barely over 6% each time
    const { state } = run(SWEEP_DEFAULTS.target, step);
    expect(state.kept).toHaveLength(SWEEP_DEFAULTS.target);
    expect(sweepWideEnough(state)).toBe(false);
  });

  it("accepts a run with real travel", () => {
    const { state } = run(SWEEP_DEFAULTS.target, 60); // 12% per step
    expect(sweepWideEnough(state)).toBe(true);
  });

  it("rejects a single-frame run", () => {
    expect(sweepWideEnough(sweepStep(EMPTY_SWEEP, sample()).state)).toBe(false);
  });
});

describe("sweepKeepers", () => {
  // Ties in the stacker go to the earliest frame, so where two frames are equally
  // unspecular at a pixel the sharper one should be the one that wins.
  it("hands the stacker its frames sharpest first", () => {
    let state = sweepStep(EMPTY_SWEEP, sample({ sharp: 10 })).state;
    state = sweepStep(state, sample({ quad: quadAt(40, 0), sharp: 30 })).state;
    state = sweepStep(state, sample({ quad: quadAt(80, 0), sharp: 20 })).state;
    expect(sweepKeepers(state).map((k) => k.sharp)).toEqual([30, 20, 10]);
  });

  it("does not disturb the stored order", () => {
    let state = sweepStep(EMPTY_SWEEP, sample({ sharp: 10 })).state;
    state = sweepStep(state, sample({ quad: quadAt(40, 0), sharp: 30 })).state;
    sweepKeepers(state);
    expect(state.kept.map((k) => k.sharp)).toEqual([10, 30]);
  });
});

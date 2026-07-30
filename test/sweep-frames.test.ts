import { describe, it, expect } from "vitest";
import {
  probeQuadToVideo, offerFrame, finishSweep, EMPTY_CAPTURE, type SweepCapture,
} from "@/lib/cards/sweep-frames";
import { SWEEP_DEFAULTS, type SweepSample } from "@/lib/cards/sweep";
import type { Point } from "@/lib/cards/homography";
import type { Quad } from "@/lib/cards/edges";

const CARD_ASPECT = 2.5 / 3.5;

const quad = (dx = 0): Quad => ({
  tl: { x: 10 + dx, y: 10 }, tr: { x: 90 + dx, y: 10 },
  br: { x: 90 + dx, y: 120 }, bl: { x: 10 + dx, y: 120 },
});

const asPoints = (q: Quad): Point[] => [q.tl, q.tr, q.br, q.bl];

const sample = (o: Partial<SweepSample> = {}): SweepSample => ({
  quad: asPoints(quad()), sharp: 20, clip: 0.01, median: 128, ...o,
});

/** A grab that always succeeds, returning a mid-grey frame of the asked size. */
const grabOk = (_q: Point[], w: number, h: number) => ({
  data: new Uint8ClampedArray(w * h * 4).fill(128),
});

describe("probeQuadToVideo", () => {
  // Detection runs on a downsampled CROP of the guide area. Warping with raw
  // probe coordinates samples a postage stamp from the video's top-left corner —
  // a plausible-looking image of the wrong thing.
  it("maps probe coordinates back through the crop into full-frame pixels", () => {
    const q: Quad = { tl: { x: 0, y: 0 }, tr: { x: 100, y: 0 }, br: { x: 100, y: 200 }, bl: { x: 0, y: 200 } };
    const pts = probeQuadToVideo(q, 100, 200, { x: 500, y: 300, w: 400, h: 800 })!;
    // Probe (0,0) is the crop's origin; probe (100,200) is its far corner.
    expect(pts[0]).toEqual({ x: 500, y: 300 });
    expect(pts[2]).toEqual({ x: 900, y: 1100 });
  });

  it("scales interior points proportionally", () => {
    const q: Quad = { tl: { x: 50, y: 100 }, tr: { x: 50, y: 100 }, br: { x: 50, y: 100 }, bl: { x: 50, y: 100 } };
    const pts = probeQuadToVideo(q, 100, 200, { x: 0, y: 0, w: 1000, h: 2000 })!;
    expect(pts[0]).toEqual({ x: 500, y: 1000 });
  });

  it("refuses a degenerate probe size", () => {
    expect(probeQuadToVideo(quad(), 0, 100, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });
});

describe("offerFrame", () => {
  // At 30fps, rejecting cheaply is most of what this does — the read-and-warp is
  // by far the expensive part and must not run on a frame being thrown away.
  it("does NOT grab a frame the controller rejects", () => {
    let grabs = 0;
    const grab = (q: Point[], w: number, h: number) => { grabs++; return grabOk(q, w, h); };
    offerFrame(EMPTY_CAPTURE, sample({ quad: null }), null, grab, CARD_ASPECT);
    offerFrame(EMPTY_CAPTURE, sample({ sharp: 1 }), asPoints(quad()), grab, CARD_ASPECT);
    expect(grabs).toBe(0);
  });

  it("grabs and stores a keeper", () => {
    const r = offerFrame(EMPTY_CAPTURE, sample(), asPoints(quad()), grabOk, CARD_ASPECT);
    expect(r.decision.keep).toBe(true);
    expect(r.capture.frames).toHaveLength(1);
    expect(r.capture.size).not.toBeNull();
    expect(r.capture.frames[0].median).toBe(128);
  });

  // Re-deriving the size per frame would give each keeper different dimensions
  // and nothing could be stacked — the whole point of registration is ONE shared
  // coordinate space.
  it("fixes the output size on the first keeper and never changes it", () => {
    let cap: SweepCapture = offerFrame(EMPTY_CAPTURE, sample(), asPoints(quad()), grabOk, CARD_ASPECT).capture;
    const first = cap.size!;
    // A much larger quad later in the run must not resize the run.
    const big: Quad = { tl: { x: 0, y: 0 }, tr: { x: 900, y: 0 }, br: { x: 900, y: 1200 }, bl: { x: 0, y: 1200 } };
    cap = offerFrame(cap, sample({ quad: asPoints(big) }), asPoints(big), grabOk, CARD_ASPECT).capture;
    expect(cap.frames).toHaveLength(2);
    expect(cap.size).toEqual(first);
    // Every buffer is the same length, which is what stacking requires.
    expect(new Set(cap.frames.map((f) => f.data.length)).size).toBe(1);
  });

  // Leaving the controller believing it has a frame it does not would let a sweep
  // "complete" with nothing in it.
  it("rolls the keeper back when the warp fails", () => {
    const r = offerFrame(EMPTY_CAPTURE, sample(), asPoints(quad()), () => null, CARD_ASPECT);
    expect(r.decision.keep).toBe(false);
    expect(r.capture.frames).toHaveLength(0);
    expect(r.capture.state.kept).toHaveLength(0);
    // The frame was still SEEN, so progress readouts stay honest.
    expect(r.capture.state.seen).toBe(1);
  });

  it("never mutates the capture it was given", () => {
    const before = offerFrame(EMPTY_CAPTURE, sample(), asPoints(quad()), grabOk, CARD_ASPECT).capture;
    const frames = before.frames.length;
    offerFrame(before, sample({ quad: asPoints(quad(60)) }), asPoints(quad(60)), grabOk, CARD_ASPECT);
    expect(before.frames.length).toBe(frames);
  });

  it("stops grabbing once the target is met", () => {
    let cap: SweepCapture = EMPTY_CAPTURE;
    let grabs = 0;
    const grab = (q: Point[], w: number, h: number) => { grabs++; return grabOk(q, w, h); };
    for (let i = 0; i < SWEEP_DEFAULTS.target + 5; i++) {
      cap = offerFrame(cap, sample({ quad: asPoints(quad(i * 40)) }), asPoints(quad(i * 40)), grab, CARD_ASPECT).capture;
    }
    expect(cap.frames).toHaveLength(SWEEP_DEFAULTS.target);
    expect(grabs).toBe(SWEEP_DEFAULTS.target);
  });
});

describe("finishSweep", () => {
  function runOf(n: number): SweepCapture {
    let cap: SweepCapture = EMPTY_CAPTURE;
    for (let i = 0; i < n; i++) {
      const q = asPoints(quad(i * 40));
      cap = offerFrame(cap, sample({ quad: q }), q, grabOk, CARD_ASPECT).capture;
    }
    return cap;
  }

  it("produces both composites from one run", () => {
    const out = finishSweep(runOf(4))!;
    expect(out.clean.report.w).toBe(out.w);
    expect(out.surface.report.w).toBe(out.w);
    expect(out.clean.data.length).toBe(out.w * out.h * 4);
    expect(out.surface.data.length).toBe(out.w * out.h * 4);
  });

  // An abandoned sweep still did work; refusing to composite it would throw that
  // work away.
  it("composites an incomplete run rather than refusing", () => {
    expect(finishSweep(runOf(3))).not.toBeNull();
  });

  it("returns null when there is nothing to composite", () => {
    expect(finishSweep(EMPTY_CAPTURE)).toBeNull();
  });

  // Identical grey frames: nothing to choose between them, and no light raked
  // across anything. BOTH verdicts must be false rather than presenting a
  // no-op as an enhanced photo and a flat view as a defect map.
  it("refuses to call identical frames enhanced, or a flat view a surface map", () => {
    const out = finishSweep(runOf(5))!;
    expect(out.cleanWorthKeeping).toBe(false);
    expect(out.surfaceWorthKeeping).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { stackFrames, stackWorthKeeping, stackAdvice, clippedFraction, type StackFrame } from "@/lib/cards/stack";

const W = 20, H = 20;

/** A frame of flat diffuse colour, optionally with a white specular blob. */
function frame(
  colour: [number, number, number],
  blob?: { x: number; y: number; r: number },
  opts: { gain?: number; invalid?: (x: number, y: number) => boolean } = {},
): StackFrame {
  const d = new Uint8ClampedArray(W * H * 4);
  const g = opts.gain ?? 1;
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (opts.invalid?.(x, y)) { d[i + 3] = 0; continue; }
      const inBlob = blob && Math.hypot(x - blob.x, y - blob.y) <= blob.r;
      // Specular reflection ADDS the source's colour on top of the diffuse
      // colour — which is why it raises the smallest channel.
      const [r, gr, b] = inBlob ? [250, 250, 250] : colour;
      d[i] = Math.round(r * g); d[i + 1] = Math.round(gr * g); d[i + 2] = Math.round(b * g);
      d[i + 3] = 255;
      sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; n++;
    }
  }
  return { data: d, median: n ? Math.round(sum / n) : null };
}

const at = (d: Uint8ClampedArray, x: number, y: number) =>
  [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]];

describe("stackFrames — the physics it exists for", () => {
  // A glare blob that MOVES is what a sweep produces, and every point is seen
  // clean by some frame. That is the whole premise.
  it("removes a glare blob that moves between frames", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const out = stackFrames([
      frame(RED, { x: 4, y: 10, r: 3 }),
      frame(RED, { x: 10, y: 10, r: 3 }),
      frame(RED, { x: 16, y: 10, r: 3 }),
    ], W, H)!;
    // Each blob centre recovered the diffuse red from another frame.
    for (const x of [4, 10, 16]) {
      const [r, g, b] = at(out.data, x, 10);
      expect(r).toBeGreaterThan(150);
      expect(g).toBeLessThan(80);
      expect(b).toBeLessThan(80);
    }
    expect(out.report.unresolved).toBeLessThan(0.01);
    expect(out.report.framesUsed).toBeGreaterThan(1);
  });

  // THE HONEST CASE. A light source too broad to escape sits in the same place in
  // every frame, and no amount of stacking recovers it. Reporting this is worth
  // more than the composite — it points at the lamp instead of the sweep.
  it("reports the fraction it could NOT fix when the glare never moves", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const fixed = { x: 10, y: 10, r: 4 };
    const out = stackFrames([frame(RED, fixed), frame(RED, fixed), frame(RED, fixed)], W, H)!;
    expect(out.report.unresolved).toBeGreaterThan(0.05);
    expect(stackAdvice(out.report)).toContain("every angle caught it");
  });

  // Taking each channel's min independently would pull R from one frame and B
  // from another and shift the card's colour — worse than the glare, because it
  // is a wrong number rather than an obvious flaw.
  it("takes the whole pixel from one frame, so colour cannot be mixed", () => {
    const a = frame([200, 30, 30]);
    const b = frame([30, 200, 30]);
    const out = stackFrames([a, b], W, H)!;
    const [r, g, bl] = at(out.data, 10, 10);
    // Whichever frame won, the result is one of the two inputs — never (30,30,30).
    const isA = r > 150 && g < 60 && bl < 60;
    const isB = g > 150 && r < 60 && bl < 60;
    expect(isA || isB).toBe(true);
  });
});

describe("stackFrames — exposure drift", () => {
  // Without normalisation, "least specular" degenerates into "darkest frame
  // wins" and the composite is just the worst-exposed frame.
  it("normalises so a merely-darker frame doesn't win everywhere", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const bright = frame(RED, { x: 5, y: 10, r: 3 }, { gain: 1 });
    const dark = frame(RED, { x: 15, y: 10, r: 3 }, { gain: 0.75 });
    const out = stackFrames([bright, dark], W, H)!;
    // A clean point far from both blobs should come back near the true diffuse
    // value, not 25% dark.
    const [r] = at(out.data, 10, 2);
    expect(r).toBeGreaterThan(150);
  });

  it("still works when no medians are supplied", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const a = { data: frame(RED, { x: 5, y: 10, r: 3 }).data };
    const b = { data: frame(RED, { x: 15, y: 10, r: 3 }).data };
    const out = stackFrames([a, b], W, H)!;
    expect(out.report.unresolved).toBeLessThan(0.01);
  });
});

describe("stackFrames — validity, not transparency", () => {
  // Treating an off-frame pixel as black is how a min-operator paints a dark
  // band down the side of a composite.
  it("ignores pixels a frame did not cover instead of reading them as black", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const full = frame(RED);
    const holed = frame(RED, undefined, { invalid: (x) => x < 5 });
    const out = stackFrames([full, holed], W, H)!;
    const [r] = at(out.data, 2, 10); // inside the hole
    expect(r).toBeGreaterThan(150);   // came from the full frame, not black
    expect(out.report.uncovered).toBe(0);
  });

  it("counts pixels NO frame covered", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const a = frame(RED, undefined, { invalid: (x) => x < 5 });
    const b = frame(RED, undefined, { invalid: (x) => x < 5 });
    const out = stackFrames([a, b], W, H)!;
    expect(out.report.uncovered).toBeCloseTo(5 / W, 2);
    expect(stackAdvice(out.report)).toContain("wasn't in every shot");
  });
});

describe("stackFrames — degenerate inputs", () => {
  // With ONE frame nothing about the glare is knowable — "every angle caught it"
  // would be a claim about a single angle. The advice must say the sweep is
  // missing, not diagnose the light.
  it("returns a single frame unchanged, and blames the sweep rather than the light", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const out = stackFrames([frame(RED, { x: 10, y: 10, r: 3 })], W, H)!;
    expect(out.report.framesUsed).toBe(1);
    expect(out.report.improved).toBe(0);
    expect(out.report.meanDepth).toBeCloseTo(1, 5);
    const advice = stackAdvice(out.report)!;
    expect(advice).toContain("Only one shot");
    expect(advice).not.toContain("every angle");
  });

  // The mirror case, and why `meanDepth` gates the advice instead of
  // `framesUsed`: three identical shots tie so one wins everywhere, yet they DO
  // prove the glare never moved.
  it("diagnoses the light when several identical frames all caught the glare", () => {
    const RED: [number, number, number] = [180, 40, 40];
    const fixed = { x: 10, y: 10, r: 4 };
    const out = stackFrames([frame(RED, fixed), frame(RED, fixed), frame(RED, fixed)], W, H)!;
    expect(out.report.framesUsed).toBe(1);      // ties go to the first
    expect(out.report.meanDepth).toBeCloseTo(3, 5); // but three were available
    expect(stackAdvice(out.report)).toContain("every angle caught it");
  });

  it("returns null only when there is nothing to work with", () => {
    expect(stackFrames([], W, H)).toBeNull();
    expect(stackFrames([frame([1, 2, 3])], 0, H)).toBeNull();
    // A buffer too small for the stated dimensions.
    expect(stackFrames([{ data: new Uint8ClampedArray(16) }], W, H)).toBeNull();
  });
});

describe("stackWorthKeeping", () => {
  // A sweep where the phone barely moved yields a slightly noisier copy of one
  // frame. Shipping that as "enhanced" is a claim the pixels don't support.
  it("rejects a composite that changed almost nothing", () => {
    expect(stackWorthKeeping({ w: 1, h: 1, framesUsed: 4, unresolved: 0, improved: 0.001, uncovered: 0, meanDepth: 4 })).toBe(false);
  });

  it("rejects a single-frame result", () => {
    expect(stackWorthKeeping({ w: 1, h: 1, framesUsed: 1, unresolved: 0, improved: 0.5, uncovered: 0, meanDepth: 1 })).toBe(false);
  });

  it("rejects one with real registration gaps", () => {
    expect(stackWorthKeeping({ w: 1, h: 1, framesUsed: 4, unresolved: 0, improved: 0.4, uncovered: 0.1, meanDepth: 3 })).toBe(false);
  });

  it("keeps one that genuinely merged", () => {
    expect(stackWorthKeeping({ w: 1, h: 1, framesUsed: 5, unresolved: 0.001, improved: 0.2, uncovered: 0, meanDepth: 4.6 })).toBe(true);
  });

  // Unresolved glare doesn't make the composite worthless — it is still the best
  // available image, it just must not be described as clean.
  it("keeps a composite that merged well but couldn't clear every patch", () => {
    expect(stackWorthKeeping({ w: 1, h: 1, framesUsed: 5, unresolved: 0.08, improved: 0.2, uncovered: 0, meanDepth: 4.6 })).toBe(true);
  });
});

describe("stackAdvice", () => {
  it("says nothing when the composite is simply fine", () => {
    expect(stackAdvice({ w: 1, h: 1, framesUsed: 6, unresolved: 0.001, improved: 0.3, uncovered: 0, meanDepth: 5.5 })).toBeNull();
  });

  // Ordered worst-first: a registration failure explains a bad result better
  // than a glare figure computed from the pixels it did manage to cover.
  it("leads with coverage when both coverage and glare are bad", () => {
    const a = stackAdvice({ w: 1, h: 1, framesUsed: 4, unresolved: 0.3, improved: 0.1, uncovered: 0.2, meanDepth: 2 });
    expect(a).toContain("wasn't in every shot");
  });
});

describe("clippedFraction", () => {
  it("measures blown-out pixels on max(R,G,B) and skips invalid ones", () => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      // A warm-lamp reflection: red and green dead, blue alive. Luma is only
      // 242, so a luma test would call this fine — see exposure.ts.
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 140; d[i + 3] = p < 100 ? 0 : 255;
    }
    const r = clippedFraction(d, W, H)!;
    expect(r.fraction).toBe(1);
    expect(r.sampled).toBe(W * H - 100); // invalid pixels excluded
  });

  it("returns null when there is nothing to measure", () => {
    expect(clippedFraction(new Uint8ClampedArray(W * H * 4), W, H, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });
});

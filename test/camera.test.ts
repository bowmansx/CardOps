import { describe, it, expect } from "vitest";
import {
  withMargin, sharpness, frameDelta, shouldAutoSnap, pickSharpest,
  AUTO_SNAP_DEFAULTS, CARD_ASPECT,
} from "@/lib/cards/camera";

describe("withMargin — the edge-integrity rule", () => {
  const bounds = { w: 1000, h: 1000 };

  it("grows the crop on all four sides", () => {
    const r = withMargin({ x: 100, y: 100, w: 200, h: 300 }, 0.1, bounds);
    expect(r).toEqual({ x: 80, y: 70, w: 240, h: 360 });
  });

  // A crop that runs to the frame boundary hides whether the edge is the
  // card's or the crop's — which is exactly the manipulation risk.
  it("clamps to the frame instead of going negative", () => {
    const r = withMargin({ x: 5, y: 5, w: 100, h: 100 }, 0.5, bounds);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBeGreaterThan(100);
  });

  it("never exceeds the frame on the far side", () => {
    const r = withMargin({ x: 900, y: 900, w: 100, h: 100 }, 0.5, bounds);
    expect(r.x + r.w).toBeLessThanOrEqual(bounds.w);
    expect(r.y + r.h).toBeLessThanOrEqual(bounds.h);
  });

  it("a zero margin is identity", () => {
    const rect = { x: 10, y: 20, w: 30, h: 40 };
    expect(withMargin(rect, 0, bounds)).toEqual(rect);
  });
});

// A 4x5 grayscale helper.
const flat = (v: number, w = 8, h = 8) => new Uint8ClampedArray(w * h).fill(v);
function checker(w = 8, h = 8): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = (x + y) % 2 ? 255 : 0;
  return a;
}

describe("sharpness", () => {
  it("is zero on a flat field — nothing to focus on", () => {
    expect(sharpness(flat(128), 8, 8)).toBe(0);
  });

  it("is large on high-frequency detail", () => {
    expect(sharpness(checker(), 8, 8)).toBeGreaterThan(1000);
  });

  it("ranks a sharp frame above a blurred one", () => {
    const sharp = checker(16, 16);
    // crude blur: average each pixel with its right neighbour
    const blur = new Uint8ClampedArray(sharp.length);
    for (let i = 0; i < sharp.length - 1; i++) blur[i] = (sharp[i] + sharp[i + 1]) / 2;
    expect(sharpness(sharp, 16, 16)).toBeGreaterThan(sharpness(blur, 16, 16));
  });

  it("degrades safely on a buffer too small to convolve", () => {
    expect(sharpness(flat(10, 2, 2), 2, 2)).toBe(0);
  });
});

describe("frameDelta", () => {
  it("is zero for identical frames", () => {
    expect(frameDelta(flat(100), flat(100))).toBe(0);
  });
  it("grows with movement", () => {
    expect(frameDelta(flat(100), flat(140))).toBe(40);
  });
  it("treats an empty buffer as maximally unstable rather than stable", () => {
    expect(frameDelta(new Uint8ClampedArray(0), new Uint8ClampedArray(0))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("shouldAutoSnap", () => {
  const good = { sharp: 100, delta: 1 };
  const blurry = { sharp: 10, delta: 1 };
  const moving = { sharp: 100, delta: 20 };

  it("fires after enough consecutive good frames", () => {
    expect(shouldAutoSnap(Array(AUTO_SNAP_DEFAULTS.stableFrames).fill(good))).toBe(true);
  });

  it("waits until it has enough history", () => {
    expect(shouldAutoSnap([good, good])).toBe(false);
  });

  // The point of requiring CONSECUTIVE frames: one sharp frame happens while
  // sweeping the phone across a table, and would fire on the wrong card.
  it("does not fire when a recent frame was blurred", () => {
    const recent = [good, good, blurry, good];
    expect(shouldAutoSnap(recent)).toBe(false);
  });

  it("does not fire while the hands are still moving", () => {
    expect(shouldAutoSnap([good, good, good, moving])).toBe(false);
  });
});

describe("pickSharpest", () => {
  it("returns the sharpest frame of a burst", () => {
    expect(pickSharpest([{ sharp: 1 }, { sharp: 9 }, { sharp: 4 }])).toEqual({ sharp: 9 });
  });
  it("returns null for an empty burst rather than throwing", () => {
    expect(pickSharpest([])).toBeNull();
  });
});

describe("aspect constants", () => {
  it("a raw card is taller than it is wide", () => {
    expect(CARD_ASPECT).toBeLessThan(1);
    expect(CARD_ASPECT).toBeCloseTo(0.714, 3);
  });
});

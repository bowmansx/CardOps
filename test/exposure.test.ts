import { describe, it, expect } from "vitest";
import { clipFraction, globalMedian, readGlare, glareAdvice } from "@/lib/cards/exposure";

const W = 40, H = 30;

/** An RGBA buffer filled with one colour. */
function solid(r: number, g: number, b: number, w = W, h = H) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255;
  }
  return a;
}

/** Paint a rectangle into an RGBA buffer. */
function blot(a: Uint8ClampedArray, w: number, r: { x: number; y: number; w: number; h: number },
              col: [number, number, number]) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * w + x) * 4;
      a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = 255;
    }
  }
  return a;
}

describe("clipFraction", () => {
  // THE REASON IT IS max(R,G,B) AND NOT LUMA. A warm desk lamp's reflection
  // reads about (255,255,140): red and green are completely dead, that detail
  // is gone for good — and its luma is 242, under any sensible luma threshold.
  // A luma test calls the commonest form of indoor glare "fine".
  it("catches a warm lamp reflection that a luma test would miss", () => {
    const buf = blot(solid(60, 60, 60), W, { x: 0, y: 0, w: 20, h: 30 }, [255, 255, 140]);
    const luma = 255 * 0.299 + 255 * 0.587 + 140 * 0.114;
    expect(luma).toBeLessThan(254); // a luma test would see nothing
    expect(clipFraction(buf, W, H)!.fraction).toBeCloseTo(0.5, 2);
  });

  it("does not flag merely bright pixels", () => {
    expect(clipFraction(solid(250, 250, 250), W, H)!.fraction).toBe(0);
  });

  it("measures only inside the rect it was given", () => {
    const buf = blot(solid(10, 10, 10), W, { x: 0, y: 0, w: 20, h: 30 }, [255, 255, 255]);
    expect(clipFraction(buf, W, H, { x: 20, y: 0, w: 20, h: 30 })!.fraction).toBe(0);
    expect(clipFraction(buf, W, H, { x: 0, y: 0, w: 20, h: 30 })!.fraction).toBe(1);
  });

  // No reading and a reading of zero are different facts, and a guidance UI
  // must never show a clean number it did not take.
  it("returns null rather than zero when there is nothing to measure", () => {
    expect(clipFraction(solid(0, 0, 0), W, H, { x: 100, y: 100, w: 5, h: 5 })).toBeNull();
    expect(clipFraction(new Uint8ClampedArray(4), W, H)).toBeNull();
  });
});

describe("globalMedian", () => {
  it("reads the middle of the distribution", () => {
    expect(globalMedian(solid(128, 128, 128), W, H)).toBe(128);
  });

  // A growing glare blob drags a MEAN upward, which would read as the exposure
  // falling — exactly backwards. The median ignores it until it takes half the
  // frame.
  it("is not dragged by a bright blob the way a mean would be", () => {
    const dark = solid(60, 60, 60);
    const withBlob = blot(solid(60, 60, 60), W, { x: 0, y: 0, w: 12, h: 30 }, [255, 255, 255]);
    expect(globalMedian(withBlob, W, H)).toBe(globalMedian(dark, W, H));
  });

  it("returns null when the rect is outside the buffer", () => {
    expect(globalMedian(solid(100, 100, 100), W, H, { x: 999, y: 999, w: 4, h: 4 })).toBeNull();
  });
});

describe("readGlare", () => {
  const run = (clips: number[], meds?: number[]) =>
    clips.map((c, i) => ({ clip: c, median: meds?.[i] ?? 120 }));

  // The verdict that saves the most time, and the reason this module exists
  // before any compositor does. Clipping that never drops as the phone moves
  // is a reflection of a source too broad to escape, and telling someone to
  // sweep harder is telling them to waste fifteen seconds.
  it("calls a glare that never moves FIXED", () => {
    const r = readGlare(run([0.09, 0.10, 0.088, 0.095, 0.10, 0.092, 0.098, 0.091]));
    expect(r.verdict).toBe("fixed");
    expect(glareAdvice(r)).toMatch(/too broad to sweep around/);
  });

  it("calls a glare that clears at some angle CLEARABLE", () => {
    const r = readGlare(run([0.12, 0.09, 0.04, 0.0005, 0.03, 0.08, 0.11, 0.06]));
    expect(r.verdict).toBe("clearable");
  });

  it("calls a partial escape PARTLY", () => {
    const r = readGlare(run([0.12, 0.10, 0.05, 0.03, 0.04, 0.09, 0.11, 0.06]));
    expect(r.verdict).toBe("partly");
  });

  it("says clearable when there was no glare to begin with", () => {
    const r = readGlare(run([0, 0, 0.0001, 0, 0, 0, 0, 0]));
    expect(r.verdict).toBe("clearable");
    expect(glareAdvice(r)).toBeNull();
  });

  // Too few samples cannot tell a fixed reflection from one nobody tried to
  // move off. Silence beats a guess.
  it("refuses a verdict on too little evidence", () => {
    expect(readGlare(run([0.1, 0.1, 0.1])).verdict).toBe("unknown");
    expect(readGlare([]).verdict).toBe("unknown");
    expect(glareAdvice(readGlare(run([0.1, 0.1])))).toBeNull();
  });

  it("reports exposure drift across the run", () => {
    const r = readGlare(run([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
                            [110, 118, 131, 140, 138, 126, 119, 112]));
    expect(r.drift).toBe(30);
  });
});

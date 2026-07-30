import { describe, it, expect } from "vitest";
import {
  homographyFromQuads, applyHomography, orderQuad, warpQuadToRect, outputSizeFor,
  type Point,
} from "@/lib/cards/homography";

const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

const SQUARE: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe("homographyFromQuads", () => {
  it("finds the identity when the quads match", () => {
    const h = homographyFromQuads(SQUARE, SQUARE)!;
    for (const p of [{ x: 3, y: 7 }, { x: 0, y: 0 }, { x: 10, y: 10 }]) {
      const q = applyHomography(h, p)!;
      near(q.x, p.x); near(q.y, p.y);
    }
  });

  it("finds a pure scale", () => {
    const h = homographyFromQuads(SQUARE, SQUARE.map((p) => ({ x: p.x * 2, y: p.y * 3 })))!;
    const q = applyHomography(h, { x: 5, y: 5 })!;
    near(q.x, 10); near(q.y, 15);
  });

  it("finds a translation", () => {
    const h = homographyFromQuads(SQUARE, SQUARE.map((p) => ({ x: p.x + 4, y: p.y - 2 })))!;
    const q = applyHomography(h, { x: 1, y: 1 })!;
    near(q.x, 5); near(q.y, -1);
  });

  // The real case: a hand-held card is a keystone, not a rectangle.
  it("maps a genuine keystone exactly at its corners", () => {
    const keystone: Point[] = [{ x: 2, y: 0 }, { x: 8, y: 1 }, { x: 10, y: 10 }, { x: 0, y: 9 }];
    const h = homographyFromQuads(keystone, SQUARE)!;
    keystone.forEach((k, i) => {
      const q = applyHomography(h, k)!;
      near(q.x, SQUARE[i].x, 1e-5); near(q.y, SQUARE[i].y, 1e-5);
    });
  });

  it("round-trips through its own inverse mapping", () => {
    const keystone: Point[] = [{ x: 2, y: 0 }, { x: 8, y: 1 }, { x: 10, y: 10 }, { x: 0, y: 9 }];
    const fwd = homographyFromQuads(keystone, SQUARE)!;
    const back = homographyFromQuads(SQUARE, keystone)!;
    const p = { x: 5, y: 4 };
    const there = applyHomography(fwd, p)!;
    const home = applyHomography(back, there)!;
    near(home.x, p.x, 1e-5); near(home.y, p.y, 1e-5);
  });

  // Partial pivoting exists for exactly this: an axis-aligned quad puts zeros on
  // the diagonal, and it is the COMMON case because we ask users to shoot square.
  it("handles an axis-aligned quad without dividing by zero", () => {
    expect(homographyFromQuads(SQUARE, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 28 }, { x: 0, y: 28 }])).not.toBeNull();
  });

  it("refuses a degenerate quad rather than smearing the frame", () => {
    // Three collinear points can't determine a plane map.
    expect(homographyFromQuads([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], SQUARE)).toBeNull();
    // Coincident corners.
    expect(homographyFromQuads([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], SQUARE)).toBeNull();
  });

  it("needs exactly four points", () => {
    expect(homographyFromQuads(SQUARE.slice(0, 3), SQUARE)).toBeNull();
  });
});

describe("orderQuad", () => {
  // A MIRRORED card looks plausible at a glance and is unusable as evidence, so
  // consistent winding matters more than it appears to.
  it("returns TL, TR, BR, BL whatever order it is given", () => {
    const want = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    for (const shuffled of [
      [want[2], want[0], want[3], want[1]],
      [want[3], want[2], want[1], want[0]],
      [want[1], want[3], want[0], want[2]],
    ]) {
      expect(orderQuad(shuffled)).toEqual(want);
    }
  });

  it("orders a rotated quad consistently", () => {
    const rot = [{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }];
    const o = orderQuad(rot)!;
    // Whatever it picks as first, the winding must be clockwise on screen: each
    // step turns the same way.
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const signs = [cross(o[0], o[1], o[2]), cross(o[1], o[2], o[3]), cross(o[2], o[3], o[0])];
    expect(new Set(signs.map(Math.sign)).size).toBe(1);
  });
});

describe("warpQuadToRect", () => {
  /** A frame with a distinctive gradient, so a warp error shows up as wrong values. */
  function gradient(w: number, h: number) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        d[i] = Math.round((x / (w - 1)) * 255);
        d[i + 1] = Math.round((y / (h - 1)) * 255);
        d[i + 2] = 100;
        d[i + 3] = 255;
      }
    }
    return d;
  }

  it("maps a full-frame quad to a same-size rect nearly unchanged", () => {
    const w = 40, h = 40;
    const src = gradient(w, h);
    const out = warpQuadToRect(src, w, h, [
      { x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 },
    ], w, h)!;
    const at = (d: Uint8ClampedArray, x: number, y: number) => d[(y * w + x) * 4];
    expect(Math.abs(at(out.data, 10, 10) - at(src, 10, 10))).toBeLessThanOrEqual(1);
    expect(Math.abs(at(out.data, 30, 20) - at(src, 30, 20))).toBeLessThanOrEqual(1);
  });

  it("marks every output pixel valid when the quad is inside the frame", () => {
    const out = warpQuadToRect(gradient(40, 40), 40, 40, [
      { x: 5, y: 5 }, { x: 34, y: 5 }, { x: 34, y: 34 }, { x: 5, y: 34 },
    ], 20, 28)!;
    let invalid = 0;
    for (let p = 0; p < 20 * 28; p++) if (out.data[p * 4 + 3] === 0) invalid++;
    expect(invalid).toBe(0);
  });

  // ALPHA IS VALIDITY, NOT TRANSPARENCY. Treating an off-frame pixel as black is
  // exactly how a min-operator paints a dark band down the side of a composite.
  it("marks pixels whose source fell outside the frame as invalid", () => {
    const out = warpQuadToRect(gradient(40, 40), 40, 40, [
      { x: -30, y: -30 }, { x: 20, y: -30 }, { x: 20, y: 20 }, { x: -30, y: 20 },
    ], 30, 30)!;
    let invalid = 0;
    for (let p = 0; p < 30 * 30; p++) if (out.data[p * 4 + 3] === 0) invalid++;
    expect(invalid).toBeGreaterThan(0);
  });

  it("rectifies a keystone so opposite edges become parallel", () => {
    const w = 60, h = 60;
    const out = warpQuadToRect(gradient(w, h), w, h,
      [{ x: 10, y: 5 }, { x: 50, y: 12 }, { x: 46, y: 52 }, { x: 6, y: 46 }], 25, 35)!;
    expect(out.w).toBe(25);
    expect(out.h).toBe(35);
    // Corners all resolved to real samples rather than dropping out.
    for (const [x, y] of [[0, 0], [24, 0], [24, 34], [0, 34]]) {
      expect(out.data[(y * 25 + x) * 4 + 3]).toBe(255);
    }
  });

  it("refuses junk input", () => {
    expect(warpQuadToRect(new Uint8ClampedArray(4), 1, 1, SQUARE, 0, 10)).toBeNull();
    expect(warpQuadToRect(new Uint8ClampedArray(10), 40, 40, SQUARE, 10, 10)).toBeNull();
  });
});

describe("outputSizeFor", () => {
  it("sizes from the quad's longest edge and keeps the card aspect", () => {
    const s = outputSizeFor([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 420 }, { x: 0, y: 420 }], 2.5 / 3.5);
    expect(s.h).toBe(420);
    expect(s.w).toBe(300);
  });

  // A composite holds every frame in memory at once, on a phone.
  it("caps the output so a close-up can't blow up memory", () => {
    const s = outputSizeFor([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 5000 }, { x: 0, y: 5000 }], 2.5 / 3.5, 1400);
    expect(s.h).toBe(1400);
  });

  it("floors the output so a tiny detection can't produce a 3px image", () => {
    expect(outputSizeFor([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }, { x: 0, y: 6 }], 2.5 / 3.5).h).toBe(200);
  });
});

import { describe, it, expect } from "vitest";
import {
  sobel, houghLines, quadFromLines, orderQuad, validQuad, intersect,
  frameFill, tiltDegrees, distanceInches, apparentAspect, guessSize,
  focalPx, angleGap, polygonArea, isConvex, detectCard, dist,
  CARD_SIZES, type Point, type Quad,
} from "@/lib/cards/edges";

// ── a synthetic frame: a light quad on a dark ground ───────────────────────
function render(quad: Quad, w: number, h: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h).fill(30);
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) g[y * w + x] = 225;
  return g;
}

const rect = (x: number, y: number, w: number, h: number): Quad => ({
  tl: { x, y }, tr: { x: x + w, y }, br: { x: x + w, y: y + h }, bl: { x, y: y + h },
});

const near = (a: Point, b: Point, tol: number) => dist(a, b) <= tol;

describe("geometry primitives", () => {
  it("intersects two lines", () => {
    const p = intersect({ rho: 10, theta: 0, votes: 1 }, { rho: 20, theta: Math.PI / 2, votes: 1 });
    expect(p!.x).toBeCloseTo(10, 5);
    expect(p!.y).toBeCloseTo(20, 5);
  });

  it("refuses to intersect parallel lines rather than returning infinity", () => {
    expect(intersect({ rho: 10, theta: 0, votes: 1 }, { rho: 50, theta: 0, votes: 1 })).toBeNull();
  });

  it("measures the smallest angle between orientations", () => {
    expect(angleGap(0, Math.PI - 0.01)).toBeCloseTo(0.01, 3);
    expect(angleGap(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("computes polygon area and convexity", () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50);
    expect(isConvex([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
    // A bowtie is not convex and must never pass as a card.
    expect(isConvex([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
  });

  it("orders corners into tl, tr, br, bl however they arrive", () => {
    const q = rect(10, 20, 40, 60);
    const shuffled = [q.br, q.bl, q.tr, q.tl];
    const o = orderQuad(shuffled);
    expect(near(o.tl, q.tl, 0.001)).toBe(true);
    expect(near(o.tr, q.tr, 0.001)).toBe(true);
    expect(near(o.br, q.br, 0.001)).toBe(true);
    expect(near(o.bl, q.bl, 0.001)).toBe(true);
  });
});

describe("validQuad rejects what isn't a card", () => {
  const W = 200, H = 200;
  it("accepts a plausible card", () => {
    expect(validQuad(rect(40, 30, 100, 140), W, H)).toBe(true);
  });
  it("rejects a speck", () => {
    expect(validQuad(rect(10, 10, 8, 10), W, H)).toBe(false);
  });
  it("rejects a sliver", () => {
    expect(validQuad({ tl: { x: 0, y: 0 }, tr: { x: 200, y: 0 }, br: { x: 200, y: 4 }, bl: { x: 0, y: 100 } }, W, H)).toBe(false);
  });
  it("rejects NaN corners instead of propagating them into a HUD", () => {
    const q = rect(10, 10, 100, 100);
    q.tr = { x: NaN, y: 10 };
    expect(validQuad(q, W, H)).toBe(false);
  });
  it("rejects a non-convex quad", () => {
    expect(validQuad({ tl: { x: 10, y: 10 }, tr: { x: 150, y: 10 }, br: { x: 50, y: 60 }, bl: { x: 10, y: 150 } }, W, H)).toBe(false);
  });
});

describe("metrics", () => {
  const W = 400, H = 300;

  it("frameFill is the fraction of the frame covered", () => {
    expect(frameFill(rect(0, 0, 200, 150), W, H)).toBeCloseTo(0.25, 6);
    expect(frameFill(rect(0, 0, 400, 300), W, H)).toBeCloseTo(1, 6);
  });

  // A rectangle photographed square-on has no measurable tilt.
  it("reports ~0 degrees for a head-on card", () => {
    const t = tiltDegrees(rect(100, 50, 120, 168), W, H);
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(2);
  });

  // Foreshortening one side is what tilt looks like in an image.
  it("reports a real angle for a tilted card", () => {
    const q: Quad = {
      tl: { x: 120, y: 60 }, tr: { x: 280, y: 90 },
      br: { x: 280, y: 210 }, bl: { x: 120, y: 240 },
    };
    const t = tiltDegrees(q, W, H);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(5);
    expect(t!).toBeLessThan(89);
  });

  it("never returns NaN for a degenerate quad", () => {
    const q: Quad = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    const t = tiltDegrees(q, W, H);
    expect(t === null || Number.isFinite(t)).toBe(true);
  });

  it("focal length grows as the field of view narrows", () => {
    expect(focalPx(400, 40)).toBeGreaterThan(focalPx(400, 80));
  });

  // The whole point of distance: a card filling less of the frame is further.
  it("distance increases as the card shrinks in frame", () => {
    const close = distanceInches(rect(50, 20, 300, 420), W, "standard")!;
    const far = distanceInches(rect(170, 110, 60, 84), W, "standard")!;
    expect(far).toBeGreaterThan(close);
  });

  it("scales with the card's real size — a slab at the same pixels is further", () => {
    const q = rect(100, 50, 120, 168);
    const asCard = distanceInches(q, W, "standard")!;
    const asSlab = distanceInches(q, W, "slab_psa")!;
    expect(asSlab).toBeGreaterThan(asCard);
  });

  it("returns null rather than a number for a zero-size quad", () => {
    expect(distanceInches(rect(10, 10, 0, 0), W, "standard")).toBeNull();
  });
});

describe("size identification before the card is known", () => {
  it("measures aspect ratio from the quad", () => {
    expect(apparentAspect(rect(0, 0, 250, 350))!).toBeCloseTo(2.5 / 3.5, 3);
  });

  it("tells a standard card from a slab from a tobacco card", () => {
    expect(guessSize(2.5 / 3.5)?.key).toBe("standard");
    expect(guessSize(3.32 / 5.44)?.key).toBe("slab_psa");
    expect(guessSize(1.4375 / 2.625)?.key).toBe("tobacco");
  });

  // The three guessable sizes must stay far enough apart that a pixel of noise
  // can't flip between them — otherwise the distance readout swings by 6%.
  it("the guessable sizes are actually separable", () => {
    const gs = (Object.keys(CARD_SIZES) as (keyof typeof CARD_SIZES)[])
      .filter((k) => CARD_SIZES[k].guessable)
      .map((k) => CARD_SIZES[k].w / CARD_SIZES[k].h)
      .sort((a, b) => a - b);
    // Separation must exceed TWICE the tolerance, or one measurement can sit
    // inside two sizes at once and the tie is broken by rounding.
    for (let i = 1; i < gs.length; i++) expect(gs[i] - gs[i - 1]).toBeGreaterThan(0.03 * 2);
  });

  it("does not try to separate sizes that pixels cannot separate", () => {
    expect(guessSize(2.625 / 3.75)?.key).not.toBe("topps_1952");
    expect(guessSize(3.5 / 5.5)?.key).not.toBe("slab_bgs");
  });

  // Claiming a size that isn't close is how you get a confidently wrong
  // distance on a card that isn't shaped like anything we know.
  // 1.05 is nothing like a card in EITHER orientation — the reciprocal is
  // 0.95, equally unlike one. (1.9 would match a sideways tobacco card, which
  // is correct behaviour, not nonsense.)
  it("returns null when nothing is close enough to claim", () => {
    expect(guessSize(1.05)).toBeNull();
  });

  it("every known size has sane dimensions", () => {
    for (const k of Object.keys(CARD_SIZES) as (keyof typeof CARD_SIZES)[]) {
      const s = CARD_SIZES[k];
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(s.w); // every card is taller than it is wide
    }
  });
});

describe("detection end to end", () => {
  const W = 160, H = 120;

  it("finds a card-shaped rectangle in a synthetic frame", () => {
    const truth = rect(40, 15, 60, 84);
    const d = detectCard(render(truth, W, H), W, H);
    expect(d).not.toBeNull();
    // Within a couple of pixels on a 160px-wide probe frame.
    expect(near(d!.quad.tl, truth.tl, 4)).toBe(true);
    expect(near(d!.quad.br, truth.br, 4)).toBe(true);
  });

  it("reports fill, aspect and a size guess for that card", () => {
    const d = detectCard(render(rect(40, 15, 60, 84), W, H), W, H)!;
    expect(d.fill).toBeGreaterThan(0.2);
    expect(d.fill).toBeLessThan(0.35);
    expect(d.aspect!).toBeCloseTo(60 / 84, 1);
    expect(d.size).toBe("standard");
  });

  // A blank frame has no edges to vote. Returning null is the contract.
  it("returns null on a featureless frame instead of inventing a card", () => {
    expect(detectCard(new Uint8ClampedArray(W * H).fill(128), W, H)).toBeNull();
  });

  it("returns null on a frame too small to mean anything", () => {
    expect(detectCard(new Uint8ClampedArray(8 * 8).fill(0), 8, 8)).toBeNull();
  });

  it("survives pure noise without throwing", () => {
    const g = new Uint8ClampedArray(W * H);
    let seed = 7;
    for (let i = 0; i < g.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; g[i] = seed % 256; }
    expect(() => detectCard(g, W, H)).not.toThrow();
  });
});

describe("hough on a known edge", () => {
  it("finds the four sides of a rectangle", () => {
    const W = 120, H = 120;
    const g = render(rect(30, 30, 60, 60), W, H);
    const { mag, dir } = sobel(g, W, H);
    const lines = houghLines(mag, dir, W, H);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const q = quadFromLines(lines, W, H);
    expect(q).not.toBeNull();
    expect(validQuad(q!, W, H)).toBe(true);
  });

  it("returns nothing when there are fewer than four lines to work with", () => {
    expect(quadFromLines([{ rho: 1, theta: 0, votes: 5 }], 100, 100)).toBeNull();
  });
});

// ── the tests that should have existed the first time ─────────────────────
describe("it must not invent a card", () => {
  const W = 160, H = 120;
  const noise = (seed: number) => {
    const g = new Uint8ClampedArray(W * H);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; g[i] = s % 256; }
    return g;
  };

  // THE BUG: 199 of 200 noise frames used to return a confident Detection,
  // several naming a card size and a distance in inches. Hough votes prove a
  // direction was popular; only edge pixels under the segment prove an edge.
  it("returns null for pure noise, across many seeds", () => {
    let hits = 0;
    for (let s = 1; s <= 60; s++) if (detectCard(noise(s), W, H)) hits++;
    expect(hits).toBe(0);
  });

  it("never reports a distance without a card", () => {
    for (let s = 1; s <= 60; s++) {
      const d = detectCard(noise(s), W, H);
      expect(d?.inches ?? null).toBeNull();
    }
  });

  it("still finds the real card after the tightening", () => {
    const truth = rect(40, 15, 60, 84);
    const d = detectCard(render(truth, W, H), W, H);
    expect(d).not.toBeNull();
    expect(d!.support.filter((v) => v >= 0.55).length).toBe(4);
  });
});

// ── a card is never held perfectly square ─────────────────────────

/**
 * The card as a lens and sensor actually deliver it: the edge ramps across a
 * pixel or two rather than landing on a pixel boundary.
 *
 * THIS MATTERS MORE THAN IT LOOKS. `render` fills each pixel in or out, so a
 * rotated edge becomes literal stair treads whose gradients point along the
 * axes - and the Hough transform then elects axis-aligned lines for a card
 * that is plainly rotated. That is a property of the renderer and of no
 * photograph, and tuning the detector against it would be tuning against a
 * lie. Anything about ROTATION gets tested here, not with `render`.
 */
function renderAA(quad: Quad, w: number, h: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h).fill(30);
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const S = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) if (inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) n++;
      }
      g[y * w + x] = 30 + Math.round((n / (S * S)) * 195);
    }
  }
  return g;
}

const rotate = (q: Quad, deg: number): Quad => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  const cx = (q.tl.x + q.br.x) / 2, cy = (q.tl.y + q.br.y) / 2;
  const t = (p: Point): Point => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * sn,
    y: cy + (p.x - cx) * sn + (p.y - cy) * c,
  });
  return { tl: t(q.tl), tr: t(q.tr), br: t(q.br), bl: t(q.bl) };
};

/** A little sensor grain, so a result is never one lucky rasterisation. */
const grainy = (g: Uint8ClampedArray, seed: number) => {
  let st = seed;
  const out = new Uint8ClampedArray(g.length);
  for (let i = 0; i < g.length; i++) {
    st = (st * 1103515245 + 12345) & 0x7fffffff;
    out[i] = Math.max(0, Math.min(255, g[i] + ((st % 21) - 10)));
  }
  return out;
};

describe("a card held slightly off-square stays found", () => {
  // The real probe: a 192px-wide crop of a portrait guide.
  const W = 192, H = 269;
  const card = rect(30, 40, 130, 182);

  for (const deg of [0, 1, 2, 3.5, 5, 8]) {
    it(`holds the lock at ${deg} degrees`, () => {
      const truth = rotate(card, deg);
      let found = 0;
      for (let seed = 1; seed <= 30; seed++) {
        if (detectCard(grainy(renderAA(truth, W, H), seed), W, H)) found++;
      }
      expect(found).toBeGreaterThanOrEqual(29);
    });
  }

  /**
   * The real defect the search band fixes, and the only regime where it shows.
   *
   * Around 2 degrees the edge straddles two theta bins and the votes split, so
   * the elected line sits off the true edge by more than a fixed one-pixel
   * search band covers. With +/-1 the four sides scored 0.67 / 0.63 / 0.88 /
   * 0.73 against a lit threshold of 0.55 - eight hundredths of margin, which
   * sensor noise erases, and an edge that blinks off and back is what "it does
   * not lock in smoothly" actually looks like.
   */
  it("keeps clear of the lit threshold at the angle a hand actually holds", () => {
    const d = detectCard(renderAA(rotate(card, 2), W, H), W, H);
    expect(d).not.toBeNull();
    expect(Math.min(...d!.support)).toBeGreaterThan(0.75);
  });
});

describe("support and sampled are different facts", () => {
  const W = 192, H = 269;

  it("reports a fully visible card as fully sampled", () => {
    const d = detectCard(renderAA(rect(30, 40, 130, 182), W, H), W, H);
    expect(d).not.toBeNull();
    expect(Math.min(...d!.sampled)).toBeGreaterThanOrEqual(0.9);
    expect(d!.fill).not.toBeNull();
  });

  // "Nothing under this line" and "could not look under this line" used to be
  // reported as the same number - the difference between a thumb over the edge
  // and a card framed tight to the crop. A distance printed off a side nobody
  // measured is exactly the kind of confident wrongness the dashes exist for.
  it("never claims a distance off a side it could not look at", () => {
    const d = detectCard(renderAA(rect(-40, -30, 190, 260), W, H), W, H);
    if (d && d.sampled.some((v) => v < 0.7)) {
      expect(d.inches).toBeNull();
      expect(d.fill).toBeNull();
    }
  });
});

describe("honest nulls", () => {
  it("tiltDegrees returns null for a degenerate quad rather than a confident 90", () => {
    const q: Quad = { tl: { x: 5, y: 5 }, tr: { x: 5, y: 5 }, br: { x: 5, y: 5 }, bl: { x: 5, y: 5 } };
    expect(tiltDegrees(q, 200, 200)).toBeNull();
  });

  // standard (0.714) and 1952 Topps (0.700) are 0.014 apart — far closer than
  // the measurement can resolve. Picking one by pixel noise and then reporting
  // a distance from its dimensions is confident wrongness.
  // Ambiguity is now prevented rather than reported: sizes too close to tell
  // apart are excluded from guessing entirely, so a standard card resolves
  // cleanly and its distance reading is earned.
  it("resolves a standard card without ambiguity", () => {
    const g = guessSize(2.5 / 3.5);
    expect(g!.key).toBe("standard");
    expect(g!.ambiguous).toBe(false);
  });

  it("guessSize matches a card lying sideways", () => {
    const g = guessSize(3.5 / 2.5);
    expect(g).not.toBeNull();
  });

  it("guessSize still refuses a shape that is nothing like a card", () => {
    expect(guessSize(1.05)).toBeNull();
  });

  it("frameFill ignores the part of a card hanging off-screen", () => {
    // Half off the left edge: the visible half is 25% of the frame, not 50%.
    expect(frameFill(rect(-100, 0, 200, 150), 400, 300)).toBeCloseTo(0.125, 3);
  });

  it("refuses a frame too large to process inside a video loop", () => {
    expect(detectCard(new Uint8ClampedArray(1000 * 1000), 1000, 1000)).toBeNull();
  });
});

describe("the FOV axis", () => {
  // The 60-70 degree figure quoted for phone cameras is across the sensor's
  // LONG axis. Feeding it the frame WIDTH is only right in landscape, and a
  // card is shot in portrait — where width is the short side. That mistake
  // made every distance read ~45% low.
  it("focal length is derived from whichever edge is longer", () => {
    const portraitW = 192, portraitH = 341;
    const wrong = focalPx(portraitW);            // the old behaviour
    const right = focalPx(Math.max(portraitW, portraitH));
    expect(right).toBeGreaterThan(wrong * 1.7);
  });

  it("a longer focal reports a greater distance for the same pixels", () => {
    const q = rect(60, 100, 60, 84);
    const short = distanceInches(q, 192, "standard", 65, focalPx(192))!;
    const long = distanceInches(q, 192, "standard", 65, focalPx(341))!;
    expect(long).toBeGreaterThan(short);
  });

  it("still works with no focal passed, treating w as the long edge", () => {
    expect(distanceInches(rect(60, 100, 60, 84), 192, "standard")).not.toBeNull();
  });
});

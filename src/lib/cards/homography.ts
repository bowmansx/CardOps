// PLANAR REGISTRATION (2026-07-29) — the piece that makes frame stacking possible.
//
// Combining frames assumes the same point on the card sits at the same pixel in
// every one of them. Handheld, it never does: the phone drifts, and the whole
// point of a glare sweep is that you DELIBERATELY change the angle between
// frames. Unregistered frames composited together produce a soft double-exposed
// mess, and the darker "min" family of operators turns every misalignment into a
// dark fringe.
//
// THE REGISTRATION IS ALREADY PAID FOR. General stacking needs feature matching
// — expensive, fiddly, and prone to locking onto the glare itself, which is the
// brightest structure in the frame. We don't need it: a trading card is a flat
// rectangle, `edges.ts` already finds its four corners per frame, and four point
// correspondences on a plane determine a projective transform exactly. So each
// frame warps straight onto a canonical rectangle and every frame lands in the
// same coordinate space by construction.
//
// A homography also corrects the perspective keystone for free — the reason a
// hand-held card photo has slightly non-parallel edges — so the composite comes
// out rectified as well as stacked.
//
// Pure math over pixel buffers. No DOM, no canvas, testable without a camera.

/** Row-major 3x3, with h22 fixed at 1. Eight degrees of freedom. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export type Point = { x: number; y: number };

/**
 * Solve a dense linear system by Gaussian elimination with partial pivoting.
 *
 * Partial pivoting is not optional here. Without it, a card whose quad is
 * axis-aligned produces zeros on the diagonal and the naive elimination divides
 * by zero — which is the common case, not the rare one, because a card
 * photographed squarely is what we ask the user for.
 */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Work on copies; callers reuse their arrays across frames.
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null; // singular — degenerate quad
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const d = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * The projective transform taking each `from[i]` to `to[i]`.
 *
 * For a correspondence (x,y) -> (u,v):
 *   u = (h0·x + h1·y + h2) / (h6·x + h7·y + 1)
 *   v = (h3·x + h4·y + h5) / (h6·x + h7·y + 1)
 * Cross-multiplying gives two linear rows per point, so four points determine
 * all eight unknowns exactly — no least-squares, no iteration.
 *
 * Returns null for a degenerate quad (collinear or coincident corners) rather
 * than a transform that would smear the frame across the output.
 */
export function homographyFromQuads(from: Point[], to: Point[]): Homography | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solve(a, b);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as const;
}

/** Apply a homography to a point. Null when the point maps to infinity. */
export function applyHomography(h: Homography, p: Point): Point | null {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(d) < 1e-12) return null;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

/**
 * Corners ordered top-left, top-right, bottom-right, bottom-left.
 *
 * Order is everything: the same four points in a different order is a valid
 * homography that rotates or MIRRORS the card, and a mirrored card looks
 * plausible at a glance while being unusable as evidence. Sorting by angle about
 * the centroid gives a consistent winding no matter how the detector found them.
 */
export function orderQuad(pts: Point[]): Point[] | null {
  if (pts.length !== 4) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  // atan2 measured with y DOWN (image coordinates), so increasing angle runs
  // clockwise on screen and the sequence starts in the top-left quadrant.
  const withAngle = pts.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }));
  const start = -Math.PI * 0.75; // pointing up-left
  withAngle.sort((m, n) => norm(m.a - start) - norm(n.a - start));
  return withAngle.map((w) => w.p);
}

const norm = (a: number) => {
  let x = a;
  while (x < 0) x += Math.PI * 2;
  while (x >= Math.PI * 2) x -= Math.PI * 2;
  return x;
};

/**
 * Warp an RGBA frame so the given quad fills an `outW x outH` rectangle.
 *
 * Samples BACKWARDS — for each output pixel, find where it came from in the
 * source — which is what guarantees every output pixel is written. Forward
 * mapping leaves unfilled holes wherever the transform expands.
 *
 * Bilinear, because nearest-neighbour aliases the card's print dots into moiré
 * and this output is meant to be evidence.
 *
 * The alpha channel carries VALIDITY, not transparency: 0 marks an output pixel
 * whose source fell outside the frame. The compositor must skip those — treating
 * an off-frame pixel as black is exactly how a "min" operator paints a dark band
 * down the side of a composite.
 */
export function warpQuadToRect(
  rgba: Uint8ClampedArray, w: number, h: number,
  quad: Point[], outW: number, outH: number,
): { data: Uint8ClampedArray; w: number; h: number } | null {
  if (outW < 1 || outH < 1 || rgba.length < w * h * 4) return null;
  const ordered = orderQuad(quad);
  if (!ordered) return null;
  // Solve OUTPUT -> SOURCE directly, so no matrix inversion is needed.
  const dst: Point[] = [
    { x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 },
  ];
  const hMat = homographyFromQuads(dst, ordered);
  if (!hMat) return null;

  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 4;
      const s = applyHomography(hMat, { x, y });
      if (!s) continue; // alpha stays 0 — invalid
      const sx = s.x, sy = s.y;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx;
        const bot = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx;
        out[o + c] = Math.round(top * (1 - fy) + bot * fy);
      }
      out[o + 3] = 255; // valid
    }
  }
  return { data: out, w: outW, h: outH };
}

/**
 * The output size to warp into, for a card of a given aspect.
 *
 * Driven by the quad's own longest edge so a close-up frame isn't upsampled into
 * false detail and a distant one isn't thrown away. Capped, because a composite
 * holds every frame in memory at once and this runs on a phone.
 */
export function outputSizeFor(quad: Point[], aspect: number, cap = 1400): { w: number; h: number } {
  const ordered = orderQuad(quad) ?? quad;
  const edge = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const longest = Math.max(
    edge(ordered[0], ordered[1]), edge(ordered[1], ordered[2]),
    edge(ordered[2], ordered[3]), edge(ordered[3], ordered[0]),
  );
  // aspect = width / height, and the long side of a card is its height.
  const hOut = Math.min(cap, Math.max(200, Math.round(longest)));
  return { w: Math.max(1, Math.round(hOut * aspect)), h: hOut };
}

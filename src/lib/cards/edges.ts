// Card edge detection (Beau, 2026-07-26). Pure, unit-tested, no DOM —
// CameraSheet feeds it pixels and draws the result.
//
// THE KEYSTONE. Finding the card's four edges in a live frame is what makes
// four separate things possible at once:
//
//   1. Distance   — the card's real-world size vs how much of the frame it
//                   fills. A trading card has known dimensions, so pixels
//                   convert to inches.
//   2. Angle      — a rectangle photographed off-axis becomes a trapezoid;
//                   the skew encodes the viewing angle exactly.
//   3. Deskew     — warping the quad back to a rectangle, so a photo taken at
//                   a slight angle looks scanned.
//   4. Lock-on    — drawing the detected outline live on the viewfinder.
//
// WHY HOUGH AND NOT CONTOURS. Hough votes on edge FRAGMENTS, so a finger
// across the middle of a side still leaves enough of that side to fit a line.
// Contour-finding needs a closed boundary and fails the moment a hand touches
// the card — which is how people actually hold them.
//
// WHAT IT STILL CANNOT DO. A vanishing point requires two lines that are
// PARALLEL IN THE WORLD: left+right give one, top+bottom give the other, and
// the plane's orientation needs both. So angle needs a visible fragment of all
// FOUR sides. Fragments can be short and corners can be hidden, but a hand
// covering an entire side means no angle — the code returns null rather than a
// number, because a confident wrong angle is worse than none.

export type Point = { x: number; y: number };
export type Quad = { tl: Point; tr: Point; br: Point; bl: Point };

/** A line in normal form: x·cos(theta) + y·sin(theta) = rho. */
export type Line = { rho: number; theta: number; votes: number };

/** Card sizes in inches. Deviations are real and matter for distance. */
export const CARD_SIZES = {
  standard: { w: 2.5, h: 3.5, label: "Standard", guessable: true },
  tobacco: { w: 1.4375, h: 2.625, label: "Tobacco (T206 era)", guessable: true },
  slab_psa: { w: 3.32, h: 5.44, label: "PSA slab", guessable: true },
  // NOT guessable: their aspect ratios sit closer to a guessable neighbour
  // than any measurement can resolve — 1952 Topps is 0.014 from standard, a
  // BGS slab 0.026 from a PSA one. Their dimensions are here so that once the
  // IDENTITY layer names the card we use exact numbers; guessing between them
  // from pixels would be picking by noise and then reporting the result as a
  // distance in inches.
  topps_1952: { w: 2.625, h: 3.75, label: "1952 Topps", guessable: false },
  slab_bgs: { w: 3.5, h: 5.5, label: "BGS slab", guessable: false },
} as const;
export type CardSizeKey = keyof typeof CARD_SIZES;

// ── gradients ──────────────────────────────────────────────────────────────

/** Sobel magnitude and direction over a grayscale buffer. */
export function sobel(gray: Uint8ClampedArray | Uint8Array, w: number, h: number):
  { mag: Float32Array; dir: Float32Array } {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1];
      const l = gray[i - 1], r = gray[i + 1];
      const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      mag[i] = Math.hypot(gx, gy);
      dir[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, dir };
}

// ── Hough ──────────────────────────────────────────────────────────────────

const THETA_STEPS = 180;          // 1° resolution
const RHO_STEP = 2;               // pixels per accumulator bin

/**
 * Vote edge pixels into a (rho, theta) accumulator and return peaks.
 *
 * Only pixels above `threshold` vote, and each votes for the ONE theta implied
 * by its gradient direction rather than all 180. That is ~180× cheaper and
 * sharper, which is what makes this viable at video rate on a phone.
 */
export function houghLines(
  mag: Float32Array, dir: Float32Array, w: number, h: number,
  opts: { threshold?: number; maxLines?: number; minVotes?: number } = {},
): Line[] {
  const threshold = opts.threshold ?? 60;
  const maxLines = opts.maxLines ?? 24;
  // ABSOLUTE floor, scaled to the frame. The old default of 8 was dead: the
  // accumulator sums gradient MAGNITUDE and every voting pixel already clears
  // `threshold`, so a single stray pixel beat it 7x over. A real card edge
  // runs across a good part of the frame; noise spreads its votes thinly over
  // every bin, so requiring the equivalent of a quarter of the short side at
  // full edge strength separates them cleanly.
  const minVotes = opts.minVotes ?? 0.25 * Math.min(w, h) * threshold;

  const diag = Math.ceil(Math.hypot(w, h));
  const rhoBins = Math.ceil((2 * diag) / RHO_STEP) + 1;
  const acc = new Float32Array(THETA_STEPS * rhoBins);
  const cos = new Float32Array(THETA_STEPS);
  const sin = new Float32Array(THETA_STEPS);
  for (let t = 0; t < THETA_STEPS; t++) {
    const a = (t * Math.PI) / THETA_STEPS;
    cos[t] = Math.cos(a);
    sin[t] = Math.sin(a);
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < threshold) continue;
      // theta in normal form is the angle of the line's NORMAL, and the
      // gradient IS that normal — no 90-degree turn. Adding one made every
      // pixel of a single edge vote for a different rho.
      let t = Math.round((dir[i] / Math.PI) * THETA_STEPS);
      t = ((t % THETA_STEPS) + THETA_STEPS) % THETA_STEPS;
      // Spread the vote over neighbouring bins — a hard 1° quantisation
      // splits one real edge across two bins and halves its peak.
      for (let dt = -1; dt <= 1; dt++) {
        const tt = ((t + dt) % THETA_STEPS + THETA_STEPS) % THETA_STEPS;
        const rho = x * cos[tt] + y * sin[tt];
        const rb = Math.round((rho + diag) / RHO_STEP);
        if (rb < 0 || rb >= rhoBins) continue;
        acc[tt * rhoBins + rb] += dt === 0 ? m : m * 0.5;
      }
    }
  }

  // Non-maximum suppression, then take the strongest peaks.
  const peaks: Line[] = [];
  for (let t = 0; t < THETA_STEPS; t++) {
    for (let rb = 1; rb < rhoBins - 1; rb++) {
      const v = acc[t * rhoBins + rb];
      if (v < minVotes) continue;
      if (v < acc[t * rhoBins + rb - 1] || v < acc[t * rhoBins + rb + 1]) continue;
      const tPrev = (t - 1 + THETA_STEPS) % THETA_STEPS;
      const tNext = (t + 1) % THETA_STEPS;
      if (v < acc[tPrev * rhoBins + rb] || v < acc[tNext * rhoBins + rb]) continue;
      peaks.push({ rho: rb * RHO_STEP - diag, theta: (t * Math.PI) / THETA_STEPS, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);

  // Drop near-duplicates: one physical edge produces a cluster of peaks.
  //
  // Compared GEOMETRICALLY, not by (rho, theta) arithmetic. theta wraps at PI,
  // so one edge can surface as theta=0,rho=90 and theta=179deg,rho=-88 — the
  // same line to within a pixel, but 178 apart in rho. Comparing the point on
  // each line closest to the frame centre has no such seam.
  const cx = w / 2, cy = h / 2;
  const kept: Line[] = [];
  for (const p of peaks) {
    if (kept.length >= maxLines) break;
    const fp = footPoint(p, cx, cy);
    const dup = kept.some((k) =>
      angleGap(k.theta, p.theta) < 0.12 && dist(footPoint(k, cx, cy), fp) < 8);
    if (!dup) kept.push(p);
  }
  return kept;
}

/** The point on a line closest to (cx, cy). Seam-free way to compare lines. */
export function footPoint(l: Line, cx: number, cy: number): Point {
  const c = Math.cos(l.theta), s = Math.sin(l.theta);
  const d = cx * c + cy * s - l.rho;
  return { x: cx - d * c, y: cy - d * s };
}

/**
 * Re-express a line so its orientation sits within a right angle of `base`.
 *
 * (rho, theta) and (-rho, theta+PI) are the same line. Mixing both forms in
 * one family makes "which of these is the outermost edge" meaningless, because
 * the sign of rho flips between them.
 */
export function alignTo(l: Line, base: number): Line {
  let theta = l.theta, rho = l.rho;
  while (theta - base > Math.PI / 2) { theta -= Math.PI; rho = -rho; }
  while (base - theta > Math.PI / 2) { theta += Math.PI; rho = -rho; }
  return { rho, theta, votes: l.votes };
}

/** Smallest angle between two undirected line orientations, in radians. */
export function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return d > Math.PI / 2 ? Math.PI - d : d;
}

// ── quad assembly ──────────────────────────────────────────────────────────

/** Where two lines cross. Null when they're too close to parallel to trust. */
export function intersect(a: Line, b: Line): Point | null {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta);
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det,
    y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det,
  };
}

/**
 * Pick the four lines that bound a card and build the quad.
 *
 * Splits candidates into two orientation families (the card's two edge
 * directions), then takes the extreme line on each side of each family — the
 * outermost pair, which is the card's boundary rather than a design element
 * printed on its face.
 */
export function quadFromLines(lines: Line[], w: number, h: number): Quad | null {
  if (lines.length < 4) return null;

  // A card's edges are PERPENDICULAR. Build the two families around the
  // strongest line and its right angle, and discard everything else — the
  // diagonals thrown off by corners are not edges, and letting them into a
  // family is how the outermost-line search picks a 45-degree artifact.
  const TOL = 0.44; // ~25 degrees
  const base = lines[0].theta;
  const famA: Line[] = [];
  const famB: Line[] = [];
  for (const l of lines) {
    if (angleGap(l.theta, base) < TOL) famA.push(alignTo(l, base));
    else if (angleGap(l.theta, base + Math.PI / 2) < TOL) famB.push(alignTo(l, base + Math.PI / 2));
  }
  if (famA.length < 2 || famB.length < 2) return null;

  // A real card edge dominates its family. Anything under a fifth of the
  // family's best is a print detail or a shadow, not the boundary.
  const strong = (fam: Line[]) => {
    const best = Math.max(...fam.map((l) => l.votes));
    return fam.filter((l) => l.votes >= best * 0.2);
  };
  const sa = strong(famA);
  const sb = strong(famB);
  if (sa.length < 2 || sb.length < 2) return null;

  // Signed distance from the frame centre, so "outermost pair" is well defined
  // even when the card is off to one side. Safe now that every member of a
  // family shares one sign convention.
  const cx = w / 2, cy = h / 2;
  const offset = (l: Line) => l.rho - (cx * Math.cos(l.theta) + cy * Math.sin(l.theta));
  const extremes = (fam: Line[]): [Line, Line] | null => {
    let lo = fam[0], hi = fam[0];
    for (const l of fam) {
      if (offset(l) < offset(lo)) lo = l;
      if (offset(l) > offset(hi)) hi = l;
    }
    return lo === hi ? null : [lo, hi];
  };
  const pa = extremes(sa);
  const pb = extremes(sb);
  if (!pa || !pb) return null;

  const pts = [
    intersect(pa[0], pb[0]), intersect(pa[0], pb[1]),
    intersect(pa[1], pb[1]), intersect(pa[1], pb[0]),
  ];
  if (pts.some((p) => p === null)) return null;
  return orderQuad(pts as Point[]);
}


/**
 * Is this line actually an edge BETWEEN these two corners?
 *
 * THE BUG THIS EXISTS FOR: Hough votes belong to an INFINITE line. Scattered
 * pixels anywhere in the frame can elect a line that has nothing under the
 * span we then treat as a card edge — which is why 199 of 200 pure-noise
 * frames used to return a confident card, several with a size and a distance
 * in inches. Votes prove a direction was popular; only this proves an edge is
 * there.
 */
export function segmentSupport(
  a: Point, b: Point, theta: number,
  mag: Float32Array, dir: Float32Array, w: number, h: number,
  threshold: number,
): number {
  const len = dist(a, b);
  if (len < 4) return 0;
  const samples = Math.min(64, Math.max(8, Math.round(len / 2)));
  // Unit normal to the line: the only direction worth searching.
  const nx = Math.cos(theta), ny = Math.sin(theta);
  let hit = 0, counted = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    // Look only ACROSS the line, not in a 3x3 block. A block of nine chances
    // with a loose angle window finds a passing pixel in pure noise about 90%
    // of the time, which is how noise used to score as a fully supported edge.
    let best = 0;
    for (let k = -1; k <= 1; k++) {
      const x = Math.round(px + nx * k), y = Math.round(py + ny * k);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const i2 = y * w + x;
      if (mag[i2] < threshold) continue;
      if (angleGap(dir[i2], theta) > 0.25) continue;
      best = Math.max(best, mag[i2]);
    }
    counted++;
    if (best > 0) hit++;
  }
  return counted ? hit / counted : 0;
}

/** Put four corners in tl, tr, br, bl order regardless of how they arrived. */
export function orderQuad(pts: Point[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const byAngle = [...pts].sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  // Sorted counter-clockwise from -PI; rotate so the top-left is first.
  let best = 0, bestScore = Infinity;
  byAngle.forEach((p, i) => {
    const score = p.x + p.y;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  const r = [0, 1, 2, 3].map((i) => byAngle[(best + i) % 4]);
  // Screen coordinates put y downwards, so ascending atan2 already walks
  // clockwise from the top-left: tl, tr, br, bl.
  return { tl: r[0], tr: r[1], br: r[2], bl: r[3] };
}

/** Reject nonsense before anything downstream trusts it. */
export function validQuad(q: Quad, w: number, h: number, opts: { minFill?: number } = {}): boolean {
  const minFill = opts.minFill ?? 0.03;
  const pts = [q.tl, q.tr, q.br, q.bl];
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  // Allow a little overhang — a card can legitimately run past the frame edge.
  const pad = Math.max(w, h) * 0.5;
  if (pts.some((p) => p.x < -pad || p.y < -pad || p.x > w + pad || p.y > h + pad)) return false;
  if (!isConvex(pts)) return false;
  const area = polygonArea(pts);
  if (area / (w * h) < minFill) return false;
  // A card is never a sliver: opposite sides should be within 4x of each other.
  const top = dist(q.tl, q.tr), bottom = dist(q.bl, q.br);
  const left = dist(q.tl, q.bl), right = dist(q.tr, q.br);
  if (top <= 0 || bottom <= 0 || left <= 0 || right <= 0) return false;
  if (Math.max(top, bottom) / Math.min(top, bottom) > 4) return false;
  if (Math.max(left, right) / Math.min(left, right) > 4) return false;
  return true;
}

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function polygonArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function isConvex(pts: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

// ── metrics ────────────────────────────────────────────────────────────────

/** Fraction of the frame the card covers, 0..1. Dimension-free, so it works
 *  before the card has even been identified. */
export function frameFill(q: Quad, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  // Clip to the frame first. Clamping the ratio afterwards let a card hanging
  // half off-screen report 90% coverage, which reads as perfectly framed.
  const clipped = clipToRect([q.tl, q.tr, q.br, q.bl], w, h);
  if (clipped.length < 3) return 0;
  return Math.min(1, polygonArea(clipped) / (w * h));
}

/** Sutherland-Hodgman clip of a convex polygon to the frame rectangle. */
export function clipToRect(pts: Point[], w: number, h: number): Point[] {
  const edges: [(p: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [(p) => p.x >= 0, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= w, (a, b) => ({ x: w, y: a.y + ((b.y - a.y) * (w - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= 0, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [(p) => p.y <= h, (a, b) => ({ x: a.x + ((b.x - a.x) * (h - a.y)) / (b.y - a.y), y: h })],
  ];
  let out = pts;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

/**
 * Focal length in pixels, from the horizontal field of view.
 *
 * Phone cameras cluster around 60-70° horizontal FOV; 65 is a reasonable
 * default and the error it introduces is a few percent, not a factor. When a
 * device reports its real FOV, pass it — and every reading gets better.
 */
export function focalPx(frameWidth: number, fovDegrees = 65): number {
  return frameWidth / 2 / Math.tan((fovDegrees * Math.PI) / 360);
}

/**
 * Viewing angle in degrees: 0 = looking straight down at the card.
 *
 * Uses vanishing points, which is why all four sides must be at least partly
 * visible. Returns null when either edge pair is too close to parallel to
 * locate its vanishing point reliably — at that point the card IS square to
 * the lens, so the caller should read null as "no measurable tilt" rather
 * than as an error.
 */
export function tiltDegrees(
  q: Quad, w: number, h: number, focal = focalPx(w),
): number | null {
  const cx = w / 2, cy = h / 2;
  const vp = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  };
  // One vanishing point per real-world direction: the two horizontal sides,
  // and the two vertical sides.
  const vh = vp(q.tl, q.tr, q.bl, q.br);
  const vv = vp(q.tl, q.bl, q.tr, q.br);

  // A vanishing point at infinity means those sides are parallel in the image,
  // i.e. no tilt about that axis. Use the image-plane direction instead.
  const dirOf = (v: Point | null, fallback: Point): [number, number, number] => {
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.hypot(v.x - cx, v.y - cy) > 1e6) {
      return norm3(fallback.x, fallback.y, 0);
    }
    return norm3(v.x - cx, v.y - cy, focal);
  };
  const d1 = dirOf(vh, { x: q.tr.x - q.tl.x, y: q.tr.y - q.tl.y });
  const d2 = dirOf(vv, { x: q.bl.x - q.tl.x, y: q.bl.y - q.tl.y });

  // Plane normal = the two in-plane directions crossed.
  const n = norm3(
    d1[1] * d2[2] - d1[2] * d2[1],
    d1[2] * d2[0] - d1[0] * d2[2],
    d1[0] * d2[1] - d1[1] * d2[0],
  );
  // A degenerate quad produces two near-identical in-plane directions, whose
  // cross product is ~0 and whose "normal" is meaningless. This used to fall
  // through and report a confident 90 degrees — the most alarming reading
  // available — for a quad that was simply nonsense.
  const cross = Math.hypot(
    d1[1] * d2[2] - d1[2] * d2[1],
    d1[2] * d2[0] - d1[0] * d2[2],
    d1[0] * d2[1] - d1[1] * d2[0],
  );
  if (!(cross > 0.05)) return null;
  if (!Number.isFinite(n[2])) return null;
  const deg = (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI;
  return Number.isFinite(deg) ? deg : null;
}

function norm3(x: number, y: number, z: number): [number, number, number] {
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
}

/**
 * Distance from lens to card, in inches.
 *
 * Needs a side measured END TO END, so it degrades differently from angle: a
 * thumb over a corner breaks the two sides that meet there, while the opposite
 * sides may still carry the measurement. Uses the LONGER apparent side of each
 * pair, which is the one nearer the lens and least foreshortened.
 */
export function distanceInches(
  q: Quad, w: number, size: CardSizeKey | { w: number; h: number } = "standard", fovDegrees = 65,
): number | null {
  const dims = typeof size === "string" ? CARD_SIZES[size] : size;
  const f = focalPx(w, fovDegrees);
  const widthPx = Math.max(dist(q.tl, q.tr), dist(q.bl, q.br));
  const heightPx = Math.max(dist(q.tl, q.bl), dist(q.tr, q.br));
  if (widthPx < 1 || heightPx < 1) return null;
  // Two independent estimates; average them so one foreshortened side doesn't
  // dominate. Both use the pinhole relation: distance = real × focal / pixels.
  const byW = (dims.w * f) / widthPx;
  const byH = (dims.h * f) / heightPx;
  const d = (byW + byH) / 2;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** The card's aspect ratio with perspective taken out — enough to tell a
 *  standard card (0.71) from a slab (0.61) or a tobacco card (0.55) BEFORE
 *  anything knows what the card is. */
export function apparentAspect(q: Quad): number | null {
  const wpx = (dist(q.tl, q.tr) + dist(q.bl, q.br)) / 2;
  const hpx = (dist(q.tl, q.bl) + dist(q.tr, q.br)) / 2;
  if (hpx < 1) return null;
  return wpx / hpx;
}

/** Best matching known card size for a measured aspect ratio, or null when
 *  nothing is close enough to claim. */
export function guessSize(
  aspect: number, tolerance = 0.03,
): { key: CardSizeKey; ambiguous: boolean } | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  // A card lying sideways in frame measures the reciprocal. It is the same
  // physical card, so match against both and take whichever fits.
  const candidates = [aspect, 1 / aspect];
  const scored: { key: CardSizeKey; err: number }[] = [];
  for (const k of Object.keys(CARD_SIZES) as CardSizeKey[]) {
    if (!CARD_SIZES[k].guessable) continue;
    const target = CARD_SIZES[k].w / CARD_SIZES[k].h;
    scored.push({ key: k, err: Math.min(...candidates.map((c) => Math.abs(c - target))) });
  }
  scored.sort((x, y) => x.err - y.err);
  if (scored[0].err > tolerance) return null;
  // Two catalog entries can sit closer together than the tolerance — standard
  // and 1952 Topps are 0.014 apart. Picking between them by a pixel of noise
  // and then presenting the resulting distance as fact is exactly the kind of
  // confident wrongness this module is supposed to refuse. Say it is
  // ambiguous and let the identity layer settle it.
  const ambiguous = scored.length > 1 && scored[1].err <= tolerance
    && Math.abs(scored[1].err - scored[0].err) < tolerance * 0.5;
  return { key: scored[0].key, ambiguous };
}

// ── the whole pipeline ─────────────────────────────────────────────────────

export type Detection = {
  quad: Quad;
  fill: number;
  /** Degrees off perpendicular, or null when it can't be measured. */
  tilt: number | null;
  /** Inches, or null when the geometry doesn't justify a number. */
  inches: number | null;
  aspect: number | null;
  size: CardSizeKey | null;
  /** True when the size was a coin-flip between catalog entries that sit
   *  closer together than the measurement can resolve. `inches` is null in
   *  that case — the reading exists, it just isn't earned. */
  sizeAmbiguous: boolean;
  /** 0..1 per side, in tl-tr, tr-br, br-bl, bl-tl order. How much real edge
   *  actually lies under each line. Drives the per-edge highlight: a side
   *  above `minSupport` is a side you have locked. */
  support: [number, number, number, number];
  /** The four sides as line segments, for drawing. */
  edges: [[Point, Point], [Point, Point], [Point, Point], [Point, Point]];
};

/** Above this tilt, aspect ratio is too foreshortened to name a card size. */
const MAX_TILT_FOR_SIZE = 12;
/** Above this tilt, the pinhole distance estimate stops being trustworthy. */
const MAX_TILT_FOR_DISTANCE = 40;

/**
 * Find the card in one grayscale frame.
 *
 * Returns null rather than a guess — and unlike the first version of this
 * file, that is now actually true. Every side must be CORROBORATED by edge
 * pixels lying under it, size is not named when perspective has distorted the
 * aspect ratio beyond recognition, and distance is not reported when the card
 * is too oblique for the pinhole relation to mean anything.
 */
export function detectCard(
  gray: Uint8ClampedArray | Uint8Array, w: number, h: number,
  opts: {
    threshold?: number;
    size?: CardSizeKey | { w: number; h: number };
    fovDegrees?: number;
    /** Fraction of a side that must have real edge under it. */
    minSupport?: number;
  } = {},
): Detection | null {
  if (w < 16 || h < 16) return null;
  // An upper bound too: a full-resolution frame is a multi-hundred-millisecond
  // main-thread stall, and this is meant to run inside a video loop.
  if (w * h > 400_000) return null;

  const threshold = opts.threshold ?? 60;
  const minSupport = opts.minSupport ?? 0.55;
  const { mag, dir } = sobel(gray, w, h);
  const lines = houghLines(mag, dir, w, h, { threshold });
  const quad = quadFromLines(lines, w, h);
  if (!quad || !validQuad(quad, w, h)) return null;

  const sides: [Point, Point][] = [
    [quad.tl, quad.tr], [quad.tr, quad.br], [quad.br, quad.bl], [quad.bl, quad.tl],
  ];
  const support = sides.map(([p, q]) =>
    segmentSupport(p, q, Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2, mag, dir, w, h, threshold),
  ) as [number, number, number, number];

  // At least three sides must be real before this is a card at all. Two lit
  // sides is a corner of something; it is not evidence of a rectangle.
  const lit = support.filter((v) => v >= minSupport).length;
  if (lit < 3) return null;

  const tilt = tiltDegrees(quad, w, h, focalPx(w, opts.fovDegrees));
  const aspect = apparentAspect(quad);

  // Size from aspect is only honest when the card is near enough to square-on
  // that perspective hasn't stretched it. Past that, the identity layer is the
  // answer, not geometry.
  let size: CardSizeKey | null = null;
  let sizeAmbiguous = false;
  if (typeof opts.size === "string") {
    size = opts.size;
  } else if (!opts.size && aspect != null && (tilt == null || tilt <= MAX_TILT_FOR_SIZE)) {
    const g = guessSize(aspect);
    if (g) { size = g.key; sizeAmbiguous = g.ambiguous; }
  }

  const dims = typeof opts.size === "object" ? opts.size : size;
  const trustworthy = lit === 4 && (tilt == null || tilt <= MAX_TILT_FOR_DISTANCE) && !sizeAmbiguous;
  const inches = dims && trustworthy ? distanceInches(quad, w, dims, opts.fovDegrees) : null;

  return { quad, fill: frameFill(quad, w, h), tilt, inches, aspect, size, sizeAmbiguous, support, edges: sides as Detection["edges"] };
}

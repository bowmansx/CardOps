// Which photos REPRESENT a card, and in what order (Beau, 2026-07-25) —
// CAPTURE_WORK_ITEMS.md P5. Pure: no I/O.
//
// Templates made this necessary. A 12-shot grading run stores up to 24 rows —
// each shot keeps its uncropped frame AND the crop derived from it — and both
// consumers of a card's photos were reading the raw table in created_at order:
//
//   • the eBay listing sent whatever came first, so the UNCROPPED frame (table
//     background and all) became the lead image buyers see as the thumbnail,
//     and a 12-shot card filled its twelve slots with corner close-ups before
//     it ever reached the back;
//   • grade-estimate looked only for kind 'front' and 'back' and ignored every
//     corner, surface and edge shot the grading template exists to produce.
//
// One place decides, so the two can't disagree.

export type PhotoRow = {
  id: string;
  kind: string | null;
  role: string | null;
  variant: string | null;
  derived_from: string | null;
  bucket: string;
  path: string;
  /**
   * `card_photos.capture_meta` — what the camera recorded about this shot.
   *
   * Read here for one reason: a SWEEP composite is not an ordinary photo, and
   * one of the two kinds must never be published. See `stackedKind`.
   */
  capture_meta?: unknown;
};

/** What a sweep produced, or null for an ordinary single-exposure photo. */
export type StackedKind = "clean" | "surface";

/**
 * Was this photo merged from a sweep, and which of the two is it?
 *
 * A `surface` image is DELIBERATELY RAKED — light skimming across the card to
 * make scratches, print lines and creases visible. That is exactly what a grader
 * wants and exactly what a buyer must never be shown: it looks like a damaged
 * card to anyone who does not know what they are looking at.
 *
 * Read from the stored metadata rather than from the role, because the role comes
 * from the template slot the shot was taken in — sweep on a "front" slot and both
 * composites inherit `front`. The metadata is the only thing that knows which is
 * which, and it is written at capture time by the camera.
 */
export function stackedKind(row: Pick<PhotoRow, "capture_meta">): StackedKind | null {
  const m = row.capture_meta;
  if (!m || typeof m !== "object") return null;
  const s = (m as { stacked?: { kind?: unknown } }).stacked;
  if (!s || typeof s !== "object") return null;
  return s.kind === "surface" ? "surface" : s.kind === "clean" ? "clean" : null;
}

/** Is this an image that must not go out on a listing? */
const isSurfaceView = (p: PhotoRow) =>
  stackedKind(p) === "surface" || (p.role || p.kind) === "surface_angle";

/** Presentation order: the whole card first, then the close detail. */
const ROLE_RANK: Record<string, number> = {
  front: 0,
  back: 1,
  slab: 2,
  surface_angle: 3,
  edge: 4,
  corner_tl: 10, corner_tr: 11, corner_bl: 12, corner_br: 13,
  corner_tl_back: 14, corner_tr_back: 15, corner_bl_back: 16, corner_br_back: 17,
  defect: 20,
  other: 30,
};

const rank = (r: string) => ROLE_RANK[r] ?? 25;

/**
 * The photos that stand for the card: one row per SHOT, preferring the framed
 * crop over the uncropped frame it came from.
 *
 * A row that another row was derived FROM is a source, not a presentation
 * image — it is kept so an edge can be audited, not so it can be published.
 * When cropping is off there is no derivative and the single row IS the shot.
 */
export function displayPhotos(rows: PhotoRow[] | null | undefined): PhotoRow[] {
  const list = rows ?? [];
  const isSource = new Set(list.map((p) => p.derived_from).filter(Boolean) as string[]);
  return list
    .filter((p) => !isSource.has(p.id))
    .map((p, i) => ({ p, i, r: (p.role || p.kind || "other") as string }))
    // Stable: equal ranks keep capture order, so four corners stay in the
    // order they were shot rather than shuffling between calls.
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.p);
}

/**
 * The photos to publish, capped.
 *
 * The cap is applied AFTER ordering, so the front and back are never crowded
 * out by close-ups — losing the shot of the whole card is the one truncation
 * that would make a listing worse than having no detail shots at all.
 */
export function listingPhotos(rows: PhotoRow[] | null | undefined, cap = 12): { photos: PhotoRow[]; truncated: boolean } {
  // SURFACE VIEWS ARE EXCLUDED, and this is the one filter here that is about
  // harm rather than about ordering. A raking-light image exists to make every
  // scratch and print line as visible as possible; published as a product photo
  // it advertises a card as damaged. Grading wants it, a buyer must not see it.
  const ordered = displayPhotos(rows).filter((p) => !isSurfaceView(p));
  return { photos: ordered.slice(0, cap), truncated: ordered.length > cap };
}

/**
 * The photos to send to the grader, capped, plus what is MISSING.
 *
 * Missing shots are returned rather than ignored: a grade estimated from the
 * front alone and one estimated from twelve angles are not the same claim, and
 * the model is told which one it is being asked for.
 */
export function gradingPhotos(
  rows: PhotoRow[] | null | undefined,
  cap = 8,
): { photos: PhotoRow[]; roles: string[]; missing: string[]; truncated: boolean } {
  const ordered = displayPhotos(rows).filter((p) => (p.role || p.kind) !== "slab");
  const roles = ordered.map((p) => (p.role || p.kind || "other") as string);
  // What a grader would want and this card doesn't have.
  const WANT = ["front", "back", "corner_tl", "corner_tr", "corner_bl", "corner_br", "surface_angle", "edge"];
  const have = new Set(roles);
  return {
    photos: ordered.slice(0, cap),
    roles,
    missing: WANT.filter((w) => !have.has(w)),
    truncated: ordered.length > cap,
  };
}

/**
 * The caption for one photo, role plus how it was made.
 *
 * A grader shown a raking-light composite without being told what it is will
 * read every highlight as a defect, which is the opposite of useful — it exists
 * to reveal defects, so it makes a mint card look scuffed. And a glare-removed
 * composite deserves saying too: it is merged from several exposures, not a
 * single photograph, and that is relevant to anyone judging surface from it.
 */
export function photoCaption(row: PhotoRow): string {
  const base = roleCaption((row.role || row.kind || "other") as string);
  switch (stackedKind(row)) {
    case "surface":
      return `${base} — SURFACE MAP: merged from several angles with light deliberately raking across the card, so gloss, scratches and print lines show. Highlights here are the lighting doing its job, not necessarily damage.`;
    case "clean":
      return `${base} — merged from several angles to remove glare.`;
    default:
      return base;
  }
}

/** Human label for a role, used to caption each image for the model. */
export function roleCaption(role: string): string {
  switch (role) {
    case "front": return "Front of the card";
    case "back": return "Back of the card";
    case "slab": return "Slab label";
    case "surface_angle": return "Surface at an angle (gloss, print lines, scratches)";
    case "edge": return "Edges";
    case "defect": return "A flaw the owner flagged";
    case "corner_tl": return "FRONT top-left corner";
    case "corner_tr": return "FRONT top-right corner";
    case "corner_bl": return "FRONT bottom-left corner";
    case "corner_br": return "FRONT bottom-right corner";
    case "corner_tl_back": return "BACK top-left corner";
    case "corner_tr_back": return "BACK top-right corner";
    case "corner_bl_back": return "BACK bottom-left corner";
    case "corner_br_back": return "BACK bottom-right corner";
    default: return "Another view";
  }
}

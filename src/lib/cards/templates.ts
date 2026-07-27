// Photo templates (Beau, 2026-07-25) — CAPTURE_WORK_ITEMS.md P3.
// Pure: no I/O, no DOM. The API route and the camera both read from here so a
// template means exactly one thing in both places.

/**
 * The roles card_photos will accept. This list MIRRORS the CHECK constraint in
 * migration 20260740; a role that isn't here is one the database would refuse,
 * and finding that out at the end of a twelve-shot run is the worst possible
 * moment. Keep the two in step.
 */
export const PHOTO_ROLES = [
  { role: "front", label: "Front" },
  { role: "back", label: "Back" },
  { role: "slab", label: "Slab / label" },
  { role: "corner_tl", label: "Front · top-left corner" },
  { role: "corner_tr", label: "Front · top-right corner" },
  { role: "corner_bl", label: "Front · bottom-left corner" },
  { role: "corner_br", label: "Front · bottom-right corner" },
  { role: "corner_tl_back", label: "Back · top-left corner" },
  { role: "corner_tr_back", label: "Back · top-right corner" },
  { role: "corner_bl_back", label: "Back · bottom-left corner" },
  { role: "corner_br_back", label: "Back · bottom-right corner" },
  { role: "surface_angle", label: "Surface at an angle" },
  { role: "edge", label: "Edges" },
  { role: "defect", label: "A flaw" },
  { role: "other", label: "Other" },
] as const;

export type PhotoRole = (typeof PHOTO_ROLES)[number]["role"];

const ROLE_SET = new Set<string>(PHOTO_ROLES.map((r) => r.role));
const LABEL_BY_ROLE = new Map(PHOTO_ROLES.map((r) => [r.role as string, r.label]));

export type TemplateShot = {
  role: PhotoRole;
  label: string;
  hint?: string;
  /**
   * How much of the frame the card should fill, 0..1. Beau's "proximity"
   * (`Photo Process and Format`): *"it can be decided how far away the photo
   * should be taken... a guide, when they have a proximity template set, to
   * let them know how much further or closer they need to move."*
   *
   * Stored as FRAME FILL rather than inches deliberately. Inches drift with
   * every phone's lens; the fraction of frame a card occupies is what actually
   * determines whether two corner shots are comparable, and it needs no
   * calibration to be right.
   */
  targetFill?: number;
  /**
   * Viewing angle in degrees, 0 = square on. Beau's "angles": *"a box that the
   * user can input a number that would be the number of angle degree."* A
   * surface shot wants a deliberate tilt to catch the light; a corner shot
   * wants none.
   */
  targetTilt?: number;
  /** How far either side of the target still counts as on-target. */
  tolerance?: number;
};

export type PhotoTemplate = {
  id: string;
  key: string;
  name: string;
  builtIn: boolean;
  shots: TemplateShot[];
};

/**
 * Coerce anything (a DB row, a form, an older template) into shots the camera
 * can run and the database will accept.
 *
 * A shot whose role isn't valid is DROPPED rather than corrected to something
 * else: silently turning a "corner_tl" typo into "other" would file a corner
 * shot where no corner-reading code will ever look for it.
 */
export function normalizeShots(raw: unknown): TemplateShot[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateShot[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const r = (s as Record<string, unknown>).role;
    if (typeof r !== "string" || !ROLE_SET.has(r)) continue;
    const label = String((s as Record<string, unknown>).label ?? "").trim() || LABEL_BY_ROLE.get(r) || r;
    const hint = String((s as Record<string, unknown>).hint ?? "").trim();
    const num = (v: unknown, lo: number, hi: number): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
    };
    const o = s as Record<string, unknown>;
    out.push({
      role: r as PhotoRole,
      label: label.slice(0, 40),
      hint: hint ? hint.slice(0, 120) : undefined,
      // A target outside its plausible range is DROPPED, not clamped: a
      // template asking to fill 300% of the frame is a mistake, and clamping
      // it to 100% would silently invent a requirement nobody wrote.
      targetFill: num(o.targetFill, 0.05, 0.98),
      targetTilt: num(o.targetTilt, 0, 75),
      tolerance: num(o.tolerance, 0.01, 0.5),
    });
  }
  return out.slice(0, 40);
}

/** Which shots of a template a card is still missing, by role. */
export function missingShots(template: PhotoTemplate, haveRoles: string[]): TemplateShot[] {
  // Count, don't just check membership: a template asking for four corners
  // isn't satisfied by one corner photo.
  const remaining = new Map<string, number>();
  for (const r of haveRoles) remaining.set(r, (remaining.get(r) ?? 0) + 1);
  const missing: TemplateShot[] = [];
  for (const s of template.shots) {
    const n = remaining.get(s.role) ?? 0;
    if (n > 0) remaining.set(s.role, n - 1);
    else missing.push(s);
  }
  return missing;
}

/** "3 of 12" — the progress a camera announces. */
export function shotStep(index: number, total: number): string {
  return `${index + 1} of ${total}`;
}


// ── shooting to a target ───────────────────────────────────────────────────

export type Guidance = {
  /** What to tell the user, or null when they are on target. */
  message: string | null;
  /** True when every stated target is satisfied. */
  onTarget: boolean;
  /** Per-axis, for colouring the readouts independently. */
  fill: "low" | "ok" | "high" | "none";
  tilt: "low" | "ok" | "high" | "none";
};

const DEFAULT_TOL = 0.08;      // frame-fill fraction
const TILT_TOL_DEG = 6;

/**
 * Turn a live reading into an instruction.
 *
 * Says ONE thing at a time. A HUD reading "move closer and tilt back and hold
 * still" is a HUD nobody acts on — distance first, because framing is what the
 * user is already thinking about, and the angle barely matters until the card
 * is the right size in frame.
 *
 * A target the reading cannot measure produces no instruction at all rather
 * than a guess: `null` tilt means the geometry could not support an angle, and
 * inventing "tilt flatter" from that would send someone chasing a number that
 * was never taken.
 */
export function guideToTarget(
  shot: Pick<TemplateShot, "targetFill" | "targetTilt" | "tolerance"> | null | undefined,
  reading: { fill: number | null; tilt: number | null },
): Guidance {
  const none: Guidance = { message: null, onTarget: true, fill: "none", tilt: "none" };
  if (!shot) return none;

  const tol = shot.tolerance ?? DEFAULT_TOL;
  let fillState: Guidance["fill"] = "none";
  let tiltState: Guidance["tilt"] = "none";
  let message: string | null = null;

  if (shot.targetFill != null && reading.fill != null) {
    const d = reading.fill - shot.targetFill;
    fillState = Math.abs(d) <= tol ? "ok" : d < 0 ? "low" : "high";
    if (fillState === "low") message = "Move closer";
    else if (fillState === "high") message = "Move back";
  }

  if (shot.targetTilt != null && reading.tilt != null) {
    const d = reading.tilt - shot.targetTilt;
    const tdeg = TILT_TOL_DEG;
    tiltState = Math.abs(d) <= tdeg ? "ok" : d < 0 ? "low" : "high";
    // Only speak about angle once distance is settled — one instruction at a
    // time is the difference between a guide and a nag.
    if (!message && tiltState !== "ok") {
      message = shot.targetTilt === 0
        ? "Hold the phone flatter"
        : d < 0 ? `Tilt more — aiming for ${shot.targetTilt}°` : `Tilt less — aiming for ${shot.targetTilt}°`;
    }
  }

  const stated = (shot.targetFill != null ? 1 : 0) + (shot.targetTilt != null ? 1 : 0);
  const met = (fillState === "ok" ? 1 : 0) + (tiltState === "ok" ? 1 : 0);
  return { message, onTarget: stated > 0 && met === stated, fill: fillState, tilt: tiltState };
}

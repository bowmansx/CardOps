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

export type TemplateShot = { role: PhotoRole; label: string; hint?: string };

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
    out.push({ role: r as PhotoRole, label: label.slice(0, 40), hint: hint ? hint.slice(0, 120) : undefined });
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

// Photo capture preferences (Beau, 2026-07-25) — CAPTURE_WORK_ITEMS.md P2.
// Pure: no I/O, no DOM. The camera and the settings screen both read from here
// so a preset means exactly one thing in both places.

export const PHOTO_QUALITIES = ["economy", "standard", "high", "archive"] as const;
export type PhotoQuality = (typeof PHOTO_QUALITIES)[number];

export const CAPTURE_MODES = ["in_app", "os_camera"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const CROP_MODES = ["off", "margin", "tight"] as const;
export type CropMode = (typeof CROP_MODES)[number];

/**
 * What each quality level actually does, and roughly what it costs.
 *
 * `approxBytes` is a HONEST ESTIMATE, not a measurement — a JPEG of a card at a
 * given resolution varies with the card's own busyness. It exists so the
 * storage trade is visible where the choice is made rather than discovered on a
 * bill, and it is deliberately labelled "about" everywhere it renders. The
 * REAL number is recorded per image in card_photos.bytes (20260740).
 */
export const QUALITY_SPECS: Record<PhotoQuality, {
  label: string;
  maxEdge: number;
  jpegQuality: number;
  approxBytes: number;
  note: string;
}> = {
  economy:  { label: "Economy",  maxEdge: 1200, jpegQuality: 0.75, approxBytes: 150_000,   note: "Plenty to identify a card" },
  standard: { label: "Standard", maxEdge: 1600, jpegQuality: 0.85, approxBytes: 300_000,   note: "The default — good all round" },
  high:     { label: "High",     maxEdge: 2400, jpegQuality: 0.9,  approxBytes: 800_000,   note: "Better for listing photos" },
  archive:  { label: "Archive",  maxEdge: 4000, jpegQuality: 0.95, approxBytes: 3_000_000, note: "Grading evidence; large" },
};

export type PhotoPrefs = {
  capture_mode: CaptureMode;
  photo_quality: PhotoQuality;
  auto_snap: boolean;
  burst_count: number;
  auto_crop: CropMode;
  crop_margin_pct: number;
  keep_originals: boolean;
  default_template: string | null;
};

export const PHOTO_PREF_DEFAULTS: PhotoPrefs = {
  capture_mode: "in_app",
  photo_quality: "standard",
  auto_snap: false,
  burst_count: 3,
  auto_crop: "margin",
  crop_margin_pct: 0.04,
  keep_originals: true,
  default_template: null,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Coerce anything (a DB row, a JSON preset, a partial patch) into valid prefs.
 * Bad values fall back to the default rather than throwing: a malformed
 * preference must never be able to stop someone photographing a card.
 */
export function normalizePhotoPrefs(raw: Partial<Record<keyof PhotoPrefs, unknown>> | null | undefined): PhotoPrefs {
  const r = raw ?? {};
  const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
    allowed.includes(v as T) ? (v as T) : dflt;
  const marginRaw = Number(r.crop_margin_pct);
  return {
    capture_mode: pick(r.capture_mode, CAPTURE_MODES, PHOTO_PREF_DEFAULTS.capture_mode),
    photo_quality: pick(r.photo_quality, PHOTO_QUALITIES, PHOTO_PREF_DEFAULTS.photo_quality),
    auto_snap: typeof r.auto_snap === "boolean" ? r.auto_snap : PHOTO_PREF_DEFAULTS.auto_snap,
    burst_count: Number.isFinite(Number(r.burst_count))
      ? clamp(Math.round(Number(r.burst_count)), 1, 5)
      : PHOTO_PREF_DEFAULTS.burst_count,
    auto_crop: pick(r.auto_crop, CROP_MODES, PHOTO_PREF_DEFAULTS.auto_crop),
    // A zero margin puts the card's edge ON the image boundary — the exact
    // misrepresentation the margin exists to prevent. Floor it, don't honour it.
    crop_margin_pct: Number.isFinite(marginRaw)
      ? clamp(marginRaw, 0.005, 0.25)
      : PHOTO_PREF_DEFAULTS.crop_margin_pct,
    keep_originals: typeof r.keep_originals === "boolean" ? r.keep_originals : PHOTO_PREF_DEFAULTS.keep_originals,
    default_template: typeof r.default_template === "string" && r.default_template ? r.default_template : null,
  };
}

/** Bytes one CARD costs at these settings, given how many shots are taken. */
export function estimateBytesPerCard(prefs: PhotoPrefs, shots = 2): number {
  const per = QUALITY_SPECS[prefs.photo_quality].approxBytes;
  // Keeping originals stores the full frame too. It is a little larger than the
  // crop it came from, but the same order — count it as another shot each.
  const copies = prefs.keep_originals && prefs.auto_crop !== "off" ? 2 : 1;
  return per * shots * copies;
}

/** Human-readable size, matched to the credits page's formatting. */
export function humanBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

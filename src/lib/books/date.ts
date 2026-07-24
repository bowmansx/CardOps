// Coerce an untrusted date string to a real calendar day, or today.
// Vision/model output and client payloads can produce shape-valid-but-impossible
// dates (e.g. "2026-13-45") that pass a /\d{4}-\d{2}-\d{2}/ regex but make
// Postgres' `date` column throw on insert. This validates the actual day by
// round-tripping through Date, and falls back to today for anything invalid.
export function coerceDate(s: string | undefined | null, todayISO?: string): string {
  const today = todayISO ?? new Date().toISOString().slice(0, 10);
  return coerceDateOrNull(s) ?? today;
}

// Same validation, but UNKNOWN stays unknown — for records where substituting
// today (a wrong-but-plausible date) would corrupt time-weighted math, e.g.
// comp recency weighting. An impossible date becomes null, never "now".
export function coerceDateOrNull(s: string | undefined | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

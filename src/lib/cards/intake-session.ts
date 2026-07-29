// The cards booked in THIS sitting — what you just did, still on screen.
//
// Beau: "below 'photograph the card' on intake, a running list of the cards
// being added during this photo session. it will be interactive... a delete
// button, the card can be clicked which will bring up whatever information you
// have compiled for that card so far but someone may likely just be taking new
// photos so that can be done as well."
//
// Intake used to keep a NUMBER. `savedCount` went up, `reset()` wiped the
// screen, and the card you had just booked was gone from view — so a typo
// caught two cards later meant leaving intake, finding the card, fixing it, and
// coming back. The work was never lost, but it became invisible the instant it
// succeeded.
//
// IN MEMORY, DELIBERATELY. Each entry is a card that already exists in the
// database, so a reload loses the LIST and never the cards. Persisting it would
// buy the ability to reopen a session, at the cost of a table to keep in step
// with reality — and `card_intake_sessions` is a staging pipeline for the batch
// flow, a different thing that happens to share a name.

export type SessionCard = {
  /** The booked card's id — these are real rows, not drafts. */
  id: string;
  sku: string | null;
  /** "2021 Prizm Ja'Marr Chase" — whatever identity was captured. */
  label: string;
  /** Front image as a data URL, for the thumbnail. Null for a library pick. */
  thumb: string | null;
  /** When it was booked, for ordering. */
  at: number;
  /**
   * False when the card saved but its photos did not attach. That state
   * already exists in intake and had nowhere to be seen once the screen reset
   * — a card booked without its evidence looked identical to a complete one.
   */
  photosAttached: boolean;
};

/** Newest first: what you just did is what you are most likely to fix. */
export function addToSession(list: SessionCard[], card: SessionCard): SessionCard[] {
  return [card, ...list.filter((c) => c.id !== card.id)];
}

export function removeFromSession(list: SessionCard[], id: string): SessionCard[] {
  return list.filter((c) => c.id !== id);
}

/**
 * Build the display label from whatever identity survived the scan.
 *
 * Returns null rather than a placeholder when there is nothing to show, so the
 * caller decides what an unidentified card looks like instead of inheriting a
 * string like "Untitled" that then appears in a list as though it were a name.
 */
export function sessionLabel(f: {
  year?: number | string | null;
  set_name?: string | null;
  player?: string | null;
  card_number?: string | null;
}): string | null {
  const head = [f.year, f.set_name, f.player].map((v) => (v == null ? "" : String(v).trim())).filter(Boolean);
  const num = f.card_number ? `#${String(f.card_number).trim()}` : "";
  const s = [...head, num].filter(Boolean).join(" ");
  return s || null;
}

export type SessionSummary = {
  total: number;
  /** Cards booked without their photos. The number worth acting on. */
  missingPhotos: number;
  /** Minutes from the first booking to the last, or null below two cards. */
  spanMinutes: number | null;
};

export function sessionSummary(list: SessionCard[], now = Date.now()): SessionSummary {
  const total = list.length;
  const missingPhotos = list.filter((c) => !c.photosAttached).length;
  if (total < 2) return { total, missingPhotos, spanMinutes: null };
  const times = list.map((c) => c.at);
  const span = Math.max(...times, now) - Math.min(...times);
  return { total, missingPhotos, spanMinutes: Math.max(1, Math.round(span / 60_000)) };
}

/**
 * Cards per hour, for the pace readout — null until there is enough of a run
 * to mean anything.
 *
 * Three cards in ninety seconds extrapolates to 120/hour, which is a number
 * nobody should be shown. The floor is arbitrary and stated rather than tuned.
 */
export function sessionPace(s: SessionSummary): number | null {
  if (s.total < 5 || !s.spanMinutes || s.spanMinutes < 2) return null;
  return Math.round((s.total / s.spanMinutes) * 60);
}

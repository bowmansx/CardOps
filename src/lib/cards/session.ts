// The photo SESSION — the shot list, what has been captured into each slot,
// and how that turns into an upload payload.
//
// Lives in lib rather than in the camera component because the interesting
// rules here have nothing to do with React: which slot comes next, what
// happens to the crop→original links when a session is reordered, which slots
// the card already has covered. All three are answerable without a camera, so
// all three are testable without one.

import type { PhotoShot } from "./upload";
import type { TemplateShot } from "./templates";

export type CapturedShot = {
  /** The framed, margin-preserved card image — what the app shows and scans. */
  url: string;
  /** The FULL uncropped frame. Kept so a crop can never be the only record of
   *  an edge. Null for library picks, which have no camera frame behind them. */
  original: string | null;
  meta: { mode: "in_app" | "library"; auto: boolean; sharp: number | null; marginPct: number };
};

/**
 * Turn the session — the shot list plus whatever landed in each slot — into
 * the flat upload payload.
 *
 * BUILT AT THE END, NOT AS YOU GO. `derivedFromIndex` links a crop to the
 * uncropped frame it came from by POSITION in this array, so appending as each
 * shot is taken makes those links hostage to the order they were taken in. The
 * moment a session can be reordered or a shot deleted, every stored link is
 * wrong — a crop pointing at some other shot's frame. Deriving the whole array
 * from the FINAL order instead means delete and reorder cost nothing.
 *
 * This is also what makes Beau's rule true: *"the order of your session ...
 * will also be the order of how your photos are saved."*
 */
export function sessionToShots(queue: TemplateShot[], captured: (CapturedShot | null)[]): PhotoShot[] {
  const out: PhotoShot[] = [];
  queue.forEach((slot, i) => {
    const c = captured[i];
    if (!c) return;
    let srcIndex: number | undefined;
    if (c.original) {
      srcIndex = out.length;
      out.push({ dataUrl: c.original, kind: slot.role, variant: "original", position: i });
    }
    out.push({
      dataUrl: c.url,
      kind: slot.role,
      variant: c.original ? "processed" : "original",
      derivedFromIndex: srcIndex,
      cropGeometry: c.original ? { margin_pct: c.meta.marginPct, deskewed: false } : null,
      captureMeta: c.meta,
      // The SLOT, not the payload index: a crop and its frame are one shot and
      // share a position, which is what makes the saved order the session's.
      position: i,
    });
  });
  return out;
}

/**
 * Which queue slots this card ALREADY has a photo for.
 *
 * Counts by role rather than testing membership, for the same reason
 * missingShots does: a template asking for four corners is not satisfied by one
 * corner photo.
 */
export function existingSlots(queue: TemplateShot[], haveRoles: string[]): boolean[] {
  const left = new Map<string, number>();
  for (const r of haveRoles) left.set(r, (left.get(r) ?? 0) + 1);
  return queue.map((s) => {
    const n = left.get(s.role) ?? 0;
    if (n > 0) { left.set(s.role, n - 1); return true; }
    return false;
  });
}

/**
 * The next slot still waiting for a photo, searching forward then wrapping.
 * Returns -1 when every slot is filled — which is what ends the run.
 *
 * Wrapping matters once the menu exists: jump back to retake shot 2 of 12 and
 * the natural next stop is shot 3, but if you jumped back to the LAST empty
 * one, forward-only search would fall off the end and finish a session with
 * gaps still in it.
 */
export function nextOpen(captured: (CapturedShot | null)[], from: number): number {
  const n = captured.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!captured[i]) return i;
  }
  return -1;
}

/** Move one slot, carrying its photo with it. */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const out = list.slice();
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
}

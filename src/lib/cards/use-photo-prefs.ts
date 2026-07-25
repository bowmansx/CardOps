"use client";

import { useEffect, useState } from "react";
import { normalizePhotoPrefs, PHOTO_PREF_DEFAULTS, type PhotoPrefs } from "./photo-prefs";

// One fetch per page load, shared by every capture surface. Speed Book, batch
// intake and the full form all open the same camera; three copies of the same
// request on the same screen would be waste, and worse, they could disagree.
let cached: Promise<PhotoPrefs> | null = null;

function load(): Promise<PhotoPrefs> {
  cached ??= fetch("/api/cards/prefs")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => normalizePhotoPrefs(d?.prefs ?? null))
    // Defaults, never a thrown error: an unreachable prefs route must not stop
    // someone photographing a card.
    .catch(() => PHOTO_PREF_DEFAULTS);
  return cached;
}

/** Invalidate after saving settings, so the next camera open uses them. */
export function resetPhotoPrefsCache() {
  cached = null;
}

/**
 * The user's saved capture settings. Returns the documented defaults until the
 * fetch lands — the camera stays usable during the round trip.
 */
export function usePhotoPrefs(): PhotoPrefs {
  const [prefs, setPrefs] = useState<PhotoPrefs>(PHOTO_PREF_DEFAULTS);
  useEffect(() => {
    let live = true;
    load().then((p) => { if (live) setPrefs(p); });
    return () => { live = false; };
  }, []);
  return prefs;
}

"use client";

// Direct-to-storage photo upload (Beau, 2026-07-25).
//
// Photos used to travel to a server action as base64 data URLs. That cost 37%
// inflation on the wire and ran into Next's server-action body limit, which is
// how booking a card came to hang for ever on "Saving…". Raising the limit and
// shrinking images to fit bought time; it did not fix the shape. A 12-shot
// grading template is ~10 MB encoded, and squeezing that under any limit means
// destroying the very detail the template exists to capture.
//
// So the bytes go straight from the browser to Supabase Storage, and only the
// PATHS travel to the server. The card insert now carries no images at all.
//
// RLS still holds: card_photo_visible() (20260728) grants a user any object
// whose first path segment is their own uid, so these uploads are inside the
// same boundary as the server-side ones — no new policy, no service role.

import { createClient } from "@/lib/supabase/client";

export type PhotoShot = {
  dataUrl: string;
  kind: string;
  variant: "original" | "processed";
  derivedFromIndex?: number;
  cropGeometry?: unknown;
  captureMeta?: unknown;
};

export type UploadedPhoto = {
  path: string;
  bytes: number;
  kind: string;
  variant: "original" | "processed";
  /** Index into the ORIGINAL shot array, for the crop→original link. */
  shotIndex: number;
  derivedFromIndex?: number;
  cropGeometry?: unknown;
  captureMeta?: unknown;
};

/** Turn a data URL into bytes without a round trip through the network. */
function decode(dataUrl: string): { blob: Blob; ext: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return { blob: new Blob([buf], { type: m[1] }), ext: m[1].split("/")[1].replace("jpeg", "jpg") };
}

export type UploadResult = {
  photos: UploadedPhoto[];
  /** One entry per shot that did NOT land. Empty means everything uploaded. */
  failures: string[];
};

/**
 * Upload a card's shots. Returns the paths to hand to the server.
 *
 * EVERY SHOT IS ATTEMPTED. An earlier version returned on the first error,
 * which meant a failed uncropped frame also cost you the cropped photo that
 * would have been perfectly fine — losing a good image because a different one
 * failed is the worse outcome. Failures are collected and reported instead.
 */
export async function uploadCardPhotos(
  userId: string,
  cardId: string,
  shots: PhotoShot[],
): Promise<UploadResult> {
  const supabase = createClient();
  const photos: UploadedPhoto[] = [];
  const failures: string[] = [];

  for (const [i, s] of shots.entries()) {
    const d = decode(s.dataUrl);
    if (!d) { failures.push(`${s.kind} (${s.variant}): not a readable image`); continue; }
    // <uid>/<card>/… — the layout card_photo_visible() already recognises.
    const path = `${userId}/${cardId}/${s.kind}-${s.variant}-${Date.now()}-${i}.${d.ext}`;
    try {
      const { error } = await supabase.storage
        .from("card-photos")
        .upload(path, d.blob, { contentType: d.blob.type, upsert: false });
      if (error) { failures.push(`${s.kind} (${s.variant}): ${error.message}`); continue; }
    } catch (e) {
      // A dropped connection rejects rather than returning — it must not take
      // the remaining shots down with it.
      failures.push(`${s.kind} (${s.variant}): ${e instanceof Error ? e.message : "upload failed"}`);
      continue;
    }
    photos.push({
      path,
      bytes: d.blob.size,
      kind: s.kind,
      variant: s.variant,
      shotIndex: i,
      derivedFromIndex: s.derivedFromIndex,
      cropGeometry: s.cropGeometry,
      captureMeta: s.captureMeta,
    });
  }
  return { photos, failures };
}

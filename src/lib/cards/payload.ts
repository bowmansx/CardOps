// Keeping the intake payload inside the server-action body limit.
//
// Card photos travel to the server action as base64 data URLs. Base64 inflates
// binary by 4/3, so two 1600px JPEGs sit right on Next's 1 MB default — which
// is how a save could fail with a 413 that the action never saw: no card
// created, no error returned, just a request that died in transit.
//
// The config now allows 4 MB (Vercel's own ceiling is 4.5 MB), and this module
// keeps us under it by SHRINKING rather than refusing. Losing some resolution
// is a far better outcome than losing the card.

/** Bytes a base64 data URL actually costs on the wire. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return dataUrl.length;
  const b64 = dataUrl.length - i - 1;
  const pad = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  // The encoded string IS what gets sent, so its own length is the cost.
  // (Binary size, for reference, would be b64 * 3/4 - pad.)
  void pad;
  return b64;
}

/**
 * Ceiling for one save's worth of images. The server allows 4 MB; leave real
 * headroom for the form fields, the action's own framing, and the fact that
 * our size estimate is of the encoded strings only.
 */
export const PAYLOAD_CAP = 3_000_000;

/** Total wire cost of the images in one save. */
export function totalBytes(urls: (string | null | undefined)[]): number {
  return urls.reduce<number>((n, u) => n + (u ? dataUrlBytes(u) : 0), 0);
}

/**
 * Re-encode a JPEG data URL smaller. Browser-only (canvas).
 * Returns the ORIGINAL string if anything goes wrong — a failed optimisation
 * must never be the reason a card can't be saved.
 */
export async function shrinkDataUrl(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", quality);
    // Only accept the re-encode if it actually helped.
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

/**
 * Bring a set of images under `cap`, shrinking in steps. Preserves array
 * positions (and nulls) so callers can destructure straight back.
 *
 * Steps go down in both dimension and quality because either alone plateaus:
 * a busy foil card stays large at 1600px however hard you compress it.
 */
export async function fitPayload(
  urls: (string | null | undefined)[],
  cap = PAYLOAD_CAP,
): Promise<{ urls: (string | null)[]; shrunk: boolean; from: number; to: number }> {
  const from = totalBytes(urls);
  let out: (string | null)[] = urls.map((u) => u ?? null);
  if (from <= cap) return { urls: out, shrunk: false, from, to: from };

  const steps: [number, number][] = [[1600, 0.8], [1400, 0.72], [1200, 0.65], [1000, 0.6]];
  for (const [maxEdge, quality] of steps) {
    out = await Promise.all(out.map((u) => (u ? shrinkDataUrl(u, maxEdge, quality) : Promise.resolve(null))));
    if (totalBytes(out) <= cap) break;
  }
  return { urls: out, shrunk: true, from, to: totalBytes(out) };
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// App-layer AES-256-GCM for eBay tokens: the refresh token is 18 months of
// full seller-account control, so it never touches the DB in plaintext
// (connector plan §4 — deliberately stricter than the google_connections
// precedent). Key = EBAY_TOKEN_KEY env, 32 bytes hex.

function key(): Buffer | null {
  const hex = process.env.EBAY_TOKEN_KEY;
  if (!hex || hex.length !== 64) return null;
  try {
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}

export function sealToken(plain: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function openToken(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    const k = key();
    if (!k) return null;
    const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
    const d = createDecipheriv("aes-256-gcm", k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

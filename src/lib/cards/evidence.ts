// Evidence integrity + backup state (Beau, 2026-07-25). Wave B §5.
//
// If an asset's value lives in its documentation, then LOSING the documentation
// is the catastrophic failure — not a degraded feature. Two rules follow, and
// both are the reason this file exists rather than a one-line "copy to R2":
//
//   1. VERIFY BY HASH, NOT BY EXISTENCE. A backup that exists but is truncated
//      is worse than no backup, because it buys false confidence. We record the
//      source sha256, then re-read the copy and compare.
//   2. FRESHNESS IS A NUMBER YOU SHOW. A backup nobody checks is a belief, not
//      a control. `evidenceHealth` renders complete or flagged (rule 4) —
//      never a reassuring green with unknowns hidden behind it.
//
// Pure functions only; the route does the I/O.

export type BackupState = "pending" | "backed_up" | "failed";

export type EvidenceDoc = {
  id: string;
  proves: string;
  sha256: string | null;
  backup_state: BackupState;
  backed_up_at: string | null;
  backup_error?: string | null;
};

/** Hex sha256 of bytes, via WebCrypto (available in the Node and edge runtimes). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buf as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Did the copy land intact? Both hashes must exist AND match — a missing hash
 * is NOT a pass. This is the whole point of hash-verification: "we couldn't
 * check" and "it's fine" are different answers and must never collapse.
 */
export function verifiedCopy(sourceSha: string | null, copySha: string | null): boolean {
  return !!sourceSha && !!copySha && sourceSha === copySha;
}

export type EvidenceHealth = {
  total: number;
  backedUp: number;
  failed: number;
  pending: number;
  /** Oldest successful backup in the set — the honest freshness figure. */
  oldestBackupAt: string | null;
  staleHours: number | null;
  /** true when every document is verifiably backed up and fresh. */
  ok: boolean;
  /** Human-readable reason when not ok. Rendered, not swallowed. */
  problem: string | null;
};

const STALE_HOURS = 48;

/** Roll a document set into a status a screen can show without lying. */
export function evidenceHealth(docs: EvidenceDoc[], nowMs: number): EvidenceHealth {
  const total = docs.length;
  const backedUp = docs.filter((d) => d.backup_state === "backed_up").length;
  const failed = docs.filter((d) => d.backup_state === "failed").length;
  const pending = docs.filter((d) => d.backup_state === "pending").length;

  // OLDEST, not newest: one fresh copy says nothing about the other six.
  let oldestMs: number | null = null;
  for (const d of docs) {
    if (d.backup_state !== "backed_up" || !d.backed_up_at) continue;
    const t = new Date(d.backed_up_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (oldestMs == null || t < oldestMs) oldestMs = t;
  }
  const staleHours = oldestMs == null ? null : (nowMs - oldestMs) / 3_600_000;

  let problem: string | null = null;
  if (total === 0) problem = null; // nothing to protect yet — not a failure
  else if (failed > 0) problem = `${failed} document${failed === 1 ? "" : "s"} failed to back up`;
  else if (pending > 0) problem = `${pending} document${pending === 1 ? "" : "s"} not yet backed up`;
  else if (staleHours != null && staleHours > STALE_HOURS) {
    problem = `oldest backup is ${Math.floor(staleHours)}h old`;
  }

  return {
    total, backedUp, failed, pending,
    oldestBackupAt: oldestMs == null ? null : new Date(oldestMs).toISOString(),
    staleHours,
    ok: total === 0 || problem == null,
    problem,
  };
}

/** Documents an asset record needs but doesn't have — the "undefended number" check. */
export function missingEvidence(
  docs: EvidenceDoc[],
  claims: { basis?: boolean; insured?: boolean; grade?: boolean; title?: boolean },
): string[] {
  const have = new Set(docs.map((d) => d.proves));
  const gaps: string[] = [];
  if (claims.basis && !have.has("basis")) gaps.push("basis has no supporting document");
  if (claims.insured && !have.has("insured_value")) gaps.push("insured value has no policy document");
  if (claims.grade && !have.has("grade")) gaps.push("grade has no certificate on file");
  if (claims.title && !have.has("title")) gaps.push("legal title has no document");
  return gaps;
}

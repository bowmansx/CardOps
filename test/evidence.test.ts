import { describe, it, expect } from "vitest";
import { verifiedCopy, evidenceHealth, missingEvidence, sha256Hex, type EvidenceDoc } from "@/lib/cards/evidence";

const doc = (o: Partial<EvidenceDoc>): EvidenceDoc => ({
  id: "d1", proves: "basis", sha256: "abc", backup_state: "backed_up",
  backed_up_at: "2026-07-25T00:00:00Z", ...o,
});
const NOW = new Date("2026-07-25T12:00:00Z").getTime();

describe("verifiedCopy", () => {
  it("passes only when both hashes exist and match", () => {
    expect(verifiedCopy("abc", "abc")).toBe(true);
    expect(verifiedCopy("abc", "def")).toBe(false);
  });

  // The point of hash verification: "we couldn't check" must never be
  // reported as "it's fine". A backup that exists but is truncated is worse
  // than none, because it buys false confidence.
  it("treats a missing hash as UNVERIFIED, not as a pass", () => {
    expect(verifiedCopy(null, "abc")).toBe(false);
    expect(verifiedCopy("abc", null)).toBe(false);
    expect(verifiedCopy(null, null)).toBe(false);
  });
});

describe("evidenceHealth", () => {
  it("is ok when every document is backed up and fresh", () => {
    const h = evidenceHealth([doc({}), doc({ id: "d2" })], NOW);
    expect(h.ok).toBe(true);
    expect(h.backedUp).toBe(2);
    expect(h.problem).toBeNull();
  });

  it("reports failures ahead of anything else", () => {
    const h = evidenceHealth([doc({}), doc({ id: "d2", backup_state: "failed" })], NOW);
    expect(h.ok).toBe(false);
    expect(h.problem).toMatch(/failed to back up/);
  });

  it("flags pending documents rather than counting them as safe", () => {
    const h = evidenceHealth([doc({}), doc({ id: "d2", backup_state: "pending", backed_up_at: null })], NOW);
    expect(h.ok).toBe(false);
    expect(h.pending).toBe(1);
  });

  // One fresh copy says nothing about the other six, so freshness is the
  // OLDEST backup in the set, never the newest.
  it("measures staleness from the oldest backup, not the newest", () => {
    const h = evidenceHealth([
      doc({ id: "old", backed_up_at: "2026-07-20T00:00:00Z" }), // 5 days
      doc({ id: "new", backed_up_at: "2026-07-25T11:00:00Z" }), // 1 hour
    ], NOW);
    expect(h.ok).toBe(false);
    expect(h.problem).toMatch(/oldest backup is \d+h old/);
    expect(h.oldestBackupAt).toBe("2026-07-20T00:00:00.000Z");
  });

  it("an empty set is not a failure — there is nothing to protect yet", () => {
    const h = evidenceHealth([], NOW);
    expect(h.ok).toBe(true);
    expect(h.problem).toBeNull();
  });
});

describe("missingEvidence", () => {
  it("names the undefended claims", () => {
    const gaps = missingEvidence([doc({ proves: "basis" })], { basis: true, insured: true, grade: true });
    expect(gaps).toHaveLength(2);
    expect(gaps.join(" ")).toMatch(/insured value/);
    expect(gaps.join(" ")).toMatch(/grade/);
  });

  it("is silent when every claim is documented", () => {
    const docs = [doc({ proves: "basis" }), doc({ id: "d2", proves: "insured_value" })];
    expect(missingEvidence(docs, { basis: true, insured: true })).toEqual([]);
  });
});

describe("sha256Hex", () => {
  it("hashes bytes to the known digest", async () => {
    // sha256("abc")
    expect(await sha256Hex(new TextEncoder().encode("abc")))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

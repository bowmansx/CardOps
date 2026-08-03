// AN OBLIGATION NOBODY CAN EXECUTE IS AN OBLIGATION NOBODY MEETS (2026-08-02).
//
// `SourceRights.deleteOnTerminationDays` has been declared since the rights
// contract landed — The Card API §5 gives 30 days from cancellation to delete
// stored rows — and nothing in the app could carry it out. A licence term the
// code states and cannot perform is worse than one it never claimed: it reads,
// to anyone auditing this, as a commitment that was made and then ignored.
//
// This is the pure half. It decides WHAT is subject to a purge and by WHEN; the
// route does the deleting, behind an explicit confirmation, because this is the
// only destructive operation in the pricing stack.
//
// TWO THINGS IT WILL NOT DO, both deliberate:
//
//   1. It never touches a row the USER produced. `own_sale`, `manual_paste` and
//      `user_upload` rows are Beau's own records of his own transactions — a
//      vendor's termination clause has no reach over them, and sweeping them up
//      because they sit in the same table would destroy work under cover of
//      compliance. Scope is (source AND provenance='vendor'), never source alone.
//   2. It never silently deletes a ROLLUP. Whether a statistical aggregate
//      derived from a vendor's rows is still that vendor's data is a real legal
//      question with no obvious answer, and guessing either way is wrong. Rollups
//      carrying the source are REPORTED so a person decides.
import type { SourceRights } from "./price-sources/types";

/** Sale provenances a vendor's termination clause can reach. */
export const VENDOR_PROVENANCE = "vendor" as const;

export type RetentionDuty = {
  sourceId: string;
  /** Days after termination within which rows must go. Null = no such term. */
  withinDays: number | null;
  /** When the obligation falls due, given a termination date. */
  dueAt: string | null;
  /** Days remaining. Negative means the deadline has passed. */
  daysLeft: number | null;
  /** True once the deadline is inside a week, or already gone. */
  urgent: boolean;
};

/**
 * What a source's terms require, given the date its subscription ended.
 *
 * `terminatedAt` null means it hasn't — the duty exists in the contract and is
 * not yet due, which is a different state from "no duty" and reads differently
 * on a screen.
 */
export function retentionDuty(
  sourceId: string,
  rights: Pick<SourceRights, "deleteOnTerminationDays">,
  terminatedAt: string | null,
  nowMs = Date.now(),
): RetentionDuty {
  const withinDays = rights.deleteOnTerminationDays;
  if (withinDays == null || !terminatedAt) {
    return { sourceId, withinDays, dueAt: null, daysLeft: null, urgent: false };
  }
  const end = Date.parse(`${terminatedAt.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(end)) {
    return { sourceId, withinDays, dueAt: null, daysLeft: null, urgent: false };
  }
  const dueMs = end + withinDays * 86_400_000;
  const daysLeft = Math.ceil((dueMs - nowMs) / 86_400_000);
  return {
    sourceId,
    withinDays,
    dueAt: new Date(dueMs).toISOString().slice(0, 10),
    daysLeft,
    urgent: daysLeft <= 7,
  };
}

/**
 * What a purge of this source would touch.
 *
 * Counted before anything is deleted, and shown to a person. A destructive
 * operation whose blast radius is only visible afterwards is not one anybody
 * can consent to.
 */
export type PurgeScope = {
  sourceId: string;
  /** Vendor rows attributable to this source — the ones a purge removes. */
  vendorSales: number;
  /**
   * Rows in the same table that this purge will NOT remove, because the user
   * made them. Reported so their survival is a stated outcome, not a surprise.
   */
  userRowsKept: number;
  /**
   * Rollups carrying this source. NOT deleted — surfaced for a human decision,
   * because whether an aggregate derived from a vendor's rows is still that
   * vendor's data is unsettled and guessing either way is wrong.
   */
  rollupsCarrying: number;
  truncated: boolean;
};

/** A one-line account of a purge, for a confirmation dialog. */
export function purgeNarrative(s: PurgeScope): string {
  if (!s.vendorSales && !s.rollupsCarrying) {
    return `Nothing stored from ${s.sourceId}. There is nothing to delete.`;
  }
  const parts = [
    `${s.vendorSales} sale${s.vendorSales === 1 ? "" : "s"} fetched from ${s.sourceId} will be deleted permanently.`,
  ];
  if (s.userRowsKept) {
    parts.push(
      `${s.userRowsKept} row${s.userRowsKept === 1 ? "" : "s"} you entered or sold yourself will be kept — ` +
      `a vendor's terms don't reach your own records.`,
    );
  }
  if (s.rollupsCarrying) {
    parts.push(
      `${s.rollupsCarrying} compacted summar${s.rollupsCarrying === 1 ? "y" : "ies"} also list ${s.sourceId} as a contributing source. ` +
      `Those are NOT touched — whether a statistic derived from a vendor's data is still their data needs a decision, not a default.`,
    );
  }
  if (s.truncated) {
    parts.push("The count stopped at the cap, so the real number is higher.");
  }
  return parts.join(" ");
}

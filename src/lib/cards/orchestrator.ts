// WHICH SOURCES TO ASK, AND WHEN TO STOP (2026-07-30).
//
// Valuation engine Phase 1.4. Every source costs something — money, a rate-limit
// slot, or a second of someone's time — and the cheapest useful answer is almost
// always enough. A card with six of the user's own settled sales does not need a
// vendor call, and making one anyway is how a 5,000-card collection buy turns
// into a 5,000-call bill.
//
// TWO RULES, and the second is the one that is easy to get wrong.
//
//   1. CHEAPEST FIRST. Own-book is free and exact; a vendor call costs money;
//      a deep multi-source sweep costs the most. Walk in that order.
//   2. STOP ON SUFFICIENCY, NOT ON SUCCESS. A source returning rows is not a
//      reason to stop — the question is whether the EVIDENCE now supports an
//      answer at the confidence the caller asked for. Three comps spanning two
//      years is not the same as three from last month, and neither is
//      "sufficient" for a card someone is about to buy.
//
// Pure. The caller supplies the rows and performs the I/O; this decides the
// order and calls the stop. That keeps it testable without a network and keeps
// the RLS context in the caller's hands, which is where it has to be.
import type { ObservedSale } from "./observed-sale";
import type { CardForPricing } from "./price-sources/types";

/**
 * How hard to try, per RUN rather than as a global setting.
 *
 * The same card wants different behaviour depending on the job: pricing a
 * listing wants defensible evidence, insuring a collection wants a number for
 * every card, and deciding whether to buy wants the pessimistic end. A single
 * global "aggression" dial cannot express that, which is why this is an
 * argument.
 */
export type Budget = "fast" | "standard" | "deep";

export type SufficiencyTarget = {
  /** Comps needed before the engine will stop looking. */
  minComps: number;
  /** How recent at least SOME of them must be, in days. */
  freshWithinDays: number;
  /** How many must fall inside that window. */
  minFresh: number;
};

/**
 * What "enough" means at each budget.
 *
 * `fast` is deliberately not "one comp". A single sale is a data point, not a
 * market — it could be a wash trade, a bad photo, or a friend doing a favour.
 * Two is the floor at which disagreement is even visible.
 */
export const SUFFICIENCY: Record<Budget, SufficiencyTarget> = {
  fast:     { minComps: 2, freshWithinDays: 365, minFresh: 1 },
  standard: { minComps: 5, freshWithinDays: 180, minFresh: 2 },
  deep:     { minComps: 12, freshWithinDays: 90, minFresh: 3 },
};

export type SourceCost = {
  id: string;
  /** Money per call. 0 for free sources. */
  costPerCall: number;
  /**
   * Rough seconds a call takes. Breaks ties between free sources: reading rows
   * already in the database beats a network round trip that also costs nothing.
   */
  latency: number;
};

/**
 * The walk order. Cheapest first, latency as the tie-break.
 *
 * Stable for equal cost and latency, so the order two identically-priced
 * sources are asked in does not change between runs — a valuation that reorders
 * its own sources run to run is one nobody can reproduce.
 */
export function costOrder(sources: SourceCost[]): SourceCost[] {
  return [...sources]
    .map((s, i) => ({ s, i }))
    .sort((a, b) =>
      a.s.costPerCall - b.s.costPerCall ||
      a.s.latency - b.s.latency ||
      a.i - b.i)
    .map((x) => x.s);
}

export type Evidence = {
  /** Comps gathered so far, across every source asked. */
  comps: ObservedSale[];
  /** Which sources were asked, in order. */
  asked: string[];
  /** Sources that returned nothing usable, and why. */
  empty: { id: string; note?: string }[];
  /** Money spent so far. */
  spent: number;
};

export const NO_EVIDENCE: Evidence = { comps: [], asked: [], empty: [], spent: 0 };

/**
 * Is what we have enough to stop?
 *
 * DATED COMPS ONLY count toward freshness, because an undated sale cannot be
 * placed in time and so cannot testify to whether the market is current. It
 * still counts toward `minComps` — it is evidence of a clearing price, just
 * evidence of unknown age.
 */
export function isSufficient(
  comps: ObservedSale[], target: SufficiencyTarget, nowMs = Date.parse("2026-07-30"),
): boolean {
  if (comps.length < target.minComps) return false;
  const cutoff = nowMs - target.freshWithinDays * 86_400_000;
  let fresh = 0;
  for (const c of comps) {
    if (!c.soldAt) continue;
    const t = Date.parse(`${c.soldAt}T00:00:00Z`);
    if (Number.isFinite(t) && t >= cutoff) fresh++;
  }
  return fresh >= target.minFresh;
}

export type GatherStep = {
  id: string;
  /** Rows this source contributed, after dedup against what was already held. */
  added: number;
  /** Did the run stop here? */
  stopped: boolean;
  reason?: "sufficient" | "budget-exhausted" | "no-more-sources";
};

export type GatherResult = {
  evidence: Evidence;
  steps: GatherStep[];
  /** True when the walk ended because the evidence was good enough. */
  satisfied: boolean;
  /**
   * Sources NOT asked because the run stopped first.
   *
   * Reported rather than dropped: a valuation built from two of five available
   * sources is a different claim from one built from all five, and the
   * difference has to be visible (rule 10). It is also the honest answer to "why
   * didn't it use PriceCharting?" — usually "it didn't need to".
   */
  skipped: string[];
};

/**
 * Walk the sources cheapest-first, stopping as soon as the evidence is enough.
 *
 * `read` is supplied by the caller and does the I/O. It returns null for a
 * source that failed — DISTINCT from one that returned no rows, because a
 * vendor being down is not evidence that a card has no comps, and treating it
 * as such would let an outage silently reprice an inventory.
 */
export async function gatherComps(
  card: CardForPricing,
  sources: SourceCost[],
  read: (id: string) => Promise<{ sales: ObservedSale[]; note?: string } | null>,
  opts: { budget?: Budget; maxSpend?: number; nowMs?: number } = {},
): Promise<GatherResult> {
  const budget = opts.budget ?? "standard";
  const target = SUFFICIENCY[budget];
  const maxSpend = opts.maxSpend ?? Number.POSITIVE_INFINITY;

  const ordered = costOrder(sources);
  const evidence: Evidence = { comps: [], asked: [], empty: [], spent: 0 };
  const steps: GatherStep[] = [];
  const seen = new Set<string>();
  let satisfied = false;
  let stoppedAt = -1;

  for (let i = 0; i < ordered.length; i++) {
    const src = ordered[i];

    // Check the spend BEFORE the call, not after. Discovering the budget is
    // blown once the money is gone is not a budget.
    if (evidence.spent + src.costPerCall > maxSpend) {
      steps.push({ id: src.id, added: 0, stopped: true, reason: "budget-exhausted" });
      stoppedAt = i;
      break;
    }

    evidence.asked.push(src.id);
    let res: { sales: ObservedSale[]; note?: string } | null = null;
    try {
      res = await read(src.id);
    } catch {
      res = null; // a throw is a failure, not an absence of comps
    }
    // Only charge for a call that happened. A failed source has not sold us
    // anything, and billing for it would break the rule that a cost above zero
    // is a claim something was fetched.
    if (res) evidence.spent += src.costPerCall;

    if (!res || !res.sales.length) {
      evidence.empty.push({ id: src.id, note: res ? res.note : "source failed" });
      steps.push({ id: src.id, added: 0, stopped: false });
      continue;
    }

    let added = 0;
    for (const s of res.sales) {
      // Dedup across sources by (source-scoped id), so the same sale arriving
      // from two vendors counts once. `externalId` is only unique WITHIN a
      // source, hence the prefix.
      const key = `${src.id}:${s.externalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.comps.push(s);
      added++;
    }

    if (isSufficient(evidence.comps, target, opts.nowMs)) {
      satisfied = true;
      steps.push({ id: src.id, added, stopped: true, reason: "sufficient" });
      stoppedAt = i;
      break;
    }
    steps.push({ id: src.id, added, stopped: false });
  }

  if (stoppedAt < 0) {
    // Walked every source without reaching sufficiency. That is a legitimate
    // outcome — thin cards exist — and the caller needs to know the difference
    // between "stopped early because it was enough" and "asked everything and
    // it still is not".
    steps.push({ id: "", added: 0, stopped: true, reason: "no-more-sources" });
  }

  return {
    evidence,
    steps,
    satisfied,
    skipped: stoppedAt < 0 ? [] : ordered.slice(stoppedAt + 1).map((s) => s.id),
  };
}

/** A sentence for the reasoning trace, in plain language. */
export function gatherNarrative(r: GatherResult, budget: Budget = "standard"): string {
  const n = r.evidence.comps.length;
  const asked = r.evidence.asked.filter(Boolean);
  if (!n) {
    return asked.length
      ? `No comps found. Asked ${asked.join(", ")}.`
      : "No sources were available for this card.";
  }
  const head = `${n} comp${n === 1 ? "" : "s"} from ${asked.join(", ")}`;
  if (r.satisfied) {
    return r.skipped.length
      ? `${head} — enough at the ${budget} setting, so ${r.skipped.join(", ")} ${r.skipped.length === 1 ? "was" : "were"} not asked.`
      : `${head} — enough at the ${budget} setting.`;
  }
  // The honest ending: everything was asked and it still is not enough.
  return `${head} — every available source was asked and this is still below the ${budget} threshold, so treat the estimate as thin.`;
}

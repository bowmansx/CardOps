// ONE VALUATION, END TO END (2026-08-02).
//
// The join between four modules that each did their job and reached nobody:
// `orchestrator` decides who to ask and when to stop, `own-book` supplies the
// cheapest and most trustworthy comps, `distill` turns comps into a price, and
// `thin-reason` explains the silence when there is no price to give. Every one
// of them was pure, tested, and unreachable from the app.
//
// This is still pure — no Supabase client, no fetch. The route owns the I/O and
// passes rows in, which is what keeps the RLS context in the caller's hands
// where it has to be (bug class 1) and keeps this testable without a network.
//
// THE ANSWER MAY BE "NO PRICE", and that is a first-class outcome rather than a
// failure. A verdict with `price: null` still carries the reason, the sources
// asked, the ones skipped and what would have to change — because Beau's whole
// objection to a pricing tool was not being able to see where a number came
// from, and "we don't know" with its reasons attached is more useful than a
// confident number nobody can check.
import type { ObservedSale } from "./observed-sale";
import type { CardForPricing, SourceCost, SourceQuote } from "./price-sources/types";
import { distill, type SoldQuotePayload, type DistillAggregate } from "./distill";
import {
  gatherComps, gatherNarrative, SUFFICIENCY,
  type Budget, type GatherResult,
} from "./orchestrator";
import {
  thinReason, methodFor, thinNarrative, THIN_LABEL,
  type ThinContext, type ThinReason, type TransferMethod,
} from "./thin-reason";

/**
 * A source that never declared its cost.
 *
 * Sorted LAST, not first. An adapter with no `cost` is one nobody has priced,
 * and defaulting it to zero would put an unpriced vendor at the head of a walk
 * order whose entire purpose is to spend nothing it does not have to. Same
 * posture as `mayPersist` default-denying an unknown source: "we never checked"
 * must not read the same as "free".
 */
export const UNPRICED_SOURCE: Omit<SourceCost, "id"> = {
  costPerCall: Number.MAX_SAFE_INTEGER,
  latency: Number.MAX_SAFE_INTEGER,
};

/** The shape `sourceCosts` needs from an adapter — kept narrow so tests can fake it. */
export type CostableSource = {
  id: string;
  enabled: () => boolean;
  handles: (card: CardForPricing) => boolean;
  cost?: Omit<SourceCost, "id">;
};

/**
 * The sources worth asking for THIS card, with their declared costs.
 *
 * Filters on both `enabled` (is it configured here) and `handles` (does it cover
 * this category) before costing anything — asking Scryfall about a baseball card
 * is a guaranteed miss, and a guaranteed miss still costs a round trip.
 */
export function sourceCosts(card: CardForPricing, sources: CostableSource[]): SourceCost[] {
  return sources
    .filter((s) => s.enabled() && s.handles(card))
    .map((s) => ({ id: s.id, ...(s.cost ?? UNPRICED_SOURCE) }));
}

/**
 * How much to trust the number.
 *
 * Derived from the evidence rather than asserted, and deliberately coarse —
 * three buckets a person can act on beat a percentage that implies precision the
 * inputs do not have.
 */
export type Confidence = "firm" | "indicative" | "thin";

export type Verdict = {
  /** The price, or null when the engine abstains. Both are real answers. */
  price: number | null;
  currency: string;
  confidence: Confidence;
  /** The quote behind `price`, carrying the sample and window. */
  quote: SourceQuote | null;
  /** What the number rests on — the provenance chip's contents. */
  evidence: SoldQuotePayload | null;
  /** Sources asked, in order. */
  asked: string[];
  /** Sources NOT asked because the walk stopped first (rule 10). */
  skipped: string[];
  /** Sources that returned nothing, and why. */
  empty: { id: string; note?: string }[];
  /** Money spent reaching this answer. */
  spent: number;
  /** Set only when the engine could not price the card directly. */
  thin: {
    reason: ThinReason;
    label: string;
    /** The transfer this reason licenses. "none" means abstain. */
    method: TransferMethod;
    narrative: string;
  } | null;
  /** Plain-language account of the whole run, for the reasoning trace. */
  narrative: string;
};

/**
 * Confidence from what was actually gathered.
 *
 * `firm` requires clearing the DEEP bar regardless of the budget the caller
 * asked for. A fast run that happened to find twelve fresh comps is firm; a deep
 * run that scraped together five is not. Tying confidence to the budget would
 * mean the same evidence reported differently depending on how hard someone
 * asked, which is backwards — the evidence does not change because the question
 * was urgent.
 */
export function confidenceFrom(comps: ObservedSale[], satisfied: boolean, nowMs: number): Confidence {
  const deep = SUFFICIENCY.deep;
  const cutoff = nowMs - deep.freshWithinDays * 86_400_000;
  const fresh = comps.filter((c) => {
    if (!c.soldAt) return false;
    const t = Date.parse(`${c.soldAt}T00:00:00Z`);
    return Number.isFinite(t) && t >= cutoff;
  }).length;

  if (comps.length >= deep.minComps && fresh >= deep.minFresh) return "firm";
  return satisfied ? "indicative" : "thin";
}

/**
 * Turn a completed gather into the answer.
 *
 * `thinCtx` is only consulted when there is no price — computing a thin reason
 * for a card that priced cleanly would invite a caller to show "too rare" beside
 * a card selling twice a week.
 */
export function verdictFor(
  card: CardForPricing,
  gather: GatherResult,
  thinCtx: ThinContext,
  opts: { budget?: Budget; nowMs?: number; aggregate?: DistillAggregate } = {},
): Verdict {
  const budget = opts.budget ?? "standard";
  const now = opts.nowMs ?? Date.now();
  const { comps, asked, empty, spent } = gather.evidence;

  // Every comp gathered, distilled as one quote. Sources are NOT kept separate
  // here the way `distillBySource` keeps them for the card page: the orchestrator
  // stopped as soon as the evidence was sufficient, so a per-source breakdown
  // would usually be a single source and read as a comparison that was never made.
  const d = distill(comps, card, "engine", opts.aggregate);

  const confidence = confidenceFrom(comps, gather.satisfied, now);
  const gatherLine = gatherNarrative(gather, budget);

  if (d.quote) {
    return {
      price: d.quote.price,
      currency: d.quote.currency,
      confidence,
      quote: d.quote,
      evidence: (d.quote.payload as SoldQuotePayload) ?? null,
      asked, skipped: gather.skipped, empty, spent,
      thin: null,
      narrative: gatherLine,
    };
  }

  // NO PRICE. Say why, and say what kind of evidence would answer it — the
  // reason decides the method, and applying the wrong one prices a 2026 rookie
  // off a 2019 sibling.
  const reason = thinReason({ ...thinCtx, nowMs: now });
  const method = methodFor(reason);

  // A comp set that existed but was thrown away is a DIFFERENT story from one
  // that was never found, and the difference is actionable: condition mismatch
  // means the card needs a comp at its own grade, an unresolvable basis means a
  // venue's premium is uncited. Silent either way would read as "no data".
  const discarded: string[] = [];
  if (d.excluded) discarded.push(`${d.excluded} whose price basis couldn't be resolved`);
  if (d.unconfirmed) discarded.push(`${d.unconfirmed} still provisional`);
  const held = discarded.length ? `, and ${discarded.join(" and ")} were held out` : "";

  let dropped = "";
  if (comps.length) {
    const n = `${comps.length} sale${comps.length === 1 ? "" : "s"}`;
    dropped = d.usable > 0
      // MATCHED AND STILL NO PRICE. Only the caller's own `min_comps` can do
      // this, and saying "nothing matched" here would send someone hunting for
      // comps they already have.
      ? ` ${n} were found and ${d.usable} matched this card's condition, but your pricing rules ask for more before naming a number.`
      : ` ${n} were found but none matched this card's condition${held}.`;
  }

  return {
    price: null,
    currency: "USD",
    confidence: "thin",
    quote: null,
    evidence: null,
    asked, skipped: gather.skipped, empty, spent,
    thin: {
      reason,
      label: THIN_LABEL[reason],
      method,
      narrative: thinNarrative(reason, thinCtx),
    },
    narrative: `${gatherLine}${dropped}`,
  };
}

/**
 * The whole run: walk the sources, then decide.
 *
 * A thin convenience over `gatherComps` + `verdictFor` so a caller does not have
 * to remember to do both — and so the two can still be used apart, which the
 * tests do.
 */
export async function runValuation(
  card: CardForPricing,
  sources: SourceCost[],
  read: (id: string) => Promise<{ sales: ObservedSale[]; note?: string } | null>,
  thinCtx: ThinContext,
  opts: { budget?: Budget; maxSpend?: number; nowMs?: number; aggregate?: DistillAggregate } = {},
): Promise<{ verdict: Verdict; gather: GatherResult }> {
  const gather = await gatherComps(card, sources, read, opts);
  return { verdict: verdictFor(card, gather, thinCtx, opts), gather };
}

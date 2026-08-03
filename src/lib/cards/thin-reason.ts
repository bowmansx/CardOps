// WHY IS THIS CARD THIN? (2026-07-30)
//
// `tierOf` in `liquidity.ts` classifies from measured velocity and returns
// `unknown` when there is nothing to measure. That is honest, and it is also
// where the ladder runs out: `unknown` conflates two situations that need
// OPPOSITE methods, and picking the wrong one is not a small error.
//
//   TOO_NEW  — no history because the card has not existed long enough. A 2026
//              product three weeks old. Its siblings do not exist yet either, so
//              reaching sideways finds nothing. The only transfer available is
//              from LAST YEAR'S equivalent product: same brand, same parallel
//              tier, adjusted for player tier.
//
//   TOO_RARE — history exists for the set, this VARIANT does not trade. A /5
//              parallel of a card whose base version sells daily. Reaching
//              sideways is exactly right here, because the siblings are real and
//              actively priced.
//
// Apply a TOO_RARE method to a TOO_NEW card and you price a 2026 rookie off a
// 2019 sibling that shares a name and nothing else. Apply a TOO_NEW method to a
// TOO_RARE card and you reach for a prior-year product when the answer was
// sitting one parallel over.
//
// A REFINEMENT, NOT A SEVENTH TIER. `tierOf` keeps its six values and every
// existing consumer keeps working; this answers a different question about the
// same classification. Adding a tier would have forced every switch statement in
// the app to be re-checked.
//
// Pure. No I/O — the caller supplies what it knows about the wider set.

/** Why a card has too little history to price directly. */
export type ThinReason = "too_new" | "too_rare" | "gone_quiet" | "unknown";

export const THIN_LABEL: Record<ThinReason, string> = {
  too_new: "Too new",
  too_rare: "Too rare",
  gone_quiet: "Gone quiet",
  unknown: "Not enough to say",
};

export const THIN_BLURB: Record<ThinReason, string> = {
  too_new: "This product is too recent to have a market yet. The closest evidence is last year's equivalent.",
  too_rare: "The set trades, this version doesn't. The closest evidence is a neighbouring parallel.",
  gone_quiet: "It used to trade and stopped. Old prices may not hold.",
  unknown: "Not enough information about the wider set to say why this is thin.",
};

/** What the caller knows about the card and the set around it. */
export type ThinContext = {
  /** The card's own year, from its identity. */
  issueYear: number | null;
  /**
   * The product's actual release date, when anything knows it.
   *
   * Almost always null today — nothing in the schema records it. It is here
   * because the year alone CANNOT answer "is this new": a 2026 product might
   * have released in January or in November, and measuring age from January 1st
   * calls the November one eight months old on the day it ships. With a real
   * date this becomes precise; without one, see the year fallback below.
   */
  releaseDate?: string | null;
  /**
   * Have ANY variants of this set sold — the base card, other parallels, other
   * players? This is what separates the two cases, and it is the one fact the
   * caller has to go and get.
   */
  setHasSales: boolean;
  /** The card's own most recent sale, in days. Null when it has never sold. */
  lastSaleDays: number | null;
  /** Sales of this exact card in the last 365 days. */
  ownSales365: number;
  nowMs?: number;
};

/**
 * How long a product needs to be out before an empty market means SCARCITY
 * rather than YOUTH.
 *
 * 120 days is a judgement, and a soft one. A product released last month with no
 * sales tells you nothing; the same product a year on with no sales is telling
 * you something real. The boundary between those is genuinely fuzzy and this
 * number should move once there are outcomes to calibrate against.
 */
export const NEW_PRODUCT_DAYS = 120;

/**
 * Why is this card thin?
 *
 * Only meaningful for cards the velocity ladder could not rate. A card that
 * trades needs no excuse, and calling this on one would invite a caller to show
 * "too rare" beside a card selling twice a week.
 */
export function thinReason(ctx: ThinContext): ThinReason {
  const now = ctx.nowMs ?? Date.now();

  // IT SOLD, AND STOPPED. Distinct from never having sold: there is a real price
  // in the past, it is just old. Reaching sideways is unnecessary — the card's
  // own history is the best evidence, it simply needs discounting for age.
  if (ctx.ownSales365 === 0 && ctx.lastSaleDays != null) return "gone_quiet";

  // TOO NEW. The product itself has barely existed, so an empty market is the
  // expected state rather than a finding. Checked BEFORE rarity, because a
  // three-week-old /5 is too new AND too rare, and treating it as rare would
  // send the transfer sideways into siblings that have not traded either.
  //
  // TWO PRECISIONS, and the difference is honest rather than cosmetic.
  if (ctx.releaseDate) {
    // Known release date: a real measurement.
    const ageDays = (now - Date.parse(`${ctx.releaseDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
    if (Number.isFinite(ageDays)) return ageDays < NEW_PRODUCT_DAYS ? "too_new" : (ctx.setHasSales ? "too_rare" : "unknown");
  }
  if (ctx.issueYear != null) {
    // YEAR GRANULARITY IS ALL WE HAVE, so the test is "is this the current year
    // or later" rather than a day count. Measuring from January 1st was the
    // first version of this and it was wrong: it called a November 2026 product
    // eight months old on release day.
    //
    // The known imprecision, stated rather than hidden: a product released in
    // JANUARY still reads as new in December. That is conservatively wrong — it
    // sends the transfer to a comparable product instead of a sibling — and for
    // a card with no sales after eleven months, both are a reach. A
    // `releaseDate` on the identity fixes it properly.
    const nowYear = new Date(now).getUTCFullYear();
    if (ctx.issueYear >= nowYear) return "too_new";
  }

  // TOO RARE. The set trades and this variant does not — which is the one case
  // where analog transfer across parallels is the right method, because the
  // neighbours are real and actively priced.
  if (ctx.setHasSales) return "too_rare";

  // Neither. Without knowing whether the set trades, the honest answer is that
  // we do not know why — and `unknown` here means the CALLER did not supply
  // enough context, not that the card is mysterious.
  return "unknown";
}

/** Which transfer method a reason licenses. Never guess this from the tier. */
export type TransferMethod = "comparable_product" | "analog_parallel" | "own_history_discounted" | "none";

export function methodFor(reason: ThinReason): TransferMethod {
  switch (reason) {
    // Last year's equivalent product — same brand, same parallel tier.
    case "too_new": return "comparable_product";
    // A neighbouring parallel of the same card.
    case "too_rare": return "analog_parallel";
    // Its own past sales, discounted for age.
    case "gone_quiet": return "own_history_discounted";
    // NO METHOD. Not a fallback to the least-bad option — with no idea why a
    // card is thin, any transfer is a guess wearing a method's name, and the
    // engine should abstain and say so.
    default: return "none";
  }
}

/** A sentence for the reasoning trace. */
export function thinNarrative(reason: ThinReason, ctx: ThinContext): string {
  switch (reason) {
    case "too_new":
      return `No sales yet — ${ctx.issueYear ?? "this"} product is too recent to have a market. Priced from last year's equivalent.`;
    case "too_rare":
      return "The set trades but this version doesn't. Priced from a neighbouring parallel.";
    case "gone_quiet":
      return ctx.lastSaleDays != null
        ? `No sale in ${Math.round(ctx.lastSaleDays / 30)} months. Its own past prices are the best evidence, discounted for age.`
        : "It used to trade and stopped.";
    default:
      return "Not enough sales, and not enough information about the wider set to say why.";
  }
}

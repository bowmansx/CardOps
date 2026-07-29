// What a sale price ACTUALLY INCLUDES, and how to put two of them on the same
// footing (2026-07-29).
//
// A median is only meaningful across prices that mean the same thing, and they
// do not. The Card API's own field reference says so in as many words:
//
//   price — "For eBay: all-in buyer price. For Goldin: hammer price only —
//   buyer also pays ~22% buyer's premium on top."
//   Goldin note — "~22% current, ~20% pre-2022 ... eBay prices are all-in.
//   Factor this in when comparing values across platforms."
//
// Nothing factored it in. The distill took a flat median of every matched sale,
// so a Goldin hammer price and an all-in eBay price landed in the same median
// with nothing distinguishing them — a card comped mostly off Goldin read
// roughly 22% cheap, and one comped off a mix read as neither.
//
// THE SPLIT OF RESPONSIBILITY MATTERS, because it is what keeps this
// vendor-neutral:
//
//   - WHETHER a given row arrives as hammer or all-in is a fact about the
//     SOURCE. One vendor may hand back Goldin's hammer figure untouched;
//     another may normalize before it ever reaches us. Only the adapter knows,
//     so the adapter stamps `priceBasis` on each ObservedSale.
//   - WHAT the premium is — ~22% now, ~20% before 2022 — is a fact about the
//     auction house itself, true regardless of who reports it. It lives here,
//     once.
//
// Get that backwards and a second vendor either silently double-counts a
// premium already included, or fails to add one that isn't.

/** What a stored `price` includes. */
export type PriceBasis = "all_in" | "hammer" | "unknown";

/**
 * Buyer's premium by auction house and era — a property of the VENUE.
 *
 * Only houses whose rate we can cite are listed. Lelands, SCP, Hakes and REA
 * are auction houses too, and all of them almost certainly charge a premium,
 * but no source we have states a rate. Assuming one would be defaulting a money
 * field to a convenient guess, which is exactly what PREVENTION RULE 9 forbids.
 * They resolve to no rate, their sales are excluded from medians, and the
 * exclusion is REPORTED rather than silent (rule 10) — an honest smaller comp
 * set beats a confident wrong number.
 *
 * One line from any of those houses turns each into an entry here.
 */
const BUYERS_PREMIUM: Record<string, { current: number; pre2022: number }> = {
  // "~22% current, ~20% pre-2022" — The Card API field reference.
  goldin: { current: 0.22, pre2022: 0.20 },
};

/**
 * The premium era boundary. Goldin's rate moved at the start of 2022; a sale
 * with no date can't be placed on either side of it, so it gets no conversion.
 */
function premiumFor(platform: string | null | undefined, soldAt: string | null | undefined): number | null {
  if (!platform) return null;
  const p = BUYERS_PREMIUM[platform.trim().toLowerCase()];
  if (!p) return null;
  const year = Number(String(soldAt ?? "").slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return null; // undated → no guess
  return year < 2022 ? p.pre2022 : p.current;
}

/** Do we know how to convert this venue's hammer price to all-in? */
export function hasPremiumRate(platform: string | null | undefined): boolean {
  return !!platform && !!BUYERS_PREMIUM[platform.trim().toLowerCase()];
}

export type NormalizedPrice =
  | { ok: true; price: number; converted: boolean }
  | { ok: false; reason: "unknown_basis" | "no_premium_rate" | "bad_price" };

/**
 * Convert one sale to an ALL-IN price — what the buyer actually paid.
 *
 * Returns ok:false rather than a number whenever the conversion can't be made
 * honestly. The caller must count those and surface them; silently dropping
 * them would thin a comp set without anyone seeing it happen.
 */
export function toAllIn(
  price: number,
  basis: PriceBasis,
  platform: string | null | undefined,
  soldAt: string | null | undefined,
): NormalizedPrice {
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "bad_price" };
  if (basis === "all_in") return { ok: true, price: round2(price), converted: false };
  if (basis === "unknown") return { ok: false, reason: "unknown_basis" };

  // hammer → all-in, but only at a rate we can actually cite.
  const pct = premiumFor(platform, soldAt);
  if (pct == null) return { ok: false, reason: "no_premium_rate" };
  return { ok: true, price: round2(price * (1 + pct)), converted: true };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The minimum a sale must expose to be normalized — deliberately structural,
 *  so a stored row and a freshly-fetched one both satisfy it. */
export type BasisInput = {
  price: number | string;
  priceBasis: PriceBasis;
  platform: string | null;
  soldAt: string | null;
};

export type ExclusionReason = Exclude<Extract<NormalizedPrice, { ok: false }>["reason"], "bad_price">;

export type BasisPartition<T> = {
  /** Sales usable in a median, with the all-in figure alongside the original. */
  usable: (T & { allIn: number; converted: boolean })[];
  /** Dropped because the basis or the premium rate is unknown. */
  excluded: { platform: string | null; reason: ExclusionReason }[];
};

/**
 * Split a set of sales into what can be medianed and what had to be dropped.
 *
 * Deliberately returns both halves. A function that returned only `usable`
 * would make an incomplete comp set indistinguishable from a complete one,
 * which is the failure PREVENTION RULE 4 exists to stop.
 */
export function partitionByBasis<T extends BasisInput>(sales: T[]): BasisPartition<T> {
  const usable: BasisPartition<T>["usable"] = [];
  const excluded: BasisPartition<T>["excluded"] = [];
  for (const s of sales) {
    const n = toAllIn(Number(s.price), s.priceBasis, s.platform, s.soldAt);
    if (n.ok) usable.push({ ...s, allIn: n.price, converted: n.converted });
    // A junk price was never a sale; reporting it would overstate how much real
    // data was dropped.
    else if (n.reason !== "bad_price") excluded.push({ platform: s.platform, reason: n.reason });
  }
  return { usable, excluded };
}

/** A one-line note for the UI when sales were dropped. Null when none were. */
export function exclusionNote(excluded: BasisPartition<BasisInput>["excluded"]): string | null {
  if (!excluded.length) return null;
  const platforms = [...new Set(excluded.map((e) => e.platform).filter(Boolean))];
  const who = platforms.length ? platforms.join(", ") : "some platforms";
  return `${excluded.length} sale${excluded.length === 1 ? "" : "s"} excluded — ${who} report a hammer price whose buyer's premium we don't have a published rate for.`;
}

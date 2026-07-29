// What a sale price ACTUALLY INCLUDES, per platform (2026-07-29).
//
// A median is only meaningful across prices that mean the same thing, and they
// do not. The Card API's own field reference says so in as many words:
//
//   price — "For eBay: all-in buyer price. For Goldin: hammer price only —
//   buyer also pays ~22% buyer's premium on top."
//   Goldin note — "~22% current, ~20% pre-2022 ... eBay prices are all-in.
//   Factor this in when comparing values across platforms."
//
// Nothing factored it in. `distillSales` took a flat median of every matched
// sale, so a Goldin hammer price and an all-in eBay price landed in the same
// median with nothing distinguishing them — a card comped mostly off Goldin
// read roughly 22% cheap, and one comped off a mix read as neither.
//
// THE UNDOCUMENTED HOUSES ARE THE INTERESTING CASE. The vendor documents the
// basis for eBay, TCGplayer and Goldin. It says nothing about Lelands, SCP,
// Hakes or REA — all auction houses, all of which almost certainly charge a
// buyer's premium, none of which state a rate we can cite. Assuming "all-in"
// would be defaulting a money field to a convenient guess, which is exactly
// what PREVENTION RULE 9 forbids. They are `unknown`, they are excluded from
// the median, and the exclusion is REPORTED rather than silent (rule 10) so a
// thinned comp set is visible instead of looking like a complete one.
//
// Fixing this properly needs one line from the vendor: the premium each house
// charges. Until then the honest answer is a smaller comp set that says so.

/** What the stored `price` includes. */
export type PriceBasis = "all_in" | "hammer" | "unknown";

/**
 * Basis by platform, keyed lowercase — the API returns display casing ("eBay",
 * "SCP Auctions") and we never want a casing change to silently reclassify
 * money.
 *
 * Only entries the vendor DOCUMENTS are listed. Anything absent resolves to
 * "unknown", so a platform added upstream tomorrow starts excluded rather than
 * quietly joining the median on an assumption nobody made deliberately.
 */
const DOCUMENTED_BASIS: Record<string, PriceBasis> = {
  ebay: "all_in",
  tcgplayer: "all_in",
  goldin: "hammer",
};

/** Buyer's premium by platform and era — only where the vendor states a rate. */
const BUYERS_PREMIUM: Record<string, { current: number; pre2022: number }> = {
  // "~22% current, ~20% pre-2022" — The Card API field reference.
  goldin: { current: 0.22, pre2022: 0.20 },
};

export function basisFor(platform: string | null | undefined): PriceBasis {
  if (!platform) return "unknown";
  return DOCUMENTED_BASIS[platform.trim().toLowerCase()] ?? "unknown";
}

/**
 * The premium era boundary. Goldin's rate moved at the start of 2022; a sale
 * with no date can't be placed on either side of it, so it gets no conversion.
 */
function premiumFor(platform: string, soldAt: string | null | undefined): number | null {
  const p = BUYERS_PREMIUM[platform.trim().toLowerCase()];
  if (!p) return null;
  const year = Number(String(soldAt ?? "").slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return null; // undated → no guess
  return year < 2022 ? p.pre2022 : p.current;
}

export type NormalizedPrice =
  | { ok: true; price: number; basis: PriceBasis; converted: boolean }
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
  platform: string | null | undefined,
  soldAt: string | null | undefined,
): NormalizedPrice {
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "bad_price" };

  const basis = basisFor(platform);
  if (basis === "all_in") return { ok: true, price: round2(price), basis, converted: false };
  if (basis === "unknown") return { ok: false, reason: "unknown_basis" };

  // hammer → all-in, but only at a rate the vendor actually publishes.
  const pct = premiumFor(String(platform), soldAt);
  if (pct == null) return { ok: false, reason: "no_premium_rate" };
  return { ok: true, price: round2(price * (1 + pct)), basis, converted: true };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type BasisPartition<T> = {
  /** Sales usable in a median, price rewritten to all-in. */
  usable: (T & { allIn: number; converted: boolean })[];
  /** Dropped because the basis or the premium rate is unknown. */
  excluded: { platform: string | null; reason: NonNullable<Extract<NormalizedPrice, { ok: false }>["reason"]> }[];
};

/**
 * Split a set of sales into what can be medianed and what had to be dropped.
 *
 * Deliberately returns both halves. A function that returned only `usable`
 * would make an incomplete comp set indistinguishable from a complete one,
 * which is the failure PREVENTION RULE 4 exists to stop.
 */
export function partitionByBasis<T extends { price?: number | string | null; platform?: string | null; sold_at?: string | null; sale_date?: string | null }>(
  sales: T[],
): BasisPartition<T> {
  const usable: BasisPartition<T>["usable"] = [];
  const excluded: BasisPartition<T>["excluded"] = [];
  for (const s of sales) {
    const n = toAllIn(Number(s.price), s.platform, s.sold_at ?? s.sale_date);
    if (n.ok) usable.push({ ...s, allIn: n.price, converted: n.converted });
    else if (n.reason !== "bad_price") excluded.push({ platform: s.platform ?? null, reason: n.reason });
  }
  return { usable, excluded };
}

/** A one-line note for the UI when sales were dropped. Null when none were. */
export function exclusionNote(excluded: BasisPartition<unknown>["excluded"]): string | null {
  if (!excluded.length) return null;
  const platforms = [...new Set(excluded.map((e) => e.platform).filter(Boolean))];
  const who = platforms.length ? platforms.join(", ") : "some platforms";
  return `${excluded.length} sale${excluded.length === 1 ? "" : "s"} excluded — ${who} report a hammer price whose buyer's premium we don't have a published rate for.`;
}

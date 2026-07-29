// WHAT YOU KEEP (Beau, 2026-07-29).
//
// The backward half already existed: `card_sell` takes the fees you actually
// paid and records net_proceeds and profit_loss. This is the FORWARD half — the
// question you have before you decide, not after:
//
//   "An offer came in at $340. Your break-even is $187 — lot #7's draw of $88,
//    plus $32 grading, plus $4 shipping in — and you keep $271 after fees."
//
// eBay shipped a free camera-scan price guide backed by two years of their own
// transactions in March 2026. You cannot out-accurate the company that owns the
// transactions, and there is no point trying. **What they cannot print is this
// sentence**, because it needs a cost basis they do not have. Market value is
// the commodity; what you keep is the product.
//
// THREE RULES THIS FILE EXISTS TO ENFORCE:
//
// 1. A fee rate is EVIDENCE OR IT IS NOTHING. The best rate is the one derived
//    from your own settled sales — it already includes your store subscription,
//    your category, your promoted-listing spend and every quirk a published
//    table misses. A published schedule is the fallback and is flagged as
//    unverified. Neither means NO ESTIMATE, not a plausible guess (rule 9).
// 2. Break-even is not basis plus a percentage. Fees are charged ON the sale
//    price, so raising the price raises the fee — the equation has to be
//    inverted, not marked up. The naive version undershoots, which means telling
//    someone an offer clears when it loses money.
// 3. A fixed fee is PER ORDER, not per line (rule 12). Five cards in one order
//    pay one $0.30, not five.

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One band of a tiered percentage. `upTo: null` is the top band.
 *
 * Tiers are not a nicety. eBay's trading-card rate is 13.25% up to $7,500 and
 * 2.35% on the portion above — so a flat 13.25% on a $10,000 slab computes
 * $1,325 where the truth is $1,052.50. A $272 error, on exactly the cards where
 * the number matters most.
 */
export type FeeTier = { upTo: number | null; pct: number };

/** Per-order fee bands, by ORDER TOTAL. `upTo: null` is the top band. */
export type PerOrderTier = { upTo: number | null; amount: number };

/**
 * A platform's published fee structure.
 *
 * `verifiedAt` is nullable and load-bearing: a schedule nobody has checked
 * produces an estimate flagged as unverified, so a number that might be stale
 * never renders as fact.
 */
export type FeeSchedule = {
  platform: string;
  /**
   * Percentage bands applied to the feeable amount.
   *
   * eBay's card threshold is stated "calculated per item", so these apply to one
   * card's own feeable total rather than the whole order's.
   */
  tiers: FeeTier[];
  /**
   * Fixed fee charged once PER ORDER, banded by order total.
   *
   * eBay: "For orders $10.00 or less the per order fee is $0.30, for orders over
   * $10.00 the per order fee is $0.40." A flat $0.40 overstates the fee on every
   * sub-$10 card, which is most of a real collection by count.
   */
  perOrderTiers: PerOrderTier[];
  /**
   * Does the percentage apply to the shipping the buyer paid?
   *
   * On eBay it does — the final value fee is calculated on the total amount of
   * the sale including shipping and handling. Treating shipping as fee-free
   * understates the fee on every low-value card, which is most of them.
   */
  pctAppliesToShipping: boolean;
  /**
   * Does the platform charge its percentage on SALES TAX it collected?
   *
   * eBay does, in as many words: the total amount of the sale "includes the item
   * price, any handling charges, any shipping costs collected from the buyer,
   * sales tax, and any other applicable fees." Almost nothing models this, and
   * it makes the real fee meaningfully higher than price + shipping implies.
   */
  pctAppliesToSalesTax: boolean;
  /** Where the numbers came from. Required — an uncited rate is not usable. */
  source: string;
  /** ISO date the rate was last confirmed against the source, or null. */
  verifiedAt: string | null;
};

/** The percentage fee on a feeable amount, walking the bands. */
export function tieredPct(feeable: number, tiers: FeeTier[]): number {
  let fee = 0;
  let floor = 0;
  for (const t of tiers) {
    const ceil = t.upTo ?? Infinity;
    if (feeable <= floor) break;
    fee += (Math.min(feeable, ceil) - floor) * t.pct;
    floor = ceil;
  }
  return fee;
}

/** The per-order fee for an order of this total. */
export function perOrderFee(orderTotal: number, tiers: PerOrderTier[]): number {
  for (const t of tiers) if (orderTotal <= (t.upTo ?? Infinity)) return t.amount;
  return tiers.length ? tiers[tiers.length - 1].amount : 0;
}

/** Which band a feeable amount falls in — the marginal rate and its floor. */
function bandFor(feeable: number, tiers: FeeTier[]): { pct: number; floor: number; feeBelow: number } {
  let floor = 0;
  let feeBelow = 0;
  for (const t of tiers) {
    const ceil = t.upTo ?? Infinity;
    if (feeable <= ceil) return { pct: t.pct, floor, feeBelow };
    feeBelow += (ceil - floor) * t.pct;
    floor = ceil;
  }
  const last = tiers[tiers.length - 1];
  return { pct: last?.pct ?? 0, floor, feeBelow };
}

/**
 * Schedules, ADOPTED FROM THE EXISTING APP PRESETS.
 *
 * These numbers came from the `FEES` table that lived inside `SellForm.tsx`,
 * where they were unreachable by anything else — which is exactly why no
 * break-even or forward estimate could exist. They are Beau's own figures,
 * already tuned against real sales, and they beat my recollection: I had written
 * eBay at 13.35% + $0.30 and his table says **13.25% + $0.40**. His wins.
 *
 * Still marked UNVERIFIED. The comment on the original table read "approximate,
 * 2026 — always editable; platforms change fees", which is an honest admission
 * that they are estimates. Every figure built on one carries `unverifiedRate`,
 * and confirming a rate is a two-minute job for whoever sells there — at which
 * point `verifiedAt` gets a date and the flag clears.
 *
 * NOTE "other" is deliberately absent. Its preset was 0% + $0, meaning "no
 * preset, enter fees yourself" — but a 0% SCHEDULE is the claim that the
 * platform takes nothing, which is exactly what rule 9 forbids. It resolves to
 * `none` instead, so the forward estimate abstains rather than lying.
 */
export const FEE_SCHEDULES: Record<string, FeeSchedule> = {
  // VERIFIED 2026-07-29 against ebay.com/help/selling/fees-credits-invoices/
  // selling-fees?id=4822. Quoted for Sports Trading Cards, Non-Sport Trading
  // Cards and Collectible Card Games:
  //   "13.25% on total amount of the sale up to $7,500 calculated per item
  //    2.35% on the portion of the sale over $7,500"
  //   "For orders $10.00 or less the per order fee is $0.30, for orders over
  //    $10.00 the per order fee is $0.40."
  //   "The total amount of the sale includes the item price, any handling
  //    charges, any shipping costs collected from the buyer, sales tax, and any
  //    other applicable fees."
  //
  // CAVEAT THAT MATTERS: eBay STORE SUBSCRIBERS pay different fees on a separate
  // page, not read. If Beau has a Store, this schedule is wrong for him — which
  // is precisely why his own measured rate outranks it the moment five settled
  // sales exist.
  ebay: {
    platform: "eBay",
    tiers: [{ upTo: 7500, pct: 0.1325 }, { upTo: null, pct: 0.0235 }],
    perOrderTiers: [{ upTo: 10, amount: 0.3 }, { upTo: null, amount: 0.4 }],
    pctAppliesToShipping: true,
    pctAppliesToSalesTax: true,
    source: "eBay Selling fees help page, Trading Cards categories — verified 2026-07-29 (non-Store rates)",
    verifiedAt: "2026-07-29",
  },
  whatnot: {
    platform: "Whatnot",
    tiers: [{ upTo: null, pct: 0.109 }],
    perOrderTiers: [{ upTo: null, amount: 0.3 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false,
    source: "app preset — Whatnot ≈ 8% + ~2.9% + $0.30 processing — NEEDS CONFIRMING", verifiedAt: null,
  },
  tcgplayer: {
    platform: "TCGplayer",
    tiers: [{ upTo: null, pct: 0.1275 }],
    perOrderTiers: [{ upTo: null, amount: 0.3 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false,
    source: "app preset — TCGplayer ≈ 10.25% + 2.5% + $0.30 — NEEDS CONFIRMING", verifiedAt: null,
  },
  mercari: {
    platform: "Mercari",
    tiers: [{ upTo: null, pct: 0.129 }],
    perOrderTiers: [{ upTo: null, amount: 0.5 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false,
    source: "app preset — Mercari ≈ 10% + processing — NEEDS CONFIRMING", verifiedAt: null,
  },
  comc: {
    // Cash-out only; COMC's storage and processing fees are charged separately
    // and are not a function of the sale price, so they cannot live in a rate.
    platform: "COMC",
    tiers: [{ upTo: null, pct: 0.05 }],
    perOrderTiers: [{ upTo: null, amount: 0 }],
    pctAppliesToShipping: false, pctAppliesToSalesTax: false,
    source: "app preset — COMC ≈ 5% cash-out, storage fees separate — NEEDS CONFIRMING", verifiedAt: null,
  },
  square: {
    platform: "Square",
    tiers: [{ upTo: null, pct: 0.029 }],
    perOrderTiers: [{ upTo: null, amount: 0.3 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false,
    source: "app preset — Square ≈ 2.9% + $0.30 — NEEDS CONFIRMING", verifiedAt: null,
  },
  shop: {
    platform: "Own shop",
    tiers: [{ upTo: null, pct: 0.029 }],
    perOrderTiers: [{ upTo: null, amount: 0.3 }],
    pctAppliesToShipping: true, pctAppliesToSalesTax: false,
    source: "app preset — own shop, card processing ≈ 2.9% + $0.30 — NEEDS CONFIRMING", verifiedAt: null,
  },
};

/** Human note for a platform's preset, for the sell form's hint line. */
export function scheduleNote(platform: string): string | null {
  return FEE_SCHEDULES[platform.trim().toLowerCase()]?.source.replace(/^app preset — /, "").replace(/ — NEEDS CONFIRMING$/, "") ?? null;
}

/**
 * Percent and fixed fee as the sell form's editable defaults expect them.
 *
 * FLATTENS TO THE FIRST BAND, deliberately. The sell form pre-fills a single
 * editable fee figure for a sale that has already happened, and the first band
 * is the rate that applies to essentially every card — eBay's second band starts
 * at $7,500. On a sale that does cross a threshold the figure is editable and
 * the real invoice is what gets recorded anyway.
 *
 * The FORWARD estimate never uses this: it walks the real tiers, because that is
 * where a $7,500-plus card would otherwise be overcharged by hundreds.
 */
export function schedulePreset(platform: string): { pct: number; fixed: number } | null {
  const s = FEE_SCHEDULES[platform.trim().toLowerCase()];
  if (!s) return null;
  return {
    pct: round2((s.tiers[0]?.pct ?? 0) * 100),
    // The band a typical single-card order lands in, not the cheapest one.
    fixed: s.perOrderTiers[s.perOrderTiers.length - 1]?.amount ?? 0,
  };
}

/** One settled sale, as `card_sales` records it. */
export type SettledSale = {
  platform: string | null;
  sale_price: number | string | null;
  fees: number | string | null;
  shipping_income?: number | string | null;
  sold_at?: string | null;
};

/**
 * Where a fee estimate's rate came from. There is no fourth case, and "none" is
 * a first-class outcome rather than a fallback to zero.
 */
export type FeeRateSource =
  | {
      kind: "observed";
      pct: number;
      /** How many of your own sales it was derived from. */
      n: number;
      platform: string;
    }
  | { kind: "schedule"; schedule: FeeSchedule }
  | { kind: "none"; why: string };

/**
 * Your OWN effective fee rate on a platform, from your settled sales.
 *
 * Better than any published table: it already contains your store subscription,
 * your category, your promoted-listing spend and every quirk a table misses.
 *
 * MEDIAN, not mean. One promoted listing at 20% would drag a mean up and quietly
 * raise the break-even on every other card. Requires a floor of real sales
 * because a rate derived from two is noise wearing a decimal point, and returns
 * `none` below it rather than a shaky number.
 */
export function observedFeeRate(sales: SettledSale[], platform: string, minSales = 5): FeeRateSource {
  const key = platform.trim().toLowerCase();
  const rates: number[] = [];
  for (const s of sales) {
    if ((s.platform ?? "").trim().toLowerCase() !== key) continue;
    const price = Number(s.sale_price);
    const fees = Number(s.fees);
    // A zero-fee sale is a real datum (a free-listing promo); a NEGATIVE fee or
    // a fee above the sale price is a data problem, and averaging it in would
    // corrupt every estimate downstream.
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(fees) || fees < 0 || fees > price) continue;
    // Charged on the total the buyer paid, so the denominator must match or the
    // rate reads low on every sale with shipping.
    const shipIncome = Number(s.shipping_income ?? 0);
    const feeable = price + (Number.isFinite(shipIncome) && shipIncome > 0 ? shipIncome : 0);
    rates.push(fees / feeable);
  }
  if (rates.length < minSales) {
    return {
      kind: "none",
      why: `only ${rates.length} settled ${platform} sale${rates.length === 1 ? "" : "s"} on file — need ${minSales} to derive your own rate`,
    };
  }
  const sorted = [...rates].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  const pct = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  return { kind: "observed", pct, n: rates.length, platform };
}

/**
 * The rate to use: your own if we have enough of it, else the published
 * schedule, else nothing.
 *
 * Never silently substitutes a schedule for observed data — the returned shape
 * says which was used, and the UI is expected to show it. "13.4% (your last 22
 * eBay sales)" and "13.35% (published rate, unconfirmed)" deserve different
 * amounts of trust and should not look identical.
 */
export function resolveFeeRate(sales: SettledSale[], platform: string, minSales = 5): FeeRateSource {
  const observed = observedFeeRate(sales, platform, minSales);
  if (observed.kind === "observed") return observed;
  const schedule = FEE_SCHEDULES[platform.trim().toLowerCase()];
  if (schedule) return { kind: "schedule", schedule };
  return { kind: "none", why: `no fee schedule for "${platform}" and no settled sales to derive one from` };
}

/**
 * A rate source flattened into what the arithmetic needs.
 *
 * An OBSERVED rate becomes a single flat tier with no per-order fee: it was
 * divided out of real settled totals, so it already contains whatever fixed fee
 * and whatever tier applied. Adding either on top would double-count.
 */
function ratesOf(src: FeeRateSource): {
  tiers: FeeTier[];
  perOrderTiers: PerOrderTier[];
  pctOnShipping: boolean;
  pctOnSalesTax: boolean;
  unverified: boolean;
} | null {
  if (src.kind === "none") return null;
  if (src.kind === "observed") {
    return {
      tiers: [{ upTo: null, pct: src.pct }],
      perOrderTiers: [{ upTo: null, amount: 0 }],
      pctOnShipping: true, pctOnSalesTax: true, unverified: false,
    };
  }
  return {
    tiers: src.schedule.tiers,
    perOrderTiers: src.schedule.perOrderTiers,
    pctOnShipping: src.schedule.pctAppliesToShipping,
    pctOnSalesTax: src.schedule.pctAppliesToSalesTax,
    unverified: src.schedule.verifiedAt == null,
  };
}

export type ProceedsInput = {
  /** What the card sells for. */
  price: number;
  /** Shipping the BUYER pays you. Part of the feeable total on most platforms. */
  shipIncome?: number;
  /** What shipping actually costs you — postage, mailer, tracking. */
  shipCost?: number;
  /**
   * Sales tax the platform collected from the buyer.
   *
   * eBay charges its percentage on this too — it is named in their definition of
   * the total amount of the sale. You never see the money, and you pay a fee on
   * it. Left at zero when unknown, which understates the fee rather than
   * inventing a tax rate we have no basis for.
   */
  salesTax?: number;
  /** Total cost basis: acquisition plus cost lines. From `cardBasis`. */
  basis?: number;
  /**
   * Number of cards in the order. A fixed fee is charged once per ORDER, so
   * attributing the whole $0.30 to each of five cards overstates every one of
   * them (rule 12).
   */
  orderLines?: number;
};

export type Proceeds = {
  price: number;
  shipIncome: number;
  shipCost: number;
  /** Amount the percentage was applied to. */
  feeable: number;
  /** Percentage component. */
  feePct: number;
  /** This line's share of the per-order fixed fee. */
  feeFixed: number;
  fees: number;
  /** What lands in your account: price + shipIncome - fees - shipCost. */
  net: number;
  /** net - basis. Null when no basis was supplied. */
  profit: number | null;
  /** profit / net, as a fraction. Null without a basis, or at zero net. */
  margin: number | null;
  rate: FeeRateSource;
  /** True when the rate came from an unconfirmed published schedule. */
  unverifiedRate: boolean;
};

/**
 * What you keep at a given price.
 *
 * Returns null when the rate is unknown. A fee of zero is a claim — it says the
 * platform takes nothing — and it is a claim that is always wrong, so the honest
 * output is no number at all (rules 4 and 9).
 */
export function estimateProceeds(input: ProceedsInput, rate: FeeRateSource): Proceeds | null {
  const r = ratesOf(rate);
  if (!r) return null;
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const shipIncome = num(input.shipIncome);
  const shipCost = num(input.shipCost);
  const salesTax = num(input.salesTax);
  const lines = Math.max(1, Math.floor(input.orderLines ?? 1));

  const feeable = price
    + (r.pctOnShipping ? shipIncome : 0)
    + (r.pctOnSalesTax ? salesTax : 0);
  const feePct = round2(tieredPct(feeable, r.tiers));
  // The per-order band is chosen by the ORDER's total, then split across its
  // lines — the fee is charged once per order, not once per card (rule 12).
  const feeFixed = round2(perOrderFee((price + shipIncome + salesTax) * lines, r.perOrderTiers) / lines);
  const fees = round2(feePct + feeFixed);
  // Sales tax is NOT added to net: the platform collects it and remits it. You
  // pay a fee on money that never reaches you.
  const net = round2(price + shipIncome - fees - shipCost);
  const basis = input.basis == null ? null : num(input.basis);
  const profit = basis == null ? null : round2(net - basis);

  return {
    price: round2(price), shipIncome, shipCost, feeable: round2(feeable),
    feePct, feeFixed, fees, net, profit,
    margin: profit == null || net === 0 ? null : profit / net,
    rate,
    unverifiedRate: r.unverified,
  };
}

export type BreakEven = {
  /** The sale price at which net proceeds exactly cover basis. */
  price: number;
  basis: number;
  rate: FeeRateSource;
  unverifiedRate: boolean;
};

/**
 * The price you must get to break even.
 *
 * NOT basis plus a percentage, and the difference is not academic. Fees are
 * charged on the sale price, so every dollar you add to the price hands a cut
 * back to the platform: the equation has to be INVERTED.
 *
 *   net  = price + shipIncome - (pct × feeable + fixed) - shipCost
 *   want = basis
 *
 * With the percentage applying to shipping:
 *   price = (basis + fixed + shipCost - shipIncome × (1 - pct)) / (1 - pct)
 * Without:
 *   price = (basis + fixed + shipCost - shipIncome) / (1 - pct)
 *
 * At $100 basis and a 13.35% fee the naive markup says $113.35 and the truth is
 * about $116.10 — so the naive answer tells you an offer clears when it loses
 * money. That is the whole reason this function exists rather than a multiply
 * at the call site.
 */
export function breakEvenPrice(
  input: { basis: number; shipIncome?: number; shipCost?: number; salesTax?: number; orderLines?: number },
  rate: FeeRateSource,
): BreakEven | null {
  const r = ratesOf(rate);
  if (!r) return null;
  const basis = num(input.basis);
  const shipIncome = num(input.shipIncome);
  const shipCost = num(input.shipCost);
  const salesTax = num(input.salesTax);
  const lines = Math.max(1, Math.floor(input.orderLines ?? 1));

  // What sits alongside the price inside the feeable amount.
  const extra = (r.pctOnShipping ? shipIncome : 0) + (r.pctOnSalesTax ? salesTax : 0);

  // PIECEWISE SOLVE. With tiers, the marginal rate depends on the answer, so
  // there is no single formula. For each (fee band × per-order band) pair, solve
  // the linear equation that holds INSIDE that pair, then check the answer
  // actually lands there. The first consistent solution is the real one.
  //
  // Within a fee band of marginal rate p, floor F, and fee-already-accrued B:
  //   net = price + shipIncome - [B + p(price + extra - F) + fixed] - shipCost
  //   price = (basis - shipIncome + B + p(extra - F) + fixed + shipCost) / (1 - p)
  let floor = 0;
  let feeBelow = 0;
  for (const t of r.tiers) {
    const ceil = t.upTo ?? Infinity;
    const p = t.pct;
    // A band at or above 100% cannot be climbed out of — the platform takes the
    // increase faster than you can earn it, so there is no break-even in it.
    if (p < 1) {
      for (const po of r.perOrderTiers) {
        const fixed = po.amount / lines;
        const price = (basis - shipIncome + feeBelow + p * (extra - floor) + fixed + shipCost) / (1 - p);
        const solved = Math.max(0, price);
        const feeable = solved + extra;
        // Both bands have to be the ones we assumed, or the arithmetic used the
        // wrong rate. A zero-floored solution is accepted as the boundary case.
        const inFeeBand = (feeable >= floor - 0.005 || floor === 0) && feeable <= ceil + 0.005;
        const orderTotal = (solved + shipIncome + salesTax) * lines;
        const inOrderBand = orderTotal <= (po.upTo ?? Infinity) + 0.005;
        if (inFeeBand && inOrderBand) {
          return {
            // A negative break-even means shipping income alone covers the basis.
            // Zero is the floor: you cannot sell for less than nothing.
            price: round2(solved),
            basis: round2(basis),
            rate,
            unverifiedRate: r.unverified,
          };
        }
      }
    }
    feeBelow += (ceil - floor) * p;
    floor = ceil;
  }
  // No band produced a self-consistent answer — most likely a 100%+ top rate.
  // Returning a large number would look like an answer.
  return null;
}

export type OfferVerdict = {
  proceeds: Proceeds;
  breakEven: BreakEven;
  /** Does this offer cover the basis? */
  clears: boolean;
  /** How far above (positive) or below (negative) break-even the offer sits. */
  headroom: number;
};

/**
 * The answer to "should I take this offer?" — stated as arithmetic, not advice.
 *
 * Everything needed is already in the database: basis comes from the purchase
 * lot or the stated figure plus cost lines, and the fee rate from your own
 * settled sales. No competitor can compute it, because none of them holds the
 * basis.
 */
export function offerVerdict(
  input: ProceedsInput & { basis: number },
  rate: FeeRateSource,
): OfferVerdict | null {
  const proceeds = estimateProceeds(input, rate);
  const breakEven = breakEvenPrice(input, rate);
  if (!proceeds || !breakEven) return null;
  return {
    proceeds,
    breakEven,
    clears: proceeds.net >= num(input.basis),
    headroom: round2(proceeds.price - breakEven.price),
  };
}

/** How the rate should be described wherever a number built on it appears. */
export function rateLabel(rate: FeeRateSource): string {
  if (rate.kind === "observed") {
    return `${(rate.pct * 100).toFixed(1)}% — your last ${rate.n} ${rate.platform} sales`;
  }
  if (rate.kind === "none") return rate.why;
  const s = rate.schedule;
  // Describe the tiers rather than flattening them: "13.25%" on a $10,000 slab
  // would be a quietly wrong label on a correctly-computed number.
  const bands = s.tiers
    .map((t, i) =>
      t.upTo == null
        ? (i === 0 ? `${(t.pct * 100).toFixed(2)}%` : `then ${(t.pct * 100).toFixed(2)}%`)
        : `${(t.pct * 100).toFixed(2)}% to ${money0(t.upTo)}`)
    .join(", ");
  const fixed = s.perOrderTiers.length === 1
    ? `$${s.perOrderTiers[0].amount.toFixed(2)}/order`
    : s.perOrderTiers.map((t) => (t.upTo == null ? `$${t.amount.toFixed(2)} above` : `$${t.amount.toFixed(2)} to ${money0(t.upTo)}`)).join(", ") + "/order";
  const when = s.verifiedAt ? `published rate, confirmed ${s.verifiedAt}` : "published rate, UNCONFIRMED";
  return `${bands} + ${fixed} — ${when}`;
}

const money0 = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function num(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

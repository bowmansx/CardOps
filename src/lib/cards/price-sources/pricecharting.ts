// PriceCharting adapter — Beau's pick. Broad coverage (TCG + games + some
// sports), current values across grades. Activates the moment
// PRICECHARTING_TOKEN is set in the environment.
//
// WHY THIS CAN NEVER BE THE APP'S PRICING SOURCE, verified 2026-07-29 from their
// own API documentation, verbatim:
//
//   "The API and CSV only support current item values in various grades and
//    conditions. Historic prices and historic sales are not supported."
//
// So there is no sales history at ANY price. That is not a licence problem or a
// tier problem — the data does not exist on this endpoint. It means PriceCharting
// can never populate `card_market_sales`, never feed the sales-over-time chart,
// and never back a provenance chip, because there is nothing to tap through to.
// It is one number they assert today. `kind: "guide"` is doing real work.
//
// TWO HARD OPERATIONAL LIMITS, same source:
//   - "The API is limited to 1 call every second... your account permissions
//     revoked if it persists." One global budget for the whole app, not per user.
//   - The bulk escape hatch is one CSV per 10 minutes, and "CSV download feature
//     is only available to Legendary subscribers" — a higher tier than the base
//     API subscription.
//
// WHAT IT IS GENUINELY GOOD FOR: nine grade points from a single call, which is
// exactly the shape a grade-delta multiplier wants, plus a `sales-volume` field
// (yearly units sold) that is a liquidity signal nothing else here provides.
import type { PriceSourceAdapter, SourceQuote, CardForPricing, AdapterResult } from "./types";

// PriceCharting's price fields mapped to card grades — VERIFIED 2026-07-29
// against their published API key descriptions (pricecharting.com/api-documentation).
// All nine field-to-grade mappings match what they document. All values arrive as
// integer pennies.
//
// TWO IMPRECISIONS IN THEIR DATA, worth knowing before trusting a match:
//
// 1. THE GRADER IS MOSTLY UNSPECIFIED. Their descriptions read "Graded 9 by a
//    grading company" — generic. Only `manual-only-price` names one: "Graded 10
//    by PSA grading service". We attribute PSA to the mid grades because PSA is
//    the dominant grader and `SourceQuote.grader` has no way to say "graded,
//    company unstated" (null means RAW there, which would be worse). The effect
//    is that a BGS 9 card fails to match a value that would in fact suit it —
//    UNDER-matching, which loses a data point rather than crediting a wrong one.
//    That is the safe direction, but it is an approximation, not their claim.
// 2. TWO FIELDS ARE BANDS, NOT GRADES. `cib-price` is "Graded 7 or 7.5" and
//    `new-price` is "Graded 8 or 8.5". A PSA 7.5 card therefore finds no exact
//    match under strict grade equality, which is why the label says the band.
//
// The raw payload is stored and every value carries its source field, so a
// correction stays trivial.
const PC_GRADE_FIELDS: { field: string; grader: string | null; grade: number | null; label: string }[] = [
  { field: "loose-price", grader: null, grade: null, label: "Ungraded" },
  { field: "cib-price", grader: "PSA", grade: 7, label: "Grade 7–7.5" },
  { field: "new-price", grader: "PSA", grade: 8, label: "Grade 8–8.5" },
  // Their docs say "Graded 9 by a grading company", not PSA 9 — the old label
  // asserted a company they never named.
  { field: "graded-price", grader: "PSA", grade: 9, label: "Grade 9" },
  { field: "box-only-price", grader: "PSA", grade: 9.5, label: "Grade 9.5" },
  // The one grade they DO attribute: "Graded 10 by PSA grading service".
  { field: "manual-only-price", grader: "PSA", grade: 10, label: "PSA 10" },
  { field: "bgs-10-price", grader: "BGS", grade: 10, label: "BGS 10" },
  { field: "condition-17-price", grader: "CGC", grade: 10, label: "CGC 10" },
  { field: "condition-18-price", grader: "SGC", grade: 10, label: "SGC 10" },
];

export const pricecharting: PriceSourceAdapter = {
  id: "pricecharting",
  label: "PriceCharting",
  enabled: () => !!process.env.PRICECHARTING_TOKEN,
  handles: () => true, // broad — let the vendor's search decide if it matches

  // VERIFIED 2026-07-29 against pricecharting.com/page/terms-of-service, under
  // "Price Data Acceptable Use". This was an assumption until then; it is now
  // quoted, and it holds:
  //
  //   "Price Data cannot be used in any software, application, or system that is
  //    accessible to third parties, including customers, clients, or the general
  //    public, without express written permission."
  //
  // CardOps serving a value to a friend is software accessible to a third party.
  // Free or paid makes no difference — the term is about WHO SEES IT. So
  // `redisplay` is false, and that is a confirmed limit rather than a cautious
  // guess.
  //
  // TWO THINGS THAT WERE NOT KNOWN BEFORE READING IT:
  //
  // 1. Even INTERNAL use has a floor: "Price Data can be used for your Internal
  //    Business Purposes if you maintain a valid and current LEGENDARY
  //    subscription" — usage "by the subscriber and their authorized employees or
  //    contractors, strictly within the organization, and not for external
  //    display or redistribution". So the cheaper API tiers do not license
  //    internal business use at all, only personal use.
  // 2. There is a named way out: "To request permission, contact brady@vgpc.com."
  //    That is the redistribution ask `GO-LIVE.md` hypothesised, with an address.
  //
  // Note the ONE thing that is permitted without asking, because it is narrower
  // than it first looks: price data "may be referenced on external websites"
  // given citation and a visible hyperlink. That is editorial reference, and the
  // software clause above is explicit that an application is a different case.
  rights: {
    persist: false,
    redisplay: false,
    pool: false,
    attribution: "PriceCharting",
    deleteOnTerminationDays: null,
  },

  async fetch(card: CardForPricing): Promise<AdapterResult> {
    const token = process.env.PRICECHARTING_TOKEN;
    if (!token) return { quotes: [], ok: false, matched: false, note: "no PRICECHARTING_TOKEN set" };
    const q = [card.year, card.player, card.set_name, card.card_number, card.parallel]
      .filter(Boolean).join(" ").trim();
    if (!q) return { quotes: [], ok: true, matched: false, note: "not enough card detail to search" };

    const url = `https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`;
    let r: Response;
    try {
      r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      return { quotes: [], ok: false, matched: false, note: e instanceof Error ? e.message : "network error" };
    }
    if (!r.ok) return { quotes: [], ok: false, matched: false, note: `PriceCharting HTTP ${r.status}` };

    const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!d || d.status !== "success" || !d.id) {
      return { quotes: [], ok: true, matched: false, note: "no PriceCharting match" };
    }
    const cents = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) / 100 : null);
    const link = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}&type=prices`;
    const quotes: SourceQuote[] = [];
    for (const f of PC_GRADE_FIELDS) {
      const price = cents(d[f.field]);
      if (price == null) continue;
      quotes.push({
        source: "pricecharting", kind: "guide", grader: f.grader, grade: f.grade,
        price, currency: "USD", label: f.label, url: link, product_ref: String(d.id),
        payload: { name: d["product-name"], console: d["console-name"], field: f.field },
      });
    }
    return {
      quotes, ok: true, matched: quotes.length > 0,
      note: quotes.length ? undefined : "matched, but no priced grades returned",
    };
  },
};

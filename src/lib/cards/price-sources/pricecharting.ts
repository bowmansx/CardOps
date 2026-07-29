// PriceCharting adapter — Beau's pick. Broad coverage (TCG + games + some
// sports), current values across grades. NOTE: the PriceCharting *API* returns
// current values only, NOT sales history (the price charts live in their web
// UI). Activates the moment PRICECHARTING_TOKEN is set in the environment.
import type { PriceSourceAdapter, SourceQuote, CardForPricing, AdapterResult } from "./types";

// PriceCharting's price fields, mapped to card grades PER THEIR API DOCS. All
// values arrive as integer pennies. This mapping is best-effort until a live
// token confirms it against a real response — the raw payload is stored, and
// every value is labeled by its source field, so a correction is trivial.
const PC_GRADE_FIELDS: { field: string; grader: string | null; grade: number | null; label: string }[] = [
  { field: "loose-price", grader: null, grade: null, label: "Ungraded" },
  { field: "cib-price", grader: "PSA", grade: 7, label: "Grade 7" },
  { field: "new-price", grader: "PSA", grade: 8, label: "Grade 8" },
  { field: "graded-price", grader: "PSA", grade: 9, label: "PSA 9" },
  { field: "box-only-price", grader: "PSA", grade: 9.5, label: "Grade 9.5" },
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

  // INTERNAL USE ONLY until a redistribution licence exists. That term is about
  // WHO uses the data, not what it costs — a friend's screen showing a
  // PriceCharting-derived value is that friend using it, free or not, so
  // "we don't charge for it" does not rescue this. `GO-LIVE.md` records the two
  // clean paths: ask them for a redistribution quote, or serve this source only
  // to the operator's own account. Until one of those happens, redisplay stays
  // false and no PriceCharting quote may be shown to another user.
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

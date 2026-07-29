// Scryfall adapter — MTG only, FREE and no key (Beau's Tarkir: Dragonstorm card
// is a Magic single, which is why it never valued: CardOps had no TCG feed).
// Scryfall asks for a descriptive User-Agent + Accept header and light rate use.
import type { PriceSourceAdapter, SourceQuote, CardForPricing, AdapterResult } from "./types";

// Category/set hints that this is a Magic card. Kept broad but not so broad it
// mis-hits sports cards through Scryfall's fuzzy name search.
const MTG_RE = /\b(mtg|magic|the gathering|planeswalker|commander|tarkir|dragonstorm|scryfall)\b/i;

export const scryfall: PriceSourceAdapter = {
  id: "scryfall",
  label: "Scryfall · MTG",
  enabled: () => true, // free, no token
  handles: (card) => MTG_RE.test(card.sport_category ?? "") || MTG_RE.test(card.set_name ?? ""),

  // Free and unrestricted for this use. The one term that BINDS LATER is
  // recorded in `GO-LIVE.md`: Scryfall data may not sit behind the credit
  // meter. Since the meter charges for reasoning rather than for lookups, a
  // free user still sees everything Scryfall provides — but that makes it a
  // hard design constraint, not a nice-to-have. The moment "out of credits"
  // hides a card's name, it is paywalled.
  //
  // These are guide values rather than sales, so nothing here reaches
  // card_market_sales; persist is false because it is meaningless, not
  // because it is forbidden.
  rights: {
    persist: false,
    redisplay: true,
    pool: false,
    attribution: "Scryfall",
    deleteOnTerminationDays: null,
  },

  async fetch(card: CardForPricing): Promise<AdapterResult> {
    const name = (card.player ?? "").trim();
    if (!name) return { quotes: [], ok: true, matched: false, note: "no card name to look up" };
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
    let r: Response;
    try {
      r = await fetch(url, {
        headers: { "User-Agent": "CardOps/1.0 (card inventory)", Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { quotes: [], ok: false, matched: false, note: e instanceof Error ? e.message : "network error" };
    }
    // 404 = a real "no such card" (safe to clear stale); 429/5xx = transient.
    if (r.status === 404) return { quotes: [], ok: true, matched: false, note: "no MTG match on Scryfall" };
    if (!r.ok) return { quotes: [], ok: false, matched: false, note: `Scryfall HTTP ${r.status}` };

    const d = (await r.json().catch(() => null)) as {
      name?: string; set_name?: string; scryfall_uri?: string; id?: string;
      prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
    } | null;
    if (!d) return { quotes: [], ok: true, matched: false, note: "unreadable Scryfall response" };

    const p = d.prices ?? {};
    const quotes: SourceQuote[] = [];
    const push = (v: string | null | undefined, label: string) => {
      const n = v == null ? NaN : Number(v);
      if (Number.isFinite(n) && n > 0) {
        quotes.push({
          source: "scryfall", kind: "guide", grader: null, grade: null,
          price: Math.round(n * 100) / 100, currency: "USD", label,
          url: d.scryfall_uri ?? null, product_ref: d.id ?? null,
          payload: { name: d.name, set_name: d.set_name },
        });
      }
    };
    push(p.usd, "Ungraded");
    push(p.usd_foil, "Ungraded · foil");
    push(p.usd_etched, "Ungraded · etched");
    return {
      quotes, ok: true, matched: quotes.length > 0,
      note: quotes.length ? undefined : "matched, but Scryfall has no USD price for it",
    };
  },
};

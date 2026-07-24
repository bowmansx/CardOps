// Pure helpers for the estimate engine (Beau, 2026-07-22). Building blocks the
// /api/cards/estimate route composes: what comparable searches to run, and how to
// summarize a pile of sales into compact stats for the AI prompt + the UI. No I/O.
import type { CardForPricing } from "./price-sources/types";
import type { CardApiSale } from "./price-sources/thecardapi";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesStats = {
  count: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  newest_date: string | null;
  oldest_date: string | null;
  span_days: number | null;
  // A few representative recent sales for display + the prompt.
  sample: { title: string | null; price: number; grader: string | null; grade: string | number | null; platform: string | null; date: string | null }[];
};

// Realized comps we already have on file (card_comps) → the same sale shape, so the
// estimate isn't blind when the live 3-day Card API window is empty.
export type CompRow = { sale_price: number | string | null; sale_date: string | null; grader: string | null; grade: number | string | null; source: string | null; listing_url?: string | null };
export function compsAsSales(rows: CompRow[]): CardApiSale[] {
  return rows.map((r) => ({
    price: r.sale_price, sold_at: r.sale_date, sale_date: r.sale_date,
    grader: r.grader, grade: r.grade, platform: r.source ?? "comp", title: null, listing_url: r.listing_url ?? null,
  }));
}

// The reference price to anchor/clamp an estimate to, from best available evidence:
// realized sales (Card API + comps) → condition-matched guide quotes → stored market value.
export function groundPrice(ownMedian: number | null, guideMedian: number | null, refValue: number | null): number | null {
  if (ownMedian != null && ownMedian > 0) return ownMedian;
  if (guideMedian != null && guideMedian > 0) return guideMedian;
  return refValue != null && refValue > 0 ? refValue : null;
}

export function medianOf(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length >> 1;
  return round2(xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2);
}

export function summarizeSales(sales: CardApiSale[]): SalesStats {
  const priced = sales
    .map((s) => ({ ...s, p: Number(s.price), d: String(s.sold_at ?? s.sale_date ?? "") }))
    .filter((s) => Number.isFinite(s.p) && s.p > 0);
  if (!priced.length) return { count: 0, median: null, mean: null, min: null, max: null, newest_date: null, oldest_date: null, span_days: null, sample: [] };

  const prices = priced.map((s) => s.p).sort((a, b) => a - b);
  const m = prices.length >> 1;
  const median = prices.length % 2 ? prices[m] : (prices[m - 1] + prices[m]) / 2;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const dates = priced.map((s) => s.d).filter(Boolean).sort();
  const newest = dates[dates.length - 1] ?? null;
  const oldest = dates[0] ?? null;
  let span: number | null = null;
  if (newest && oldest) {
    const a = Date.parse(oldest), b = Date.parse(newest);
    if (Number.isFinite(a) && Number.isFinite(b)) span = Math.round((b - a) / 86_400_000);
  }
  const sample = [...priced]
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, 8)
    .map((s) => ({ title: s.title ?? null, price: round2(s.p), grader: s.grader ?? null, grade: s.grade ?? null, platform: s.platform ?? null, date: s.d || null }));

  return {
    count: priced.length,
    median: round2(median), mean: round2(mean), min: round2(prices[0]), max: round2(prices[prices.length - 1]),
    newest_date: newest, oldest_date: oldest, span_days: span, sample,
  };
}

// Comparable searches: how a card's PARALLEL trades for other players, and the
// player's broader recent market. Kept to a couple queries to bound cost.
export function comparableQueries(card: CardForPricing): { label: string; q: string }[] {
  const out: { label: string; q: string }[] = [];
  const parallel = [card.year, card.set_name, card.parallel].filter(Boolean).map(String).join(" ").trim();
  if (parallel && card.parallel) out.push({ label: "same parallel, other players", q: parallel });
  const player = String(card.player ?? "").trim();
  if (player) out.push({ label: "player's recent market", q: player });
  return out;
}

// A tight, non-injectable digest of everything gathered — this is what the model
// reasons over. Only our own computed numbers + a capped, quoted sample of titles.
export function buildEstimateDigest(input: {
  card: CardForPricing;
  own: SalesStats;
  comparables: { label: string; stats: SalesStats }[];
  anchor?: number | null; // the template's value (Estimate A)
  guides?: { source: string; label: string; price: number }[]; // stored source quotes (Scryfall/PriceCharting/…)
}): string {
  const { card, own, comparables, anchor, guides } = input;
  const id = [card.year, card.set_name, card.player, card.parallel, card.card_number]
    .filter(Boolean).join(" ");
  const cond = card.condition_type === "graded" ? `${card.grader ?? "graded"} ${card.grade ?? "?"}` : "raw/ungraded";
  const lines: string[] = [];
  lines.push(`CARD: ${id} — condition ${cond}.`);
  if (anchor != null) lines.push(`Template price (your pricing standard): $${anchor}.`);
  lines.push(
    own.count
      ? `THIS CARD'S SALES (${own.count}): median $${own.median}, mean $${own.mean}, range $${own.min}–$${own.max}, over ${own.span_days ?? "?"} days (newest ${own.newest_date ?? "?"}).`
      : `THIS CARD'S SALES: none found in the window.`,
  );
  if (guides?.length) {
    lines.push("GUIDE / SOURCE VALUES (current vendor prices, not realized sales):");
    for (const g of guides.slice(0, 6)) lines.push(`- ${g.source}${g.label ? ` (${g.label})` : ""}: $${g.price}`);
  }
  for (const c of comparables) {
    if (c.stats.count) lines.push(`COMPARABLE (${c.label}, ${c.stats.count} sales): median $${c.stats.median}, range $${c.stats.min}–$${c.stats.max}.`);
  }
  if (own.sample.length) {
    lines.push("RECENT SALES (title · price · grade · date):");
    for (const s of own.sample.slice(0, 6)) {
      lines.push(`- ${JSON.stringify(s.title ?? "")} · $${s.price} · ${s.grader ?? "raw"} ${s.grade ?? ""} · ${s.date ?? "?"}`);
    }
  }
  return lines.join("\n");
}

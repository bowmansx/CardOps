// Top-movers digest assembly (Beau, 2026-07-24). Pure: takes a user's cards and
// their price history, returns the ranked movers and the one push to send — or
// null when there's nothing new to say. The percent math lives in movers.ts;
// this is the ranking, the "only ping me about a card I haven't seen move yet"
// dedup, and the copy. Extracted from the cron so it can be tested.
import { pctChangeOverWindow, type PricePoint } from "./movers";

export type DigestCard = {
  id: string;
  player?: string | null;
  year?: number | null;
  set_name?: string | null;
  market_value?: number | null;
  manual_price?: number | null;
};

export type Mover = { id: string; title: string; pct: number };

export type Digest = {
  /** Every card over the threshold, biggest absolute move first. */
  moves: Mover[];
  /** The subset the user hasn't already been pinged about. */
  fresh: Mover[];
  /** The push to send, or null when nothing is new. */
  push: { title: string; body: string; url: string } | null;
  /** What to store as movers_seen for the next run. */
  seenNext: string[];
};

export function cardLabel(c: Pick<DigestCard, "player" | "year" | "set_name">): string {
  return [c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(card)";
}

/** Current price: a manual override wins over the tracked market value. */
export function currentPrice(c: DigestCard): number | null {
  const v = c.manual_price ?? c.market_value;
  return v == null ? null : Number(v);
}

export function buildMoversDigest(
  cards: DigestCard[],
  history: Map<string, PricePoint[]>,
  opts: { pct: number; days: number; now: number; seen?: Iterable<string> },
): Digest {
  const { pct, days, now } = opts;
  const seen = new Set(opts.seen ?? []);

  const moves: Mover[] = [];
  for (const c of cards) {
    const arr = history.get(c.id);
    if (!arr?.length) continue;
    const cur = currentPrice(c);
    const series = cur != null && cur > 0 ? [...arr, { price: cur, at: now }] : arr;
    const m = pctChangeOverWindow(series, days, now);
    if (m && Math.abs(m.pct) >= pct) moves.push({ id: c.id, title: cardLabel(c), pct: m.pct });
  }
  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  // Only push when a card NEW to the movers set showed up — otherwise the same
  // movers re-ping every day for as long as they sit inside the window.
  const fresh = moves.filter((m) => !seen.has(m.id));
  const push = fresh.length
    ? {
        title: `📊 ${moves.length} card${moves.length > 1 ? "s" : ""} moved ≥${pct}% in ${days}d`,
        body: moves.slice(0, 3).map((m) => `${m.title} ${m.pct > 0 ? "+" : ""}${m.pct.toFixed(0)}%`).join(" · "),
        url: "/cards/movers",
      }
    : null;

  return { moves, fresh, push, seenNext: moves.map((m) => m.id) };
}

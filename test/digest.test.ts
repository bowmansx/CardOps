import { describe, it, expect } from "vitest";
import { buildMoversDigest, cardLabel, currentPrice, type DigestCard } from "@/lib/cards/digest";
import type { PricePoint } from "@/lib/cards/movers";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 24, 12, 0, 0);

const card = (id: string, over: Partial<DigestCard> = {}): DigestCard => ({
  id, player: "Zion Williamson", year: 2019, set_name: "Prizm", market_value: 100, ...over,
});

/** A history that lands the card at `to` after starting at `from` `days` ago. */
const hist = (from: number, days = 7): PricePoint[] => [{ price: from, at: NOW - days * DAY }];

describe("cardLabel / currentPrice", () => {
  it("joins the parts it has and falls back when it has none", () => {
    expect(cardLabel({ year: 2019, player: "Zion Williamson", set_name: "Prizm" })).toBe("2019 Zion Williamson Prizm");
    expect(cardLabel({ year: null, player: "Ohtani", set_name: null })).toBe("Ohtani");
    expect(cardLabel({ year: null, player: null, set_name: null })).toBe("(card)");
  });

  it("lets a manual price override the tracked market value", () => {
    expect(currentPrice(card("a", { market_value: 100, manual_price: 250 }))).toBe(250);
    expect(currentPrice(card("a", { market_value: 100, manual_price: null }))).toBe(100);
    expect(currentPrice(card("a", { market_value: null, manual_price: null }))).toBeNull();
    // A manual price of 0 is a real answer, not "unset".
    expect(currentPrice(card("a", { manual_price: 0 }))).toBe(0);
  });
});

describe("buildMoversDigest", () => {
  it("keeps only cards past the threshold and ranks by absolute move", () => {
    const cards = [
      card("small", { market_value: 105 }),  // +5%
      card("big", { market_value: 200 }),    // +100%
      card("crash", { market_value: 40 }),   // -60%
    ];
    const h = new Map<string, PricePoint[]>([
      ["small", hist(100)], ["big", hist(100)], ["crash", hist(100)],
    ]);
    const d = buildMoversDigest(cards, h, { pct: 15, days: 7, now: NOW });
    expect(d.moves.map((m) => m.id)).toEqual(["big", "crash"]); // "small" filtered out
    expect(d.moves[0].pct).toBeGreaterThan(0);
    expect(d.moves[1].pct).toBeLessThan(0);
  });

  it("pushes only when a card is new to the movers set", () => {
    const cards = [card("big", { market_value: 200 })];
    const h = new Map([["big", hist(100)]]);
    const first = buildMoversDigest(cards, h, { pct: 15, days: 7, now: NOW });
    expect(first.push).not.toBeNull();
    expect(first.seenNext).toEqual(["big"]);

    // Same mover, next day: still a mover, but nothing new to say.
    const second = buildMoversDigest(cards, h, { pct: 15, days: 7, now: NOW, seen: first.seenNext });
    expect(second.moves).toHaveLength(1);
    expect(second.fresh).toHaveLength(0);
    expect(second.push).toBeNull();
  });

  it("re-pushes once a genuinely new mover appears, and names the top 3", () => {
    const cards = [
      card("a", { market_value: 300, player: "A" }),
      card("b", { market_value: 250, player: "B" }),
      card("c", { market_value: 220, player: "C" }),
      card("d", { market_value: 210, player: "D" }),
    ];
    const h = new Map(cards.map((c) => [c.id, hist(100)]));
    const d = buildMoversDigest(cards, h, { pct: 15, days: 7, now: NOW, seen: ["a"] });
    expect(d.push).not.toBeNull();
    expect(d.push!.title).toContain("4 cards moved ≥15%");
    // Body names the top 3 of ALL movers (not just the fresh ones), biggest first.
    expect(d.push!.body.split(" · ")).toHaveLength(3);
    expect(d.push!.body.startsWith("2019 A Prizm +200%")).toBe(true);
    expect(d.push!.body).not.toContain(" D ");
  });

  it("drops a mover out of seenNext once it stops moving, so it can ping again later", () => {
    const moving = [card("x", { market_value: 200 })];
    const flat = [card("x", { market_value: 101 })];
    const h = new Map([["x", hist(100)]]);
    const run1 = buildMoversDigest(moving, h, { pct: 15, days: 7, now: NOW });
    expect(run1.seenNext).toEqual(["x"]);
    const run2 = buildMoversDigest(flat, h, { pct: 15, days: 7, now: NOW, seen: run1.seenNext });
    expect(run2.seenNext).toEqual([]); // no longer a mover → forgotten
    const run3 = buildMoversDigest(moving, h, { pct: 15, days: 7, now: NOW, seen: run2.seenNext });
    expect(run3.push).not.toBeNull(); // moves again → pings again
  });

  it("ignores cards with no history and cards with no price", () => {
    const cards = [card("nohist", { market_value: 999 }), card("noprice", { market_value: null, manual_price: null })];
    const h = new Map([["noprice", hist(100)]]);
    const d = buildMoversDigest(cards, h, { pct: 15, days: 7, now: NOW });
    // "noprice" still has history, so it is judged on history alone — one point
    // is not enough for a window move, so nothing fires.
    expect(d.moves).toEqual([]);
    expect(d.push).toBeNull();
  });

  it("singularizes the headline for exactly one mover", () => {
    const d = buildMoversDigest([card("one", { market_value: 200 })], new Map([["one", hist(100)]]), { pct: 15, days: 7, now: NOW });
    expect(d.push!.title).toContain("1 card moved");
    expect(d.push!.title).not.toContain("cards");
  });
});

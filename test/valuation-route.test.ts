import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase, filterOn, type TableHandler } from "./helpers/fake-supabase";

// THE ROUTE ITSELF, not the pure modules under it (2026-08-02).
//
// `valuation-run.test.ts` covers the decisions; this covers the WIRING, which is
// where the runtime failures live: a filter on the wrong column, an error branch
// nobody exercised, a warning that never reaches the response. A dev server
// cannot check any of it — with no Supabase credentials the middleware 500s
// every route, including ones that do not exist.

const state: {
  role: string | null;
  handlers: Record<string, TableHandler>;
  user: { id: string } | null;
  fake: ReturnType<typeof fakeSupabase>;
} = { role: "owner", handlers: {}, user: { id: "u1" }, fake: fakeSupabase({}) };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    state.fake = fakeSupabase(state.handlers, state.user);
    return state.fake.client;
  },
}));
vi.mock("@/lib/cards/roles", () => ({
  currentRole: async () => state.role,
  hasCardAccess: (r: string | null) => r === "owner" || r === "card_ops",
}));

const { POST } = await import("@/app/api/cards/valuation/route");

const CARD = {
  id: "c1", player: "Kyle Harrison", year: 2021, set_name: "Bowman Chrome",
  card_number: "BCP-42", parallel: null, sport_category: "Baseball",
  grader: "PSA", grade: 10, condition_type: "graded",
  identity_id: "ident-1", pricing_strategy: null,
};

const ownSale = (price: number, soldAt: string) => ({
  id: `s-${price}-${soldAt}`, card_id: "c1", platform: "eBay",
  sale_price: price, shipping_income: 0, sold_at: soldAt, order_ref: null,
  // The embed shape supabase-js infers: an ARRAY even for a to-one join.
  cards: [{ grader: "PSA", grade: 10, condition_type: "graded", identity_id: "ident-1" }],
});

const post = (body: unknown) =>
  POST(new Request("http://x/api/cards/valuation", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

beforeEach(() => {
  state.role = "owner";
  state.user = { id: "u1" };
  state.handlers = {
    cards: () => ({ data: CARD }),
    card_sales: () => ({ data: [] }),
    card_market_sales: () => ({ data: [] }),
  };
});

describe("POST /api/cards/valuation — gates", () => {
  it("refuses when signed out", async () => {
    state.user = null;
    expect((await post({ cardId: "c1" })).status).toBe(401);
  });

  it("refuses a role without card access", async () => {
    state.role = null;
    expect((await post({ cardId: "c1" })).status).toBe(403);
  });

  it("needs a cardId", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("404s a card that isn't there", async () => {
    state.handlers.cards = () => ({ data: null });
    expect((await post({ cardId: "nope" })).status).toBe(404);
  });

  // A failed read is not an absent card, and returning 404 would tell someone
  // their card was deleted.
  it("500s rather than 404s when the card read fails", async () => {
    state.handlers.cards = () => ({ data: null, error: { message: "boom" } });
    const r = await post({ cardId: "c1" });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toContain("boom");
  });
});

describe("POST /api/cards/valuation — own book", () => {
  it("prices from the user's own settled sales, scoped by IDENTITY", async () => {
    state.handlers.card_sales = () => ({
      data: [100, 100, 100, 100, 100].map((p, i) => ownSale(p, `2026-07-${10 + i}`)),
    });

    const r = await post({ cardId: "c1" });
    const d = await r.json();

    expect(r.status).toBe(200);
    expect(d.verdict.price).toBe(100);
    expect(d.verdict.asked).toEqual(["own-book"]);
    expect(d.warnings).toEqual([]);

    // The join is the identity, not the card id — someone who sold this card
    // twice and bought a third copy is priced off both of their own sales.
    const q = state.fake.on("card_sales")[0];
    expect(filterOn(q, "cards.identity_id")).toEqual(["eq", "cards.identity_id", "ident-1"]);
    expect(q.select).toContain("cards!inner");
  });

  // Rule 2: a paginated read needs a deterministic order with a unique
  // tiebreaker, or rows repeat or vanish between pages.
  it("orders the paged read with a unique tiebreaker", async () => {
    await post({ cardId: "c1" });
    const q = state.fake.on("card_sales")[0];
    expect(q.order.map((o) => o.column)).toEqual(["sold_at", "id"]);
    expect(q.range).toBeDefined();
  });

  // Rules 3 and 4: an errored read is not an empty book, and a money figure
  // drawn from a partial read must say so.
  it("warns rather than reporting an empty book when the read fails", async () => {
    state.handlers.card_sales = () => ({ data: null, error: { message: "timeout" } });
    const d = await (await post({ cardId: "c1" })).json();
    expect(d.warnings.join(" ")).toContain("could not be read");
    expect(d.warnings.join(" ")).toContain("timeout");
  });

  it("says so when a card has no identity to join on", async () => {
    state.handlers.cards = () => ({ data: { ...CARD, identity_id: null } });
    const d = await (await post({ cardId: "c1" })).json();
    expect(d.warnings.join(" ")).toContain("no identity fingerprint");
    expect(state.fake.on("card_sales")).toHaveLength(0);
  });
});

describe("POST /api/cards/valuation — does the set trade", () => {
  // "Bowman Chrome" is issued every year and each is its own market. Without
  // the year filter, 2015 sales would vouch for a 2021 card and send it to an
  // analog-parallel transfer with no analog to reach.
  it("matches the set on name AND year, excluding this identity", async () => {
    await post({ cardId: "c1" });
    const q = state.fake.on("card_market_sales")[0];
    expect(filterOn(q, "card_identities.set_name")).toEqual(["eq", "card_identities.set_name", "Bowman Chrome"]);
    expect(filterOn(q, "card_identities.year")).toEqual(["eq", "card_identities.year", 2021]);
    expect(filterOn(q, "identity_id")).toEqual(["neq", "identity_id", "ident-1"]);
  });

  it("drops the year filter and says so when the card has none", async () => {
    state.handlers.cards = () => ({ data: { ...CARD, year: null } });
    const d = await (await post({ cardId: "c1" })).json();
    expect(filterOn(state.fake.on("card_market_sales")[0], "card_identities.year")).toBeUndefined();
    expect(d.warnings.join(" ")).toContain("across every year");
  });

  // A trading set licenses the analog-parallel transfer; an untraded one does
  // not, and a failed check must not be read as either.
  it("reaches too_rare when the set trades", async () => {
    state.handlers.card_market_sales = () => ({ data: [{ id: "m1" }] });
    const d = await (await post({ cardId: "c1" })).json();
    expect(d.verdict.thin.reason).toBe("too_rare");
    expect(d.verdict.thin.method).toBe("analog_parallel");
  });

  it("warns instead of silently deciding the set doesn't trade", async () => {
    state.handlers.card_market_sales = () => ({ data: null, error: { message: "nope" } });
    const d = await (await post({ cardId: "c1" })).json();
    expect(d.warnings.join(" ")).toContain("whether the rest of this set trades");
    expect(d.verdict.thin.reason).toBe("unknown");
    expect(d.verdict.thin.method).toBe("none");
  });
});

describe("POST /api/cards/valuation — the user's pricing rules", () => {
  it("applies the card's configured aggregate", async () => {
    state.handlers.cards = () => ({ data: { ...CARD, pricing_strategy: "mine" } });
    state.handlers.card_pricing_strategies = () => ({
      data: { params: { pipeline: { aggregate: { fn: "max" } } } },
    });
    state.handlers.card_sales = () => ({
      data: [10, 20, 30, 40, 50].map((p, i) => ownSale(p, `2026-07-${10 + i}`)),
    });

    const d = await (await post({ cardId: "c1" })).json();
    expect(d.strategy).toBe("mine");
    expect(d.verdict.price).toBe(50); // max, not median(30)
  });

  // Charm pricing is a LISTING convention. A valuation of $47.99 claims a
  // precision that came from marketing rather than from evidence.
  it("does not carry round_99 into a valuation", async () => {
    state.handlers.cards = () => ({ data: { ...CARD, pricing_strategy: "mine" } });
    state.handlers.card_pricing_strategies = () => ({
      data: { params: { pipeline: { adjust: { round_99: true } } } },
    });
    state.handlers.card_sales = () => ({
      data: [40, 40, 40, 40, 40].map((p, i) => ownSale(p, `2026-07-${10 + i}`)),
    });

    const d = await (await post({ cardId: "c1" })).json();
    expect(d.verdict.price).toBe(40);
  });

  it("falls back to the default and says so when the rules can't be read", async () => {
    state.handlers.cards = () => ({ data: { ...CARD, pricing_strategy: "mine" } });
    state.handlers.card_pricing_strategies = () => ({ data: null, error: { message: "gone" } });
    const d = await (await post({ cardId: "c1" })).json();
    expect(d.warnings.join(" ")).toContain("default median");
    expect(d.strategy).toBeNull();
  });
});

describe("POST /api/cards/valuation — budget", () => {
  it("defaults to standard and rejects an unknown budget by falling back", async () => {
    expect((await (await post({ cardId: "c1" })).json()).budget).toBe("standard");
    expect((await (await post({ cardId: "c1", budget: "deep" })).json()).budget).toBe("deep");
    expect((await (await post({ cardId: "c1", budget: "nonsense" })).json()).budget).toBe("standard");
  });
});

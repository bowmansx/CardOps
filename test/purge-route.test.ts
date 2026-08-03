import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase, filterOn, type TableHandler } from "./helpers/fake-supabase";

// THE ONLY DESTRUCTIVE ROUTE IN THE PRICING STACK (2026-08-02).
//
// It executes a vendor's deletion clause, so the tests are mostly about what it
// REFUSES to do. Every guard here exists because its absence would either
// destroy the user's own records or report an obligation discharged that wasn't.

const state: {
  role: string | null;
  user: { id: string } | null;
  handlers: Record<string, TableHandler>;
  adminHandlers: Record<string, TableHandler>;
  hasServiceKey: boolean;
  fake: ReturnType<typeof fakeSupabase>;
  admin: ReturnType<typeof fakeSupabase>;
} = {
  role: "owner", user: { id: "u1" }, handlers: {}, adminHandlers: {},
  hasServiceKey: true, fake: fakeSupabase({}), admin: fakeSupabase({}),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    state.fake = fakeSupabase(state.handlers, state.user);
    return state.fake.client;
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    if (!state.hasServiceKey) return null;
    state.admin = fakeSupabase(state.adminHandlers, state.user);
    return state.admin.client;
  },
}));
vi.mock("@/lib/cards/roles", () => ({
  currentRole: async () => state.role,
  hasCardAccess: (r: string | null) => r === "owner" || r === "card_ops",
}));

const { POST } = await import("@/app/api/cards/market-sales/purge/route");

const post = (body: unknown) =>
  POST(new Request("http://x/api/cards/market-sales/purge", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

/** Counts for the three preview queries, in the order the route issues them. */
function counts(vendor: number, mine: number, rollups: number) {
  let n = 0;
  state.handlers.card_market_sales = () => ({ count: n++ === 0 ? vendor : mine, data: [] });
  state.handlers.card_market_rollups = () => ({ count: rollups, data: [] });
}

beforeEach(() => {
  state.role = "owner";
  state.user = { id: "u1" };
  state.hasServiceKey = true;
  state.handlers = {};
  state.adminHandlers = {};
  counts(0, 0, 0);
});

describe("purge — who may even ask", () => {
  it("refuses when signed out", async () => {
    state.user = null;
    expect((await post({ source: "thecardapi" })).status).toBe(401);
  });

  // This deletes rows belonging to every tenant's shared history. Card-ops
  // access is not enough.
  it("refuses a card_ops user, not just a signed-out one", async () => {
    state.role = "card_ops";
    expect((await post({ source: "thecardapi" })).status).toBe(403);
  });

  // Deleting by an arbitrary string would let a typo empty the table, and a
  // source nobody declared has no terms to execute in the first place.
  it("refuses a source with no declared terms", async () => {
    const r = await post({ source: "some-vendor-nobody-declared" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("no declared terms");
  });

  it("needs a source", async () => {
    expect((await post({})).status).toBe(400);
  });
});

describe("purge — preview is the default", () => {
  it("deletes nothing without an explicit confirm", async () => {
    counts(412, 3, 7);
    const d = await (await post({ source: "thecardapi" })).json();

    expect(d.preview).toBe(true);
    expect(d.scope.vendorSales).toBe(412);
    expect(state.admin.calls.filter((c) => c.op === "delete")).toHaveLength(0);
  });

  it("reports the vendor's own retention term alongside the count", async () => {
    counts(10, 0, 0);
    const d = await (await post({ source: "thecardapi" })).json();
    expect(d.rights.deleteOnTerminationDays).toBe(30); // The Card API §5
  });

  // Scoping on source ALONE would sweep up own sales and pasted comps sitting in
  // the same table — destroying work under cover of compliance.
  it("counts vendor rows and user rows SEPARATELY", async () => {
    counts(412, 3, 0);
    await post({ source: "thecardapi" });

    const [vendorQ, mineQ] = state.fake.on("card_market_sales");
    expect(filterOn(vendorQ, "provenance")).toEqual(["eq", "provenance", "vendor"]);
    expect(filterOn(mineQ, "provenance")).toEqual(["neq", "provenance", "vendor"]);
    expect(filterOn(vendorQ, "source")).toEqual(["eq", "source", "thecardapi"]);
  });

  // Rules 3 and 4: a purge sized from a failed read would report a blast radius
  // it never measured.
  it("refuses to proceed when it cannot measure the damage", async () => {
    state.handlers.card_market_sales = () => ({ data: null, error: { message: "read failed" } });
    const r = await post({ source: "thecardapi", confirm: true });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toContain("Nothing was deleted");
  });
});

describe("purge — confirmed", () => {
  /** Admin side: N vendor rows, deleted in batches, then nothing left. */
  function adminWithRows(total: number, opts: { deleteReturnsNothing?: boolean } = {}) {
    let left = total;
    state.adminHandlers.card_market_sales = (q) => {
      if (q.op === "delete") {
        const asked = (filterOn(q, "id")?.[2] as string[]) ?? [];
        if (opts.deleteReturnsNothing) return { data: [] };
        left -= asked.length;
        return { data: asked.map((id) => ({ id })) };
      }
      const n = Math.min(left, q.limit ?? 500);
      return { data: Array.from({ length: n }, (_, i) => ({ id: `r${i}` })) };
    };
  }

  it("deletes only vendor rows and reports what it kept", async () => {
    counts(1200, 5, 2);
    adminWithRows(1200);

    const d = await (await post({ source: "thecardapi", confirm: true })).json();

    expect(d.deleted).toBe(1200);
    expect(d.kept).toEqual({ userRows: 5, rollups: 2 });
    expect(d.narrative).toContain("Kept 5 of your own rows");

    const del = state.admin.calls.filter((c) => c.op === "delete");
    expect(del.length).toBeGreaterThan(1); // batched, not one huge statement
    // Every read that feeds a delete is scoped to vendor rows of this source.
    for (const q of state.admin.calls.filter((c) => c.op === "select")) {
      expect(filterOn(q, "provenance")).toEqual(["eq", "provenance", "vendor"]);
      expect(filterOn(q, "source")).toEqual(["eq", "source", "thecardapi"]);
    }
  });

  // THE BUG THIS EXISTS FOR. card_market_sales has no DELETE policy for
  // authenticated callers, so under the wrong client the delete matches zero
  // rows and returns NO ERROR — the counter would climb to the ceiling having
  // removed nothing, and report success.
  it("hard-stops when a delete removes nothing despite matching rows", async () => {
    counts(1000, 0, 0);
    adminWithRows(1000, { deleteReturnsNothing: true });

    const r = await post({ source: "thecardapi", confirm: true });
    const d = await r.json();

    expect(r.status).toBe(500);
    expect(d.error).toContain("removed nothing");
    expect(d.deleted).toBe(0);
    // It refused to loop rather than spinning to the ceiling.
    expect(state.admin.calls.filter((c) => c.op === "delete")).toHaveLength(1);
  });

  // Failing is better than an obligation that looks discharged and isn't.
  it("refuses outright with no service key, and says the duty stands", async () => {
    counts(500, 0, 0);
    state.hasServiceKey = false;

    const r = await post({ source: "thecardapi", confirm: true });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("NOT discharged");
  });

  it("surfaces rollups as a separate decision rather than deleting them", async () => {
    counts(10, 0, 4);
    adminWithRows(10);
    const d = await (await post({ source: "thecardapi", confirm: true })).json();

    expect(d.kept.rollups).toBe(4);
    expect(d.narrative).toContain("decide on those separately");
    expect(state.admin.on("card_market_rollups")).toHaveLength(0);
  });
});

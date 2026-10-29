import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase, type TableHandler } from "./helpers/fake-supabase";

// THE SERVER ACTION ITSELF (2026-10-28). The page applies these rules before
// sending, but the action is what writes, and a client can be bypassed — so its
// guards are tested where they live.

const state: { handlers: Record<string, TableHandler>; fake: ReturnType<typeof fakeSupabase> } = {
  handlers: {}, fake: fakeSupabase({}),
};

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    state.fake = fakeSupabase(state.handlers, { id: "u1" });
    return state.fake.client;
  },
}));

const { importCards } = await import("@/app/cards/actions");

type Inserted = Record<string, unknown>;
const inserted = (): Inserted[] =>
  (state.fake.on("cards").find((q) => q.op === "insert") as unknown as { rows?: Inserted[] } | undefined)?.rows ?? [];

beforeEach(() => {
  state.handlers = { cards: () => ({ data: [], error: null }) };
});

describe("importCards — blank cards", () => {
  // Every row of a file whose columns didn't match used to become a blank card.
  it("skips rows with no identity and counts them", async () => {
    const r = await importCards([{ player: "A" }, { zone: "GR" }, { location_code: "B1" }]);
    expect(r).toMatchObject({ ok: true, inserted: 1, skipped: 2 });
    expect(inserted()).toHaveLength(1);
  });

  it("judges identity on the PARSED year", async () => {
    const r = await importCards([{ year: "unknown" }, { year: "2021-22" }]);
    expect(r).toMatchObject({ ok: true, inserted: 1, skipped: 1 });
    expect(inserted()[0]).toMatchObject({ year: 2021 });
  });

  it("writes nothing and says why when every row is blank", async () => {
    const r = await importCards([{ zone: "GR" }, { zone: "HOLD" }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("None of the 2 rows");
    expect(state.fake.on("cards").some((q) => q.op === "insert")).toBe(false);
  });
});

describe("importCards — money", () => {
  it("reads a currency-formatted cost instead of zeroing it", async () => {
    await importCards([{ player: "A", individual_basis: "$12.50" }]);
    expect(inserted()[0]).toMatchObject({ individual_basis: 12.5, basis_entered: true });
  });

  it("keeps a stated zero distinct from a blank", async () => {
    await importCards([
      { player: "A", individual_basis: "0" },
      { player: "B", individual_basis: "" },
      { player: "C", individual_basis: "who knows" },
    ]);
    expect(inserted().map((c) => [c.individual_basis, c.basis_entered])).toEqual([
      [0, true], [0, false], [0, false],
    ]);
  });

  it("does not read a European decimal comma as a hundredfold amount", async () => {
    await importCards([{ player: "A", market_value: "12,50" }]);
    expect(inserted()[0]).toMatchObject({ market_value: 12.5 });
  });
});

describe("importCards — condition", () => {
  // A PSA 10 with no condition column used to import as RAW and price off
  // ungraded comps.
  it("infers graded from a grader", async () => {
    await importCards([{ player: "A", grader: "PSA", grade: "10" }]);
    expect(inserted()[0]).toMatchObject({ condition_type: "graded", grader: "PSA", grade: 10 });
  });

  it("does not let an unrecognised condition fail the whole batch", async () => {
    await importCards([{ player: "A", condition_type: "NM" }, { player: "B", condition_type: "raw" }]);
    expect(inserted().map((c) => c.condition_type)).toEqual(["raw", "raw"]);
  });
});

describe("importCards — unchanged behaviour", () => {
  // The existing rule: sold rows import unsold, and are counted.
  it("still coerces a sold status and counts it", async () => {
    const r = await importCards([{ player: "A", status: "sold" }]);
    expect(r.coerced).toBe(1);
    expect(inserted()[0]).toMatchObject({ status: "booked" });
  });

  it("surfaces an insert error rather than reporting success", async () => {
    state.handlers.cards = (q) => (q.op === "insert" ? { data: null, error: { message: "boom" } } : { data: [] });
    const r = await importCards([{ player: "A" }]);
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});

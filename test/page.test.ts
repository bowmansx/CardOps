// readAll / readAllSafe — the primitive every sum, membership set, and
// idempotency guard trusts. An off-by-one in the window arithmetic would
// duplicate or skip a row on EVERY page boundary app-wide at once, so the
// contract is pinned here (foundation review, test-adequacy finding).
import { describe, it, expect } from "vitest";
import { readAll, readAllSafe, PAGE } from "@/lib/supabase/page";

type Row = { i: number };

/** A fake table: build(from,to) slices it and records the requested windows. */
function fakeSource(total: number, failOnPage?: number) {
  const calls: Array<[number, number]> = [];
  let page = 0;
  const build = (from: number, to: number) => {
    calls.push([from, to]);
    page += 1;
    if (failOnPage === page) {
      return Promise.resolve({ data: null, error: { message: "boom" } });
    }
    const data: Row[] = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) data.push({ i });
    return Promise.resolve({ data, error: null });
  };
  return { build, calls };
}

describe("readAll", () => {
  it("pages with exact non-overlapping windows and returns every row once", async () => {
    const src = fakeSource(2500);
    const { rows, truncated } = await readAll<Row>(src.build);
    expect(src.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((r) => r.i)).size).toBe(2500); // no dupes
    expect(rows[0].i).toBe(0);
    expect(rows[2499].i).toBe(2499);
    expect(truncated).toBe(false);
  });

  it("a source of exactly PAGE rows terminates on the empty second page, no duplication", async () => {
    const src = fakeSource(PAGE);
    const { rows, truncated } = await readAll<Row>(src.build);
    expect(src.calls).toHaveLength(2); // full page, then the empty terminator
    expect(rows).toHaveLength(PAGE);
    expect(truncated).toBe(false);
  });

  it("THROWS on a mid-stream page error — a partial result must never look complete", async () => {
    const src = fakeSource(2500, 2);
    await expect(readAll<Row>(src.build)).rejects.toThrow("boom");
  });

  it("reports truncated:true when the cap is hit, never silently stopping", async () => {
    const src = fakeSource(5000);
    const { rows, truncated } = await readAll<Row>(src.build, 2000);
    expect(truncated).toBe(true);
    expect(rows.length).toBe(2000);
  });

  it("an empty table returns [] complete", async () => {
    const src = fakeSource(0);
    const { rows, truncated } = await readAll<Row>(src.build);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });
});

describe("readAllSafe", () => {
  it("returns rows:[] plus the error message instead of throwing", async () => {
    const src = fakeSource(2500, 2);
    const r = await readAllSafe<Row>(src.build);
    expect(r.rows).toEqual([]); // never a partial slice presented as data
    expect(r.error).toBe("boom");
  });

  it("mirrors readAll on success", async () => {
    const src = fakeSource(1500);
    const r = await readAllSafe<Row>(src.build);
    expect(r.rows).toHaveLength(1500);
    expect(r.error).toBeNull();
    expect(r.truncated).toBe(false);
  });
});

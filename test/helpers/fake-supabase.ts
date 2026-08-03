// A RECORDING STAND-IN FOR THE SUPABASE CLIENT (2026-08-02).
//
// Route logic in this app is mostly query SHAPE — which table, scoped how,
// ordered by what, and what the code does with an error. None of that is
// reachable from a unit test of a pure function, and none of it is reachable
// from a dev server either: without Supabase credentials the middleware 500s
// every route, including ones that do not exist.
//
// So: a builder that records the chain instead of issuing it, and hands each
// call to a per-table handler the test supplies. What this catches is the class
// of bug that typechecks and fails at runtime — a filter on the wrong column, a
// missing `.order()` before `.range()`, an error branch nobody exercised.
//
// It is deliberately NOT a Postgres. It does not filter, sort or paginate; the
// handler returns whatever the test says. Anything asserting real query
// semantics belongs in `supabase/tests/*.sql`, against a real database.

export type RecordedQuery = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  select?: string;
  /** Every filter applied, in order: ["eq", "cards.identity_id", "abc"]. */
  filters: [string, string, unknown][];
  order: { column: string; ascending?: boolean }[];
  range?: [number, number];
  limit?: number;
  /** True when the caller asked for a single row. */
  single?: boolean;
  /** True when the caller asked for a count instead of rows. */
  head?: boolean;
};

export type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number };

/** Given the recorded chain, what the database would have answered. */
export type TableHandler = (q: RecordedQuery) => QueryResult;

const FILTERS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "like", "ilike", "contains"] as const;

/**
 * A chainable, thenable query builder.
 *
 * Thenable rather than a promise: the chain must stay extendable right up until
 * something awaits it, which is exactly how the real client behaves and how
 * `readAllSafe` uses it (it applies `.range()` to a query the caller built).
 */
function builder(q: RecordedQuery, handle: TableHandler, calls: RecordedQuery[]) {
  const settle = () => {
    calls.push({ ...q, filters: [...q.filters], order: [...q.order] });
    const r = handle(q);
    return { data: r.data ?? null, error: r.error ?? null, count: r.count };
  };

  const self: Record<string, unknown> = {
    select(sel?: string, opts?: { count?: string; head?: boolean }) {
      q.select = sel;
      if (opts?.head) q.head = true;
      return self;
    },
    order(column: string, opts?: { ascending?: boolean }) {
      q.order.push({ column, ascending: opts?.ascending });
      return self;
    },
    range(from: number, to: number) { q.range = [from, to]; return self; },
    limit(n: number) { q.limit = n; return self; },
    maybeSingle() { q.single = true; return Promise.resolve(settle()); },
    single() { q.single = true; return Promise.resolve(settle()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(settle()).then(res, rej);
    },
  };
  for (const f of FILTERS) {
    self[f] = (col: string, val: unknown) => { q.filters.push([f, col, val]); return self; };
  }
  return self as never;
}

export type FakeClient = {
  client: {
    from: (table: string) => never;
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  };
  /** Every query issued, in order. The assertion surface. */
  calls: RecordedQuery[];
  /** Queries against one table, in order. */
  on: (table: string) => RecordedQuery[];
};

export function fakeSupabase(
  handlers: Record<string, TableHandler>,
  user: { id: string } | null = { id: "u1" },
): FakeClient {
  const calls: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      const handle = handlers[table] ?? (() => ({ data: [], error: null, count: 0 }));
      const q: RecordedQuery = { table, op: "select", filters: [], order: [] };
      const b = builder(q, handle, calls) as unknown as Record<string, unknown>;
      // Write ops mark the record and otherwise chain identically.
      b.delete = () => { q.op = "delete"; return b; };
      b.insert = (rows: unknown) => { q.op = "insert"; (q as { rows?: unknown }).rows = rows; return b; };
      b.update = (row: unknown) => { q.op = "update"; (q as { rows?: unknown }).rows = row; return b; };
      return b as never;
    },
    auth: { getUser: async () => ({ data: { user } }) },
  };
  return { client, calls, on: (t) => calls.filter((c) => c.table === t) };
}

/** Find the filter applied to a column, or undefined. */
export function filterOn(q: RecordedQuery, column: string): [string, string, unknown] | undefined {
  return q.filters.find(([, c]) => c === column);
}

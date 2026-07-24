// Paged reads (Beau, 2026-07-24).
//
// PostgREST silently caps a single request at 1000 rows. `.limit(20000)` does
// NOT raise that — it reads like a safety ceiling and behaves like a lie. This
// codebase has been bitten by it repeatedly: a truncated ledger read that let a
// half-posted sale through, a dedup Set that let duplicates in, a delete-then-
// rebuild that destroyed the rows it never read, and several dollar figures
// shown to the user as fact while being a fraction of the truth.
//
// Rule of thumb: if a read feeds a SUM, a COUNT, a membership Set, an
// idempotency guard, or anything destructive, it must be complete — use readAll.
// A read that only fills a "most recent N" list can keep a plain .limit().
//
// Pagination needs a DETERMINISTIC order or rows can repeat/vanish between
// pages. Always apply .order() on something unique (or a tiebreaker) in `build`.

export const PAGE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every row by paging until a short page.
 *
 * `build(from, to)` must return a query with `.range(from, to)` applied and a
 * deterministic `.order()`. Throws on a read error — a partial result must never
 * be mistaken for a complete one.
 *
 * `cap` bounds the work; when it's hit, `truncated` is true. Callers must react
 * to `truncated` rather than silently presenting a partial answer.
 */
export async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  cap = Number.POSITIVE_INFINITY,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
    if (rows.length >= cap) return { rows, truncated: true };
  }
}

/** readAll that returns [] instead of throwing, recording why in `error`. */
export async function readAllSafe<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  cap = Number.POSITIVE_INFINITY,
): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
  try {
    const r = await readAll<T>(build, cap);
    return { ...r, error: null };
  } catch (e) {
    return { rows: [], truncated: false, error: e instanceof Error ? e.message : "read failed" };
  }
}

import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMarketValue, valueAt, type Comp, type StrategyParams } from "@/lib/cards/valuation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Nightly pricing daemon (contract §5). Recomputes market_value from cached
// comps + each card's strategy and appends price_history when it changes.
// Dormant-safe: with no comp sources enabled it simply re-derives modeled/
// manual values — it never fetches a paid API here. Guarded by CRON_SECRET.
//
// Multi-tenant (2026-07-24): this runs as the SERVICE role, which bypasses RLS,
// so every read has to scope itself. Before this pass it did not, and four things
// were wrong once a second user existed:
//   · strategies were keyed by `key` across ALL users — after per-user pricing
//     templates landed, two users sharing a key silently applied one's params
//     to the other's cards;
//   · the reprice scan took the first 1000 cards globally, so a big inventory
//     could crowd out everyone else's;
//   · the portfolio snapshot summed EVERY user's cards into one row, and read
//     `card_pool` name='main' with .maybeSingle() — which errors outright once
//     two users each have a 'main' pool;
//   · that row was written with user_id NULL (no auth.uid() under the service
//     role) against a snapshot_date-only PK, so the portfolio page — which reads
//     under RLS — could not see it at all.
// Everything below is per-user. See 20260731000000_daemon_multitenant.sql.

const CARD_SELECT = "id, year, manual_price, market_value, price_locked, pricing_strategy, landed_cost, grader, grade";
const PAGE = 1000;          // PostgREST caps a request at 1000 rows — always page.
const REPRICE_BUDGET = 4000; // cards repriced per run, across all users
const SNAPSHOT_MAX = 50_000; // cards summed per user's snapshot

type CardRow = { id: string; market_value: number | null; pricing_strategy: string };

/** Read every row, not the first 1000. */
async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });
  }

  const { data: people, error: peopleErr } = await svc
    .from("profiles").select("id").in("role", ["owner", "card_ops"]);
  if (peopleErr) return NextResponse.json({ error: peopleErr.message }, { status: 500 });

  let scanned = 0, repriced = 0, skippedErr = 0;
  const snapshots: Record<string, { cost_basis: number; market_value: number; card_count: number } | null> = {};
  const notes: string[] = [];

  // The budget is a per-user SHARE, not one global counter drained in table
  // order. With a single counter, an owner holding >= REPRICE_BUDGET cards spent
  // the whole thing on user #1 and every other user was never repriced and never
  // snapshotted — so their NAV chart would have stayed permanently empty. That is
  // the same "big inventory crowds everyone out" bug this file fixed at card
  // granularity, reintroduced at user granularity. (2026-07-24)
  const roster = (people ?? []).map((p) => p.id as string);
  const share = roster.length ? Math.max(1, Math.floor(REPRICE_BUDGET / roster.length)) : 0;

  for (const uid of roster) {
    try {
      const r = await repriceUser(svc, uid, share, notes);
      scanned += r.scanned; repriced += r.repriced; skippedErr += r.skippedErr;
    } catch (e) {
      notes.push(`reprice/${uid}: ${e instanceof Error ? e.message : "failed"}`);
    }
    // Every user gets a NAV point, whatever happened to their reprice pass.
    snapshots[uid] = await snapshotUser(svc, uid, notes);
  }

  await auditOrThrow(svc, {
    actor: "cron", action: "card_reprice", target: "cards",
    payload: { users: (people ?? []).length, scanned, repriced, skippedErr, notes: notes.slice(0, 10) },
    result: notes.length ? "partial" : "ok",
  });

  return NextResponse.json({
    ok: true, users: (people ?? []).length, scanned, repriced, skippedErr,
    snapshots, notes: notes.slice(0, 10),
  });
}

/** Reprice one user's live cards from their own comps and their own strategies. */
async function repriceUser(
  svc: SupabaseClient, uid: string, budget: number, notes: string[],
): Promise<{ scanned: number; repriced: number; skippedErr: number }> {
  // Strategies this user may use: the shared built-ins (user_id null) + their own.
  // Keyed by `key`, so their own row must WIN over a built-in of the same key.
  const { data: strats, error: stratErr } = await svc
    .from("card_pricing_strategies").select("key, params, user_id").or(`user_id.is.null,user_id.eq.${uid}`);
  if (stratErr) throw new Error(`strategies fetch failed: ${stratErr.message}`); // never price off a failed read
  const paramsByKey = new Map<string, StrategyParams | null>();
  for (const s of strats ?? []) {
    const key = s.key as string;
    if (s.user_id == null && paramsByKey.has(key)) continue; // a built-in never overwrites the user's own
    paramsByKey.set(key, (s.params as StrategyParams) ?? null);
  }

  // Least-recently-priced first, with id as a deterministic tiebreaker so paging
  // can't skip or repeat a row. Ordering by id alone would reprice the same head
  // of the inventory every night and never reach the tail. (2026-07-24)
  const { rows: cards, truncated } = await readAll<CardRow>(
    (from, to) => svc.from("cards").select(CARD_SELECT)
      .eq("user_id", uid).not("status", "in", "(archived,sold)")
      .order("last_priced_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, to),
    budget,
  );
  if (truncated) {
    notes.push(`reprice/${uid}: took the ${cards.length} least-recently-priced cards (per-user share); the rest rotate in on the next run`);
  }

  let repriced = 0, skippedErr = 0;
  for (const card of cards) {
    const { data: comps, error: compsErr } = await svc
      .from("card_comps").select("grader, grade, sale_price, sale_date, source").eq("card_id", card.id);
    if (compsErr) { skippedErr++; continue; } // never price off a failed read
    const params = paramsByKey.get(card.pricing_strategy) ?? null;
    const pool = (comps ?? []) as Comp[];
    const mv = computeMarketValue(card as never, pool, params);
    const prev = card.market_value == null ? null : Number(card.market_value);
    if (mv != null && mv !== prev) {
      const nowMs = Date.now();
      const row: Record<string, unknown> = {
        market_value: mv,
        last_priced_at: new Date().toISOString(),
        value_30d: valueAt(card as never, pool, params, nowMs - 30 * 86_400_000),
        value_365d: valueAt(card as never, pool, params, nowMs - 365 * 86_400_000),
      };
      let { error: upErr } = await svc.from("cards").update(row).eq("id", card.id);
      if (upErr && /value_30d|value_365d/.test(upErr.message)) {
        // Pre-migration fallback: snapshot columns not applied yet.
        delete row.value_30d;
        delete row.value_365d;
        ({ error: upErr } = await svc.from("cards").update(row).eq("id", card.id));
      }
      if (upErr) { skippedErr++; continue; }
      await svc.from("card_price_history").insert({ card_id: card.id, price: mv, strategy: card.pricing_strategy });
      repriced++;
    }
  }
  return { scanned: cards.length, repriced, skippedErr };
}

/**
 * Daily portfolio snapshot for one user (post-reprice values) — the history the
 * NAV chart reads. Written WITH user_id, keyed (user_id, snapshot_date), so it
 * survives RLS on the way back out.
 */
async function snapshotUser(
  svc: SupabaseClient, uid: string, notes: string[],
): Promise<{ cost_basis: number; market_value: number; card_count: number } | null> {
  try {
    const { rows: lots } = await readAll<{ remaining_cost: number | null }>(
      (from, to) => svc.from("purchase_lots").select("remaining_cost")
        .eq("user_id", uid).order("id", { ascending: true }).range(from, to),
      SNAPSHOT_MAX,
    );
    const lotTotal = lots.reduce((s, l) => s + Number(l.remaining_cost ?? 0), 0);

    const { rows: vrows, truncated } = await readAll<{
      market_value: number | null; manual_price: number | null;
      purchase_lot_id: string | null; individual_basis: number | null;
    }>(
      (from, to) => svc.from("cards")
        .select("market_value, manual_price, purchase_lot_id, individual_basis")
        .eq("user_id", uid).not("status", "in", "(archived,sold)")
        .order("id", { ascending: true }).range(from, to),
      SNAPSHOT_MAX,
    );
    if (truncated) notes.push(`snapshot/${uid}: summed the first ${SNAPSHOT_MAX} cards only`);

    let marketValue = 0, individualBasis = 0, count = 0;
    for (const v of vrows) {
      marketValue += Number((v.manual_price ?? v.market_value) ?? 0);
      if (!v.purchase_lot_id) individualBasis += Number(v.individual_basis ?? 0);
      count++;
    }
    const costBasis = lotTotal + individualBasis;
    const snapshot = {
      cost_basis: Math.round(costBasis * 100) / 100,
      market_value: Math.round(marketValue * 100) / 100,
      card_count: count,
    };
    // Upsert by (user, date) so a same-day re-run refreshes rather than duplicates.
    const { error } = await svc.from("card_portfolio_snapshots").upsert(
      { user_id: uid, snapshot_date: new Date().toISOString().slice(0, 10), ...snapshot, updated_at: new Date().toISOString() },
      { onConflict: "user_id,snapshot_date" },
    );
    if (error) throw new Error(error.message);
    return snapshot;
  } catch (e) {
    // Never fail the whole daemon over one user's snapshot — but say so, rather
    // than swallowing it the way the old single-tenant version did.
    notes.push(`snapshot/${uid}: ${e instanceof Error ? e.message : "failed"}`);
    return null;
  }
}

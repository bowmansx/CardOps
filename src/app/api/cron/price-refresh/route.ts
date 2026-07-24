import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runnableAdapters, consensusForCard, type CardForPricing, type SourceQuote } from "@/lib/cards/price-sources";
import { fetchCardApiSales, distillSales } from "@/lib/cards/price-sources/thecardapi";
import { salesToRows } from "@/lib/cards/market-sales";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily price refresh (Beau, 2026-07-21). Once a day, Vercel Cron calls this; it
// runs every configured price source over a rotating slice of the inventory,
// stores each source's quotes, adopts the consensus as market_value for cards
// that don't own their price (not locked / not manual / no comps), writes a DAILY
// history point, AND accumulates each day's observed sales into card_market_sales
// (Beau, 2026-07-23) so we build a full price-over-time history the Card API's
// 3-day window can't give us in one shot.
//
// Free-tier friendly: capped per run + oldest-priced-first, so a big inventory
// rotates over several days rather than blowing the daily record budget. One Card
// API call per card (≤40 records) → both the accumulation AND the distilled quote.
const CAP = 100; // cards per run (× ~40 records ≈ under the 5,000/day free budget)
const CONCURRENCY = 5;
const SALES_LIMIT = 40;

type CardRow = CardForPricing & {
  market_value: number | null;
  manual_price: number | null;
  price_locked: boolean | null;
  track_history: boolean | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });

  // Oldest-priced first so the whole inventory rotates through over days.
  //
  // The daily CAP is a real budget — these are billable calls on Beau's key. It
  // used to be taken across ALL users at once, so a member's inventory competed
  // with the owner's for the same slots (and the owner paid for it). The owner
  // gets first claim on the budget; whatever's left rotates through everyone
  // else, still oldest-first.
  const SELECT = "id, player, year, set_name, card_number, parallel, sport_category, grader, grade, condition_type, market_value, manual_price, price_locked, track_history, last_priced_at";
  const { data: ownerRow } = await svc.from("profiles").select("id").eq("role", "owner").limit(1).maybeSingle();
  const ownerId = (ownerRow?.id as string | undefined) ?? null;

  let list: (CardRow & { last_priced_at: string | null })[] = [];
  if (ownerId) {
    const { data: mine, error: mineErr } = await svc
      .from("cards").select(SELECT)
      .eq("user_id", ownerId)
      .not("status", "in", "(archived,sold)")
      .order("last_priced_at", { ascending: true, nullsFirst: true })
      .limit(CAP);
    if (mineErr) return NextResponse.json({ error: mineErr.message }, { status: 500 });
    list = (mine ?? []) as typeof list;
  }
  if (list.length < CAP) {
    const { data: rest, error: restErr } = await svc
      .from("cards").select(SELECT)
      .not("status", "in", "(archived,sold)")
      .not("user_id", "is", null)
      .neq("user_id", ownerId ?? "00000000-0000-0000-0000-000000000000")
      .order("last_priced_at", { ascending: true, nullsFirst: true })
      .limit(CAP - list.length);
    if (restErr) return NextResponse.json({ error: restErr.message }, { status: 500 });
    list = [...list, ...((rest ?? []) as typeof list)];
  }
  if (!list.length) return NextResponse.json({ ok: true, processed: 0, note: "no cards to price" });

  // Which cards have their own comps — those keep their comp-derived value (we
  // never overwrite it with a source guide), fetched once instead of per card.
  //
  // This set has to be COMPLETE. A comped card missing from it gets its
  // comp-derived market_value overwritten by a source guide, and that wrong
  // number is also banked as a permanent card_price_history point (which then
  // feeds the movers list and the %-move alerts). Scoping by card id bounds the
  // number of CARDS, not ROWS — card_comps holds one row per sale, so ~100 cards
  // can still exceed PostgREST's 1000-row cap. Page it, and fail the run rather
  // than overwrite every comped card in the batch off a failed read. (2026-07-24)
  const CPAGE = 1000;
  const ids = list.map((c) => c.id);
  const withComps = new Set<string>();
  for (let from = 0; ; from += CPAGE) {
    const { data, error } = await svc
      .from("card_comps").select("card_id").in("card_id", ids)
      .order("card_id", { ascending: true }).range(from, from + CPAGE - 1);
    if (error) return NextResponse.json({ error: `Couldn't read comps: ${error.message}` }, { status: 500 });
    for (const r of data ?? []) withComps.add(r.card_id as string);
    if (!data || data.length < CPAGE) break;
  }

  let adopted = 0;
  let salesStored = 0;
  const history: { card_id: string; price: number; strategy: string }[] = [];
  const now = new Date().toISOString();

  async function priceOne(card: CardRow) {
    const adapters = runnableAdapters(card);
    const useCardApi = adapters.some((a) => a.id === "thecardapi");
    const fresh: SourceQuote[] = [];
    const cleanSources: string[] = [];
    // Every source EXCEPT The Card API via the generic adapter loop (Scryfall etc.).
    for (const a of adapters.filter((a) => a.id !== "thecardapi")) {
      try {
        const res = await a.fetch(card);
        if (res.ok) { cleanSources.push(a.id); fresh.push(...res.quotes); }
      } catch { /* transient — leave prior quotes intact */ }
    }
    // The Card API: ONE raw-sales call → accumulate the day's sales into history
    // AND distill a condition-matched quote (no double call, stays in budget).
    if (useCardApi) {
      try {
        const r = await fetchCardApiSales(card, { allGrades: true, limit: SALES_LIMIT });
        if (r.ok) {
          cleanSources.push("thecardapi");
          fresh.push(...distillSales(r.sales, card));
          if (card.track_history !== false && r.sales.length) {
            const rows = salesToRows(card.id, r.sales);
            if (rows.length) {
              const { error } = await svc!.from("card_market_sales").upsert(rows, { onConflict: "card_id,source,external_id", ignoreDuplicates: true });
              if (!error) salesStored += rows.length;
            }
          }
        }
      } catch { /* transient */ }
    }
    // Replace only the sources that ran cleanly (a 0-quote clean run clears stale).
    if (cleanSources.length) {
      await svc!.from("card_source_quotes").delete().eq("card_id", card.id).in("source", cleanSources);
      if (fresh.length) {
        await svc!.from("card_source_quotes").insert(fresh.map((q) => ({
          card_id: card.id, source: q.source, kind: q.kind, grader: q.grader, grade: q.grade,
          price: q.price, currency: q.currency, label: q.label, url: q.url ?? null, product_ref: q.product_ref ?? null, payload: q.payload ?? null,
        })));
      }
    }

    // Adopt a market value ONLY for cards that don't own their price.
    let market = card.market_value;
    const ownsPrice = card.price_locked || card.manual_price != null || withComps.has(card.id);
    if (!ownsPrice) {
      const cons = consensusForCard({ condition_type: card.condition_type, grader: card.grader, grade: card.grade }, null, fresh);
      if (cons.value != null && cons.value > 0 && cons.value !== Number(card.market_value)) {
        const { error: upErr } = await svc!.from("cards").update({ market_value: cons.value, last_priced_at: now }).eq("id", card.id);
        if (!upErr) { market = cons.value; adopted++; }
      }
    }

    // A daily history point using the card's EFFECTIVE value (manual overrides).
    const effective = card.manual_price != null ? Number(card.manual_price) : market != null ? Number(market) : null;
    if (effective != null && effective > 0) history.push({ card_id: card.id, price: effective, strategy: "daily" });
  }

  // Bounded concurrency.
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    await Promise.all(list.slice(i, i + CONCURRENCY).map((c) => priceOne(c).catch(() => {})));
  }

  if (history.length) await svc.from("card_price_history").insert(history);
  // Advance the rotation cursor for every card we touched (even unchanged ones).
  await svc.from("cards").update({ last_priced_at: now }).in("id", list.map((c) => c.id));

  return NextResponse.json({
    ok: true, processed: list.length, adopted, history_written: history.length, sales_stored: salesStored, capped_at: CAP,
  });
}

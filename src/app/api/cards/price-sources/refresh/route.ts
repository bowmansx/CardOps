import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { ADAPTERS, sourceAvailability, consensusForCard, type CardForPricing, type SourceQuote } from "@/lib/cards/price-sources";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Refresh a card's multi-source pricing (Beau, 2026-07-20). Runs every adapter
// that's configured AND covers the card, stores each vendor's current values in
// card_source_quotes, and returns the fresh set. Display-only — this never
// touches cards.market_value.

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { cardId?: string } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });

  const { data: card } = await supabase
    .from("cards")
    .select("id, player, year, set_name, card_number, parallel, sport_category, grader, grade, condition_type, price_locked, manual_price, market_value")
    .eq("id", body.cardId)
    .maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const c = card as CardForPricing;

  const runnable = ADAPTERS.filter((a) => a.enabled() && a.handles(c));
  const report: { id: string; label: string; matched: boolean; count: number; note?: string }[] = [];
  const replaceIds: string[] = []; // sources that ran cleanly → safe to replace
  const fresh: SourceQuote[] = [];

  await Promise.all(
    runnable.map(async (a) => {
      try {
        const res = await a.fetch(c);
        report.push({ id: a.id, label: a.label, matched: !!res.matched, count: res.quotes.length, note: res.note });
        if (res.ok) {
          replaceIds.push(a.id); // clean run — its stored quotes may be replaced
          fresh.push(...res.quotes);
        }
      } catch (e) {
        report.push({ id: a.id, label: a.label, matched: false, count: 0, note: e instanceof Error ? e.message : "failed" });
      }
    }),
  );

  // Replace ONLY the sources that ran cleanly — a transient error leaves a
  // previously-good quote untouched. A clean run with 0 quotes clears stale.
  if (replaceIds.length) {
    await supabase.from("card_source_quotes").delete().eq("card_id", c.id).in("source", replaceIds);
  }
  if (fresh.length) {
    const rows = fresh.map((q) => ({
      card_id: c.id, source: q.source, kind: q.kind, grader: q.grader, grade: q.grade,
      price: q.price, currency: q.currency, label: q.label, url: q.url ?? null,
      product_ref: q.product_ref ?? null, payload: q.payload ?? null,
    }));
    const { error } = await supabase.from("card_source_quotes").insert(rows);
    if (error) return NextResponse.json({ error: `Save failed: ${error.message}` }, { status: 500 });
  }

  const { data: quotes } = await supabase
    .from("card_source_quotes")
    .select("source, kind, grader, grade, price, currency, label, url, fetched_at")
    .eq("card_id", c.id)
    .order("source", { ascending: true })
    .order("grade", { ascending: true, nullsFirst: true });

  // ── Guide → value bridge (Beau, 2026-07-20). A card with NO sale comps (an
  // MTG single priced only by Scryfall, say) shows "—" because market_value is
  // written from comps/manual only. Adopt the consensus guide as its
  // market_value so it actually shows a number. Strictly guarded: never a
  // price-locked, manual-priced, or comped card — those own their value.
  const cc = card as {
    price_locked?: boolean | null; manual_price?: number | null; market_value?: number | null;
    condition_type?: string | null; grader?: string | null; grade?: number | null;
  };
  let adopted: number | null = null;
  if (!cc.price_locked && cc.manual_price == null) {
    try {
      const { count: compCount, error: compErr } = await supabase
        .from("card_comps").select("id", { count: "exact", head: true }).eq("card_id", c.id);
      // Adopt ONLY when we know for certain the card has zero comps. A transient
      // count error returns count=null — treat that as "unknown, don't touch the
      // value" so we never overwrite a comp-derived price on a blip.
      if (!compErr && compCount === 0) {
        const sq: SourceQuote[] = (quotes ?? []).map((q) => ({
          source: q.source as string, kind: q.kind as SourceQuote["kind"],
          grader: (q.grader as string | null) ?? null, grade: (q.grade as number | null) ?? null,
          price: Number(q.price), currency: (q.currency as string) ?? "USD",
          label: (q.label as string | null) ?? "", url: (q.url as string | null) ?? null,
          product_ref: null, payload: null,
        }));
        const cons = consensusForCard(
          { condition_type: cc.condition_type ?? "raw", grader: cc.grader ?? null, grade: cc.grade ?? null },
          null, // no comp value — we're bridging BECAUSE there are none
          sq,
        );
        if (cons.value != null && cons.value > 0 && cons.value !== Number(cc.market_value)) {
          const { error: upErr } = await supabase
            .from("cards")
            .update({ market_value: cons.value, last_priced_at: new Date().toISOString() })
            .eq("id", c.id);
          if (!upErr) {
            adopted = cons.value;
            await supabase.from("card_price_history").insert({ card_id: c.id, price: cons.value, strategy: "source_guide" });
          }
        }
      }
    } catch {
      // Adoption is best-effort — never fail the refresh over it.
    }
  }

  return NextResponse.json({ quotes: quotes ?? [], report, available: sourceAvailability(c), adopted });
}

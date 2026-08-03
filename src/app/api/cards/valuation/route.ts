// PRICE ONE CARD, AND SHOW THE WORKING (2026-08-02).
//
// The caller for the valuation engine. Everything it uses was already built and
// unreachable: the orchestrator's cheapest-first walk, own-book as the free and
// highest-trust source, the distill's strict condition matching, and the thin
// reason that explains a silence instead of filling it with a guess.
//
// SHAPE: this route does the I/O and nothing else. It reads rows, hands them to
// pure functions, and returns what they decided. That is not tidiness — a source
// that did its own Supabase reads would have to know whether it was running as a
// user or as the service role, and getting that wrong is the first of the two
// recurring bug classes in this codebase.
//
// READ-ONLY. It computes a valuation and returns it; it does NOT write
// `cards.market_value`, post to books, or store a quote. Adopting a number is a
// decision, and money-critical writes are gated on Beau saying so.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { readAllSafe } from "@/lib/supabase/page";
import { ADAPTERS, type CardForPricing } from "@/lib/cards/price-sources";
import { ownSalesToObserved, type OwnSaleRow } from "@/lib/cards/price-sources/own-book";
import type { ObservedSale } from "@/lib/cards/observed-sale";
import { sourceCosts, runValuation } from "@/lib/cards/valuation-run";
import type { Budget } from "@/lib/cards/orchestrator";
import type { DistillAggregate } from "@/lib/cards/distill";
import type { StrategyParams } from "@/lib/cards/valuation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGETS: Budget[] = ["fast", "standard", "deep"];
const DAY = 86_400_000;

type JoinedCard = { grader: string | null; grade: number | string | null; condition_type: string | null };

/** A card's own sales, joined to the condition the card was in. */
type OwnSaleJoined = {
  id: string; card_id: string; platform: string | null;
  sale_price: number | string | null; shipping_income: number | string | null;
  sold_at: string | null; order_ref: string | null;
  /**
   * BOTH SHAPES ACCEPTED, deliberately. PostgREST returns an object for a
   * to-one embed, but supabase-js infers an array whenever the schema types
   * aren't generated — which they aren't here. Asserting either one would be a
   * guess that reads `undefined` for every grader if it were the wrong guess,
   * and a wrong grader silently prices a graded card off raw comps.
   */
  cards: JoinedCard | JoinedCard[] | null;
};

const oneCard = (c: OwnSaleJoined["cards"]): JoinedCard | null =>
  Array.isArray(c) ? c[0] ?? null : c;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    { cardId?: string; budget?: string; maxSpend?: number } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  const budget: Budget = BUDGETS.includes(body.budget as Budget) ? (body.budget as Budget) : "standard";

  const { data: card, error: cardErr } = await supabase
    .from("cards")
    .select("id, player, year, set_name, card_number, parallel, sport_category, grader, grade, condition_type, identity_id, pricing_strategy")
    .eq("id", body.cardId)
    .maybeSingle();
  if (cardErr) return NextResponse.json({ error: `Card read failed: ${cardErr.message}` }, { status: 500 });
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const c = card as CardForPricing & { identity_id: string | null; pricing_strategy: string | null };

  const now = Date.now();
  // Warnings that must reach the screen. A valuation built on a partial read is
  // not a valuation (rule 4) — every one of these degrades the answer, and an
  // undegraded-looking answer is the failure mode this list exists to prevent.
  const warnings: string[] = [];

  // ── Own book ────────────────────────────────────────────────────────────
  // Every copy of this card the user owns, and every sale of those copies. The
  // identity is the join, not the card id: a user who sold this exact card twice
  // and bought a third copy should be priced off both of their own sales.
  //
  // COMPLETE, not capped. These feed a median that becomes a money figure, so a
  // silently truncated read would understate or overstate it (rule 5). The embed
  // carries RLS on both tables, so this is the user's own book and nobody else's.
  let ownRows: OwnSaleRow[] = [];
  if (c.identity_id) {
    const own = await readAllSafe<OwnSaleJoined>((from, to) =>
      supabase
        .from("card_sales")
        .select("id, card_id, platform, sale_price, shipping_income, sold_at, order_ref, cards!inner(grader, grade, condition_type, identity_id)")
        .eq("cards.identity_id", c.identity_id)
        .order("sold_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to));

    if (own.error) {
      // An errored read is NOT an empty book. Saying so is the difference
      // between "you have never sold this" and "we could not look" (rule 3).
      warnings.push(`Your own sales could not be read (${own.error}), so they are missing from this valuation.`);
    } else if (own.truncated) {
      warnings.push("Your own sales were capped before the end of the list, so this median is drawn from part of your history.");
    }
    ownRows = own.rows.map((r) => {
      const j = oneCard(r.cards);
      return {
        id: r.id, card_id: r.card_id, platform: r.platform,
        sale_price: r.sale_price, shipping_income: r.shipping_income,
        sold_at: r.sold_at, order_ref: r.order_ref,
        grader: j?.grader ?? null,
        grade: j?.grade ?? null,
        condition_type: j?.condition_type ?? null,
      };
    });
  } else {
    // No fingerprint means no identity, and own-book joins on the identity.
    warnings.push("This card has no identity fingerprint yet, so your own past sales of it could not be matched.");
  }
  const ownSales: ObservedSale[] = ownSalesToObserved(ownRows);

  // ── Does the SET trade? ─────────────────────────────────────────────────
  // The one fact `thinReason` cannot derive, and the one that decides the
  // method: if the set trades and this variant does not, the answer is a
  // neighbouring parallel; if nothing in the set has ever traded, reaching
  // sideways finds nothing.
  //
  // An existence check, so a bare `.limit(1)` is legitimate — it feeds no sum,
  // no membership set and nothing destructive.
  let setHasSales = false;
  if (c.identity_id && c.set_name) {
    let q = supabase
      .from("card_market_sales")
      .select("id, card_identities!inner(set_name, year)")
      .eq("card_identities.set_name", c.set_name)
      .neq("identity_id", c.identity_id);
    // THE YEAR IS PART OF THE SET. "Bowman Chrome" is issued every year and each
    // one is a different product with its own market — 2015 sales vouching for a
    // 2021 card would report a genuinely untraded set as trading, and send the
    // card to an analog-parallel transfer with no analog to reach.
    if (c.year != null) q = q.eq("card_identities.year", c.year);
    else warnings.push("This card has no year, so the check for whether its set trades matched on the set name across every year.");
    const { data: sib, error: sibErr } = await q.limit(1);
    if (sibErr) {
      // Unknown, not absent. `thinReason` treats a false `setHasSales` as "the
      // set does not trade", which would send a card to the wrong method — so
      // the failure is stated rather than folded into the answer.
      warnings.push(`Could not check whether the rest of this set trades (${sibErr.message}), so the reason for a thin result may be wrong.`);
    } else {
      setHasSales = (sib?.length ?? 0) > 0;
    }
  }

  // ── Walk the sources ────────────────────────────────────────────────────
  const sources = sourceCosts(c, [
    // own-book's cost lives on its adapter, but its ROWS come from above — it is
    // the one source the orchestrator reads from the database rather than
    // fetching, so it enters the walk here with the rest.
    ...ADAPTERS.filter((a) => a.id === "own-book" || typeof a.fetchSales === "function"),
  ]);

  const read = async (id: string) => {
    if (id === "own-book") return { sales: ownSales };
    const adapter = ADAPTERS.find((a) => a.id === id);
    if (!adapter?.fetchSales) return null;
    const res = await adapter.fetchSales(c);
    // `ok: false` is a transient failure, and null is how the orchestrator is
    // told a source FAILED rather than came back empty — the difference between
    // "this card has no comps" and "the vendor was down".
    if (!res.ok) return null;
    if (res.truncated) warnings.push(`${adapter.label} had more sales than it returned.`);
    return { sales: res.sales, note: res.note };
  };

  const lastSaleDays = ownSales.length && ownSales[0].soldAt
    ? Math.round((now - Date.parse(`${ownSales[0].soldAt}T00:00:00Z`)) / DAY)
    : null;
  const ownSales365 = ownSales.filter((s) =>
    s.soldAt && Date.parse(`${s.soldAt}T00:00:00Z`) >= now - 365 * DAY).length;

  // ── The user's own pricing rules ────────────────────────────────────────
  // The card page already lets Beau configure how sales become a number —
  // trimmed mean vs median, IQR fences, a minimum comp count, a multiplier for
  // "my cards sell under the comps". Ignoring that here would make the engine
  // quietly disagree with the value shown two panels down on the same screen.
  //
  // `round_99` is deliberately NOT carried across. Charm pricing is a LISTING
  // convention and belongs to `suggestedListPrice`; a valuation of $47.99 claims
  // a precision that came from marketing rather than from evidence.
  let agg: DistillAggregate = {};
  let strategyKey: string | null = null;
  if (c.pricing_strategy) {
    const { data: strat, error: stratErr } = await supabase
      .from("card_pricing_strategies").select("params").eq("key", c.pricing_strategy).maybeSingle();
    if (stratErr) {
      warnings.push(`Your pricing rules couldn't be read (${stratErr.message}), so this used the default median.`);
    } else {
      const p = (strat?.params as StrategyParams | null)?.pipeline;
      if (p) {
        strategyKey = c.pricing_strategy;
        agg = {
          guards: p.guards, min_comps: p.min_comps, aggregate: p.aggregate,
          ...(p.adjust?.multiplier != null ? { adjust: { multiplier: p.adjust.multiplier } } : {}),
        };
      }
    }
  }

  const { verdict } = await runValuation(
    c, sources, read,
    { issueYear: c.year, setHasSales, lastSaleDays, ownSales365 },
    { budget, maxSpend: typeof body.maxSpend === "number" ? body.maxSpend : undefined, nowMs: now, aggregate: agg },
  );

  return NextResponse.json({ verdict, budget, strategy: strategyKey, warnings });
}

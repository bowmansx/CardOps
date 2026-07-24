import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { IntelSchema, parseStoredIntel } from "@/lib/cards/card-intel-schema";
import { parseStoredEstimate } from "@/lib/cards/grade-estimate-schema";
import { computeMarketValue, valueAt, type Comp, type StrategyParams } from "@/lib/cards/valuation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Card Intel (Beau, 2026-07-18): live-web news scan + a disciplined
// buy/hold/sell verdict + sell-timing strategy per card, per horizon.
// Uses the Claude web_search server tool on the existing API key — no
// extra connector required. Spend-gated + debounced like every AI route.

const SYSTEM = `You are CardOps' card-market analyst for a solo reseller. You receive one card's full context (identity, current computed value, 30-day and 1-year value points, comp summary, grade estimate) and a HORIZON. Then you SEARCH THE WEB for recent, relevant news: the player (injuries, performance, awards, trades, retirement/HOF), the set/product (reprints, rotation, anniversaries, hype cycles), the game (for TCGs: bans, meta shifts, new releases), and the market segment. Rules:
- Only report news you actually found — cite the source name and rough date. No news is a valid answer.
- Verdict discipline: strong_buy/buy = you'd add copies at today's price; hold = ride; sell/strong_sell = exit at/near today's price. Judge RELATIVE TO THE HORIZON given.
- timing_strategy: the most specific sell-timing you can defend (e.g. "list 2 weeks before the October anniversary window peaks; hype cycles top before the event itself").
- watch_for: the 1-3 concrete triggers that would change this verdict.
- You are decision support for a pre-grading reseller, not financial advice — be concrete, never hedge into mush.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Spend guardrail — same kill switch as every paid AI surface.
  const svcGate = createServiceClient();
  const { data: cfg } = svcGate
    ? await svcGate.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) {
    return NextResponse.json({ error: "AI is off (Services page)." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | { cardId?: string; horizon?: string; tier?: string; force?: boolean }
    | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  const horizon = ["flip", "season", "longterm"].includes(body.horizon ?? "") ? body.horizon! : "season";
  // Tiers (Beau, 2026-07-19): light = NO web (fast+cheap, auto-runs on card
  // open); medium = a few searches; deep = the full dig. Search counts are
  // budgeted to finish inside the 60s serverless ceiling.
  const tier = ["light", "medium", "deep"].includes(body.tier ?? "") ? body.tier! : "medium";
  const TIER = {
    // Light takes are kept ~2 weeks then auto-refresh on open (Beau); medium/
    // deep stay short so an on-demand re-run always re-searches the web.
    light: { maxUses: 0, maxTokens: 1100, staleMs: 14 * 24 * 3600_000 },
    medium: { maxUses: 3, maxTokens: 2200, staleMs: 30 * 60_000 },
    deep: { maxUses: 6, maxTokens: 3200, staleMs: 30 * 60_000 },
  }[tier as "light" | "medium" | "deep"];

  const { data: card } = await supabase
    .from("cards")
    .select("id, year, player, set_name, card_number, parallel, sport_category, brand, rarity, condition_type, grader, grade, manual_price, market_value, price_locked, pricing_strategy, landed_cost, serial_number, is_rookie, is_auto, is_relic, vision_confidence")
    .eq("id", body.cardId)
    .maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  // Intel is stored PER HORIZON (vision_confidence.intel_by[horizon]) so each
  // of Beau's three dropdowns keeps its own take; legacy single `intel` is
  // read as a fallback for its own horizon.
  const vcRaw = card.vision_confidence as
    | { intel?: unknown; intel_by?: Record<string, unknown>; grade_estimate?: unknown }
    | null;
  const legacy = parseStoredIntel(vcRaw?.intel);
  const stored =
    parseStoredIntel(vcRaw?.intel_by?.[horizon]) ??
    (legacy && (legacy.horizon ?? "season") === horizon ? legacy : null);
  // Debounce: light reuses any fresh take for this horizon; medium/deep reuse
  // only an equal-or-better fresh run. force overrides.
  if (!body.force && stored?.at) {
    const age = Date.now() - new Date(stored.at).getTime();
    const rank = (t?: string) => (t === "deep" ? 3 : t === "medium" ? 2 : 1);
    const reusable = tier === "light" ? age < TIER.staleMs : rank(stored.tier) >= rank(tier) && age < TIER.staleMs;
    if (reusable) return NextResponse.json({ intel: stored, cached: true });
  }

  const [{ data: compsRaw }, { data: strat }] = await Promise.all([
    supabase.from("card_comps").select("grader, grade, sale_price, sale_date, source").eq("card_id", card.id),
    supabase.from("card_pricing_strategies").select("params").eq("key", card.pricing_strategy).maybeSingle(),
  ]);
  const comps = (compsRaw ?? []) as Comp[];
  const params = (strat?.params as StrategyParams) ?? null;
  const now = Date.now();
  const cur = computeMarketValue(card as never, comps, params);
  const v30 = valueAt(card as never, comps, params, now - 30 * 86_400_000);
  const v365 = valueAt(card as never, comps, params, now - 365 * 86_400_000);
  const est = parseStoredEstimate(vcRaw?.grade_estimate);

  const title = [card.year, card.player, card.set_name, card.parallel, card.card_number ? `#${card.card_number}` : null]
    .filter(Boolean).join(" ");
  const ctx = [
    `CARD: ${title || card.id}`,
    `category: ${card.sport_category ?? "?"}${card.brand ? ` · brand ${card.brand}` : ""}${card.rarity ? ` · rarity ${card.rarity}` : ""}`,
    card.condition_type === "graded" ? `graded: ${card.grader} ${card.grade}` : "raw",
    [card.is_rookie && "RC", card.is_auto && "AUTO", card.is_relic && "PATCH", card.serial_number && `#'d ${card.serial_number}`].filter(Boolean).join(" ") || null,
    `current computed value: ${cur ?? "unknown"} · 30d-ago point: ${v30 ?? "n/a"} · 1y-ago point: ${v365 ?? "n/a"}`,
    `comps on file: ${comps.length}${comps.length ? ` · latest: ${comps.slice(0, 5).map((c) => `${c.grader ?? "RAW"}${c.grade ? " " + c.grade : ""} $${c.sale_price} ${c.sale_date ?? ""}`).join("; ")}` : ""}`,
    `landed cost: ${card.landed_cost ?? "pooled/unknown"}`,
    est ? `AI grade estimate: PSA ${est.psa.low}-${est.psa.high}, BGS ${est.bgs.low}-${est.bgs.high}, SGC ${est.sgc.low}-${est.sgc.high}, CGC ${est.cgc.low}-${est.cgc.high}` : null,
    `HORIZON: ${horizon}`,
    `today: ${new Date().toISOString().slice(0, 10)}`,
  ].filter(Boolean).join("\n");

  try {
    const lightAddendum =
      tier === "light"
        ? "\n\nTHIS IS THE LIGHT TIER: you have NO web access. Use only the provided card context plus your existing market knowledge. Return an EMPTY news array, judge from fundamentals (card profile, values, trajectory, seasonality you know), and phrase the verdict_reason as a quick take."
        : "";
    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: TIER.maxTokens,
      ...(TIER.maxUses > 0
        ? { tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: TIER.maxUses }] }
        : {}),
      system: [{ type: "text", text: SYSTEM + lightAddendum, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `${ctx}\n\n${tier === "light" ? "Deliver the quick-take intel from the context alone." : "Search for recent relevant news, then deliver the intel."}`,
      }],
      output_config: { format: zodOutputFormat(IntelSchema.omit({ horizon: true, tier: true, at: true })) },
    });
    const out = message.parsed_output;
    if (!out) return NextResponse.json({ error: "Couldn't produce intel." }, { status: 422 });

    const intel = { ...out, horizon, tier, at: new Date().toISOString() };
    const prior = card.vision_confidence;
    const vc = prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : {};
    const intelBy = { ...((vc.intel_by as Record<string, unknown>) ?? {}), [horizon]: intel };
    const { error: upErr } = await supabase
      .from("cards")
      .update({ vision_confidence: { ...vc, intel_by: intelBy } })
      .eq("id", card.id);
    if (upErr) console.error("intel persist failed:", upErr.message);

    return NextResponse.json({ intel });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? `Intel failed: ${e.message}` : "Intel failed." },
      { status: 502 },
    );
  }
}

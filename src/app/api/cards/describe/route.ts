import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { cardOpsPrefs } from "@/lib/cards/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AI sale-description generator (Beau): writes listing copy — what the card is,
// its significance, its role (how it's played in a TCG / what it means to the
// scene), and one honest line on HOW the market price was determined (from the
// real pricing method, not invented). Spend-gated like every AI route.
// The discount-off-market line is added at LIST time from price-vs-market, not
// here, so it always matches the slider.

const Out = z.object({
  description: z.string().describe("The finished listing description, plain text, ready to paste."),
});

const TONES: Record<string, string> = {
  professional: "Clean, factual, trustworthy. Short sentences. No hype words.",
  enthusiast: "Collector-to-collector energy — genuine enthusiasm, still honest.",
  minimal: "Terse. Identity + one significance line + the pricing note. Nothing extra.",
};

const SYSTEM = `You write eBay/marketplace listing descriptions for a sports-card and TCG reseller. Given one card's facts, write a tight, accurate description with, in order:
1. What the card is (year, set, player/character, parallel, numbering, grade — from the facts given).
2. Its significance — why a buyer cares (rookie/key card, short print, notable player/character, set importance). Use your knowledge, but do NOT invent stats, records, or specific claims you're unsure of.
3. Its role — for a TCG, how the card is actually played / its place in the meta or format; for sports, the player's relevance to the scene. One or two sentences.
4. One honest sentence on HOW the price was set, paraphrasing the PRICING BASIS provided verbatim in spirit — never invent comp counts or numbers not given.
Hard rules: never fabricate condition, authenticity, or provenance. Never promise investment returns. Do not add a discount/percentage-off line (the system adds that). Keep it to the requested length. Output ONLY the description text.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svcGate = createServiceClient();
  const { data: cfg } = svcGate
    ? await svcGate.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) return NextResponse.json({ error: "AI is off (Services page)." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { cardId?: string; tone?: string; length?: string } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  // Defaults come from CardOps Settings when the caller doesn't override.
  const { data: us } = await supabase.auth.getUser().then(({ data }) =>
    supabase.from("user_settings").select("prefs").eq("user_id", data.user!.id).maybeSingle());
  const defs = cardOpsPrefs(us?.prefs as Record<string, unknown> | null);
  const tone = TONES[body.tone ?? ""] ? body.tone! : defs.description_tone;
  const lenKey = body.length ?? defs.description_length;
  const length = lenKey === "long" ? "3-5 sentences" : lenKey === "short" ? "1-2 sentences" : "2-3 sentences";

  const { data: card } = await supabase
    .from("cards")
    .select("id, year, player, set_name, card_number, parallel, sport_category, brand, rarity, language, condition_type, grader, grade, serial_number, print_run, is_rookie, is_auto, is_relic, market_value, manual_price, pricing_strategy")
    .eq("id", body.cardId)
    .maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  // Factual pricing basis from the card's actual strategy — so "how the price
  // was determined" is real, not hallucinated.
  const { data: strat } = await supabase
    .from("card_pricing_strategies").select("key, params").eq("key", card.pricing_strategy).maybeSingle();
  const p = (strat?.params ?? {}) as Record<string, unknown>;
  const agg = ((p.aggregate as { fn?: string })?.fn ?? "median").replace(/_/g, " ");
  const win = typeof p.window_days === "number" ? `${p.window_days}-day` : "recent";
  const scope = p.comp_scope === "cross_grade" ? "cross-grader" : p.comp_scope === "own_grade" ? "same-grade" : "raw";
  const cur = (card.manual_price ?? card.market_value) as number | null;
  const pricingBasis = cur != null
    ? `Computed market value ${cur} USD, set by the "${strat?.key ?? card.pricing_strategy}" method — the ${agg} of ${scope} sold comps over a ${win} window.`
    : "Priced from comparable recent sales.";

  const facts = [
    `Year: ${card.year ?? "?"}`,
    `Player/character: ${card.player ?? "?"}`,
    `Set: ${card.set_name ?? "?"}`,
    card.card_number ? `Card #: ${card.card_number}` : null,
    card.parallel ? `Parallel/finish: ${card.parallel}` : null,
    `Category: ${card.sport_category ?? "?"}`,
    card.brand ? `Brand: ${card.brand}` : null,
    card.rarity ? `Rarity: ${card.rarity}` : null,
    card.language && card.language !== "English" ? `Language: ${card.language}` : null,
    card.condition_type === "graded" ? `Graded: ${card.grader} ${card.grade}` : "Raw / ungraded",
    [card.is_rookie && "Rookie", card.is_auto && "Autograph", card.is_relic && "Memorabilia/patch",
      card.serial_number && `Serial #'d ${card.serial_number}${card.print_run ? `/${card.print_run}` : ""}`].filter(Boolean).join(", ") || null,
    `PRICING BASIS: ${pricingBasis}`,
    `TONE: ${tone} — ${TONES[tone]}`,
    `LENGTH: ${length}`,
  ].filter(Boolean).join("\n");

  try {
    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${facts}\n\nWrite the description.` }],
      output_config: { format: zodOutputFormat(Out) },
    });
    const out = message.parsed_output;
    if (!out?.description) return NextResponse.json({ error: "Couldn't write a description." }, { status: 422 });
    return NextResponse.json({ description: out.description.trim() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `Describe failed: ${e.message}` : "Describe failed." }, { status: 502 });
  }
}

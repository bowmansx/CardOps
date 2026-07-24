import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, VISION_MODEL, dataUrlToImageBlock } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// CardOps Full-Intake vision (contract §4). Gated by the anthropic_vision
// service_config toggle — GUARDRAIL: no paid API call fires when it's off.
// (service_config is owner-only under RLS, so we read it with the service
//  client — card_ops sessions can't read it directly.)

const Extracted = z.object({
  player: z.string().describe("Player/character/subject name. Empty if unreadable."),
  year: z.string().describe("Print year (4 digits). Empty if not visible."),
  set_name: z.string().describe("Set/series/product name (e.g. 'Prizm', 'Topps Chrome'). Empty if unknown."),
  card_number: z.string().describe("Card/collector number (e.g. '150' or 'RC-12'). Empty if none."),
  parallel: z.string().describe("Parallel/insert/finish (e.g. 'Silver', 'Refractor', 'Holo', 'Reverse Holo'). Empty if base."),
  sport_category: z.string().describe("One of: Football, Basketball, Baseball, Hockey, Soccer, Pokemon, MTG, LoL TCG, Other. Use 'LoL TCG' for League of Legends / Riftbound cards. Empty if unclear."),
  team: z.string().describe("Team/affiliation (sports only). Empty for TCG cards."),
  rarity: z.string().describe("TCG rarity as printed/known (e.g. 'Rare Holo', 'Illustration Rare', 'Secret Rare', 'Mythic Rare', 'Epic'). Empty for sports cards or if unknown."),
  brand: z.string().describe("Card manufacturer/brand for sports cards (Topps, Panini, Bowman, Upper Deck, Fleer, Donruss, Leaf…). Empty for TCG cards or if unknown."),
  is_rookie: z.boolean().describe("Rookie card (RC / rookie logo present)."),
  is_auto: z.boolean().describe("On-card or sticker autograph present."),
  is_relic: z.boolean().describe("Memorabilia/relic/patch swatch present."),
  serial_number: z.string().describe("Serial like '12/99' if numbered. Empty if not."),
  condition_type: z.enum(["raw", "graded"]).describe("graded if in a PSA/BGS/SGC/CGC slab, else raw."),
  raw_grade_estimate: z.string().describe("If raw: NM/EX/VG/GD/PR estimate from visible wear. Empty if graded."),
  grader: z.string().describe("If graded: PSA/BGS/SGC/CGC. Empty if raw."),
  grade: z.string().describe("If graded: numeric grade from the slab label. Empty if raw."),
  cert_number: z.string().describe("If graded: cert/serial number on the slab label. Empty if raw."),
  confidences: z
    .object({
      player: z.number(), year: z.number(), set_name: z.number(),
      card_number: z.number(), grader: z.number(), grade: z.number(),
    })
    .describe("Per-field confidence 0-1 for the key identity fields."),
  overall_confidence: z.number().describe("Overall 0-1 confidence in the identification."),
});

const SYSTEM = `You identify trading cards for an inventory system from one or two photos (front, and often the back).
- The FRONT carries the player/subject, artwork, and often the parallel/finish and rookie/auto/relic markings.
- The BACK carries the set name, card number, year/copyright, and edition text. Always check the back for set_name, card_number, and year.
- If the card is in a graded SLAB (PSA/BGS/SGC/CGC), read the label: grader, numeric grade, and cert number, and set condition_type='graded'.
- For TCG cards (Pokémon / Magic: The Gathering / League of Legends "Riftbound"): player = the card's character/card name, set_name = the expansion, rarity = the printed rarity, team = empty.
- Only report what you can actually see; return empty strings for anything illegible — never guess.
- Give a per-field confidence 0-1 for player, year, set_name, card_number, grader, grade based on legibility.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Role gate IN the route (defense in depth): the edge proxy/middleware also
  // gates this path, but this route spends paid API money — never rely on a
  // single layer for that. RLS can't help here (the spend isn't a table read).
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Service toggle (owner-only table → read via service client). Fail CLOSED:
  // if the toggle is off OR we can't confirm it's on, do not spend on the API.
  const svc = createServiceClient();
  const { data: cfg } = svc
    ? await svc.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) {
    return NextResponse.json({ aiOff: true, message: "AI scan is off — fill the card in manually." });
  }

  const body = (await request.json().catch(() => null)) as { front?: string; back?: string } | null;
  if (!body?.front) return NextResponse.json({ error: "Send at least a `front` image." }, { status: 400 });

  let content;
  try {
    content = [
      { type: "text" as const, text: "Front of the card:" },
      dataUrlToImageBlock(body.front),
      ...(body.back
        ? [{ type: "text" as const, text: "Back of the card:" }, dataUrlToImageBlock(body.back)]
        : [{ type: "text" as const, text: "(No back photo provided.)" }]),
      { type: "text" as const, text: "Identify this card. Empty strings for anything you cannot read." },
    ];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad image." }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.parse({
      model: VISION_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(Extracted) },
    });
    const card = message.parsed_output;
    if (!card) return NextResponse.json({ error: "Couldn't read the card." }, { status: 422 });
    return NextResponse.json({ card });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `AI request failed: ${e.message}` },
        { status: e.status === 401 ? 500 : (e.status ?? 502) },
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scan failed." }, { status: 500 });
  }
}

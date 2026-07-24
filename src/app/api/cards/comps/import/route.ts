import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL, dataUrlToImageBlock } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { recomputeCard } from "@/app/cards/[id]/value/actions";
import { coerceDateOrNull } from "@/lib/books/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The universal comps importer (Beau's Card Ladder connector, and everything
// else): paste TEXT or a SCREENSHOT of a sales history — Card Ladder, eBay
// solds, 130point, auction archives — and the AI parses it into structured
// comps, dedupes against what's already on the card, and reprices. No APIs,
// no ToS drama: you paste what you can already see.

const Parsed = z.object({
  source: z.enum(["cardladder", "ebay", "pricecharting", "auction", "other"])
    .describe("Best guess where this sales data came from, based on its formatting."),
  sales: z.array(z.object({
    grader: z.string().describe("Grading company if the sale was a graded copy (PSA, BGS, SGC, CGC…). 'RAW' if ungraded/unknown."),
    grade: z.number().describe("Numeric grade (halves ok). 0 for raw."),
    sale_price: z.number().describe("Final sale price in dollars. Exclude shipping when itemized separately."),
    sale_date: z.string().describe("Sale date as YYYY-MM-DD. Empty string if not shown."),
  })).describe("Every COMPLETED sale found. Skip active listings, asks, and bids — sold prices only. Dedupe identical rows."),
});

const SYSTEM = `You parse card-sales history pasted from marketplace tools (Card Ladder, eBay sold listings, 130point, PriceCharting, auction archives) — as text or a screenshot.
- Extract COMPLETED sales only: skip active listings, asking prices, canceled/best-offer-unknown rows.
- Grades: "PSA 10", "BGS 9.5" etc → grader + numeric grade. Ungraded/unspecified → RAW / 0.
- Dates: normalize to YYYY-MM-DD; resolve relative dates ("3d ago") against today; empty string when absent.
- Prices: the final sale amount in USD; strip currency symbols/commas; when shipping is itemized separately, exclude it.
- Never invent rows. If the content contains no sales, return an empty list.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Spend guardrail (day-review): fail CLOSED when the AI toggle is off.
  const svcGate = createServiceClient();
  const { data: cfg } = svcGate
    ? await svcGate.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) {
    return NextResponse.json({ error: "AI is off (Services page)." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { cardId?: string; text?: string; image?: string } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });
  const text = (body.text ?? "").trim();
  if (!text && !body.image) return NextResponse.json({ error: "Paste sales text or a screenshot." }, { status: 400 });

  const { data: card } = await supabase.from("cards").select("id").eq("id", body.cardId).maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  // Parse via vision/text.
  let parsed: z.infer<typeof Parsed>;
  try {
    const content: ({ type: "text"; text: string } | ReturnType<typeof dataUrlToImageBlock>)[] = [];
    if (body.image) content.push({ type: "text", text: "Screenshot of the sales history:" }, dataUrlToImageBlock(body.image));
    if (text) content.push({ type: "text", text: `Pasted sales text:\n${text.slice(0, 20_000)}` });
    content.push({ type: "text", text: `Today's date: ${new Date().toISOString().slice(0, 10)}. Extract the sales.` });

    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(Parsed) },
    });
    if (!message.parsed_output) throw new Error("no output");
    parsed = message.parsed_output;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? `Couldn't read the sales: ${e.message}` : "Couldn't read the sales." },
      { status: 502 },
    );
  }
  if (!parsed.sales.length) {
    return NextResponse.json({ inserted: 0, skipped: 0, source: parsed.source, note: "No completed sales found in the paste." });
  }

  // Dedupe against existing comps (same grader+grade+price+date = same sale).
  const { data: existing } = await supabase
    .from("card_comps").select("grader, grade, sale_price, sale_date").eq("card_id", card.id);
  const seen = new Set(
    (existing ?? []).map((c) => `${(c.grader ?? "RAW").toUpperCase()}|${Number(c.grade ?? 0)}|${Number(c.sale_price)}|${c.sale_date ?? ""}`),
  );

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const s of parsed.sales) {
    if (!(s.sale_price > 0) || s.sale_price > 1_000_000) { skipped++; continue; }
    const grader = (s.grader || "RAW").toUpperCase();
    // Round-trip the model-emitted date: "2026-06-31" passes the regex but
    // makes the date column throw, 500ing the whole batch. Invalid → null.
    const date = coerceDateOrNull(s.sale_date);
    const k = `${grader}|${s.grade}|${s.sale_price}|${date ?? ""}`;
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    rows.push({
      card_id: card.id,
      fingerprint: `import-${card.id}`,
      source: parsed.source,
      grader,
      grade: s.grade,
      sale_price: s.sale_price,
      sale_date: date,
    });
  }

  if (rows.length) {
    const { error } = await supabase.from("card_comps").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await recomputeCard(card.id as string);
  }
  return NextResponse.json({ inserted: rows.length, skipped, source: parsed.source });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { parseStoredEstimate } from "@/lib/cards/grade-estimate-schema";
import { GRADING_SYSTEM_PROMPT } from "@/lib/cards/grading-prompt";
import { categoryKind } from "@/lib/cards/types";
import { eraOf } from "@/lib/cards/valuation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-company grade estimator (Beau, 2026-07-18): vision pre-grading against
// the deep-researched rubric (reference/grading-rubric.md). Estimates RANGES
// with rationale + confidence — a pre-grading tool, never a guarantee.

const CompanyEst = z.object({
  low: z.number().describe("Low end of the estimated grade range on this company's scale (halves allowed)."),
  high: z.number().describe("High end of the estimated range."),
  confidence: z.number().describe("0-1 confidence in this range given the photo quality."),
  rationale: z.string().describe("One or two sentences: the specific observations driving this range for THIS company's standards."),
});

const Estimate = z.object({
  image_quality: z.string().describe("One line on photo quality and what it limits (glare, borders cut off, resolution)."),
  key_observations: z.string().describe("2-3 sentences: centering measurement, corner/edge/surface findings that drive every estimate."),
  psa: CompanyEst,
  bgs: CompanyEst,
  sgc: CompanyEst,
  cgc: CompanyEst,
  caveats: z.string().describe("What a photo cannot rule out for this card (surface under glare, back if missing, trimming)."),
});

async function photoDataUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bucket: string,
  path: string,
): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).download(path);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function block(dataUrl: string) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)!;
  return { type: "image" as const, source: { type: "base64" as const, media_type: m[1] as "image/jpeg", data: m[2] } };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Spend guardrail (day-review): no paid API call fires when the toggle is
  // off — fail CLOSED, same invariant as the intake scan route.
  const svcGate = createServiceClient();
  const { data: cfg } = svcGate
    ? await svcGate.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle()
    : { data: null };
  if (!cfg?.enabled) {
    return NextResponse.json({ error: "AI is off (Services page)." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { cardId?: string; force?: boolean } | null;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required." }, { status: 400 });

  const { data: card } = await supabase
    .from("cards")
    .select("id, year, player, set_name, sport_category, parallel, condition_type, grader, grade, vision_confidence")
    .eq("id", body.cardId)
    .maybeSingle();
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  // Debounce: an unchanged card re-estimated within 10 minutes returns the
  // stored answer instead of re-spending (force:true overrides).
  const vcRaw = card.vision_confidence as { grade_estimate?: unknown } | null;
  const stored = parseStoredEstimate(vcRaw?.grade_estimate);
  if (!body.force && stored?.at && Date.now() - new Date(stored.at).getTime() < 10 * 60_000) {
    return NextResponse.json({ estimate: stored, cached: true });
  }

  const { data: photos } = await supabase
    .from("card_photos").select("kind, bucket, path").eq("card_id", card.id).order("created_at");
  const front = (photos ?? []).find((p) => p.kind === "front");
  const back = (photos ?? []).find((p) => p.kind === "back");
  if (!front) return NextResponse.json({ error: "This card has no stored front photo — rescan it first." }, { status: 400 });

  const frontUrl = await photoDataUrl(supabase, front.bucket as string, front.path as string);
  const backUrl = back ? await photoDataUrl(supabase, back.bucket as string, back.path as string) : null;
  if (!frontUrl) return NextResponse.json({ error: "Couldn't load the front photo." }, { status: 500 });

  const kind = categoryKind(card.sport_category as string | null);
  const era = kind === "tcg" ? "tcg" : eraOf(card.year as number | null) === "vintage" ? "vintage_sports" : "modern_sports";
  const meta = [
    `category: ${era}`,
    card.year ? `year: ${card.year}` : null,
    card.set_name ? `set: ${card.set_name}` : null,
    card.parallel ? `finish/parallel: ${card.parallel}` : null,
    card.condition_type === "graded"
      ? `NOTE: already graded ${card.grader} ${card.grade} — estimate what the OTHER companies would likely assign (crossover view).`
      : "raw card",
  ].filter(Boolean).join("\n");

  try {
    const message = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: "text", text: GRADING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Front of the card:" },
          block(frontUrl),
          ...(backUrl ? [{ type: "text" as const, text: "Back of the card:" }, block(backUrl)] : [{ type: "text" as const, text: "(No back photo — hedge accordingly.)" }]),
          { type: "text", text: `Card metadata:\n${meta}\n\nEstimate the per-company grade ranges.` },
        ],
      }],
      output_config: { format: zodOutputFormat(Estimate) },
    });
    const est = message.parsed_output;
    if (!est) return NextResponse.json({ error: "Couldn't produce an estimate." }, { status: 422 });

    // Persist: full estimate into vision_confidence.grade_estimate; compact
    // summary into raw_grade_estimate for raw cards.
    const fmt = (c: z.infer<typeof CompanyEst>) => (c.low === c.high ? `${c.low}` : `${c.low}–${c.high}`);
    const summary = `AI est: PSA ${fmt(est.psa)} · BGS ${fmt(est.bgs)} · SGC ${fmt(est.sgc)} · CGC ${fmt(est.cgc)}`;
    // Guard against a non-object vision_confidence (jsonb is client-writable).
    const prior = card.vision_confidence;
    const vc = prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : {};
    const update: Record<string, unknown> = {
      vision_confidence: { ...vc, grade_estimate: { ...est, at: new Date().toISOString() } },
    };
    if (card.condition_type !== "graded") update.raw_grade_estimate = summary;
    const { error: upErr } = await supabase.from("cards").update(update).eq("id", card.id);
    if (upErr) console.error("grade-estimate persist failed:", upErr.message);

    return NextResponse.json({ estimate: est });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? `Estimate failed: ${e.message}` : "Estimate failed." },
      { status: 502 },
    );
  }
}

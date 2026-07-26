import { NextResponse } from "next/server";
import { gradingPhotos, roleCaption, type PhotoRow } from "@/lib/cards/photo-set";
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

  // EVERY view the card has, not just front and back. Corners and surface
  // angles are precisely what a grader looks at, and the grading template
  // exists to produce them - reading only kind='front'/'back' meant a card
  // photographed from twelve angles was graded from two.
  const { data: photoRows, error: photoErr } = await supabase
    .from("card_photos")
    .select("id, kind, role, variant, derived_from, bucket, path")
    .eq("card_id", card.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (photoErr) return NextResponse.json({ error: `Couldn't read the card's photos: ${photoErr.message}` }, { status: 500 });

  const set = gradingPhotos(photoRows as PhotoRow[] | null, 8);
  if (!set.photos.some((p) => (p.role || p.kind) === "front")) {
    return NextResponse.json({ error: "This card has no stored front photo - photograph it first." }, { status: 400 });
  }

  // Load in parallel; a view that will not load is dropped and NAMED, never
  // silently treated as a view the card does not have.
  const loaded = (await Promise.all(set.photos.map(async (p) => {
    const url = await photoDataUrl(supabase, p.bucket, p.path);
    return url ? { role: (p.role || p.kind || "other") as string, url } : null;
  }))).filter(Boolean) as { role: string; url: string }[];
  const unreadable = set.photos.length - loaded.length;
  if (!loaded.some((l) => l.role === "front")) {
    return NextResponse.json({ error: "Couldn't load the front photo." }, { status: 500 });
  }

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
          // Each image is captioned with WHICH view it is, so a corner
          // close-up is read as a corner rather than as a blurry whole card.
          ...loaded.flatMap((l) => [
            { type: "text" as const, text: `${roleCaption(l.role)}:` },
            block(l.url),
          ]),
          {
            type: "text",
            text:
              `Card metadata:\n${meta}\n\n` +
              `Views supplied: ${loaded.map((l) => l.role).join(", ")}.\n` +
              (set.missing.length
                ? `Views NOT supplied: ${set.missing.join(", ")}. An estimate from ${loaded.length} view(s) is weaker than one from a full set - widen your ranges accordingly and say so in caveats.\n`
                : `This is a full set of views - you may be correspondingly more confident.\n`) +
              (unreadable ? `${unreadable} stored photo(s) could not be loaded and are absent from what you see.\n` : "") +
              `\nEstimate the per-company grade ranges.`,
          },
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
      vision_confidence: { ...vc, grade_estimate: { ...est, at: new Date().toISOString(), views: loaded.map((l) => l.role), missing_views: set.missing } },
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

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { buildLadder, rawValue, type Comp, type Multiplier } from "@/lib/cards/valuation";
import { parseStoredEstimate } from "@/lib/cards/grade-estimate-schema";
import { cardOpsPrefs, DEFAULT_CARDOPS } from "@/lib/cards/settings";
import { gradingVerdict, verdictLine } from "@/lib/cards/grading-ev";

export const dynamic = "force-dynamic";

// Grade-or-Flip EV engine (CardOps' signature): for a raw card, combine the AI
// grade estimate (the grade you'd LIKELY get from each grader) with the value
// ladder (value at that grade) and each grader's real cost → expected net vs.
// selling it raw. Decision support, not a guarantee. Grading fees come from
// CardOps Settings (economy/bulk defaults).
const GRADERS = ["PSA", "BGS", "SGC", "CGC"] as const;
type GKey = "psa" | "bgs" | "sgc" | "cgc";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("cardId");
  if (!id) return NextResponse.json({ error: "cardId required." }, { status: 400 });

  const [{ data: card }, { data: compsRaw }, { data: mult }, { data: us }] = await Promise.all([
    supabase.from("cards").select("*").eq("id", id).maybeSingle(),
    supabase.from("card_comps").select("grader, grade, sale_price, sale_date, source").eq("card_id", id),
    supabase.from("card_grade_multipliers").select("grader, grade, era_bucket, multiplier"),
    supabase.from("user_settings").select("prefs").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!card) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  const fees = cardOpsPrefs(us?.prefs as Record<string, unknown> | null).grading_fees;
  const SHIP = fees.ship;
  const FEES: Record<string, number> = { PSA: fees.PSA, BGS: fees.BGS, SGC: fees.SGC, CGC: fees.CGC };

  const comps = (compsRaw ?? []) as Comp[];
  const multipliers = (mult ?? []) as Multiplier[];
  const est = parseStoredEstimate((card.vision_confidence as { grade_estimate?: unknown } | null)?.grade_estimate);
  const raw = rawValue(card as never, comps) ?? ((card.manual_price ?? card.market_value) as number | null);

  if (card.condition_type === "graded") return NextResponse.json({ ready: false, reason: "already_graded", raw });
  if (est == null) return NextResponse.json({ ready: false, reason: "no_estimate", raw });
  if (raw == null) return NextResponse.json({ ready: false, reason: "no_value", raw });

  const ladder = buildLadder(card as never, comps, multipliers);

  const paths = GRADERS.map((g) => {
    const e = est[g.toLowerCase() as GKey];
    const step = g === "BGS" ? 0.5 : 1;
    const fee = (FEES[g] ?? DEFAULT_CARDOPS.grading_fees.PSA) + SHIP;
    const cells = ladder.filter((c) => c.grader.toUpperCase() === g && c.value != null);

    // ACROSS THE WHOLE ESTIMATE, not its midpoint. "PSA 8 to 10" used to
    // collapse to "PSA 9" and report one number as though the grade were
    // known - averaging away the entire reason grading is a gamble. Only an
    // EXACT ladder cell counts now: the old nearest-cell fallback quietly
    // priced a 10 off the 9 it could find, which is the same bias the pipeline
    // has when it pools grades (see valuation.ts).
    const verdict = gradingVerdict(
      { low: e.low, high: e.high },
      {
        step, fee, rawValue: raw,
        valueAtGrade: (grade) => cells.find((c) => Number(c.grade) === grade)?.value ?? null,
      },
    );

    // The midpoint is still reported - it is a useful shorthand - but it is no
    // longer what the decision is computed from.
    const expected = Math.round(((e.low + e.high) / 2) / step) * step;
    return {
      grader: g, expected, low: e.low, high: e.high, confidence: e.confidence,
      fee,
      gradedValue: verdict.bestCase?.value ?? null,
      net: verdict.expectedNet,
      delta: verdict.expectedDelta,
      // What the old screen could never say.
      downsideP: verdict.downsideP,
      priced: verdict.priced,
      bestCase: verdict.bestCase,
      worstCase: verdict.worstCase,
      outcomes: verdict.outcomes,
      line: verdictLine(verdict),
      basis: cells.length ? cells[0].basis_source ?? null : null,
    };
  });

  const viable = paths.filter((p) => p.delta != null) as (typeof paths[number] & { delta: number })[];
  const best = viable.length ? viable.reduce((b, p) => (p.delta > b.delta ? p : b)) : null;
  const worthIt = best != null && best.delta > 0;

  return NextResponse.json({ ready: true, raw, paths, best, worthIt });
}

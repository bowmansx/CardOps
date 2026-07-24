import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { buildLadder, rawValue, type Comp, type Multiplier } from "@/lib/cards/valuation";
import { parseStoredEstimate } from "@/lib/cards/grade-estimate-schema";
import { cardOpsPrefs } from "@/lib/cards/settings";

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
    // Expected grade = midpoint of the estimate (half-steps for BGS).
    const step = g === "BGS" ? 0.5 : 1;
    const expected = Math.round(((e.low + e.high) / 2) / step) * step;
    // Value at that grade: nearest ladder cell for this grader.
    const cells = ladder.filter((c) => c.grader.toUpperCase() === g && c.value != null);
    let cell = cells.find((c) => Number(c.grade) === expected) ?? null;
    if (!cell && cells.length) {
      cell = cells.reduce((b, c) => (Math.abs(c.grade - expected) < Math.abs(b.grade - expected) ? c : b));
    }
    const gradedValue = cell?.value ?? null;
    const fee = (FEES[g] ?? 25) + SHIP;
    const net = gradedValue != null ? Math.round((gradedValue - fee) * 100) / 100 : null;
    const delta = net != null ? Math.round((net - raw) * 100) / 100 : null;
    return { grader: g, expected, low: e.low, high: e.high, confidence: e.confidence, gradedValue, fee, net, delta, basis: cell?.basis_source ?? null };
  });

  const viable = paths.filter((p) => p.delta != null) as (typeof paths[number] & { delta: number })[];
  const best = viable.length ? viable.reduce((b, p) => (p.delta > b.delta ? p : b)) : null;
  const worthIt = best != null && best.delta > 0;

  return NextResponse.json({ ready: true, raw, paths, best, worthIt });
}

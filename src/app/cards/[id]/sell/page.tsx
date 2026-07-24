import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SellForm } from "@/components/cards/SellForm";
import {
  buildLadder, rawValue, type Comp, type Multiplier,
} from "@/lib/cards/valuation";
import { parseStoredEstimate } from "@/lib/cards/grade-estimate-schema";

export const dynamic = "force-dynamic";

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function SellPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: card }, { data: compsRaw }, { data: mult }] = await Promise.all([
    supabase
      .from("cards")
      .select("id, sku, player, year, set_name, parallel, status, grader, grade, condition_type, manual_price, market_value, pricing_strategy, landed_cost, price_locked, vision_confidence")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("card_comps").select("grader, grade, sale_price, sale_date, source").eq("card_id", id),
    supabase.from("card_grade_multipliers").select("grader, grade, era_bucket, multiplier"),
  ]);
  if (!card) notFound();
  if (card.status === "sold") redirect(`/cards/${id}`);
  const title = [card.year, card.player, card.set_name].filter(Boolean).join(" ") || (card.sku as string);

  // Suggested sale price = the card's current value (manual wins, then market).
  const suggested = (card.manual_price as number | null) ?? (card.market_value as number | null);

  // Per-company "if it graded at its estimated grade" values: midpoint of each
  // AI-estimated range → nearest grade-ladder cell for that company.
  const comps = (compsRaw ?? []) as Comp[];
  const ladder = buildLadder(card as never, comps, (mult ?? []) as Multiplier[]);
  const raw = rawValue(card as never, comps);
  // safeParse — vision_confidence is client-writable jsonb; malformed data
  // must degrade to "run the estimator", never 500 the sell page (day-review).
  const est = parseStoredEstimate((card.vision_confidence as { grade_estimate?: unknown } | null)?.grade_estimate);
  const estRows = est
    ? (["psa", "bgs", "sgc", "cgc"] as const).map((k) => {
        const c = est[k];
        const mid = Math.round(((c.low + c.high) / 2) * 2) / 2; // nearest half-grade
        const cells = ladder.filter((l) => l.grader.toUpperCase() === k.toUpperCase());
        const cell = cells.length
          ? cells.reduce((best, l) => (Math.abs(l.grade - mid) < Math.abs(best.grade - mid) ? l : best))
          : null;
        return { company: k.toUpperCase(), mid, value: cell?.value ?? null, basis: cell?.basis_source ?? null, cellGrade: cell?.grade ?? null };
      })
    : null;

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settle sale</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href={`/cards/${id}`} className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Card</Link>
        </header>

        {/* If-graded value panel — each company at its AI-estimated grade
            (range midpoint), valued off the grade ladder. */}
        {estRows ? (
          <section className="mt-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
              If graded — value at each company&apos;s estimated grade
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {estRows.map((r) => (
                <div key={r.company} className="rounded-xl border border-hairline bg-white px-3 py-2.5 text-center">
                  <div className="figures text-[11px] font-bold text-ink/60">{r.company} {r.mid}</div>
                  <div className="figures mt-0.5 text-base font-bold text-flag">{money(r.value)}</div>
                  {r.basis && (
                    <div className="figures text-[9px] text-ink/35">
                      {r.cellGrade !== r.mid ? `nearest cell ${r.cellGrade} · ` : ""}{r.basis}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {raw == null && (
              <p className="mt-1 text-[11px] text-warn/80">
                Values show &quot;—&quot; because this card has no sales evidence yet — add comps on the Value page and these light up.
              </p>
            )}
          </section>
        ) : (
          <p className="mt-4 rounded-xl border border-hairline bg-white px-3 py-2.5 text-[11px] text-ink/50">
            Run <b>Grade estimate (AI)</b> on the card page to see per-company &quot;if graded&quot; values here.
          </p>
        )}

        <SellForm
          id={id}
          cardTitle={title}
          suggestedPrice={suggested}
          graded={card.condition_type === "graded" ? `${card.grader ?? ""} ${card.grade ?? ""}`.trim() : null}
        />
      </div>
    </main>
  );
}

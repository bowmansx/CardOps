import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buildLadder, rawValue, computeMarketValue, suggestedListPrice, gradeUp, valueAt,
  type Comp, type Multiplier, type StrategyParams,
} from "@/lib/cards/valuation";
import { addComp, setStrategy, setManualPrice } from "./actions";
import { GRADERS } from "@/lib/cards/types";
import { CompsPaste } from "@/components/cards/CompsPaste";
import { MultiCasePanel, type PriceCase } from "@/components/cards/MultiCasePanel";
import { LiquidityPanel, type TierRow } from "@/components/cards/LiquidityPanel";
import { velocity, tierOf, weightedPrices, matchesExact } from "@/lib/cards/liquidity";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";
const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const inp = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-flag";

export default async function ValuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: card }, { data: compsRaw }, { data: mult }, { data: strats }, { data: history }] = await Promise.all([
    supabase.from("cards").select("*").eq("id", id).maybeSingle(),
    supabase.from("card_comps").select("grader, grade, sale_price, sale_date, source").eq("card_id", id).order("sale_date", { ascending: false }),
    supabase.from("card_grade_multipliers").select("grader, grade, era_bucket, multiplier"),
    supabase.from("card_pricing_strategies").select("key, label, params"),
    supabase.from("card_price_history").select("price, strategy, ts").eq("card_id", id).order("ts", { ascending: true }).limit(500),
  ]);
  if (!card) notFound();
  const comps = (compsRaw ?? []) as Comp[];
  const multipliers = (mult ?? []) as Multiplier[];
  const SEED_ORDER = ["standard", "conservative", "aggressive", "hot", "thin_market", "manual_lock"];
  const strategies = ((strats ?? []) as { key: string; label: string; params: StrategyParams | null }[])
    .sort((a, b) => {
      const ai = SEED_ORDER.indexOf(a.key), bi = SEED_ORDER.indexOf(b.key);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.label.localeCompare(b.label);
    });
  const activeParams = strategies.find((s) => s.key === card.pricing_strategy)?.params ?? null;

  // Every format's answer for THIS card (pure computation — cheap).
  const cases: PriceCase[] = strategies.map((s) => ({
    key: s.key,
    label: s.label,
    value: computeMarketValue(card as never, comps, s.params),
    active: s.key === card.pricing_strategy,
    tags: s.params?.meta?.tags ?? [],
  }));

  // Timeline data: the nightly repricer + every recompute have been logging
  // (price, strategy, ts) — one line per strategy.
  const histRows = (history ?? []) as { price: number; strategy: string | null; ts: string }[];

  const raw = rawValue(card as never, comps);
  const ladder = buildLadder(card as never, comps, multipliers);
  const market = computeMarketValue(card as never, comps, activeParams);
  const list = suggestedListPrice(market, card.landed_cost as number | null);
  const up = gradeUp(ladder, raw);

  // Sales-by-grade rollup from this card's comp pool: how many sales exist at
  // each company+grade, their average, and % vs the card's current market
  // value (green = that grade sells above where this card sits, red = below).
  const gradeRollup = (() => {
    const m = new Map<string, { grader: string; grade: number; count: number; sum: number }>();
    for (const c of comps) {
      if (c.sale_price == null) continue;
      const grader = (c.grader ?? "RAW").toUpperCase();
      const grade = Number(c.grade ?? 0);
      const k = `${grader}|${grade}`;
      const e = m.get(k) ?? { grader, grade, count: 0, sum: 0 };
      e.count += 1;
      e.sum += c.sale_price;
      m.set(k, e);
    }
    return [...m.values()]
      .map((e) => ({ ...e, avg: e.sum / e.count, pct: market ? ((e.sum / e.count - market) / market) * 100 : null }))
      .sort((a, b) => (a.grader === b.grader ? b.grade - a.grade : a.grader === "RAW" ? 1 : b.grader === "RAW" ? -1 : a.grader.localeCompare(b.grader)));
  })();
  const title = [card.year, card.player, card.set_name].filter(Boolean).join(" ") || (card.sku as string);

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Value</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href={`/cards/${id}`} className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Card</Link>
        </header>
        <p className="figures mt-1 text-sm text-ink/60">{title}</p>

        {/* Headline numbers */}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <Stat label="Raw (as-is)" value={money(raw)} />
          <Stat label="Market" value={money(market)} tone="sky" />
          <Stat label={list.floorApplied ? "List · floor" : "Suggested list"} value={money(list.price)} tone={list.floorApplied ? "amber" : "emerald"} />
        </div>

        {/* Then vs now — the value as of 30 days / 1 year ago under the SAME
            format, with % change to today. */}
        {(() => {
          const now = Date.now();
          const v30 = valueAt(card as never, comps, activeParams, now - 30 * 86_400_000);
          const v365 = valueAt(card as never, comps, activeParams, now - 365 * 86_400_000);
          const delta = (then: number | null) =>
            then != null && then > 0 && market != null ? ((market - then) / then) * 100 : null;
          const Cell = ({ label, then }: { label: string; then: number | null }) => {
            const d = delta(then);
            return (
              <div className="flex items-baseline justify-between rounded-xl border border-hairline bg-white px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-ink/50">{label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="figures text-sm font-semibold text-ink/80">{money(then)}</span>
                  {d != null && Math.abs(d) >= 0.5 && (
                    <span className={"figures text-xs font-bold " + (d > 0 ? "text-pos" : "text-danger")}>
                      {d > 0 ? "+" : ""}{d.toFixed(0)}%
                    </span>
                  )}
                </span>
              </div>
            );
          };
          return (
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              <Cell label="30 days ago" then={v30} />
              <Cell label="1 year ago" then={v365} />
            </div>
          );
        })()}

        <MultiCasePanel cases={cases} />

        {/* Liquidity — how fast it trades at three scopes, and the price
            slider. Player scope = comps across YOUR cards of this player (an
            honest, labeled proxy until player-wide vendor data lands). */}
        {await (async () => {
          const now = Date.now();
          const exactComps = comps.filter((c) => matchesExact(card as never, c));

          let playerNote: string | undefined;
          let playerV = null as ReturnType<typeof velocity> | null;
          if (card.player) {
            const pc = await readAllSafe<{ id: string }>((from, to) =>
              supabase.from("cards").select("id").eq("player", card.player)
                .order("id", { ascending: true }).range(from, to));
            // .in() rides the query string — cap the id list and SAY so (rule 10).
            const ids = pc.rows.map((r) => r.id);
            const capped = ids.slice(0, 200);
            let playerComps: Comp[] = [];
            let err = pc.error;
            if (capped.length) {
              const cc = await readAllSafe<Comp>((from, to) =>
                supabase.from("card_comps")
                  .select("grader, grade, sale_price, sale_date, source")
                  .in("card_id", capped)
                  .order("id", { ascending: true }).range(from, to));
              err = err ?? cc.error;
              playerComps = cc.rows;
            }
            playerV = velocity(playerComps, now);
            playerNote = err
              ? "read failed — reload"
              : `across ${capped.length}${ids.length > capped.length ? ` of your ${ids.length}` : ""} card${ids.length === 1 ? "" : "s"} of this player`;
          }

          const vExact = velocity(exactComps, now);
          const vCard = velocity(comps, now);
          const exactScope = card.condition_type === "graded" && card.grader
            ? `This exact card (${card.grader} ${card.grade ?? "?"})`
            : "This exact card (raw)";
          const rows: TierRow[] = [
            { scope: exactScope, tier: tierOf(vExact), v: vExact },
            { scope: "This card, any grade", tier: tierOf(vCard), v: vCard },
            ...(playerV ? [{ scope: `Player: ${card.player}`, tier: tierOf(playerV), v: playerV, note: playerNote }] : []),
          ];

          // Slider basis: exact-grade comps when they carry a real sample,
          // else all grades of this card — always labeled.
          const useExact = exactComps.length >= 4 && vExact.perMonth != null;
          const basis = useExact ? exactComps : comps;
          const basisV = useExact ? vExact : vCard;
          return (
            <LiquidityPanel
              estimate={market}
              manualPrice={card.manual_price == null ? null : Number(card.manual_price)}
              rows={rows}
              perMonth={basisV.perMonth}
              weighted={weightedPrices(basis, now)}
              basisLabel={useExact ? "exact-grade comps" : "all grades of this card"}
              basisN={basis.filter((c) => c.sale_price != null).length}
            />
          );
        })()}

        {/* Sales by grade — first thing after the headline: what actually
            trades, at which grade, by which company, and how it compares to
            where THIS card is priced right now. */}
        {gradeRollup.length > 0 && (
          <section className="mt-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
              Sales by grade <span className="normal-case tracking-normal text-ink/35">(from this card&apos;s comps)</span>
            </h2>
            <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
              {gradeRollup.map((g) => (
                <div key={`${g.grader}-${g.grade}`} className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2 last:border-b-0">
                  <span className="figures text-sm font-semibold text-ink/85">
                    {g.grader === "RAW" ? "Raw" : `${g.grader} ${g.grade}`}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="figures text-[11px] text-ink/45">{g.count} sale{g.count === 1 ? "" : "s"}</span>
                    <span className="figures w-20 text-right text-sm font-semibold">{money(g.avg)}</span>
                    {g.pct != null && Math.abs(g.pct) >= 0.5 && (
                      <span className={"figures w-16 text-right text-xs font-bold " + (g.pct > 0 ? "text-pos" : "text-danger")}>
                        {g.pct > 0 ? "+" : ""}{g.pct.toFixed(0)}%
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink/40">
              % = that grade&apos;s average vs this card&apos;s current market value. True population reports per company arrive with the data-feed connectors.
            </p>
          </section>
        )}

        {up && (
          <div className={"mt-3 rounded-xl border px-4 py-3 text-sm " + (up.basis_source === "actual" ? "border-pos/30 bg-pos/5" : "border-hairline bg-white")}>
            <span className="flex items-center gap-2">
              <b className={up.basis_source === "actual" ? "text-pos" : "text-ink"}>
                Grade-up {up.basis_source === "actual" ? "opportunity" : "estimate"}:
              </b>
              <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (up.basis_source === "actual" ? "bg-pos/15 text-pos" : "bg-ink/10 text-ink/50")}>{up.basis_source}</span>
            </span>
            <div className="mt-1">
              {up.grader} {up.grade} ≈ {money(up.value)} — about <b className="figures">{money(up.upside)}</b> over raw after grading cost.
              {up.basis_source === "modeled" && <span className="text-ink/50"> (multiplier estimate — verify with real comps)</span>}
            </div>
          </div>
        )}

        {/* Strategy — every saved format, built-in and custom */}
        <section className="mt-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Pricing standard</h2>
            <Link href="/cards/pricing" className="text-[11px] text-flag underline-offset-2 hover:underline">Build formats →</Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {strategies.map((s) => (
              <form key={s.key} action={setStrategy.bind(null, id, s.key)}>
                <button className={"rounded-full border px-3 py-1 text-xs font-semibold " + (card.pricing_strategy === s.key ? "border-flag bg-flag text-white" : "border-hairline bg-white text-ink/60")}>{s.label}</button>
              </form>
            ))}
          </div>
        </section>

        {/* Grade ladder */}
        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Grade ladder</h2>
          <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
            {ladder.map((c) => (
              <div key={`${c.grader}-${c.grade}`} className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2 last:border-b-0">
                <span className="figures text-sm font-semibold text-ink/80">{c.grader}{c.grade ? ` ${c.grade}` : ""}</span>
                <span className="flex items-center gap-2">
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (c.basis_source === "actual" ? "bg-pos/15 text-pos" : "bg-ink/10 text-ink/50")}>
                    {c.basis_source}{c.basis_source === "actual" ? ` · ${c.comp_count}` : ""}
                  </span>
                  <span className="figures w-20 text-right text-sm font-semibold">{money(c.value)}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink/40">
            <b>modeled</b> = raw × grade multiplier (seed) · <b>actual</b> = averaged from ≥3 real comps.
          </p>
        </section>

        <PriceHistory rows={histRows} strategies={strategies.map((s) => ({ key: s.key, label: s.label }))} />

        {/* Manual price / lock */}
        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Manual price</h2>
          <form action={setManualPrice.bind(null, id)} className="mt-2 flex items-end gap-2 rounded-xl border border-hairline bg-white p-3">
            <label className="flex-1">
              <span className="mb-1 block text-[11px] text-ink/50">Price $</span>
              <input name="manual_price" type="number" step="0.01" min="0" defaultValue={(card.manual_price as number) ?? ""} className={inp + " figures"} />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-xs">
              <input type="checkbox" name="price_locked" defaultChecked={!!card.price_locked} className="h-4 w-4 accent-[#E8590C]" /> lock
            </label>
            <button className="rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white">Set</button>
          </form>
        </section>

        {/* Comps */}
        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Comps ({comps.length})</h2>
          <CompsPaste cardId={id} />
          <form action={addComp.bind(null, id)} className="mt-2 grid grid-cols-4 gap-2 rounded-xl border border-hairline bg-white p-3">
            <select name="grader" className={inp}>
              <option value="RAW">RAW</option>
              {GRADERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input name="grade" type="number" step="0.5" placeholder="grade" className={inp + " figures"} />
            <input name="sale_price" type="number" step="0.01" placeholder="$ sold" required className={inp + " figures"} />
            <input name="sale_date" type="date" className={inp} />
            <button className="col-span-4 rounded-lg bg-flag py-2 text-sm font-bold text-white">Add comp</button>
          </form>
          {comps.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
              {comps.slice(0, 20).map((c, i) => (
                <div key={i} className="figures flex items-center justify-between border-b border-hairline px-3 py-1.5 text-[11px] text-ink/60 last:border-b-0">
                  <span>{(c.grader ?? "RAW")}{c.grade ? ` ${c.grade}` : ""} · {c.source}</span>
                  <span>{money(c.sale_price)} {c.sale_date ? `· ${c.sale_date}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// Price timeline — one line per strategy, server-rendered SVG (no chart lib).
// History accrues from the nightly repricer + every manual recompute.
const LINE_COLORS = ["#c9a227", "#43d989", "#f26d6d", "#6aa9e9", "#e8994a", "#b78ae0"];

function PriceHistory({
  rows,
  strategies,
}: {
  rows: { price: number; strategy: string | null; ts: string }[];
  strategies: { key: string; label: string }[];
}) {
  const pts = rows.filter((r) => Number.isFinite(Number(r.price)));
  if (pts.length < 2) {
    return (
      <section className="mt-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Price timeline</h2>
        <p className="mt-2 rounded-xl border border-hairline bg-white px-3 py-3 text-[11px] text-ink/45">
          The timeline draws itself as values change — every nightly reprice and strategy switch adds a point.
        </p>
      </section>
    );
  }
  const t0 = new Date(pts[0].ts).getTime();
  const t1 = new Date(pts[pts.length - 1].ts).getTime();
  const span = Math.max(1, t1 - t0);
  const prices = pts.map((p) => Number(p.price));
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  const W = 600, H = 150, M = 8;
  const x = (ts: string) => M + ((new Date(ts).getTime() - t0) / span) * (W - 2 * M);
  const y = (p: number) => H - M - ((p - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 2 * M);

  const byStrategy = new Map<string, { price: number; ts: string }[]>();
  for (const r of pts) {
    const k = r.strategy ?? "—";
    const arr = byStrategy.get(k) ?? [];
    arr.push({ price: Number(r.price), ts: r.ts });
    byStrategy.set(k, arr);
  }
  const series = [...byStrategy.entries()];
  const label = (k: string) => strategies.find((s) => s.key === k)?.label ?? k;
  const money2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <section className="mt-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Price timeline</h2>
      <div className="mt-2 rounded-xl border border-hairline bg-white p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="price history">
          {series.map(([k, arr], i) => (
            <g key={k}>
              <polyline
                fill="none"
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={2}
                points={arr.map((p) => `${x(p.ts)},${y(p.price)}`).join(" ")}
              />
              {arr.map((p, j) => (
                <circle key={j} cx={x(p.ts)} cy={y(p.price)} r={2.5} fill={LINE_COLORS[i % LINE_COLORS.length]} />
              ))}
            </g>
          ))}
        </svg>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map(([k], i) => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-ink/60">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
              {label(k)}
            </span>
          ))}
          <span className="figures ml-auto text-[10px] text-ink/40">
            {money2(lo)} – {money2(hi)} · {pts.length} points
          </span>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const t: Record<string, string> = { sky: "text-sky-700", amber: "text-warn", emerald: "text-pos", ink: "text-ink" };
  return (
    <div className="rounded-xl border border-hairline bg-white px-3 py-3">
      <div className={"figures text-lg font-bold " + (t[tone ?? "ink"] || t.ink)}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink/50">{label}</div>
    </div>
  );
}

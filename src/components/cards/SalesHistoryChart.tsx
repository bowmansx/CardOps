// Sales over time (Beau, 2026-07-23). Every observed sale as a dot, plus a gold
// daily-median line — the price-over-time history we accumulate in card_market_sales
// from the Card API's rolling window. Server-rendered SVG, no chart lib. Draws
// nothing until there are ≥2 dated sales.
//
// EVERY PRICE HERE IS ALL-IN (2026-07-29). The dots used to plot the vendor's
// raw price, which mixes bases: eBay quotes what the buyer paid, Goldin quotes
// the hammer with a ~22% premium still to come. A week whose sales happened to
// come from Goldin dipped ~22% and read as a market move that never happened.
// Both the dots and the line now go through `toAllIn`, together — normalizing
// one and not the other would leave the line floating off its own points.
import { dailyMedianSeries } from "@/lib/cards/market-sales";
import { toAllIn } from "@/lib/cards/price-basis";
import type { ObservedSale } from "@/lib/cards/observed-sale";

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function SalesHistoryChart({ sales, className = "" }: { sales: ObservedSale[]; className?: string }) {
  const pts = sales
    .map((s) => {
      const n = toAllIn(s.price, s.priceBasis, s.platform, s.soldAt);
      return {
        p: n.ok ? n.price : NaN,
        t: s.soldAt ? new Date(s.soldAt.slice(0, 10) + "T00:00:00Z").getTime() : NaN,
        graded: !!s.grader,
      };
    })
    .filter((s) => Number.isFinite(s.p) && s.p > 0 && Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const { points: line, excluded } = dailyMedianSeries(sales);
  const W = 320, H = 120, ML = 6, MR = 6, MT = 8, MB = 6;
  const ts = pts.map((p) => p.t), ps = pts.map((p) => p.p);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), lo = Math.min(...ps), hi = Math.max(...ps);
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  const x = (t: number) => ML + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - ML - MR);
  const y = (p: number) => MT + (1 - (p - (lo - pad)) / (hi - lo + 2 * pad)) * (H - MT - MB);
  const linePath = line
    .map((d, i) => `${i ? "L" : "M"}${x(new Date(d.date + "T00:00:00Z").getTime()).toFixed(1)},${y(d.price).toFixed(1)}`)
    .join(" ");

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="sales over time">
        {line.length >= 2 && (
          <path d={linePath} fill="none" stroke="var(--color-flag)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.p)} r={p.graded ? 2.4 : 2} fill="var(--color-ink)" fillOpacity={p.graded ? 0.5 : 0.3} />
        ))}
      </svg>
      <div className="figures mt-0.5 flex items-center justify-between text-[9px] text-ink/40">
        <span>{fmtDate(t0)}</span>
        <span>{pts.length} sales · {money(lo)}–{money(hi)}</span>
        <span>{fmtDate(t1)}</span>
      </div>
      {/* A graph drawn from part of the data must say so — otherwise it reads as
          the whole picture (rules 4 and 10). */}
      {excluded > 0 && (
        <p className="mt-0.5 text-[9px] leading-snug text-ink/35">
          {excluded} sale{excluded === 1 ? "" : "s"} not plotted — no published buyer&rsquo;s premium for that platform.
        </p>
      )}
    </div>
  );
}

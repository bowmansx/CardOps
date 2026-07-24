"use client";

// Liquidity section for the value screen (Beau, 2026-07-25): three tiers of
// "how fast does this actually trade" + the price↔likelihood slider. All math
// lives in src/lib/cards/liquidity (pure, tested); this component only renders
// and re-evaluates as the slider moves — zero network per drag.

import { useState } from "react";
import {
  sellEstimate, formatEta, TIER_LABEL, TIER_BLURB,
  type Velocity, type LiquidityTier, type WeightedPrice,
} from "@/lib/cards/liquidity";

export type TierRow = {
  scope: string;      // "This exact card (PSA 9)" / "This card, any grade" / "Player: LeBron James"
  tier: LiquidityTier;
  v: Velocity;
  note?: string;      // e.g. "across 14 of your cards" / "read failed — reload"
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const TIER_TONE: Record<LiquidityTier, string> = {
  hot: "bg-pos/15 text-pos",
  liquid: "bg-pos/10 text-pos",
  moderate: "bg-amber-500/15 text-amber-600",
  thin: "bg-amber-500/10 text-amber-600",
  stale: "bg-danger/10 text-danger",
  unknown: "bg-ink/5 text-ink/50",
};

function facts(v: Velocity): string {
  const bits: string[] = [];
  if (v.perMonth != null) bits.push(`~${v.perMonth < 1 ? v.perMonth.toFixed(1) : Math.round(v.perMonth)}/mo`);
  else if (v.n365 > 0) bits.push(`${v.n365} sale${v.n365 === 1 ? "" : "s"}/yr`);
  if (v.lastSaleDays != null) bits.push(v.lastSaleDays === 0 ? "sold today" : `last sale ${v.lastSaleDays}d ago`);
  if (v.activeMonths12 > 0) bits.push(`${v.activeMonths12}/12 months active`);
  return bits.join(" · ") || "no dated sales recorded";
}

export function LiquidityPanel({
  estimate, manualPrice, rows, perMonth, weighted, basisLabel, basisN,
}: {
  estimate: number | null;
  manualPrice: number | null;
  rows: TierRow[];
  perMonth: number | null;
  weighted: WeightedPrice[];
  basisLabel: string;
  basisN: number;
}) {
  const [pct, setPct] = useState(0);
  const [span, setSpan] = useState<50 | 90>(50);

  const sliderReady = estimate != null && estimate > 0 && perMonth != null && weighted.length > 0;
  const price = estimate != null ? estimate * (1 + pct / 100) : null;
  const est = sliderReady && price != null ? sellEstimate({ perMonth, weighted }, price) : null;

  return (
    <section className="mt-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
        Liquidity <span className="normal-case tracking-normal text-ink/35">(from recorded sales — estimates, not promises)</span>
      </h2>

      <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
        {rows.map((r) => (
          <div key={r.scope} className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2 last:border-b-0">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink/85">{r.scope}</div>
              <div className="truncate text-[11px] text-ink/50">{facts(r.v)}{r.note ? ` · ${r.note}` : ""}</div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TIER_TONE[r.tier]}`}
              title={TIER_BLURB[r.tier]}
            >
              {TIER_LABEL[r.tier]}
            </span>
          </div>
        ))}
      </div>

      {/* Price ↔ likelihood slider */}
      <div className="mt-2 rounded-xl border border-hairline bg-white p-4">
        {!sliderReady ? (
          <p className="text-xs text-ink/50">
            {estimate == null || estimate <= 0
              ? "No estimated price yet — the slider needs a market value to anchor to."
              : "Not enough dated sales to model sale likelihood for this card yet. Paste comps and this lights up."}
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-ink/50">
                If you priced it at
              </span>
              <span className="flex items-center gap-1 text-[10px]">
                {[50, 90].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setSpan(s as 50 | 90); setPct((p) => Math.max(-s, Math.min(s, p))); }}
                    className={`rounded-full border px-2 py-0.5 font-semibold ${span === s ? "border-flag bg-flag text-white" : "border-hairline text-ink/50"}`}
                  >
                    ±{s}%
                  </button>
                ))}
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-3">
              <span className="figures text-2xl font-bold text-ink">{money(price!)}</span>
              <span className={`figures text-xs font-semibold ${pct === 0 ? "text-ink/40" : pct > 0 ? "text-amber-600" : "text-pos"}`}>
                {pct === 0 ? "market estimate" : `${pct > 0 ? "+" : ""}${pct}% vs estimate`}
              </span>
              {manualPrice != null && estimate != null && estimate > 0 && (
                <span className="text-[10px] text-ink/40">
                  your price: {money(manualPrice)} ({manualPrice >= estimate ? "+" : ""}{Math.round(((manualPrice - estimate) / estimate) * 100)}%)
                </span>
              )}
            </div>

            <input
              type="range"
              min={-span}
              max={span}
              step={1}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="mt-3 w-full accent-[#E8590C]"
              aria-label="Asking price relative to the market estimate"
            />
            <div className="flex justify-between text-[10px] text-ink/35">
              <span>−{span}%</span>
              <button type="button" onClick={() => setPct(0)} className="underline-offset-2 hover:underline">reset</button>
              <span>+{span}%</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="rounded-lg border border-hairline px-3 py-2">
                <div className="figures text-lg font-bold text-ink">{est ? `${Math.round(est.p30 * 100)}%` : "—"}</div>
                <div className="text-[10px] uppercase tracking-wider text-ink/50">chance it sells in 30 days</div>
              </div>
              <div className="rounded-lg border border-hairline px-3 py-2">
                <div className="figures text-lg font-bold text-ink">{est ? formatEta(est.expectedMonths) : "—"}</div>
                <div className="text-[10px] uppercase tracking-wider text-ink/50">expected time to sell</div>
              </div>
            </div>

            {est && (
              <p className="mt-2 text-[11px] leading-snug text-ink/50">
                This price is above {Math.round((1 - est.share) * 100)}% of recent recorded sales.
                Model: {basisLabel} ({basisN} sale{basisN === 1 ? "" : "s"}), sold-comp history only — it can&apos;t
                see competing live listings yet.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

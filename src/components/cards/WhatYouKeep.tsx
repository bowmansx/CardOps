"use client";

import { useMemo, useState } from "react";
import { Wallet, AlertTriangle, Info } from "lucide-react";
import {
  resolveFeeRate, estimateProceeds, breakEvenPrice, offerVerdict, rateLabel,
  FEE_SCHEDULES, type SettledSale,
} from "@/lib/cards/net-proceeds";

// WHAT YOU KEEP (Beau, 2026-07-29).
//
// The one screen in this app that no competitor can build, and the reason is
// structural rather than clever: it needs a cost basis, and none of them holds
// one. eBay shipped a free camera-scan price guide backed by two years of their
// own transactions in March 2026 — market value is a commodity now. This is not.
//
//   "An offer came in at $340. Your break-even is $187 and you keep $301."
//
// Every number here decomposes into real rows. `basis` is the purchase lot's
// current average or the stated figure, plus capitalized cost lines. The fee
// rate prefers YOUR OWN settled sales over any published table, because those
// already contain your store subscription, your category and your promoted
// listings.
//
// It abstains rather than guesses. No rate means no figure — a fee of zero is
// the claim that the platform takes nothing, and it is always wrong (rule 9).

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const PLATFORMS = Object.keys(FEE_SCHEDULES);

export function WhatYouKeep({
  basis,
  basisEntered,
  marketValue,
  settledSales,
  defaultPlatform = "ebay",
  className = "",
}: {
  /** Total cost basis: acquisition + cost lines, from `cardBasis`. */
  basis: number;
  /**
   * Has a basis ever been STATED for this card?
   *
   * `individual_basis` defaults to 0, so an un-costed card and a genuinely free
   * one are the same number. CLAUDE.md is explicit: never present a basis of 0
   * as fact when `basis_entered` is false. Break-even off an unstated basis
   * would read as "anything above fees is profit", which is the most flattering
   * possible lie.
   */
  basisEntered: boolean;
  marketValue: number | null;
  /** This user's own settled sales, for deriving their real fee rate. */
  settledSales: SettledSale[];
  defaultPlatform?: string;
  className?: string;
}) {
  const [platform, setPlatform] = useState(defaultPlatform);
  const [priceText, setPriceText] = useState(marketValue != null ? String(marketValue) : "");
  const [shipIncome, setShipIncome] = useState("");
  const [shipCost, setShipCost] = useState("");

  const rate = useMemo(() => resolveFeeRate(settledSales, platform), [settledSales, platform]);

  const price = Number(priceText);
  const inputs = {
    price,
    shipIncome: Number(shipIncome) || 0,
    shipCost: Number(shipCost) || 0,
    basis,
  };

  const be = useMemo(
    () => (basisEntered ? breakEvenPrice(inputs, rate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitives, not the object identity
    [basis, basisEntered, inputs.shipIncome, inputs.shipCost, rate],
  );
  const verdict = useMemo(
    () => (basisEntered && Number.isFinite(price) && price > 0 ? offerVerdict(inputs, rate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitives, not the object identity
    [price, basis, basisEntered, inputs.shipIncome, inputs.shipCost, rate],
  );
  // Without a basis we can still answer "what do you keep" — just not "does it
  // clear". That half is honest and worth showing.
  const proceeds = useMemo(
    () => (Number.isFinite(price) && price > 0 ? estimateProceeds(inputs, rate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitives, not the object identity
    [price, basis, inputs.shipIncome, inputs.shipCost, rate],
  );

  const fld = "w-full rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag";
  const lbl = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/45";

  return (
    <section className={"overflow-hidden rounded-xl border border-hairline bg-white " + className}>
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Wallet size={13} className="text-flag" /> What you keep
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-hairline px-3 py-2.5 sm:grid-cols-4">
        <label className="block">
          <span className={lbl}>Platform</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={fld}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{FEE_SCHEDULES[p].platform}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Sale price</span>
          <input value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" placeholder="0.00" className={fld} />
        </label>
        <label className="block">
          <span className={lbl}>Ship charged</span>
          <input value={shipIncome} onChange={(e) => setShipIncome(e.target.value)} inputMode="decimal" placeholder="0.00" className={fld} />
        </label>
        <label className="block">
          <span className={lbl}>Postage cost</span>
          <input value={shipCost} onChange={(e) => setShipCost(e.target.value)} inputMode="decimal" placeholder="0.00" className={fld} />
        </label>
      </div>

      {/* The two headline numbers. */}
      <div className="grid grid-cols-2 divide-x divide-hairline border-t border-hairline">
        <div className="px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-ink/50">Break-even</div>
          <div className="figures text-2xl font-bold text-ink">
            {be ? money(be.price) : "—"}
          </div>
          <div className="text-[10px] leading-snug text-ink/40">
            {be
              ? <>covers basis of {money(be.basis)}</>
              : !basisEntered
                ? "no basis stated for this card"
                : "no fee rate for this platform"}
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-ink/50">You keep</div>
          <div className={"figures text-2xl font-bold " + (proceeds ? "text-flag" : "text-ink/30")}>
            {proceeds ? money(proceeds.net) : "—"}
          </div>
          <div className="text-[10px] leading-snug text-ink/40">
            {proceeds
              ? <>after {money(proceeds.fees)} fees{proceeds.shipCost > 0 ? <> and {money(proceeds.shipCost)} postage</> : null}</>
              : "enter a sale price"}
          </div>
        </div>
      </div>

      {/* Does it clear? Only sayable with a stated basis. */}
      {verdict && (
        <div
          className={
            "flex items-baseline justify-between gap-2 border-t px-3 py-2 text-[11px] " +
            (verdict.clears ? "border-pos/30 bg-pos/5 text-pos" : "border-danger/30 bg-danger/5 text-danger")
          }
        >
          <span className="font-bold">
            {verdict.clears ? "Clears your basis" : "Does not cover your basis"}
          </span>
          <span className="figures">
            {verdict.clears ? "+" : ""}{money(verdict.proceeds.profit ?? 0)}
            <span className="opacity-60">
              {" "}· {verdict.headroom >= 0 ? "+" : ""}{money(verdict.headroom)} vs break-even
            </span>
          </span>
        </div>
      )}

      {/* The decomposition. A break-even nobody can take apart is a number to be
          taken on faith, which is the thing this whole area is trying to stop. */}
      {proceeds && (
        <dl className="figures grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-hairline px-3 py-2 text-[10px] text-ink/55">
          <dt>Sale price</dt><dd className="text-right">{money(proceeds.price)}</dd>
          {proceeds.shipIncome > 0 && (<><dt>Shipping charged</dt><dd className="text-right">{money(proceeds.shipIncome)}</dd></>)}
          <dt>Platform fee{proceeds.feeFixed > 0 ? "s" : ""} on {money(proceeds.feeable)}</dt>
          <dd className="text-right text-danger">−{money(proceeds.fees)}</dd>
          {proceeds.shipCost > 0 && (<><dt>Postage</dt><dd className="text-right text-danger">−{money(proceeds.shipCost)}</dd></>)}
          <dt className="font-bold text-ink/75">Net</dt><dd className="text-right font-bold text-ink/75">{money(proceeds.net)}</dd>
          {basisEntered && (<><dt>Cost basis</dt><dd className="text-right text-danger">−{money(basis)}</dd></>)}
          {proceeds.profit != null && basisEntered && (
            <>
              <dt className="font-bold text-ink">Profit</dt>
              <dd className={"text-right font-bold " + (proceeds.profit >= 0 ? "text-pos" : "text-danger")}>
                {money(proceeds.profit)}
                {proceeds.margin != null && <span className="opacity-60"> · {(proceeds.margin * 100).toFixed(0)}%</span>}
              </dd>
            </>
          )}
        </dl>
      )}

      {/* Where the fee rate came from. "13.4% — your last 22 eBay sales" and
          "13.25% published, unconfirmed" deserve different trust and must not
          look identical. */}
      <p className="flex items-start gap-1 border-t border-hairline px-3 py-2 text-[10px] leading-snug text-ink/45">
        <Info size={11} className="mt-px shrink-0" />
        Fee rate: {rateLabel(rate)}
      </p>

      {proceeds?.unverifiedRate && (
        <p className="flex items-start gap-1 border-t border-hairline bg-amber-500/8 px-3 py-2 text-[10px] leading-snug text-amber-800">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          That rate is a preset nobody has confirmed against the platform&rsquo;s current schedule. Sell a few
          on {FEE_SCHEDULES[platform]?.platform ?? platform} and this switches to your own measured rate.
        </p>
      )}

      {!basisEntered && (
        <p className="flex items-start gap-1 border-t border-hairline bg-amber-500/8 px-3 py-2 text-[10px] leading-snug text-amber-800">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>
            <b>No cost basis recorded</b>, so there is no break-even to show. The stored figure is $0 because none
            was entered, not because the card was free — enter what it cost and this fills in.
          </span>
        </p>
      )}
    </section>
  );
}

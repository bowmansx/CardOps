"use client";

import { useState } from "react";
import { Gauge, Loader2, AlertTriangle, Check, Minus, ArrowRight } from "lucide-react";
import type { SoldQuotePayload } from "@/lib/cards/distill";
import { PriceProvenance } from "./PriceProvenance";

// WHAT THIS CARD IS WORTH, AND HOW WE GOT THERE (2026-08-02).
//
// Beau, on reading that automated sold comps looked unobtainable: "if we can't
// get good sales data and determine accurate prices of scanned in cards and show
// where that data came from then i don't know what good we are."
//
// The engine answers both halves and until now answered them to nobody. This is
// the screen. It shows the price, and beside it the WALK — which sources were
// asked in which order, which were skipped and why, which came back empty. A
// number with a visible derivation is the one thing none of the six competitors
// in `STRATEGY.md` offers; eBay ships a free scanner backed by their own
// transactions, so accuracy is not where this competes. Being checkable is.
//
// THE ABSTENTION IS A FEATURE AND IS RENDERED AS ONE. When there is no price,
// this shows the reason and the kind of evidence that would settle it, in the
// same visual weight as a price. A pricing screen that goes blank when it does
// not know teaches people to distrust it when it does.

type Verdict = {
  price: number | null;
  currency: string;
  confidence: "firm" | "indicative" | "thin";
  evidence: SoldQuotePayload | null;
  asked: string[];
  skipped: string[];
  empty: { id: string; note?: string }[];
  spent: number;
  freshestDays: number | null;
  thin: { reason: string; label: string; method: string; narrative: string } | null;
  narrative: string;
};

/**
 * How old the freshest evidence is, in words.
 *
 * "Thin" is a judgement a reader has to take on trust; "the most recent sale was
 * 14 months ago" is a fact they can act on. The two failures that both render as
 * thin — too few comps, and comps that are all old — want completely different
 * responses, and only this tells them apart.
 */
function freshness(days: number | null): { text: string; stale: boolean } | null {
  if (days == null) return null;
  if (days <= 1) return { text: "Most recent sale: today", stale: false };
  if (days < 60) return { text: `Most recent sale: ${days} days ago`, stale: false };
  const months = Math.round(days / 30);
  if (months < 24) return { text: `Most recent sale: ${months} months ago`, stale: days > 180 };
  return { text: `Most recent sale: over ${Math.floor(months / 12)} years ago`, stale: true };
}

type Budget = "fast" | "standard" | "deep";

const money = (n: number | null, ccy = "USD") =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 });

const SOURCE_LABEL: Record<string, string> = {
  "own-book": "Your own sales",
  thecardapi: "The Card API",
  pricecharting: "PriceCharting",
  scryfall: "Scryfall",
};
const label = (id: string) => SOURCE_LABEL[id] ?? id;

/**
 * What each confidence actually MEANS, in the user's terms.
 *
 * Spelled out rather than left to a coloured dot: "firm" and "thin" are the
 * app's words, and a word whose meaning is only in the source code is a word the
 * reader has to guess at.
 */
const CONFIDENCE: Record<Verdict["confidence"], { text: string; blurb: string; cls: string }> = {
  firm: {
    text: "Firm",
    blurb: "Enough recent sales at this exact condition to stand behind.",
    cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  indicative: {
    text: "Indicative",
    blurb: "Real sales, but fewer or older than we'd want. Treat it as a guide.",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
  },
  thin: {
    text: "Thin",
    blurb: "Not enough evidence. The number below, if any, is weakly supported.",
    cls: "bg-ink/5 text-ink/60 border-hairline",
  },
};

/** The kind of evidence a thin reason licenses — plain language, no jargon. */
const METHOD_BLURB: Record<string, string> = {
  comparable_product: "Last year's equivalent product is the closest evidence — same brand, same parallel tier.",
  analog_parallel: "A neighbouring parallel of this same card is the closest evidence.",
  own_history_discounted: "Its own past sales are the best evidence, discounted for how long ago they were.",
  none: "There isn't a defensible way to price this yet. Adding a comp by hand is the fastest fix.",
};

export function ValuationPanel({ cardId, className = "" }: { cardId: string; className?: string }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [budget, setBudget] = useState<Budget>("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/cards/valuation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, budget }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Valuation failed.");
      setVerdict(d.verdict ?? null);
      setWarnings(d.warnings ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Valuation failed.");
    } finally {
      // Rule 8: the in-flight flag clears in `finally` or a rejected promise
      // strands the spinner with no way back.
      setBusy(false);
    }
  }

  const conf = verdict ? CONFIDENCE[verdict.confidence] : null;

  return (
    <section className={"overflow-hidden rounded-xl border border-hairline bg-white " + className}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Gauge size={13} className="text-flag" /> What it&apos;s worth
        </h2>
        <div className="flex items-center gap-1.5">
          <select
            value={budget}
            onChange={(e) => setBudget(e.target.value as Budget)}
            disabled={busy}
            aria-label="How hard to look"
            className="rounded-lg border border-hairline bg-white px-1.5 py-1 text-[10px] text-ink/60"
          >
            <option value="fast">Fast</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
          <button
            onClick={run}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Gauge size={11} />}
            {verdict ? "Run again" : "Value it"}
          </button>
        </div>
      </div>

      {err && (
        <p className="mx-3 mb-2.5 flex items-start gap-1 rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] leading-snug text-rose-700">
          <AlertTriangle size={11} className="mt-px shrink-0" /> {err}
        </p>
      )}

      {!verdict && !busy && !err && (
        <p className="px-3 pb-3 text-[11px] leading-snug text-ink/45">
          Walks your sources cheapest-first and stops as soon as the evidence is good enough — your
          own settled sales are free and get asked before any vendor.
        </p>
      )}

      {verdict && (
        <div className="border-t border-hairline px-3 py-2.5">
          {/* ── The number, or the honest absence of one ─────────────────── */}
          <div className="flex items-baseline gap-2">
            <span className="figures text-2xl font-semibold text-ink">
              {verdict.price == null ? "No price" : money(verdict.price, verdict.currency)}
            </span>
            {conf && (
              <span className={"rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide " + conf.cls}>
                {conf.text}
              </span>
            )}
          </div>
          {conf && <p className="mt-0.5 text-[10px] leading-snug text-ink/45">{conf.blurb}</p>}

          {/* The age of the evidence, as a fact rather than a judgement. */}
          {(() => {
            const f = freshness(verdict.freshestDays);
            if (!f) return null;
            return (
              <p className={"figures mt-0.5 text-[10px] " + (f.stale ? "text-amber-700" : "text-ink/40")}>
                {f.text}
              </p>
            );
          })()}

          {/* The evidence behind the number — same chip the source rows use. */}
          {verdict.evidence && (
            <PriceProvenance payload={verdict.evidence} className="mt-2" />
          )}

          {/* ── No price: the reason, and what would settle it ───────────── */}
          {verdict.thin && (
            <div className="mt-2 rounded-lg border border-hairline bg-ink/3 p-2">
              <p className="text-[11px] font-semibold text-ink/75">{verdict.thin.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-ink/55">{verdict.thin.narrative}</p>
              <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-ink/45">
                <ArrowRight size={10} className="mt-0.5 shrink-0 text-flag" />
                {METHOD_BLURB[verdict.thin.method] ?? METHOD_BLURB.none}
              </p>
            </div>
          )}

          {/* ── The walk ─────────────────────────────────────────────────── */}
          {/* Rule 10, rendered: a valuation built from two of five sources is a
              different claim from one built from all five, and a screen that
              shows only the winners reads as "we checked everything". */}
          <ul className="mt-2 space-y-0.5">
            {verdict.asked.map((id) => {
              const failed = verdict.empty.find((e) => e.id === id);
              return (
                <li key={id} className="flex items-baseline gap-1.5 text-[10px]">
                  {failed ? (
                    <Minus size={10} className="mt-0.5 shrink-0 text-ink/30" />
                  ) : (
                    <Check size={10} className="mt-0.5 shrink-0 text-emerald-600" />
                  )}
                  <span className="text-ink/65">{label(id)}</span>
                  {failed && (
                    <span className="text-ink/35">
                      — {failed.note === "source failed" ? "couldn't be reached" : failed.note ?? "nothing found"}
                    </span>
                  )}
                </li>
              );
            })}
            {verdict.skipped.map((id) => (
              <li key={id} className="flex items-baseline gap-1.5 text-[10px] text-ink/35">
                <Minus size={10} className="mt-0.5 shrink-0" />
                <span>{label(id)} — not asked, the answer was already good enough</span>
              </li>
            ))}
          </ul>

          {verdict.spent > 0 && (
            <p className="figures mt-1 text-[10px] text-ink/35">Cost this run: {money(verdict.spent)}</p>
          )}

          <p className="mt-1.5 text-[10px] leading-snug text-ink/40">{verdict.narrative}</p>

          {/* Rule 4: a valuation drawn from a partial read must say so, in the
              same view as the number rather than in a console nobody reads. */}
          {warnings.map((w, i) => (
            <p key={i} className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-amber-700">
              <AlertTriangle size={11} className="mt-px shrink-0" /> {w}
            </p>
          ))}

          <p className="mt-2 border-t border-hairline pt-1.5 text-[10px] leading-snug text-ink/35">
            Guidance only — this doesn&apos;t change the card&apos;s stored value.
          </p>
        </div>
      )}
    </section>
  );
}

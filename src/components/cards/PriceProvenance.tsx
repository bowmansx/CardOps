"use client";

import { useState } from "react";
import { ExternalLink, ChevronDown, AlertTriangle } from "lucide-react";
import type { SoldQuotePayload } from "@/lib/cards/distill";

// WHERE A PRICE CAME FROM (Beau, 2026-07-29).
//
// "if we can't get good sales data and determine accurate prices of scanned in
//  cards and show where that data came from then i don't know what good we are"
//
// The data was already there and nothing rendered it. `distill` has always kept
// a sample of the exact sales behind every median, in the quote's payload, and
// the card page showed a bare number with a vendor name next to it. A pasted
// comp and a cron-derived figure rendered with identical authority, and the
// pasted one is the honest one.
//
// Ranked #2 in `spec/strategy/STRATEGY.md`, where the note is that none of six
// competitors shows this. eBay ships a free scanner backed by their own
// transactions, so accuracy is not the place to compete — being CHECKABLE is.
//
// The chip answers four questions without a tap: which source, how many sales,
// over what window, and how fresh. One tap opens the sales themselves, each
// linking back to the listing it came from.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const shortDate = (d: string | null) => {
  if (!d) return null;
  const t = Date.parse(d.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** "Mar 4 – Apr 18", or a single date when every sale landed on one day. */
function windowLabel(from: string | null, to: string | null): string | null {
  const a = shortDate(from), b = shortDate(to);
  if (!a && !b) return null;
  if (!a || !b || a === b) return a ?? b;
  return `${a} – ${b}`;
}

export function PriceProvenance({
  payload, fetchedAt, className = "",
}: {
  payload: SoldQuotePayload;
  /** Rendered by the caller, which already formats "2h ago" its own way. */
  fetchedAt?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const window = windowLabel(payload.from, payload.to);
  const hasEvidence = payload.sample.length > 0;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasEvidence}
        aria-expanded={open}
        className="figures flex w-full items-center gap-1.5 rounded-lg border border-hairline px-2 py-1 text-left text-[10px] text-ink/55 enabled:hover:border-flag/40 disabled:opacity-70"
      >
        <span className="font-semibold text-ink/70">
          {payload.count} sale{payload.count === 1 ? "" : "s"}
        </span>
        {window && <span className="text-ink/40">· {window}</span>}
        {payload.platforms.length > 0 && (
          <span className="truncate text-ink/40">· {payload.platforms.join(", ")}</span>
        )}
        {fetchedAt && <span className="text-ink/40">· {fetchedAt}</span>}
        {hasEvidence && (
          <ChevronDown size={11} className={"ml-auto shrink-0 text-ink/35 transition-transform " + (open ? "rotate-180" : "")} />
        )}
      </button>

      {/* Caveats sit OUTSIDE the collapse. A price computed from part of the
          available sales must say so whether or not anyone opens the detail
          (rules 4 and 10). */}
      {payload.exclusionNote && (
        <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-amber-700">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {payload.exclusionNote}
        </p>
      )}
      {!!payload.unconfirmed && (
        <p className="mt-1 text-[10px] leading-snug text-ink/40">
          {payload.unconfirmed} more {payload.unconfirmed === 1 ? "sale is" : "sales are"} still settling and
          {" "}{payload.unconfirmed === 1 ? "isn't" : "aren't"} counted yet.
        </p>
      )}

      {open && hasEvidence && (
        <ul className="mt-1 space-y-0.5 rounded-lg bg-ink/4 p-1.5">
          {payload.sample.map((s, i) => (
            <li key={i} className="flex items-baseline gap-1.5 text-[10px]">
              <span className="figures w-16 shrink-0 font-semibold text-ink/75">{money(s.allIn)}</span>
              <span className="figures w-12 shrink-0 text-ink/40">{shortDate(s.sold_at) ?? "—"}</span>
              <span className="min-w-0 flex-1 truncate text-ink/50">
                {s.grader ? `${s.grader} ${s.grade ?? ""} · ` : ""}{s.platform ?? "—"}
                {/* A converted hammer price is shown AS a conversion. Otherwise
                    the figure quietly disagrees with the listing it links to,
                    and the listing looks wrong. */}
                {s.converted && (
                  <span className="text-ink/35"> · {money(s.price)} hammer + premium</span>
                )}
              </span>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open the sold listing"
                  className="shrink-0 text-flag hover:underline"
                >
                  <ExternalLink size={10} />
                </a>
              )}
            </li>
          ))}
          {payload.count > payload.sample.length && (
            <li className="figures pt-0.5 text-[10px] text-ink/35">
              showing {payload.sample.length} of {payload.count}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The state a valuation screen has never had: NO COMP, said out loud.
 *
 * `distill` returns no quote when nothing matches the card's condition — the
 * deliberate choice that an honest "no comp at this grade" beats a price
 * borrowed from a neighbouring grade. Nothing surfaced it, so the screen simply
 * showed one fewer source and the absence read as "we didn't look".
 */
export function NoCompAtGrade({
  condition, source, note, className = "",
}: {
  /** "PSA 10", "Ungraded" — what we looked for. */
  condition: string;
  source: string;
  /** Why, when the source said something useful. */
  note?: string | null;
  className?: string;
}) {
  return (
    <p className={"text-[10px] leading-snug text-ink/45 " + className}>
      <b className="text-ink/60">No {condition} sales</b> from {source}
      {note ? ` — ${note}` : ""}. Not priced from a nearby grade on purpose.
    </p>
  );
}

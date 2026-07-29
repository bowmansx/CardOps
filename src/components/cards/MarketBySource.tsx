"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2, RefreshCw, ExternalLink, Clock } from "lucide-react";
import { consensusForCard } from "@/lib/cards/price-sources/blend";
import type { SourceQuote } from "@/lib/cards/price-sources/types";
import { asSoldPayload } from "@/lib/cards/distill";
import { PriceProvenance, NoCompAtGrade } from "./PriceProvenance";

// "Market — by source" (Beau, 2026-07-20): each vendor's current values shown
// SEPARATELY, plus one blended consensus on top. Guidance only — it does not
// change the card's set market value. Scryfall works with no setup (MTG);
// PriceCharting lights up once PRICECHARTING_TOKEN is in the environment.

type QuoteRow = {
  source: string; kind: string; grader: string | null; grade: number | null;
  price: number; currency: string; label: string | null; url: string | null; fetched_at: string;
  /** Present on sold quotes: the sales the median rests on. See PriceProvenance. */
  payload?: unknown;
};
type Availability = { id: string; label: string; enabled: boolean; handles: boolean; sold?: boolean };
type CondCard = { condition_type: string; grader: string | null; grade: number | null };

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const fmtWhen = (at?: string) => {
  if (!at) return "";
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const SOURCE_LABEL: Record<string, string> = { pricecharting: "PriceCharting", scryfall: "Scryfall · MTG", thecardapi: "The Card API · sold" };

export function MarketBySource({
  cardId, card, compValue, initialQuotes, initialAvailable,
}: {
  cardId: string;
  card: CondCard;
  compValue: number | null;
  initialQuotes: QuoteRow[];
  initialAvailable: Availability[];
}) {
  const router = useRouter();
  const [quotes, setQuotes] = useState<QuoteRow[]>(initialQuotes);
  const [available, setAvailable] = useState<Availability[]>(initialAvailable);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const consensus = useMemo(
    () => consensusForCard(card, compValue, quotes as unknown as SourceQuote[]),
    [card, compValue, quotes],
  );

  // Group quotes by source, sorted raw-first then by grade.
  const groups = useMemo(() => {
    const m = new Map<string, QuoteRow[]>();
    for (const q of quotes) (m.get(q.source) ?? m.set(q.source, []).get(q.source)!).push(q);
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.grade ?? -1) - (b.grade ?? -1));
    }
    return [...m.entries()];
  }, [quotes]);

  const lastFetched = quotes.reduce<string | null>((acc, q) => (!acc || q.fetched_at > acc ? q.fetched_at : acc), null);

  // Is this the quote that matches the card's own condition? (highlighted)
  const isOwnCond = (q: QuoteRow) => {
    if (card.condition_type === "graded") {
      if (q.grader == null) return false;
      return card.grade == null || q.grade == null || Math.abs(q.grade - card.grade) < 0.001;
    }
    return q.grader == null && !/foil|etched/i.test(q.label ?? "");
  };

  async function refresh() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const r = await fetch("/api/cards/price-sources/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
      const d = (await r.json()) as { quotes?: QuoteRow[]; available?: Availability[]; adopted?: number | null; error?: string };
      if (!r.ok) throw new Error(d.error || "Refresh failed.");
      setQuotes(d.quotes ?? []);
      if (d.available) setAvailable(d.available);
      if (d.adopted != null) {
        setNote(`No sale comps yet — set this card's market value to ${money(d.adopted)} from the guide.`);
        router.refresh(); // reflect the new value elsewhere on the page
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  // Availability nudges for sources with no quotes yet.
  const withQuotes = new Set(quotes.map((q) => q.source));

  /** What we looked for — the condition the absence is about. */
  const ownCondLabel = card.condition_type === "graded"
    ? `${card.grader ?? "Graded"} ${card.grade ?? ""}`.trim()
    : "Ungraded";

  // Sold sources that RAN and found no comp at this condition.
  //
  // The `quotes.length > 0` guard is doing real work: with nothing at all on
  // file, no refresh has happened yet and "no PSA 10 sales" would be a claim we
  // haven't earned. Only once some source has answered can this source's silence
  // be read as an answer rather than as absence of a run.
  const silentSoldSources = quotes.length > 0
    ? available.filter((a) => a.sold && a.enabled && a.handles && !withQuotes.has(a.id))
    : [];
  const silentIds = new Set(silentSoldSources.map((a) => a.id));

  const nudges = available
    // Covered by the explicit no-comp line below; a second "tap Refresh" note
    // for the same source would contradict it.
    .filter((a) => !withQuotes.has(a.id) && !silentIds.has(a.id))
    .map((a) => {
      if (!a.enabled) {
        return a.id === "pricecharting"
          ? { id: a.id, text: `${a.label} — add a PRICECHARTING_TOKEN to enable` }
          : { id: a.id, text: `${a.label} — not configured` };
      }
      if (!a.handles) return { id: a.id, text: `${a.label} — doesn't cover this card` };
      return { id: a.id, text: `${a.label} — tap Refresh to pull values` };
    });

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          <Layers size={13} className="text-flag" /> Market — by source
        </h2>
        <button
          onClick={refresh}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg border border-flag/50 px-2.5 py-1 text-xs font-bold text-flag disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {/* Blended consensus */}
      <div className="flex items-end justify-between gap-3 border-t border-hairline px-3 py-2.5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink/50">Blended · guidance</div>
          <div className="figures text-2xl font-bold text-flag">{money(consensus.value)}</div>
        </div>
        <div className="text-right text-[10px] leading-tight text-ink/45">
          {consensus.method === "none" ? (
            <span>no inputs yet</span>
          ) : (
            <>
              <div className="figures">
                {consensus.method === "median" ? `median of ${consensus.inputs.length}` : "single input"}
              </div>
              {lastFetched && (
                <div className="figures inline-flex items-center gap-1 text-flag/80">
                  <Clock size={9} /> {fmtWhen(lastFetched)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Inputs to the blend (comps + one per source) */}
      {consensus.inputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline px-3 py-2">
          {consensus.inputs.map((inp, i) => (
            <span key={i} className="figures rounded bg-ink/8 px-1.5 py-0.5 text-[10px] text-ink/60">
              {inp.label} <b className="text-ink/80">{money(inp.price)}</b>
            </span>
          ))}
        </div>
      )}

      {/* Per-source detail */}
      {groups.map(([source, qs]) => (
        <div key={source} className="border-t border-hairline px-3 py-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-bold text-ink">{SOURCE_LABEL[source] ?? source}</span>
            <span className="figures inline-flex items-center gap-1 text-[10px] text-ink/40">
              {qs[0].url && (
                <a href={qs[0].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-flag hover:underline">
                  view <ExternalLink size={9} />
                </a>
              )}
              <Clock size={9} /> {fmtWhen(qs[0].fetched_at)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {qs.map((q, i) => {
              const own = isOwnCond(q);
              return (
                <span
                  key={i}
                  className={
                    "figures rounded-md px-2 py-1 text-[11px] " +
                    (own ? "bg-flag/15 font-bold text-flag ring-1 ring-flag/40" : "bg-ink/6 text-ink/70")
                  }
                  title={own ? "matches this card's condition" : undefined}
                >
                  {q.label ?? (q.grader ? `${q.grader} ${q.grade ?? ""}` : "Raw")} {money(q.price)}
                </span>
              );
            })}
          </div>

          {/* WHERE THAT NUMBER CAME FROM. Only sold quotes carry evidence — a
              guide value is one figure a vendor asserts, with nothing behind it
              to show, and pretending otherwise would be the dishonest half of
              this feature. */}
          {qs.map((q, i) => {
            const p = asSoldPayload(q.payload);
            return p ? (
              <PriceProvenance key={`prov-${i}`} payload={p} fetchedAt={fmtWhen(q.fetched_at)} className="mt-1.5" />
            ) : null;
          })}
        </div>
      ))}

      {/* Sources that RAN and found nothing at this card's condition. The
          distill deliberately returns no quote rather than borrowing a nearby
          grade, and until now that decision was invisible — the source just
          vanished from the panel and looked unconfigured. */}
      {silentSoldSources.length > 0 && (
        <div className="space-y-1 border-t border-hairline px-3 py-2">
          {silentSoldSources.map((s) => (
            <NoCompAtGrade key={s.id} condition={ownCondLabel} source={s.label} />
          ))}
        </div>
      )}

      {/* Nudges for sources not yet returning */}
      {nudges.length > 0 && (
        <div className="border-t border-hairline px-3 py-2">
          {nudges.map((n) => (
            <div key={n.id} className="text-[10px] leading-relaxed text-ink/40">• {n.text}</div>
          ))}
        </div>
      )}

      {note && <p className="border-t border-hairline px-3 py-2 text-xs font-semibold text-pos">{note}</p>}
      {err && <p className="border-t border-hairline px-3 py-2 text-xs text-danger">{err}</p>}

      <p className="border-t border-hairline px-3 py-2 text-[10px] leading-snug text-ink/40">
        Vendor guide values — current, not sold history. For a card with sale comps these are guidance only; a card with
        <b> no comps</b> (e.g. an MTG single) adopts the blended guide as its market value so it isn&apos;t blank.
      </p>
    </section>
  );
}

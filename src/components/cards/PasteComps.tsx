"use client";

import { useState } from "react";
import { ClipboardPaste, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { MANUAL_SOURCES } from "@/lib/cards/price-sources/manual";
import type { PriceBasis } from "@/lib/cards/price-basis";

// PASTE SOLD COMPS (Beau, 2026-07-29).
//
// The lane no API sells. Every source with real depth — Terapeak, 130point, an
// auction house's prices-realized page — puts a table on the clipboard and
// offers no feed.
//
// PREVIEW THEN CONFIRM, always. These rows go into the SHARED identity history,
// so every owner of this card inherits them; `GO-LIVE.md` records that one bad
// paste poisons everyone's estimate for that identity, permanently, because
// history accumulates and there is no dispute path yet. A human reading back
// what was parsed is the only real defence that exists today, so the first call
// is always a dry run.

type Rejected = { line: number; text: string; reason: string };
type Sample = {
  price: number; soldAt: string | null; platform: string | null;
  grader: string | null; grade: number | null; title: string | null;
};
type Preview = {
  ok: boolean;
  dryRun: boolean;
  parsed: number;
  rejected: Rejected[];
  columns: Record<string, string>;
  dateOrder: string;
  sample: Sample[];
  note?: string;
  inserted?: number;
  alreadyHad?: number;
  error?: string;
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const SOURCES = Object.values(MANUAL_SOURCES);

export function PasteComps({ cardId, className = "" }: { cardId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [source, setSource] = useState(SOURCES[0].id);
  const [basis, setBasis] = useState<PriceBasis>(SOURCES[0].defaultBasis);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const src = MANUAL_SOURCES[source];

  function pickSource(id: string) {
    setSource(id);
    // Follow the source's usual convention, but leave it editable — an auction
    // house quoting all-in prices is unusual, not impossible.
    setBasis(MANUAL_SOURCES[id].defaultBasis);
    setPreview(null);
  }

  async function send(dryRun: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/cards/market-sales/paste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, text, source, priceBasis: basis, dryRun }),
      });
      const d = (await r.json().catch(() => null)) as Preview | null;
      if (!d) throw new Error("Couldn't read the response.");
      setPreview(d);
      if (!r.ok || d.error) setErr(d.error ?? `Import failed (HTTP ${r.status}).`);
      // Only clear the box once rows are actually in — the paste is the only
      // copy of what the user gathered, and losing it to a failed write would be
      // worse than leaving it there.
      if (!dryRun && d.ok) setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.");
    } finally {
      // In `finally`, so a rejected promise can never strand the spinner (rule 8).
      setBusy(false);
    }
  }

  const fld = "w-full rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm outline-none focus:border-flag";
  const lbl = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/45";
  const committed = preview && !preview.dryRun && preview.ok;

  return (
    <section className={"overflow-hidden rounded-xl border border-hairline bg-white " + className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left"
      >
        <ClipboardPaste size={13} className="text-flag" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Paste sold comps</span>
        <span className="ml-auto text-[10px] text-ink/35">{open ? "hide" : "add real sales"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-hairline px-3 py-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={lbl}>Where from</span>
              <select value={source} onChange={(e) => pickSource(e.target.value)} className={fld}>
                {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={lbl}>Prices include</span>
              <select value={basis} onChange={(e) => setBasis(e.target.value as PriceBasis)} className={fld}>
                <option value="all_in">What the buyer paid</option>
                <option value="hammer">Hammer only (premium on top)</option>
                <option value="unknown">Not sure</option>
              </select>
            </label>
          </div>

          <p className="text-[10px] leading-snug text-ink/40">{src.hint}</p>

          {/* "Not sure" is honest and has a real cost — say what it is rather
              than letting someone pick it and wonder why nothing prices. */}
          {basis === "unknown" && (
            <p className="flex items-start gap-1 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
              <AlertTriangle size={11} className="mt-px shrink-0" />
              These sales will be stored but left out of every median — a price we can&rsquo;t put on the same
              footing as the others would move the number without meaning anything.
            </p>
          )}

          <label className="block">
            <span className={lbl}>Paste the table, including its headings</span>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setPreview(null); }}
              rows={5}
              spellCheck={false}
              placeholder={"Title\tSold Price\tSold Date\n2021 Bowman Chrome Kyle Harrison Auto PSA 10\t$1,250.00\t2026-05-14"}
              className={fld + " font-mono text-[11px]"}
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => send(true)}
              className="rounded-lg border border-flag/50 px-3 py-1.5 text-xs font-bold text-flag disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : "Check it"}
            </button>
            {preview?.dryRun && preview.parsed > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => send(false)}
                className="rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                Import {preview.parsed} sale{preview.parsed === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {err && <p className="text-[11px] leading-snug text-danger">{err}</p>}

          {committed && (
            <p className="flex items-start gap-1.5 rounded-lg border border-pos/30 bg-pos/5 px-2 py-1.5 text-[11px] text-pos">
              <CheckCircle2 size={13} className="mt-px shrink-0" />
              <span>
                Imported <b>{preview.inserted}</b>.
                {/* A re-paste is a no-op rather than a double-count — say so, or
                    "0 imported" reads as a failure. */}
                {!!preview.alreadyHad && <> {preview.alreadyHad} were already on file and weren&rsquo;t added twice.</>}
              </span>
            </p>
          )}

          {preview && (
            <div className="space-y-1.5 rounded-lg bg-ink/4 p-2">
              {preview.note && <p className="text-[10px] leading-snug text-amber-800">{preview.note}</p>}

              {Object.keys(preview.columns).length > 0 && (
                <p className="figures text-[10px] leading-snug text-ink/50">
                  Read{" "}
                  {Object.entries(preview.columns).map(([f, c], i) => (
                    <span key={f}>{i ? " · " : ""}<b className="text-ink/70">{f}</b> from “{c}”</span>
                  ))}
                  {preview.dateOrder === "dmy" && <> · dates as day/month</>}
                  {preview.dateOrder === "mdy" && <> · dates as month/day</>}
                </p>
              )}

              {preview.sample.length > 0 && (
                <ul className="space-y-0.5">
                  {preview.sample.map((s, i) => (
                    <li key={i} className="figures flex items-baseline gap-1.5 text-[10px]">
                      <span className="w-16 shrink-0 font-semibold text-ink/75">{money(s.price)}</span>
                      <span className="w-16 shrink-0 text-ink/40">{s.soldAt ?? "—"}</span>
                      <span className="min-w-0 flex-1 truncate text-ink/50">
                        {s.grader ? `${s.grader} ${s.grade ?? ""} · ` : ""}{s.title ?? s.platform ?? "—"}
                      </span>
                    </li>
                  ))}
                  {preview.parsed > preview.sample.length && (
                    <li className="figures text-[10px] text-ink/35">
                      and {preview.parsed - preview.sample.length} more
                    </li>
                  )}
                </ul>
              )}

              {/* Every rejection, with its line number. A parser that quietly
                  keeps 8 of 40 rows reads as "your paste had 8 sales". */}
              {preview.rejected.length > 0 && (
                <div className="space-y-0.5 border-t border-hairline pt-1.5">
                  <p className="text-[10px] font-semibold text-amber-800">
                    {preview.rejected.length} row{preview.rejected.length === 1 ? "" : "s"} skipped
                  </p>
                  {preview.rejected.slice(0, 6).map((r) => (
                    <p key={r.line} className="text-[10px] leading-snug text-ink/45">
                      <span className="figures text-ink/60">line {r.line}</span> — {r.reason}
                    </p>
                  ))}
                  {preview.rejected.length > 6 && (
                    <p className="text-[10px] text-ink/35">and {preview.rejected.length - 6} more</p>
                  )}
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] leading-snug text-ink/35">
            These sales attach to the card&rsquo;s shared identity, so every owner of this card sees them.
            Nothing is written until you press Import.
          </p>
        </div>
      )}
    </section>
  );
}

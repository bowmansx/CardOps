"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { importCards } from "../actions";
import {
  parseFile, proposeMapping, toMapping, applyMapping, mappingProblem,
  IMPORT_FIELDS, FIELD_LABEL, type ImportField, type Mapping, type ParsedFile, type Proposal,
} from "@/lib/cards/import-map";

// IMPORT FROM ANY INVENTORY FILE (Beau, spec/00: CardOps "can also receive an
// inventory system from the template/format of any other inventory software").
//
// This page used to read only its own column names. A file from another app
// matched nothing and still "succeeded" — one blank card per row. Now the file's
// own headers are read, a mapping is PROPOSED and shown, and nothing is written
// until a person has seen how each column will land. Every guess is visible and
// changeable; anything ambiguous is left out until someone chooses.

const PREVIEW_FIELDS: ImportField[] = ["player", "year", "set_name", "card_number", "grader", "grade", "individual_basis", "market_value"];

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ inserted: number; coerced: number; skipped: number } | null>(null);

  async function onFile(f: File) {
    setErr(null); setDone(null);
    try {
      const parsed = parseFile(await f.text());
      if (!parsed.headers.length || !parsed.rows.length) {
        throw new Error("No data rows found (need a header row + at least one row).");
      }
      const p = proposeMapping(parsed.headers, parsed.rows);
      setFile(parsed);
      setFileName(f.name);
      setProposal(p);
      setMapping(toMapping(p));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the file.");
    }
  }

  // Recomputed on every mapping change, so the preview is always what will be
  // written rather than what the file says.
  const applied = useMemo(
    () => (file && mapping ? applyMapping(file.rows, mapping) : null),
    [file, mapping],
  );
  const problem = mapping ? mappingProblem(mapping) : null;
  const importable = applied ? applied.cards.length - applied.identityless : 0;

  function choose(field: ImportField, col: string) {
    if (!mapping) return;
    const next = { ...mapping, [field]: col === "" ? null : Number(col) };
    // One column feeds one field. Choosing a column that another field already
    // uses moves it, rather than quietly writing the same text into both.
    if (col !== "") {
      for (const f of IMPORT_FIELDS) if (f !== field && next[f] === Number(col)) next[f] = null;
    }
    setMapping(next);
  }

  async function commit() {
    if (!applied) return;
    setBusy(true); setErr(null);
    try {
      const res = await importCards(applied.cards);
      if (!res.ok) { setErr(res.error ?? "Import failed."); return; }
      setDone({ inserted: res.inserted ?? 0, coerced: res.coerced ?? 0, skipped: res.skipped ?? 0 });
      setFile(null); setProposal(null); setMapping(null); setFileName(null);
    } catch (e) {
      // The parsed file is kept: a rejection must not make you re-pick it. A big
      // file can also exceed the action body limit, which rejects rather than
      // returning — hence the hint.
      setErr(
        (e instanceof Error && e.message ? e.message + " — " : "") +
        "Nothing was imported. If the file is very large, split it and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const headerOf = (col: number | null) => (col == null || !file ? "" : file.headers[col]);
  const howOf = (field: ImportField) => {
    const m = proposal?.map[field];
    if (!m || !mapping || mapping[field] !== m.col) return mapping?.[field] != null ? "chosen" : null;
    return m.how;
  };

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Import cards</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">
          A CSV or tab-separated export from another inventory app or a spreadsheet. Its own column names
          are read and matched to CardOps fields — you&apos;ll see the match before anything is written. Sold
          rows import as unsold; record the sale through the sell flow afterwards. SKUs are assigned.
        </p>

        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
        <button onClick={() => fileRef.current?.click()} className="mt-4 rounded-lg bg-flag px-4 py-2.5 text-sm font-bold text-white transition active:scale-95">
          {file ? "Choose a different file" : "Choose file"}
        </button>
        {err && <p className="mt-3 text-xs text-danger">{err}</p>}
        {done && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="font-semibold text-pos">
              Imported {done.inserted} card{done.inserted === 1 ? "" : "s"}. <Link href="/cards" className="underline">View</Link>
            </p>
            {/* Rule 10: a partial result says so, in the same place as the success. */}
            {done.skipped > 0 && (
              <p className="text-xs text-amber-700">{done.skipped} row{done.skipped === 1 ? "" : "s"} skipped — nothing in them identified a card.</p>
            )}
            {done.coerced > 0 && (
              <p className="text-xs text-ink/50">{done.coerced} row{done.coerced === 1 ? "" : "s"} had a status other than booked/archived and came in as booked.</p>
            )}
          </div>
        )}

        {file && mapping && applied && (
          <>
            {/* ── How the columns land ─────────────────────────────────────── */}
            <section className="mt-5 rounded-xl border border-hairline bg-white">
              <div className="flex items-baseline justify-between border-b border-hairline px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Match columns</span>
                <span className="figures text-[10px] text-ink/40">
                  {fileName} · {file.rows.length} row{file.rows.length === 1 ? "" : "s"} · {file.headers.length} columns
                </span>
              </div>
              <ul className="divide-y divide-hairline">
                {IMPORT_FIELDS.map((f) => {
                  const how = howOf(f);
                  return (
                    <li key={f} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-36 shrink-0 text-xs font-medium text-ink/75">{FIELD_LABEL[f]}</span>
                      <select
                        value={mapping[f] ?? ""}
                        onChange={(e) => choose(f, e.target.value)}
                        aria-label={`Column for ${FIELD_LABEL[f]}`}
                        className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-1.5 py-1 text-xs text-ink/80"
                      >
                        <option value="">— don&apos;t import —</option>
                        {file.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                      </select>
                      {/* "Exact" and "likely" are different claims; a guess must look like one. */}
                      {how === "exact" && <span className="w-14 shrink-0 text-right text-[10px] font-semibold text-pos">exact</span>}
                      {how === "likely" && <span className="w-14 shrink-0 text-right text-[10px] font-semibold text-amber-700">likely</span>}
                      {how === "chosen" && <span className="w-14 shrink-0 text-right text-[10px] font-semibold text-ink/50">chosen</span>}
                      {how === null && <span className="w-14 shrink-0" />}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ── What will NOT come in, said before the import, not after ── */}
            {(() => {
              // Once a person has given an ambiguous column a field, it is no
              // longer waiting on them — keep listing it and the box nags about
              // a decision already made.
              const used = new Set(Object.values(mapping).filter((c): c is number => c != null));
              const waiting = (proposal?.ambiguous ?? []).filter((a) => !used.has(a.col));
              if (!waiting.length) return null;
              return (
              <section className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-800">Needs your choice — not imported unless you pick a field above</p>
                <ul className="mt-1 space-y-0.5">
                  {waiting.map((a) => (
                    <li key={a.col} className="text-[11px] leading-snug text-amber-800">
                      <b>{a.header}</b> — {a.why}
                    </li>
                  ))}
                </ul>
              </section>
              );
            })()}
            {(() => {
              const used = new Set(Object.values(mapping).filter((c): c is number => c != null));
              const ignored = file.headers
                .map((h, i) => ({ h, i }))
                .filter(({ i }) => !used.has(i) && !proposal?.ambiguous.some((a) => a.col === i));
              if (!ignored.length) return null;
              return (
                <p className="mt-2 text-[11px] leading-snug text-ink/45">
                  Not imported: {ignored.map(({ h, i }) => h || `column ${i + 1}`).join(", ")}.
                </p>
              );
            })()}

            {/* Unreadable cells, per field — left blank and counted, never guessed. */}
            {applied.issues.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {applied.issues.map((it) => (
                  <li key={it.field} className="text-[11px] leading-snug text-amber-700">
                    {it.count} {FIELD_LABEL[it.field]} value{it.count === 1 ? "" : "s"} couldn&apos;t be read and will be left blank
                    {it.examples.length > 0 && <> (e.g. {it.examples.map((x) => `“${x}”`).join(", ")})</>}.
                  </li>
                ))}
              </ul>
            )}

            {/* ── Preview of what will be WRITTEN ─────────────────────────── */}
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
                Preview — {importable} card{importable === 1 ? "" : "s"}
              </span>
              <button onClick={commit} disabled={busy || !!problem || importable === 0}
                className="rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {busy ? "Importing…" : `Import ${importable}`}
              </button>
            </div>
            {problem && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] leading-snug text-rose-700">{problem}</p>}
            {!problem && applied.identityless > 0 && (
              <p className="mt-2 text-[11px] leading-snug text-amber-700">
                {applied.identityless} row{applied.identityless === 1 ? "" : "s"} have no player, set, card number or year and will be skipped.
              </p>
            )}
            <div className="mt-2 overflow-x-auto rounded-xl border border-hairline bg-white">
              <table className="figures min-w-full text-[11px]">
                <thead className="bg-paper text-ink/50">
                  <tr>{PREVIEW_FIELDS.map((f) => (
                    <th key={f} className="px-2 py-1.5 text-left font-semibold">
                      {FIELD_LABEL[f]}
                      {mapping[f] != null && <div className="font-normal text-ink/35">{headerOf(mapping[f])}</div>}
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {applied.cards.slice(0, 15).map((r, i) => (
                    <tr key={i} className="border-t border-hairline">
                      {PREVIEW_FIELDS.map((f) => <td key={f} className="px-2 py-1 text-ink/70">{r[f] ?? ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {applied.cards.length > 15 && <div className="px-2 py-1.5 text-[10px] text-ink/40">+{applied.cards.length - 15} more…</div>}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

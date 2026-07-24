"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { importCards } from "../actions";

// Minimal CSV parser (handles quoted fields + escaped quotes).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); field = ""; row = []; }
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function onFile(file: File) {
    setErr(null); setDone(null);
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length) throw new Error("No data rows found (need a header row + at least one row).");
      setRows(parsed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the CSV.");
    }
  }

  async function commit() {
    setBusy(true); setErr(null);
    const res = await importCards(rows);
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Import failed."); return; }
    setDone(res.inserted ?? 0);
    setRows([]);
  }

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Import cards (CSV)</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-2 text-sm text-ink/60">
          Columns recognized: player, year, set_name, card_number, parallel, sport_category,
          condition_type, grader, grade, market_value, status (booked/archived — sold rows import as
          booked; enter the sale through the sell flow), zone, location_code. SKUs auto-assigned.
        </p>

        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} className="mt-4 rounded-lg bg-flag px-4 py-2.5 text-sm font-bold text-white transition active:scale-95">
          Choose CSV file
        </button>
        {err && <p className="mt-3 text-xs text-danger">{err}</p>}
        {done != null && <p className="mt-3 text-sm font-semibold text-pos">Imported {done} card{done === 1 ? "" : "s"}. <Link href="/cards" className="underline">View</Link></p>}

        {rows.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Preview — {rows.length} rows</span>
              <button onClick={commit} disabled={busy} className="rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {busy ? "Importing…" : `Import ${rows.length}`}
              </button>
            </div>
            <div className="mt-2 overflow-x-auto rounded-xl border border-hairline bg-white">
              <table className="figures min-w-full text-[11px]">
                <thead className="bg-paper text-ink/50">
                  <tr>{["player", "year", "set_name", "sport_category", "grader", "grade", "market_value"].map((h) => <th key={h} className="px-2 py-1.5 text-left font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 15).map((r, i) => (
                    <tr key={i} className="border-t border-hairline">
                      {["player", "year", "set_name", "sport_category", "grader", "grade", "market_value"].map((h) => <td key={h} className="px-2 py-1 text-ink/70">{r[h] ?? ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 15 && <div className="px-2 py-1.5 text-[10px] text-ink/40">+{rows.length - 15} more…</div>}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

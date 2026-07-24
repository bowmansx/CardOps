"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, Plus, Loader2, Trash2, Check, X } from "lucide-react";

export type Business = {
  id: string; name: string; short_code: string; type: string | null;
  zoho_books_org_id: string | null; connector?: string | null; active: boolean;
};

const TYPES: [string, string][] = [
  ["", "—"], ["llc", "LLC"], ["s_corp", "S-Corp"], ["c_corp", "C-Corp"],
  ["partnership", "Partnership"], ["sole_prop", "Sole proprietor"], ["personal", "Personal"], ["trust", "Trust"],
];

const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";
const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/50";

export function BusinessesManager({ initial, settings }: { initial: Business[]; settings?: React.ReactNode }) {
  const [list, setList] = useState<Business[]>(initial);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Business>>({});

  async function add() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/businesses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, short_code: code, type: type || undefined, zoho_books_org_id: org || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't add it.");
      setList((p) => [...p, d.business as Business].sort((a, b) => a.short_code.localeCompare(b.short_code)));
      setName(""); setCode(""); setType(""); setOrg("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it."); } finally { setBusy(false); }
  }

  async function save(id: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/businesses", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...draft }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setList((p) => p.map((b) => (b.id === id ? (d.business as Business) : b)).sort((a, b) => a.short_code.localeCompare(b.short_code)));
      setEditing(null); setDraft({});
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  }

  async function toggleActive(b: Business) {
    setErr(null);
    const r = await fetch("/api/cards/businesses", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id, active: !b.active }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error || "Couldn't update."); return; }
    setList((p) => p.map((x) => (x.id === b.id ? (d.business as Business) : x)));
  }

  async function remove(b: Business) {
    if (!confirm(`Delete "${b.name}"? This can't be undone.`)) return;
    setErr(null);
    const r = await fetch(`/api/cards/businesses?id=${b.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error || "Couldn't delete."); return; }
    setList((p) => p.filter((x) => x.id !== b.id));
  }

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Building2 size={20} className="text-flag" /> Businesses</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/books" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Books</Link>
            <Link href="/cards" className="text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] leading-snug text-ink/50">
          What a card is booked under. Each business carries its own tax treatment and, optionally, the
          bookkeeping account it syncs to. These are yours alone — other users have their own.
        </p>

        {settings}

        {/* Add */}
        <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-white p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className={lbl}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Architect's Foundry" className={field} /></label>
            <label className="block"><span className={lbl}>Short code</span>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="AF" maxLength={8} className={"figures " + field} /></label>
            <label className="block"><span className={lbl}>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
                {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
            <label className="block"><span className={lbl}>Bookkeeping org id (optional)</span>
              <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Zoho Books org id" className={"figures " + field} /></label>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-ink/40">Leave the org id blank until you connect a bookkeeping app.</span>
            <button onClick={add} disabled={busy || !name.trim() || !code.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add business
            </button>
          </div>
          {err && <p className="text-[11px] text-danger">{err}</p>}
        </div>

        {/* List */}
        <div className="mt-4 space-y-1.5">
          {list.map((b) => (
            <div key={b.id} className="rounded-xl border border-hairline bg-white px-3 py-2.5">
              {editing === b.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input defaultValue={b.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={field} />
                    <input defaultValue={b.short_code} onChange={(e) => setDraft((d) => ({ ...d, short_code: e.target.value.toUpperCase() }))} maxLength={8} className={"figures " + field} />
                    <select defaultValue={b.type ?? ""} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))} className={field}>
                      {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <input defaultValue={b.zoho_books_org_id ?? ""} onChange={(e) => setDraft((d) => ({ ...d, zoho_books_org_id: e.target.value }))} placeholder="org id" className={"figures " + field} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setEditing(null); setDraft({}); }} className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-ink/60"><X size={13} /> Cancel</button>
                    <button onClick={() => save(b.id)} disabled={busy} className="flex items-center gap-1 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Check size={13} /> Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="figures rounded bg-flag/12 px-1.5 py-px text-[10px] font-bold text-flag">{b.short_code}</span>
                      <span className={"truncate text-sm font-semibold " + (b.active ? "text-ink" : "text-ink/40 line-through")}>{b.name}</span>
                    </div>
                    <div className="figures text-[10px] text-ink/45">
                      {TYPES.find(([k]) => k === (b.type ?? ""))?.[1] ?? "—"}
                      {b.zoho_books_org_id ? ` · org ${b.zoho_books_org_id}` : " · no books org"}
                      {b.connector ? ` · syncs to ${b.connector}` : " · no sync"}
                      {!b.active && " · inactive"}
                    </div>
                  </div>
                  <Link href={`/cards/businesses/${b.id}/connect`} className="shrink-0 text-[11px] font-semibold text-flag hover:underline">Connect</Link>
                  <button onClick={() => { setEditing(b.id); setDraft({}); }} className="shrink-0 text-[11px] font-semibold text-flag hover:underline">Edit</button>
                  <button onClick={() => toggleActive(b)} className="shrink-0 text-[11px] text-ink/45 hover:text-ink">{b.active ? "Retire" : "Restore"}</button>
                  <button onClick={() => remove(b)} className="shrink-0 text-ink/30 hover:text-danger"><Trash2 size={15} /></button>
                </div>
              )}
            </div>
          ))}
          {!list.length && <p className="mt-6 text-center text-sm text-ink/45">No businesses yet — add one above to start booking cards against it.</p>}
        </div>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Plug, Loader2, Check, AlertTriangle } from "lucide-react";

type Account = { id: string; name: string; type?: string | null };
type MapEntry = { id: string; name?: string | null };

export type ConnectData = {
  business: { id: string; name: string; short_code: string; connector: string | null; zoho_books_org_id: string | null };
  connectors: { id: string; label: string; enabled: boolean; needsOrg: boolean }[];
  map: Record<string, MapEntry>;
  usedKeys: string[];
  suggested: Record<string, { name: string; type: string }>;
  accounts: Account[];
  accountsError: string | null;
};

const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";

export function ConnectorMapping({ data }: { data: ConnectData }) {
  const [connector, setConnector] = useState(data.business.connector ?? "");
  const [map, setMap] = useState<Record<string, MapEntry>>(data.map);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const biz = data.business;
  const chosen = data.connectors.find((c) => c.id === connector);
  const needsOrg = !!chosen?.needsOrg && !biz.zoho_books_org_id;
  // Keys the ledger actually uses first, then anything already mapped.
  const keys = [...new Set([...data.usedKeys, ...Object.keys(data.map)])].sort();

  async function saveConnector(v: string) {
    setConnector(v); setMsg(null);
    const r = await fetch("/api/cards/businesses", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: biz.id, connector: v || null }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg({ ok: false, text: d.error || "Couldn't change the backend." }); return; }
    setMsg({ ok: true, text: v ? `Syncing to ${data.connectors.find((c) => c.id === v)?.label}. Reload to pull its accounts.` : "Sync off — CardOps keeps its own books." });
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/cards/connectors", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: biz.id, provider: connector || "zoho", map }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg({ ok: true, text: `Saved — ${d.saved} mapped${d.cleared ? `, ${d.cleared} cleared` : ""}.` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." }); } finally { setBusy(false); }
  }

  const mappedCount = keys.filter((k) => map[k]?.id).length;

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Plug size={20} className="text-flag" /> Connect · {biz.short_code}</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/businesses" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Businesses</Link>
            <Link href="/cards/books/push-preview" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Dry run</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] leading-snug text-ink/50">
          CardOps keeps its own books either way. Connecting a bookkeeping app just <b>mirrors</b> those entries into it —
          map each CardOps account to the matching account in <b>{biz.name}</b>&apos;s books.
        </p>

        {/* Backend */}
        <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-white p-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/50">Bookkeeping app</span>
            <select value={connector} onChange={(e) => saveConnector(e.target.value)} className={field}>
              <option value="">None — CardOps books only</option>
              {data.connectors.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.enabled}>
                  {c.label}{c.enabled ? "" : " (not configured here)"}
                </option>
              ))}
            </select>
          </label>
          {needsOrg && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              This backend needs an organization id — add it to {biz.short_code} on the Businesses screen first.
            </p>
          )}
          {data.accountsError && (
            <p className="flex items-start gap-1.5 text-[11px] text-danger">
              <AlertTriangle size={12} className="mt-px shrink-0" /> {data.accountsError}
            </p>
          )}
        </div>

        {/* Mapping */}
        {connector && !needsOrg && (
          <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-white">
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Account mapping</span>
              <span className="figures text-[10px] text-ink/45">{mappedCount}/{keys.length} mapped</span>
            </div>

            {keys.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink/45">Nothing booked yet — map accounts once this business has ledger activity.</p>
            ) : (
              keys.map((k) => (
                <div key={k} className="grid grid-cols-2 items-center gap-2 border-b border-hairline px-3 py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-ink">{data.suggested[k]?.name ?? k}</div>
                    <div className="figures truncate text-[10px] text-ink/40">{k}</div>
                  </div>
                  {data.accounts.length > 0 ? (
                    <select
                      value={map[k]?.id ?? ""}
                      onChange={(e) => {
                        const a = data.accounts.find((x) => x.id === e.target.value);
                        setMap((m) => ({ ...m, [k]: a ? { id: a.id, name: a.name } : { id: "" } }));
                      }}
                      className={field}
                    >
                      <option value="">— not mapped —</option>
                      {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  ) : (
                    <input
                      value={map[k]?.id ?? ""}
                      onChange={(e) => setMap((m) => ({ ...m, [k]: { id: e.target.value.trim() } }))}
                      placeholder="account id"
                      className={"figures " + field}
                    />
                  )}
                </div>
              ))
            )}

            {keys.length > 0 && (
              <div className="flex items-center justify-between border-t border-hairline px-3 py-2">
                <span className="text-[10px] text-ink/40">
                  {data.accounts.length > 0 ? "Pulled live from your chart of accounts." : "Couldn't read the chart of accounts — enter ids by hand."}
                </span>
                <button onClick={save} disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save mapping
                </button>
              </div>
            )}
          </div>
        )}

        {msg && <p className={"mt-2 text-xs " + (msg.ok ? "text-pos" : "text-danger")}>{msg.text}</p>}

        <p className="mt-5 text-center text-[10px] leading-relaxed text-ink/35">
          Mapping alone posts nothing. Check the dry run first — the live push is a separate, confirmed action.
        </p>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import QRCode from "qrcode";
import { Share2, Loader2, Plus, Trash2, QrCode, Copy, Check, ExternalLink } from "lucide-react";

export type Showcase = {
  id: string; token: string; title: string; card_ids: string[];
  show_prices: boolean; for_sale: boolean; is_public: boolean; contact: string | null; created_at: string;
};

export function ShowcaseManager({ initial, groups }: { initial: Showcase[]; groups: { id: string; name: string }[] }) {
  const [list, setList] = useState<Showcase[]>(initial);
  const [title, setTitle] = useState("My Showcase");
  const [groupId, setGroupId] = useState<string>(""); // "" = all live cards
  const [showPrices, setShowPrices] = useState(true);
  const [forSale, setForSale] = useState(false);
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const urlFor = (token: string) => (typeof window !== "undefined" ? `${window.location.origin}/showcase/${token}` : `/showcase/${token}`);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/showcases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "create", title, groupId: groupId || undefined, showPrices, forSale, contact: contact || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed.");
      setList((p) => [d.showcase as Showcase, ...p]);
      setTitle("My Showcase"); setContact(""); setForSale(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this showcase? The share link will stop working.")) return;
    setList((p) => p.filter((s) => s.id !== id));
    await fetch(`/api/cards/showcases?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(urlFor(token)); setCopied(token); setTimeout(() => setCopied(null), 1500); } catch {}
  }
  async function share(token: string, name: string) {
    const url = urlFor(token);
    if (navigator.share) { try { await navigator.share({ title: name, url }); return; } catch {} }
    copy(token);
  }
  async function toggleQr(token: string) {
    if (qr[token]) { setQr((p) => { const n = { ...p }; delete n[token]; return n; }); return; }
    try { const data = await QRCode.toDataURL(urlFor(token), { width: 220, margin: 1 }); setQr((p) => ({ ...p, [token]: data })); } catch {}
  }

  const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Share2 size={20} className="text-flag" /> Showcases</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/show" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Flex screen</Link>
            <Link href="/cards" className="text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] text-ink/45">A public, shareable gallery of your cards — a link or QR anyone can open (no login). Great at a table.</p>

        {/* Create */}
        <div className="mt-3 rounded-xl border border-hairline bg-white p-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Showcase title" className={field} />
          <div className="grid grid-cols-2 gap-2">
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={field}>
              <option value="">All live cards</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div className="flex items-center gap-3 px-1 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} /> Prices</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} /> For sale</label>
            </div>
          </div>
          {forSale && <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact for sales (e.g. @handle, phone, email)" className={field} />}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink/40">A group makes a fixed set; “All live cards” stays current.</span>
            <button onClick={create} disabled={busy || !title.trim()} className="flex items-center gap-1.5 rounded-lg bg-flag px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
            </button>
          </div>
          {err && <p className="text-[11px] text-danger">{err}</p>}
        </div>

        {/* List */}
        <div className="mt-4 space-y-2">
          {list.map((s) => (
            <div key={s.id} className="rounded-xl border border-hairline bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{s.title}</div>
                  <div className="text-[11px] text-ink/50">
                    {s.card_ids.length ? `${s.card_ids.length} cards` : "All live cards"} · {s.show_prices ? "prices on" : "prices hidden"}{s.for_sale ? " · for sale" : ""}
                  </div>
                </div>
                <button onClick={() => del(s.id)} className="shrink-0 text-ink/30 hover:text-danger"><Trash2 size={15} /></button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2">
                <a href={urlFor(s.token)} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-[11px] font-semibold text-ink/70 hover:border-flag">
                  <ExternalLink size={12} /> Open
                </a>
                <button onClick={() => share(s.token, s.title)} className="flex items-center gap-1 rounded-lg border border-flag/50 bg-flag/10 px-2.5 py-1 text-[11px] font-bold text-flag">
                  <Share2 size={12} /> Share
                </button>
                <button onClick={() => copy(s.token)} className="flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-[11px] font-semibold text-ink/70 hover:border-flag">
                  {copied === s.token ? <Check size={12} className="text-pos" /> : <Copy size={12} />} {copied === s.token ? "Copied" : "Copy link"}
                </button>
                <button onClick={() => toggleQr(s.token)} className="flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-[11px] font-semibold text-ink/70 hover:border-flag">
                  <QrCode size={12} /> QR
                </button>
              </div>
              {qr[s.token] && (
                <div className="mt-2 flex flex-col items-center border-t border-hairline pt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr[s.token]} alt="Showcase QR" width={180} height={180} className="rounded-lg" />
                  <p className="mt-1 text-[10px] text-ink/40">Point a phone camera here at your table.</p>
                </div>
              )}
            </div>
          ))}
          {!list.length && <p className="mt-6 text-center text-sm text-ink/45">No showcases yet — create one above.</p>}
        </div>
      </div>
    </main>
  );
}

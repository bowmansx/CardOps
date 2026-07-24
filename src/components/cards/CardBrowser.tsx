"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Layers, Download, Loader2, X, Tag as TagIcon, FolderPlus, Plus } from "lucide-react";
import { CATEGORIES, STATUS_TONE, CARD_STATUSES, deriveTags, type Card } from "@/lib/cards/types";

const money = (n: number | null): string =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// The inventory list with press-and-hold multi-select. A normal tap opens the
// card; press-and-hold (or the Select toggle) enters selection mode, and a
// bottom action bar acts on the whole selection (lot / export / set status).
export function CardBrowser({
  cards,
  grouped,
  entities = [],
}: {
  cards: Partial<Card>[];
  grouped: boolean;
  entities?: { id: string; name: string; short_code: string }[];
}) {
  const router = useRouter();
  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [cardGroups, setCardGroups] = useState<{ id: string; name: string; count: number }[] | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const toggle = (id: string) =>
    setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function startPress(id: string) {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setSelectMode(true);
      toggle(id);
      if (navigator.vibrate) navigator.vibrate(15);
    }, 420);
  }
  const cancelPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); };

  function onRowClick(e: React.MouseEvent, id: string) {
    if (longPressed.current) { e.preventDefault(); longPressed.current = false; return; } // hold already selected it
    if (selectMode) { e.preventDefault(); toggle(id); }
    // else: fall through — the <Link> navigates to the card
  }

  function exitSelect() { setSelectMode(false); setSel(new Set()); setMsg(null); }

  async function post(path: string, body: unknown) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text();
    let d: Record<string, unknown>;
    try { d = JSON.parse(text); } catch { throw new Error(`Request failed (HTTP ${r.status}).`); }
    if (!r.ok) throw new Error((d.error as string) || "Failed.");
    return d;
  }

  async function createLot() {
    setBusy(true); setMsg(null);
    try { await post("/api/cards/lots", { op: "create", cardIds: [...sel] }); router.push("/cards/lots"); }
    catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't create lot." }); setBusy(false); }
  }

  async function exportSelected() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/cards/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "generic_full", ids: [...sel] }),
      });
      if (!r.ok) throw new Error(`Export failed (HTTP ${r.status}).`);
      const blob = await r.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href; a.download = "cardops-selected.csv";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
      setMsg({ kind: "ok", text: `Exported ${sel.size} cards.` });
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Export failed." }); }
    finally { setBusy(false); }
  }

  async function openGroups() {
    setGroupOpen(true); setMsg(null);
    if (cardGroups) return;
    try {
      const r = await fetch("/api/cards/groups");
      const d = await r.json();
      setCardGroups(d.groups ?? []);
    } catch { setCardGroups([]); }
  }
  async function addToGroup(groupId: string, name: string) {
    setBusy(true); setMsg(null);
    try {
      await post("/api/cards/groups", { op: "add", groupId, cardIds: [...sel] });
      setMsg({ kind: "ok", text: `Added ${sel.size} to “${name}”.` });
      setGroupOpen(false);
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." }); }
    finally { setBusy(false); }
  }
  async function createGroup() {
    const name = newGroup.trim();
    if (!name) return;
    setBusy(true); setMsg(null);
    try {
      await post("/api/cards/groups", { op: "create", name, cardIds: [...sel] });
      setMsg({ kind: "ok", text: `Created “${name}” with ${sel.size} cards.` });
      setNewGroup(""); setGroupOpen(false); setCardGroups(null);
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." }); }
    finally { setBusy(false); }
  }

  async function setStatus(status: string) {
    if (!status) return;
    setBusy(true); setMsg(null);
    try {
      const d = await post("/api/cards/bulk", { ids: [...sel], patch: { status } });
      setMsg({ kind: "ok", text: `Set ${d.updated ?? 0} to ${status}.` });
      setNewStatus(""); exitSelect(); router.refresh();
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't update." }); }
    finally { setBusy(false); }
  }

  async function setEntity(entityId: string) {
    if (!entityId) return;
    setBusy(true); setMsg(null);
    try {
      const d = await post("/api/cards/bulk", { ids: [...sel], patch: { entity_id: entityId } });
      const ent = entities.find((e) => e.id === entityId);
      setMsg({ kind: "ok", text: `Assigned ${d.updated ?? 0} to ${ent?.short_code ?? "business"}.` });
      exitSelect(); router.refresh();
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't assign." }); }
    finally { setBusy(false); }
  }

  async function setTreatment(t: string) {
    if (!t) return;
    setBusy(true); setMsg(null);
    try {
      const d = await post("/api/cards/bulk", { ids: [...sel], patch: { tax_treatment: t } });
      setMsg({ kind: "ok", text: `Set ${d.updated ?? 0} to ${t}.` });
      exitSelect(); router.refresh();
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Couldn't update." }); }
    finally { setBusy(false); }
  }

  function Row({ c }: { c: Partial<Card> }) {
    const on = sel.has(c.id as string);
    const cur = (c.manual_price ?? c.market_value ?? null) as number | null;
    const meta = [c.sku, c.card_number && `#${c.card_number}`, c.storage_location ?? c.location_code].filter(Boolean).join(" · ");
    const tagChips = deriveTags(c).slice(0, 5);
    const delta = (then: unknown, tag: string) => {
      const t = then == null ? null : Number(then);
      if (cur == null || t == null || !(t > 0)) return null;
      const d = ((cur - t) / t) * 100;
      if (Math.abs(d) < 0.5) return null;
      return <span key={tag} className={"figures text-[9px] font-bold " + (d > 0 ? "text-pos" : "text-danger")}>{tag} {d > 0 ? "+" : ""}{d.toFixed(0)}%</span>;
    };
    const deltas = [delta((c as Record<string, unknown>).value_30d, "30d"), delta((c as Record<string, unknown>).value_365d, "1y")].filter(Boolean);
    const dot = STATUS_TONE[c.status ?? ""] ?? "bg-ink/20 text-ink/50";
    return (
      <Link
        href={`/cards/${c.id}`}
        onClick={(e) => onRowClick(e, c.id as string)}
        onPointerDown={() => startPress(c.id as string)}
        onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerMove={cancelPress}
        onContextMenu={(e) => { e.preventDefault(); setSelectMode(true); toggle(c.id as string); }}
        className={"flex select-none items-center gap-2 border-b border-hairline px-3 py-2 last:border-b-0 " + (on ? "bg-flag/10" : "hover:bg-paper")}
      >
        {selectMode && (on ? <CheckCircle2 size={16} className="shrink-0 text-flag" /> : <Circle size={16} className="shrink-0 text-ink/25" />)}
        <span className="min-w-0 flex-1">
          {/* title 14% smaller than before (text-sm 14px -> 12px) */}
          <span className="block text-[12px] font-semibold leading-tight">
            {[c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(untitled)"}
          </span>
          <span className="mt-1 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="figures text-[12px] font-semibold text-ink">{money(cur)}</span>
              {deltas}
              {tagChips.map((t) => <span key={t} className="figures rounded bg-flag/12 px-1 py-px text-[9px] font-bold text-flag">{t}</span>)}
            </span>
            <span className="figures truncate text-center text-[11px] text-ink/45">{meta}</span>
            <span className="flex items-center justify-end gap-1">
              <span className={"h-2 w-2 shrink-0 rounded-full " + dot} title={c.status ?? ""} />
              <span className="text-[9px] font-semibold text-ink/40">{c.status}</span>
            </span>
          </span>
        </span>
      </Link>
    );
  }

  const groups = useMemo(() => {
    if (!grouped) return [{ label: "", cards }];
    return CATEGORIES.map((cat) => ({ label: cat.label, cards: cards.filter((x) => x.sport_category === cat.key) }))
      .concat([{ label: "Uncategorized", cards: cards.filter((x) => !CATEGORIES.some((cat) => cat.key === x.sport_category)) }])
      .filter((g) => g.cards.length > 0);
  }, [cards, grouped]);

  return (
    <>
      <div className="mt-3 grid grid-cols-3 items-center">
        <span className="text-[11px] text-ink/40">{selectMode ? `${sel.size} selected` : "Hold a card to multi-select"}</span>
        <Link href="/cards/bulk" className="justify-self-center text-xs font-semibold text-flag underline-offset-2 hover:underline">
          Bulk Options
        </Link>
        <button onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          className="justify-self-end text-xs font-semibold text-flag underline-offset-2 hover:underline">
          {selectMode ? "Done" : "Select"}
        </button>
      </div>

      {grouped ? (
        groups.map((g) => (
          <details key={g.label} open className="mt-2">
            <summary className="cursor-pointer select-none text-sm font-bold text-ink">
              {g.label} <span className="figures text-xs font-semibold text-ink/40">({g.cards.length})</span>
            </summary>
            <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">{g.cards.map((c) => <Row key={c.id} c={c} />)}</div>
          </details>
        ))
      ) : (
        cards.length > 0 && <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">{cards.map((c) => <Row key={c.id} c={c} />)}</div>
      )}

      {/* Bottom action bar (select mode) */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-paper/95 px-4 py-3 backdrop-blur">
          {/* Group picker */}
          {groupOpen && (
            <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-hairline bg-white p-2">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink/50">Add {sel.size} to group</span>
                <button onClick={() => setGroupOpen(false)} className="text-ink/40"><X size={13} /></button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cardGroups == null ? (
                  <span className="flex items-center gap-1 px-1 text-xs text-ink/40"><Loader2 size={12} className="animate-spin" /> loading…</span>
                ) : cardGroups.length === 0 ? (
                  <span className="px-1 text-xs text-ink/40">No groups yet — make one below.</span>
                ) : (
                  cardGroups.map((g) => (
                    <button key={g.id} onClick={() => addToGroup(g.id, g.name)} disabled={busy}
                      className="rounded-full border border-hairline bg-white px-3 py-1 text-xs font-semibold text-ink/70 hover:border-flag disabled:opacity-40">
                      {g.name} <span className="figures text-ink/35">{g.count}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} maxLength={60} placeholder="New group name…"
                  className="flex-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-flag" />
                <button onClick={createGroup} disabled={busy || !newGroup.trim()}
                  className="flex items-center gap-1 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                  <Plus size={12} /> Create
                </button>
              </div>
            </div>
          )}
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
            <span className="figures text-xs font-bold text-flag">{sel.size}</span>
            <button onClick={createLot} disabled={busy || sel.size < 2}
              className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
              <Layers size={13} /> Lot
            </button>
            <button onClick={openGroups} disabled={busy || !sel.size}
              className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
              <FolderPlus size={13} /> Group
            </button>
            <button onClick={exportSelected} disabled={busy || !sel.size}
              className="flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
              <Download size={13} /> Export
            </button>
            <select value={newStatus} onChange={(e) => { setNewStatus(e.target.value); setStatus(e.target.value); }} disabled={busy || !sel.size}
              className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-flag disabled:opacity-40">
              <option value="">Set status…</option>
              {CARD_STATUSES.filter((s) => s !== "sold" && s !== "archived").map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {entities.length > 0 && (
              <select value="" onChange={(e) => setEntity(e.target.value)} disabled={busy || !sel.size} title="Assign the owning business"
                className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-flag disabled:opacity-40">
                <option value="">Assign business…</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.short_code}</option>)}
              </select>
            )}
            {entities.length > 0 && (
              <select value="" onChange={(e) => setTreatment(e.target.value)} disabled={busy || !sel.size} title="Tax classification (how the sale is booked) — owner only"
                className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs font-semibold outline-none focus:border-flag disabled:opacity-40">
                <option value="">Tax treatment…</option>
                <option value="dealer">Dealer</option>
                <option value="investment">Investment</option>
                <option value="hobby">Hobby</option>
              </select>
            )}
            <Link href="/cards/bulk" className="text-[11px] font-semibold text-ink/50 underline-offset-2 hover:text-ink hover:underline">More…</Link>
            <button onClick={exitSelect} className="ml-auto flex items-center gap-1 text-xs font-semibold text-ink/50">
              <X size={13} /> Done
            </button>
          </div>
          {msg && <p className={"mx-auto mt-1.5 max-w-3xl text-[11px] font-semibold " + (msg.kind === "ok" ? "text-pos" : "text-danger")}>{msg.text}</p>}
          {busy && <Loader2 size={12} className="mt-1 animate-spin text-flag" />}
        </div>
      )}
      {selectMode && <div className="h-16" />}
      {cards.length === 0 && (
        <div className="mt-4 rounded-xl border border-hairline bg-white">
          <p className="figures px-4 py-10 text-center text-sm text-ink/40 flex items-center justify-center gap-2"><TagIcon size={14} /> No cards match. Clear a filter or add your first.</p>
        </div>
      )}
    </>
  );
}

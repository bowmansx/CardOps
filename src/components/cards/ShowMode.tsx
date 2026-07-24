"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X, DollarSign, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

// The flex screen. Pure black, huge photos, zero admin chrome. Prices are
// one tap to hide — for when the person you're showing shouldn't see them.

export type ShowCard = {
  id: string; title: string; subtitle: string; category: string | null;
  grade: string | null; chips: string[]; price: number | null; photo: string | null;
};

const money = (n: number | null) =>
  n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ShowMode({ cards }: { cards: ShowCard[] }) {
  const [prices, setPrices] = useState(true);
  const [cat, setCat] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const cats = useMemo(
    () => [...new Set(cards.map((c) => c.category).filter(Boolean))] as string[],
    [cards],
  );
  const visible = useMemo(
    () => (cat ? cards.filter((c) => c.category === cat) : cards),
    [cards, cat],
  );
  // Changing the category filter shrinks visible[]; close any open viewer so a
  // stale index can't point at a different card.
  const setCategory = (c: string | null) => { setOpen(null); setCat(c); };

  const cur = open != null ? visible[open] : null;
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const step = (d: number) => {
    if (open == null || !visible.length) return;
    setOpen(((open + d) % visible.length + visible.length) % visible.length);
  };

  return (
    <main className="fixed inset-0 z-50 overflow-y-auto bg-black text-white" style={{ colorScheme: "dark" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-black/85 px-4 py-3 backdrop-blur">
        <span className="text-sm font-bold tracking-[0.25em] text-[#c9a227]">THE COLLECTION</span>
        <span className="flex items-center gap-2">
          <button onClick={() => setPrices((p) => !p)}
            aria-label={prices ? "Hide prices" : "Show prices"}
            className={"flex h-8 w-8 items-center justify-center rounded-full border " +
              (prices ? "border-[#c9a227] text-[#c9a227]" : "border-white/20 text-white/30")}>
            <DollarSign size={15} />
          </button>
          <Link href="/cards" aria-label="Exit show mode"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/60">
            <X size={15} />
          </Link>
        </span>
      </div>

      {/* Category chips */}
      {cats.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-1 pt-2">
          <Chip on={!cat} onClick={() => setCategory(null)}>All</Chip>
          {cats.map((c) => <Chip key={c} on={cat === c} onClick={() => setCategory(cat === c ? null : c)}>{c}</Chip>)}
        </div>
      )}

      {/* Grid */}
      {!visible.length ? (
        <p className="px-4 py-16 text-center text-sm text-white/40">Nothing to show yet — scan some cards first.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          {visible.map((c, i) => (
            <button key={c.id} onClick={() => setOpen(i)} className="group text-left">
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-white/5">
                {c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo} alt={c.title} className="h-full w-full object-cover transition group-active:scale-95" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20"><ImageOff size={22} /></div>
                )}
                {c.grade && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-[#c9a227] px-1.5 py-0.5 text-[10px] font-bold text-black">
                    {c.grade}
                  </span>
                )}
              </div>
              <div className="mt-1.5 truncate text-xs font-semibold">{c.title}</div>
              <div className="flex items-baseline justify-between">
                <span className="truncate text-[10px] text-white/40">{c.subtitle}</span>
                {prices && c.price != null && (
                  <span className="figures ml-1 shrink-0 text-xs font-bold text-[#c9a227]">{money(c.price)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen viewer */}
      {cur && (
        <div
          className="fixed inset-0 z-20 flex flex-col bg-black"
          role="dialog"
          aria-modal="true"
          onTouchStart={(e) => {
            // Only track single-finger gestures — ignore pinch-zoom.
            touchStart.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
          }}
          onTouchEnd={(e) => {
            const start = touchStart.current;
            touchStart.current = null;
            if (!start || e.touches.length > 0) return; // multi-touch or cancelled
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            // Horizontal swipe only — must clear a threshold and dominate Y.
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
          }}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="figures text-[11px] text-white/40">{(open ?? 0) + 1} / {visible.length}</span>
            <button onClick={() => setOpen(null)} aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/60">
              <X size={15} />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
            {cur.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cur.photo} alt={cur.title} className="max-h-full max-w-full rounded-xl object-contain" />
            ) : (
              <div className="text-white/20"><ImageOff size={48} /></div>
            )}
            <button onClick={() => step(-1)} aria-label="Previous"
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/60"><ChevronLeft size={20} /></button>
            <button onClick={() => step(1)} aria-label="Next"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/60"><ChevronRight size={20} /></button>
          </div>
          <div className="px-5 pb-7 pt-3 text-center">
            <div className="text-base font-bold">{cur.title}</div>
            {cur.subtitle && <div className="mt-0.5 text-xs text-white/45">{cur.subtitle}</div>}
            <div className="mt-1.5 flex items-center justify-center gap-1.5">
              {cur.grade && <span className="rounded bg-[#c9a227] px-1.5 py-0.5 text-[10px] font-bold text-black">{cur.grade}</span>}
              {cur.chips.map((t) => (
                <span key={t} className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-semibold text-white/60">{t}</span>
              ))}
            </div>
            {prices && cur.price != null && (
              <div className="figures mt-2 text-xl font-bold text-[#c9a227]">{money(cur.price)}</div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Chip({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={"shrink-0 rounded-full border px-3 py-1 text-xs font-semibold " +
        (on ? "border-[#c9a227] bg-[#c9a227] text-black" : "border-white/20 text-white/50")}>
      {children}
    </button>
  );
}

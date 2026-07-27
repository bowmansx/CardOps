"use client";

import { useRef, useState } from "react";
import { X, GripVertical, Trash2, Check, Camera, ChevronRight } from "lucide-react";
import type { TemplateShot } from "@/lib/cards/templates";

export type SessionItem = TemplateShot & {
  /** A data URL once this shot has been taken in THIS session. */
  taken?: string | null;
  /** Already on the card before the session started. */
  existing?: boolean;
};

/**
 * The photo session, as a thing you can see and rearrange.
 *
 * Beau (`Photo Process and Format`):
 *   "i want there to also be a menu during a photo session. this menu is a
 *    expand/collapse menu that brings a whole window over from the left. In
 *    this menu, you will see the entire series of photos you have decided to
 *    take in this session. there will be the ability to delete individual
 *    photos from the series whether those are from what you have already
 *    taken, the one you are taking now, or the ones coming up in your session.
 *    there will also be the option to grab and move around the order of your
 *    session and this will also be the order of how your photos are saved."
 *
 * WHY THIS IS THE BIGGEST ITEM IN THAT NOTE. It turns a WIZARD that marches you
 * forward into a SESSION you can manipulate — and in doing so it absorbs four
 * separate requests at once: go back and retake, delete a shot, reorder, and
 * inspect a shot you already have. One piece of UI, four problems.
 *
 * REORDERING IS POINTER-BASED, NOT HTML5 DRAG. `draggable` + dragover fires on
 * a desktop mouse and NOWHERE on iOS Safari — which is the only place this
 * screen is ever really used. Pointer events cover both, and the grip also
 * takes ArrowUp/ArrowDown so the list is operable without dragging at all.
 */
export function SessionMenu({
  items, index, onClose, onJump, onDelete, onReorder, inspect, onInspectChange,
}: {
  items: SessionItem[];
  /** Which item the camera is on right now. */
  index: number;
  onClose: () => void;
  onJump: (i: number) => void;
  onDelete: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Show an already-taken shot for inspection before re-taking it. */
  inspect: boolean;
  onInspectChange: (v: boolean) => void;
}) {
  const ulRef = useRef<HTMLUListElement>(null);
  const geom = useRef({ top: 0, row: 44 });
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // Removing a slot that already HAS a photo throws that photo away, so it
  // takes two taps: the first arms, the second removes. An empty slot has
  // nothing to lose and goes on one.
  const [armed, setArmed] = useState<number | null>(null);

  const done = items.filter((s) => s.taken || s.existing).length;

  function startDrag(e: React.PointerEvent<HTMLButtonElement>, i: number) {
    const ul = ulRef.current;
    if (!ul) return;
    const li = e.currentTarget.closest("li");
    geom.current = { top: ul.getBoundingClientRect().top, row: li?.offsetHeight || 44 };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: i, to: i });
  }
  function moveDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const y = e.clientY - geom.current.top + (ulRef.current?.scrollTop ?? 0);
    const to = Math.max(0, Math.min(items.length - 1, Math.floor(y / geom.current.row)));
    if (to !== drag.to) setDrag({ from: drag.from, to });
  }
  function endDrag() {
    if (drag && drag.from !== drag.to) onReorder(drag.from, drag.to);
    setDrag(null);
  }

  return (
    <div className="absolute inset-0 z-20 flex">
      <div className="flex w-[78%] max-w-xs flex-col bg-[#101010] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
            This session · {done}/{items.length}
          </span>
          <button onClick={() => { setArmed(null); onClose(); }} aria-label="Close session menu" className="rounded p-1 text-white/60 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <ul ref={ulRef} className="min-h-0 flex-1 overflow-y-auto">
          {items.map((s, i) => {
            const isNow = i === index;
            const has = !!(s.taken || s.existing);
            return (
              <li
                key={`${s.role}-${i}`}
                className={"flex items-center gap-2 px-2 py-1.5 " +
                  (drag?.to === i && drag.from !== i ? "border-t-2 border-[#c9a227] " : "border-t-2 border-transparent ") +
                  (drag?.from === i ? "opacity-40 " : "") +
                  (isNow ? "bg-[#c9a227]/20" : "")}
              >
                <button
                  type="button"
                  aria-label={`Reorder ${s.label}`}
                  onPointerDown={(e) => startDrag(e, i)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); onReorder(i, i - 1); }
                    if (e.key === "ArrowDown" && i < items.length - 1) { e.preventDefault(); onReorder(i, i + 1); }
                  }}
                  className="shrink-0 cursor-grab p-1 text-white/25"
                  style={{ touchAction: "none" }}
                >
                  <GripVertical size={14} />
                </button>

                <button
                  type="button"
                  onClick={() => { setArmed(null); onJump(i); }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {/* The thumbnail IS the inspection: you can see what you
                      already got without leaving the session. */}
                  {s.taken ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- in-memory data URL */
                    <img src={s.taken} alt="" className="h-9 w-7 shrink-0 rounded object-cover" />
                  ) : (
                    <span className={"flex h-9 w-7 shrink-0 items-center justify-center rounded border " +
                      (has ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/15")}>
                      {has ? <Check size={12} className="text-emerald-400" /> : <Camera size={12} className="text-white/30" />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={"block truncate text-[11px] font-semibold " + (isNow ? "text-[#e8c34a]" : "text-white/80")}>
                      {s.label}
                    </span>
                    <span className="block truncate text-[10px] text-white/35">
                      {s.taken ? "taken — tap to retake"
                        : s.existing ? "already on the card"
                        : isNow ? "shooting now"
                        : [s.targetFill != null ? `${Math.round(s.targetFill * 100)}% frame` : null,
                           s.targetTilt != null ? `${s.targetTilt}°` : null].filter(Boolean).join(" · ") || "queued"}
                    </span>
                  </span>
                  {isNow && <ChevronRight size={14} className="shrink-0 text-[#c9a227]" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!s.taken || armed === i) { setArmed(null); onDelete(i); }
                    else setArmed(i);
                  }}
                  aria-label={s.taken && armed !== i
                    ? `Remove ${s.label} — this discards the photo you took; tap again to confirm`
                    : `Remove ${s.label} from this session`}
                  className={"shrink-0 rounded px-1.5 py-1 text-[10px] font-bold " +
                    (armed === i ? "bg-red-500/20 text-red-400" : "text-white/25 hover:bg-white/10 hover:text-red-400")}
                >
                  {armed === i ? "Discard?" : <Trash2 size={13} />}
                </button>
              </li>
            );
          })}
        </ul>

        <label className="flex shrink-0 items-start gap-2 border-t border-white/10 px-3 py-2.5">
          <input
            type="checkbox"
            checked={inspect}
            onChange={(e) => onInspectChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#c9a227]"
          />
          <span className="text-[10px] leading-snug text-white/55">
            Show me a shot I already have before re-taking it
          </span>
        </label>
      </div>

      {/* The exposed strip closes — the fastest way back to shooting. */}
      <button aria-label="Close session menu" onClick={onClose} className="flex-1 bg-black/60" />
    </div>
  );
}

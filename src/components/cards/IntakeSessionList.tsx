"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, ImageOff, Archive, ChevronRight, Clock } from "lucide-react";
import { sessionSummary, sessionPace, type SessionCard } from "@/lib/cards/intake-session";

/**
 * The cards booked in this sitting, under the camera.
 *
 * Intake used to keep a NUMBER — "4 cards booked this session" — and reset the
 * screen after each save. The card you had just done vanished the instant it
 * succeeded, so a typo noticed two cards later meant leaving intake, hunting
 * the card down, fixing it, and coming back.
 *
 * REMOVE ARCHIVES, IT DOES NOT DELETE. These rows are already in the database
 * and may already have photos in storage. `CLAUDE.md` makes archiving the
 * sanctioned path — card_ops cannot delete at all — and a booked card is work,
 * so it takes two taps like everything else in this app that throws work away.
 */
export function IntakeSessionList({
  cards, onRemove, onAddPhotos,
}: {
  cards: SessionCard[];
  /** Archive the card and drop it from the list. */
  onRemove: (id: string) => void | Promise<void>;
  /** Reopen the camera for a card already booked. */
  onAddPhotos: (card: SessionCard) => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!cards.length) return null;
  const s = sessionSummary(cards);
  const pace = sessionPace(s);

  return (
    <div className="rounded-2xl border border-hairline bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
          This session
        </span>
        <span className="figures text-[11px] font-semibold text-ink/70">
          {s.total} card{s.total === 1 ? "" : "s"}
        </span>
        {s.spanMinutes != null && (
          <span className="flex items-center gap-1 text-[11px] text-ink/40">
            <Clock size={11} /> {s.spanMinutes}m{pace != null && ` · ~${pace}/hr`}
          </span>
        )}
      </div>

      {/* The number worth acting on, not buried in the list. */}
      {s.missingPhotos > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
          <ImageOff size={13} className="mt-px shrink-0" />
          {s.missingPhotos} card{s.missingPhotos === 1 ? " is" : "s are"} booked without photos — tap to add them.
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {cards.map((c) => (
          <li key={c.id} className="flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => { setArmed(null); onAddPhotos(c); }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline px-2 py-1.5 text-left hover:border-flag/50"
            >
              {c.thumb ? (
                /* eslint-disable-next-line @next/next/no-img-element -- in-memory data URL */
                <img src={c.thumb} alt="" className="h-9 w-7 shrink-0 rounded object-cover" />
              ) : (
                <span className={"flex h-9 w-7 shrink-0 items-center justify-center rounded border " +
                  (c.photosAttached ? "border-hairline" : "border-amber-500/50 bg-amber-500/10")}>
                  {c.photosAttached
                    ? <Camera size={12} className="text-ink/25" />
                    : <ImageOff size={12} className="text-amber-600" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-ink">
                  {c.label || <span className="text-ink/45">Not identified</span>}
                </span>
                <span className="block truncate text-[10px] text-ink/40">
                  {c.sku ? <span className="figures">{c.sku}</span> : "booked"}
                  {!c.photosAttached && " · no photos"}
                </span>
              </span>
              <Camera size={13} className="shrink-0 text-flag" />
            </button>

            <Link
              href={`/cards/${c.id}`}
              aria-label={`Open ${c.label || "card"}`}
              className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink/40 hover:text-ink"
            >
              <ChevronRight size={15} />
            </Link>

            {/* Two taps, and it archives rather than deletes — the card is
                already booked and may already have photos in storage. */}
            <button
              type="button"
              disabled={busy === c.id}
              onClick={async () => {
                if (armed !== c.id) { setArmed(c.id); return; }
                setArmed(null); setBusy(c.id);
                try { await onRemove(c.id); } finally { setBusy(null); }
              }}
              aria-label={armed === c.id
                ? `Confirm archiving ${c.label || "this card"}`
                : `Archive ${c.label || "this card"} — it is already booked`}
              className={"shrink-0 rounded-lg border px-2 text-[10px] font-bold " +
                (armed === c.id
                  ? "border-amber-500 bg-amber-500/15 text-amber-700"
                  : "border-hairline text-ink/30 hover:text-amber-700")}
            >
              {busy === c.id ? "…" : armed === c.id ? "Archive?" : <Archive size={14} />}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] leading-snug text-ink/40">
        Tap a card to photograph it again, the arrow to open it. Archiving takes
        it out of inventory — it is never deleted.
      </p>
    </div>
  );
}

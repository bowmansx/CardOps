"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, Loader2, Search, AlertTriangle, CircleCheck, CircleHelp, Plus } from "lucide-react";
import { CameraSheet } from "./CameraSheet";
import { usePhotoPrefs } from "@/lib/cards/use-photo-prefs";
import type { MatchQuery } from "@/lib/cards/match";

type Match = {
  id: string; sku: string | null; status: string | null;
  player: string | null; year: number | null; set_name: string | null;
  card_number: string | null; parallel: string | null;
  grader: string | null; grade: number | null; market_value: number | null;
  score: number; confidence: "certain" | "likely" | "possible";
  reasons: string[]; conflicts: string[];
};

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const CONF: Record<Match["confidence"], { label: string; cls: string }> = {
  certain: { label: "Certain", cls: "bg-pos/15 text-pos" },
  likely: { label: "Likely", cls: "bg-flag/15 text-flag" },
  possible: { label: "Possible", cls: "bg-ink/10 text-ink/55" },
};

/**
 * FIND — point the camera at a card you already own and go straight to it.
 *
 * Beau: *"i'd also like an option when taking a photo to do a 'search for
 * card'"*, for the case where the card is in your hand and its row is
 * somewhere in an inventory too long to scroll.
 *
 * TWO WAYS IN, ON PURPOSE. The photo is the fast path, but it costs an AI call
 * and needs the card out of its case. Typing a name and a number costs nothing
 * and works when the card is already boxed for a grader — which is the exact
 * situation Beau described wanting this for.
 *
 * NOTHING IS DECIDED HERE. Every candidate is shown with WHY it matched and
 * what disagreed, and the person picks. On the flow this exists to serve —
 * sending ten cards out to be graded — updating the wrong row is worse than
 * updating none.
 */
export function FindCard() {
  const prefs = usePhotoPrefs();
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState<"scan" | "find" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState<MatchQuery>({});
  const [matches, setMatches] = useState<Match[] | null>(null);

  async function search(query: MatchQuery) {
    setBusy("find"); setErr(null);
    try {
      const r = await fetch("/api/cards/find", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(query),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.error ?? "The search failed."); setMatches(null); return; }
      setMatches(d.matches ?? []);
      // Silent truncation would read as "you don't own this card".
      setNote(d.truncated ? `Searched the ${d.searched} most recent cards — your inventory is larger, so a very old card may not appear.` : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The search failed.");
      setMatches(null);
    } finally {
      setBusy(null);
    }
  }

  async function fromPhoto(front: string) {
    setCam(false); setBusy("scan"); setErr(null); setMatches(null);
    try {
      const r = await fetch("/api/cards/intake/scan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ front }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.error ?? "Couldn't read the card."); return; }
      if (d?.aiOff) { setErr("AI scanning is off (Services page). Type what you remember instead."); return; }
      // The scan route answers { card: {...} }.
      const c = d?.card;
      if (!c) { setErr("Couldn't read anything off that photo — try again, or type what you know."); return; }
      const read: MatchQuery = {
        player: c.player, year: c.year, set_name: c.set_name, card_number: c.card_number,
        parallel: c.parallel, serial_number: c.serial_number, cert_number: c.cert_number,
        grader: c.grader, grade: c.grade,
      };
      // Show what it read, so a wrong result is diagnosable rather than
      // mysterious — and editable without re-shooting.
      setQ(read);
      await search(read);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read the card.");
    } finally {
      // Cleared in `finally` so a rejected fetch can never strand the spinner.
      setBusy((b) => (b === "scan" ? null : b));
    }
  }

  const field = (k: keyof MatchQuery, label: string, ph = "") => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</span>
      <input
        value={(q[k] as string | number | null | undefined) ?? ""}
        onChange={(e) => setQ({ ...q, [k]: e.target.value })}
        placeholder={ph}
        className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-ink"
      />
    </label>
  );

  const typed = Object.values(q).some((v) => String(v ?? "").trim());

  return (
    <div className="mt-4 space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => setCam(true)}
          disabled={busy !== null}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-flag px-4 py-3 text-sm font-bold text-black disabled:opacity-50"
        >
          {busy === "scan" ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {busy === "scan" ? "Reading the card…" : "Find by photo"}
        </button>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-3">
        <p className="text-[11px] text-ink/45">
          Or type what you know — free, and it works with the card still in its case.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {field("player", "Player / card", "Ja'Marr Chase")}
          {field("year", "Year", "2021")}
          {field("set_name", "Set", "Prizm")}
          {field("card_number", "Number", "307")}
          {field("cert_number", "Cert #", "slab label")}
          {field("serial_number", "Serial", "12/99")}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => void search(q)}
            disabled={!typed || busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-40"
          >
            {busy === "find" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
          </button>
          {(typed || matches) && (
            <button
              onClick={() => { setQ({}); setMatches(null); setErr(null); setNote(null); }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink/50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {err && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {err}
        </p>
      )}
      {note && <p className="text-[11px] text-ink/45">{note}</p>}

      {matches && matches.length === 0 && (
        <div className="rounded-xl border border-hairline bg-white p-4 text-center">
          <p className="text-sm font-semibold text-ink">Nothing in your inventory matches.</p>
          <p className="mt-1 text-[11px] text-ink/45">
            Either you don&apos;t own it yet, or what was read doesn&apos;t line up with how it&apos;s filed —
            try editing the fields above.
          </p>
          <Link
            href="/cards/intake"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-black"
          >
            <Plus size={13} /> Book it as a new card
          </Link>
        </div>
      )}

      {matches && matches.length > 0 && (
        <ul className="space-y-1.5">
          {matches.map((m) => {
            const conf = CONF[m.confidence];
            return (
              <li key={m.id}>
                <Link
                  href={`/cards/${m.id}`}
                  className="flex items-start gap-2 rounded-xl border border-hairline bg-white p-3 hover:border-flag/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide " + conf.cls}>
                        {conf.label}
                      </span>
                      {m.sku && <span className="figures text-[10px] text-ink/35">{m.sku}</span>}
                      {m.status && m.status !== "booked" && (
                        <span className="text-[10px] uppercase tracking-wide text-ink/35">{m.status}</span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-sm font-semibold text-ink">
                      {[m.year, m.set_name, m.player].filter(Boolean).join(" ") || "Untitled card"}
                    </span>
                    <span className="block truncate text-[11px] text-ink/45">
                      {[m.card_number && `#${m.card_number}`, m.parallel,
                        m.grader && `${m.grader} ${m.grade ?? ""}`.trim()].filter(Boolean).join(" · ")}
                    </span>
                    {/* Show the work: a match nobody can check is a guess with
                        a confident label on it. */}
                    <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                      {m.reasons.map((r) => (
                        <span key={r} className="flex items-center gap-0.5 rounded bg-pos/10 px-1 py-0.5 text-pos">
                          <CircleCheck size={9} /> {r}
                        </span>
                      ))}
                      {m.conflicts.map((c) => (
                        <span key={c} className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 text-amber-700">
                          <CircleHelp size={9} /> {c} differs
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="figures shrink-0 text-sm font-semibold text-ink/70">{money(m.market_value)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {cam && (
        <CameraSheet
          prefs={prefs}
          title="Find this card"
          shotLabel="FRONT"
          shotHint="Whole card — the more of the text it can read, the better the match"
          onClose={() => setCam(false)}
          onCapture={(shot) => void fromPhoto(shot.url)}
        />
      )}
    </div>
  );
}

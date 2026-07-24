"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

// The one control that writes to real books. Always requires an explicit
// confirmation naming the business and the count; the server refuses without it.
export function PushToBooks({
  businessId, code, label, ready,
}: { businessId: string; code: string; label: string; ready: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  async function push() {
    if (!confirm(`Post ${ready} ${ready === 1 ? "entry" : "entries"} to ${code}'s ${label}?\n\nThis writes to your real bookkeeping. Already-posted entries are skipped automatically.`)) return;
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/cards/connectors/push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, confirm: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Push failed.");
      // Mirror the API's actual outcome fields (it never returns `failed`):
      // pushed / skipped_already_posted / refused / uncertain / remaining.
      const bits = [`${d.pushed ?? 0} posted`];
      if (d.skipped_already_posted) bits.push(`${d.skipped_already_posted} already there`);
      if (d.refused) bits.push(`${d.refused} refused (retryable)`);
      if (d.uncertain) bits.push(`${d.uncertain} UNCERTAIN — verify in your books before retrying`);
      if (d.aborted) bits.push("STOPPED EARLY — a claim couldn't be recorded");
      if (d.remaining) bits.push(`${d.remaining} left — run again`);
      setRes({
        // Honest success = nothing refused, nothing uncertain, no abort, and
        // no error strings at all (a claim-failure abort ships only in errors).
        ok: !d.refused && !d.uncertain && !d.aborted && !(d.errors?.length),
        text: bits.join(" · ") + (d.errors?.length ? ` — ${d.errors[0]}` : ""),
      });
      router.refresh();
    } catch (e) {
      setRes({ ok: false, text: e instanceof Error ? e.message : "Push failed." });
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2">
      {res && (
        <span className={"flex items-center gap-1 text-[10px] " + (res.ok ? "text-pos" : "text-danger")}>
          {res.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {res.text}
        </span>
      )}
      <button onClick={push} disabled={busy || ready === 0}
        title={ready === 0 ? "Nothing ready to post" : `Post ${ready} to ${label}`}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-flag px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Post {ready}
      </button>
    </div>
  );
}

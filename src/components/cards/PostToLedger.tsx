"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookText, Loader2 } from "lucide-react";

// Posts card sales into the internal journal (a full resync — idempotent). The
// internal book of record a later, gated Zoho push will read from.
export function PostToLedger({ entryCount }: { entryCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function post() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/cards/books/post", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed.");
      setMsg(`Posted ${d.sales} sale${d.sales === 1 ? "" : "s"} → ${d.entries} balanced ledger lines.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-hairline bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] text-ink/60">
          <BookText size={15} className="text-flag" /> Internal ledger · {entryCount} line{entryCount === 1 ? "" : "s"}
        </span>
        <button onClick={post} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-flag/50 bg-flag/10 px-3 py-1.5 text-xs font-bold text-flag disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <BookText size={12} />} Sync sales to ledger
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[11px] font-medium text-pos">{msg}</p>}
    </div>
  );
}

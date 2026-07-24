"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2, ImagePlus, X, CheckCircle2 } from "lucide-react";
import { downscale } from "@/lib/cards/img";

/**
 * The universal comps importer (a.k.a. the Card Ladder connector): paste the
 * sales history from ANY tool — Card Ladder, eBay solds, 130point — as text
 * or a screenshot, and AI parses it into comps, dedupes, and reprices.
 */
export function CompsPaste({ cardId }: { cardId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function fileToImage(file: File) {
    setImage(await downscale(file, 2000, 0.9));
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/cards/comps/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, text: text.trim() || undefined, image: image ?? undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Import failed.");
      setMsg({
        kind: "ok",
        text: d.inserted
          ? `Imported ${d.inserted} sale${d.inserted === 1 ? "" : "s"} from ${d.source}${d.skipped ? ` (${d.skipped} duplicates skipped)` : ""} — value recomputed.`
          : d.note ?? `Nothing new — ${d.skipped} duplicate${d.skipped === 1 ? "" : "s"} skipped.`,
      });
      setText("");
      setImage(null);
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Import failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-flag/30 bg-flag/5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-flag">
        <ClipboardPaste size={13} /> Paste sales from anywhere
      </div>
      <p className="mt-1 text-[11px] leading-snug text-ink/50">
        Copy the sales history from Card Ladder / eBay solds / 130point — text or a screenshot — and paste it here.
        AI reads it into comps and reprices the card.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
          const file = item?.getAsFile();
          if (file) {
            e.preventDefault();
            fileToImage(file);
          }
        }}
        rows={3}
        placeholder={"e.g.\nPSA 10  $124.99  Jul 2\nRaw     $38.00   Jun 28  …or paste a screenshot right here"}
        className="figures mt-2 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-xs text-ink outline-none focus:border-flag"
      />
      <div className="mt-2 flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink/60">
          <ImagePlus size={13} /> Screenshot
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) fileToImage(e.target.files[0]); e.target.value = ""; }}
          />
        </label>
        {image && (
          <span className="flex items-center gap-1 rounded-lg border border-flag/40 bg-white px-2 py-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="pasted" className="h-6 w-auto rounded" />
            <button onClick={() => setImage(null)} className="text-ink/40 hover:text-danger"><X size={12} /></button>
          </span>
        )}
        <button
          onClick={submit}
          disabled={busy || (!text.trim() && !image)}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-flag px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ClipboardPaste size={13} />}
          {busy ? "Reading…" : "Import"}
        </button>
      </div>
      {msg && (
        <p className={"mt-2 flex items-center gap-1.5 text-xs " + (msg.kind === "ok" ? "text-pos" : "text-danger")}>
          {msg.kind === "ok" && <CheckCircle2 size={13} />} {msg.text}
        </p>
      )}
    </div>
  );
}

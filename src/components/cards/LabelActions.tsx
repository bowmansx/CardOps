"use client";

import { useState } from "react";
import { Printer, Copy, Check } from "lucide-react";

export function LabelActions({ zpl }: { zpl: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-flag px-4 py-2.5 text-sm font-bold text-white transition active:scale-95"
      >
        <Printer size={16} /> Print label
      </button>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(zpl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-ink/70 transition active:scale-95"
      >
        {copied ? <Check size={16} className="text-pos" /> : <Copy size={16} />}
        {copied ? "Copied" : "Copy ZPL"}
      </button>
    </div>
  );
}

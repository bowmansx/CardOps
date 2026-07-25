"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Tucks the secondary card-section links into one dropdown so the header stays
// calm. Primary links (Pricing, Show, eBay) stay visible; everything else lives
// here. Owner-only items are appended when isOwner.
export function CardsMoreMenu({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const items: [string, string][] = [
    ["Import", "/cards/import"],
    ["Export", "/cards/export"],
    ["Lots", "/cards/lots"],
    ["Watch", "/cards/watchlist"],
    ["Movers", "/cards/movers"],
    ["News", "/cards/news"],
    ["Showcases", "/cards/showcases"],
    ["Sales", "/cards/sales"],
    ["Businesses", "/cards/businesses"],
    ...(isOwner
      ? ([
          ["Books", "/cards/books"],
          ["Receipts", "/cards/receipts"],
          ["Reports", "/cards/reports"],
          ["Settings", "/cards/settings"],
          ["Services", "/cards/services"],
          ["Credits", "/cards/credits"],
        ] as [string, string][])
      : []),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-0.5 text-xs text-ink/50 underline-offset-4 hover:text-ink"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        More <ChevronDown size={12} className={"transition " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-xl border border-hairline bg-white shadow-xl">
          {items.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-xs font-semibold text-ink/70 hover:bg-paper"
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

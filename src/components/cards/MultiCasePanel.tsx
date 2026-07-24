"use client";

import { useState } from "react";
import { Layers } from "lucide-react";

export type PriceCase = {
  key: string;
  label: string;
  value: number | null;
  active: boolean;
  tags: string[];
};

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Multi-case pricing panel (Beau's ask): every saved format's answer for THIS
 * card, side-by-side — the active one highlighted — plus a blend row: check
 * any combination and see their average live. More honest than any single
 * number: one glance shows the RANGE and which formats even have enough
 * evidence to speak.
 */
export function MultiCasePanel({ cases }: { cases: PriceCase[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  const blendVals = cases.filter((c) => checked.has(c.key) && c.value != null).map((c) => c.value as number);
  const blend = blendVals.length ? blendVals.reduce((a, b) => a + b, 0) / blendVals.length : null;

  return (
    <section className="mt-4">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
        <Layers size={13} className="text-flag" /> Every format&apos;s answer
        <span className="normal-case tracking-normal text-ink/35">— check any to blend</span>
      </h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-hairline bg-white">
        {cases.map((c) => (
          <label
            key={c.key}
            className={
              "flex cursor-pointer items-center gap-2.5 border-b border-hairline px-3 py-2 last:border-b-0 " +
              (c.active ? "bg-flag/8" : "")
            }
          >
            <input
              type="checkbox"
              checked={checked.has(c.key)}
              onChange={() => toggle(c.key)}
              disabled={c.value == null}
              className="h-3.5 w-3.5 shrink-0 accent-[#c9a227] disabled:opacity-30"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-ink">{c.label}</span>
                {c.active && (
                  <span className="figures shrink-0 rounded bg-flag/15 px-1 py-px text-[9px] font-bold text-flag">active</span>
                )}
              </span>
              {c.tags.length > 0 && (
                <span className="figures block truncate text-[9px] text-ink/35">{c.tags.join(" · ")}</span>
              )}
            </span>
            <span className={"figures shrink-0 text-sm font-bold " + (c.value == null ? "text-ink/30" : "text-ink")}>
              {money(c.value)}
            </span>
          </label>
        ))}
        {checked.size > 0 && (
          <div className="flex items-center justify-between bg-flag/10 px-3 py-2">
            <span className="text-xs font-bold text-flag">
              Blend — average of {blendVals.length} checked
            </span>
            <span className="figures text-sm font-bold text-flag">{money(blend)}</span>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink/40">
        &quot;—&quot; = that format abstains (not enough qualifying sales for its rules). The active format is what the card actually uses.
      </p>
    </section>
  );
}

"use client";

import { Printer, X } from "lucide-react";

export type SheetCard = {
  id: string; sku: string | null;
  player: string | null; year: number | null; set_name: string | null;
  card_number: string | null; parallel: string | null;
  serial_number?: string | null;
  market_value: number | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * A placement sheet for a batch going out to a grader.
 *
 * Beau: *"say i'm sending out 10 cards for grading... is there a type of
 * reference page we should give the users for them to print off and set their
 * cards on"*
 *
 * WHAT IT IS AND ISN'T. It is not a submission form — PSA, BGS and SGC each
 * generate their own and this can't replace them. It is the thing that goes
 * UNDER the cards: numbered slots at true card size, laid out in the same order
 * as the list above them, so the physical stack, the list you typed, and the
 * rows in the app are all in one order. That is the part that goes wrong when
 * ten cards come back and two are in the wrong sleeves.
 *
 * THE VALUE COLUMN IS YOUR RECORDED VALUE, LABELLED AS SUCH. Graders ask for a
 * DECLARED value, which carries insurance and service-tier consequences and is
 * the submitter's call. Printing our number under that heading would quietly
 * make the app answer a question it has no business answering.
 */
export function GradingSheet({ cards, onClose }: { cards: SheetCard[]; onClose: () => void }) {
  const total = cards.reduce((s, c) => s + (c.market_value ?? 0), 0);
  const anyUnvalued = cards.some((c) => c.market_value == null);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white text-black print:static print:overflow-visible">
      <div className="mx-auto max-w-[8in] p-6 print:p-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white"
          >
            <Printer size={14} /> Print
          </button>
          <button onClick={onClose} aria-label="Close the sheet" className="rounded p-1 text-black/50 hover:bg-black/5">
            <X size={20} />
          </button>
        </div>

        <h1 className="text-lg font-bold">Grading batch — placement sheet</h1>
        <p className="mt-0.5 text-[10px] text-black/55">
          {cards.length} card{cards.length === 1 ? "" : "s"}. Lay each card on its numbered slot below, in this
          order. This is a placement and reference sheet — your grader&apos;s own submission form still applies.
        </p>

        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="w-8 py-1">#</th>
              <th className="py-1">Card</th>
              <th className="py-1">SKU</th>
              <th className="py-1 text-right">Your recorded value</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c, i) => (
              <tr key={c.id} className="border-b border-black/15 align-top">
                <td className="py-1 font-bold">{i + 1}</td>
                <td className="py-1">
                  <div className="font-semibold">
                    {[c.year, c.set_name, c.player].filter(Boolean).join(" ") || "Untitled card"}
                  </div>
                  <div className="text-black/55">
                    {[c.card_number && `#${c.card_number}`, c.parallel, c.serial_number].filter(Boolean).join(" · ") || "—"}
                  </div>
                </td>
                <td className="py-1 font-mono text-[10px] text-black/60">{c.sku ?? "—"}</td>
                <td className="py-1 text-right font-semibold">{money(c.market_value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={3} className="py-1 text-right font-semibold">Total recorded value</td>
              <td className="py-1 text-right font-bold">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
        {anyUnvalued && (
          // Rule 4: never let a partial figure read as the whole truth.
          <p className="mt-1 text-[10px] font-semibold text-black/70">
            Some cards have no recorded value — the total covers only the ones that do.
          </p>
        )}

        {/* True card size: 2.5in x 3.5in, so a card actually sits on its slot.
            page-break-inside keeps a slot from being sliced across two sheets. */}
        <h2 className="mt-6 text-sm font-bold">Placement</h2>
        <p className="text-[10px] text-black/55">Slots are printed at card size (2.5&quot; × 3.5&quot;). Print at 100% — no &quot;fit to page&quot;.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {cards.map((c, i) => (
            <div
              key={c.id}
              style={{ width: "2.5in", height: "3.5in", breakInside: "avoid" }}
              className="relative border border-dashed border-black/40"
            >
              <span className="absolute left-1 top-1 text-2xl font-black text-black/25">{i + 1}</span>
              <span className="absolute inset-x-1 bottom-1 text-[9px] leading-tight text-black/60">
                {[c.year, c.set_name, c.player].filter(Boolean).join(" ")}
                {c.card_number ? ` #${c.card_number}` : ""}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[9px] text-black/40">
          Generated by CardOps. Values are your own recorded figures, not an appraisal, and not a declared
          value for insurance or grading-tier purposes.
        </p>
      </div>
    </div>
  );
}

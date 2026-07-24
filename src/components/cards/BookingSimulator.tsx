"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FlaskConical, ChevronDown, Star, AlertTriangle } from "lucide-react";
import {
  simulate, FUNDING_PATHS, FUNDING_LABEL, FUNDING_BLURB,
  type FundingPath, type Character, type ScenarioResult,
} from "@/lib/books/funding";
import type { TaxTreatment, EntityEntry } from "@/lib/books/journal";

type Entity = { id: string; name: string; short_code: string; type: string | null; zoho_books_org_id: string | null };

const TREATMENTS: [TaxTreatment, string][] = [["investment", "Investment"], ["dealer", "Dealer"], ["hobby", "Hobby"]];
// The two paths Beau described for his own cards get a subtle marker.
const OWN_CASE: FundingPath[] = ["sale_to_entity", "loan_to_entity"];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const labelize = (a: string) => a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const charTone: Record<Character, string> = {
  capital: "bg-flag/10 text-flag",
  ordinary: "bg-amber-500/15 text-amber-600",
  hobby: "bg-ink/10 text-ink/60",
  none: "bg-ink/10 text-ink/50",
};
// Sign-aware: a negative result is a LOSS, not a "gain"/"income" (a related-party
// loss is also likely disallowed — the flags cover that; the badge must not lie).
function charLabel(c: Character, amount: number): string {
  if (c === "none") return "—";
  const loss = amount < 0;
  if (c === "capital") return loss ? "capital loss" : "capital gain";
  if (c === "ordinary") return loss ? "ordinary loss" : "ordinary income";
  return loss ? "hobby loss" : "hobby income";
}

export function BookingSimulator({ entities }: { entities: Entity[] }) {
  const personal = entities.find((e) => e.type === "personal") ?? null;
  const businesses = entities.filter((e) => e.type !== "personal");
  const firstBiz = businesses.find((e) => e.zoho_books_org_id) ?? businesses[0] ?? null;
  const codeOf = (id: string | null) => (id ? entities.find((e) => e.id === id)?.short_code ?? "?" : "—");

  const [cost, setCost] = useState("200");
  const [salePrice, setSalePrice] = useState("500");
  const [fees, setFees] = useState("50");
  const [holdingMonths, setHoldingMonths] = useState("13");
  const [transferPrice, setTransferPrice] = useState(""); // blank → defaults to cost
  const [ownerId, setOwnerId] = useState(personal?.id ?? entities[0]?.id ?? "");
  const [ownerTreatment, setOwnerTreatment] = useState<TaxTreatment>("investment");
  const [entityId, setEntityId] = useState(firstBiz?.id ?? "");
  const [entityTreatment, setEntityTreatment] = useState<TaxTreatment>("dealer");
  const [settled, setSettled] = useState(true);
  const [open, setOpen] = useState<FundingPath | null>(null);

  const results = useMemo(() => {
    const common = {
      cost: Number(cost) || 0,
      transfer_price: transferPrice === "" ? null : Number(transferPrice),
      owner_entity_id: ownerId || null,
      owner_treatment: ownerTreatment,
      entity_id: entityId || null,
      entity_treatment: entityTreatment,
      settled,
      sale_price: salePrice === "" ? null : Number(salePrice),
      fees: Number(fees) || 0,
      holding_months: holdingMonths === "" ? null : Number(holdingMonths),
    };
    return FUNDING_PATHS.map((path) => ({ path, r: simulate({ ...common, path }) }));
  }, [cost, transferPrice, ownerId, ownerTreatment, entityId, entityTreatment, settled, salePrice, fees, holdingMonths]);

  const field = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/50";

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><FlaskConical size={20} className="text-flag" /> Booking Simulator</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <span className="flex items-center gap-3 text-xs">
            <Link href="/cards/books" className="text-ink/50 underline-offset-4 hover:text-flag hover:underline">Books</Link>
            <Link href="/cards" className="text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
          </span>
        </header>
        <p className="mt-1 text-[11px] leading-snug text-ink/50">
          The same cards, every way you could book them — side by side. Nothing posts anywhere; this just shows the
          journal entries and how each option comes out. <b>Decision-support only — not tax advice.</b> Take the flags to your CPA.
        </p>

        {/* Inputs */}
        <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-white p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block"><span className={lbl}>Your cost</span>
              <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={"figures " + field} /></label>
            <label className="block"><span className={lbl}>Eventual sale</span>
              <input value={salePrice} onChange={(e) => setSalePrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="optional" className={"figures " + field} /></label>
            <label className="block"><span className={lbl}>Selling fees</span>
              <input value={fees} onChange={(e) => setFees(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={"figures " + field} /></label>
            <label className="block"><span className={lbl}>Held (months)</span>
              <input value={holdingMonths} onChange={(e) => setHoldingMonths(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={"figures " + field} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className={lbl}>You (owner)</span>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.short_code} · {e.name}</option>)}
              </select></label>
            <label className="block"><span className={lbl}>You held them as</span>
              <select value={ownerTreatment} onChange={(e) => setOwnerTreatment(e.target.value as TaxTreatment)} className={field}>
                {TREATMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
            <label className="block"><span className={lbl}>Receiving business</span>
              <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={field}>
                {businesses.map((e) => <option key={e.id} value={e.id}>{e.short_code} · {e.name}{e.zoho_books_org_id ? "" : " (no Books org)"}</option>)}
              </select></label>
            <label className="block"><span className={lbl}>It holds them as</span>
              <select value={entityTreatment} onChange={(e) => setEntityTreatment(e.target.value as TaxTreatment)} className={field}>
                {TREATMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-[11px] text-ink/60">
              <input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} className="accent-flag" />
              Paid in cash now <span className="text-ink/35">(off = left as a receivable/payable)</span>
            </label>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink/60">
              Sale-to-entity price
              <input value={transferPrice} onChange={(e) => setTransferPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={`= cost (${money(Number(cost) || 0)})`}
                className={"figures w-24 rounded-lg border border-hairline bg-white px-2 py-1 text-xs outline-none focus:border-flag"} />
            </label>
          </div>
        </div>

        {/* Comparison cards */}
        <div className="mt-4 space-y-2.5">
          {results.map(({ path, r }) => (
            <PathCard key={path} path={path} r={r} codeOf={codeOf} isOpen={open === path} onToggle={() => setOpen(open === path ? null : path)} />
          ))}
        </div>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-ink/35">
          Entries mirror what a real posting would produce (same double-entry engine as the ledger). The simulator never
          writes to your books or to Zoho. Confirm every treatment and structure with your CPA.
        </p>
      </div>
    </main>
  );
}

function PathCard({ path, r, codeOf, isOpen, onToggle }: {
  path: FundingPath; r: ScenarioResult; codeOf: (id: string | null) => string; isOpen: boolean; onToggle: () => void;
}) {
  const own = OWN_CASE.includes(path);
  return (
    <div className={"overflow-hidden rounded-xl border bg-white " + (own ? "border-flag/40" : "border-hairline")}>
      <div className="border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-ink">{FUNDING_LABEL[path]}</span>
          {own && <Star size={12} className="text-flag" fill="currentColor" />}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-ink/50">{FUNDING_BLURB[path]}</p>
      </div>

      <div className="grid grid-cols-3 divide-x divide-hairline text-center">
        {/* Now */}
        <div className="px-2 py-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">You, now</div>
          {r.acquisition_gain !== 0 ? (
            <>
              <div className={"figures mt-0.5 text-sm font-bold " + (r.acquisition_gain >= 0 ? "text-pos" : "text-danger")}>{money(r.acquisition_gain)}</div>
              <span className={"mt-0.5 inline-block rounded px-1 text-[9px] " + charTone[r.acquisition_character]}>{charLabel(r.acquisition_character, r.acquisition_gain)}</span>
            </>
          ) : <div className="mt-0.5 text-xs text-ink/40">no gain now</div>}
        </div>
        {/* Holder */}
        <div className="px-2 py-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">Held by</div>
          <div className="mt-0.5 text-sm font-bold text-ink">{codeOf(r.holder_entity_id)}</div>
          <div className="figures text-[10px] text-ink/45">basis {money(r.holder_basis)}</div>
        </div>
        {/* On sale */}
        <div className="px-2 py-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-ink/40">On sale</div>
          {r.sale ? (
            <>
              <div className={"figures mt-0.5 text-sm font-bold " + (r.final_gain >= 0 ? "text-pos" : "text-danger")}>{money(r.final_gain)}</div>
              <span className={"mt-0.5 inline-block rounded px-1 text-[9px] " + charTone[r.final_character]}>{charLabel(r.final_character, r.final_gain)}</span>
            </>
          ) : <div className="mt-0.5 text-xs text-ink/40">—</div>}
        </div>
      </div>

      {/* Badges */}
      {(r.self_employment_exposed || r.long_term_possible) && (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline px-3 py-1.5">
          {r.long_term_possible && <span className="rounded-full bg-pos/10 px-2 py-0.5 text-[9px] font-semibold text-pos">long-term rate</span>}
          {r.self_employment_exposed && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-600">+ SE tax (~15.3%)</span>}
        </div>
      )}

      <button onClick={onToggle} className="flex w-full items-center justify-center gap-1 border-t border-hairline py-1.5 text-[11px] font-semibold text-ink/50 hover:text-flag">
        Journal entries &amp; flags <ChevronDown size={13} className={"transition-transform " + (isOpen ? "rotate-180" : "")} />
      </button>

      {isOpen && (
        <div className="space-y-2.5 border-t border-hairline bg-paper/40 px-3 py-3">
          {r.acquisition.map((e, i) => <EntryTable key={"a" + i} title={`Acquisition · ${codeOf(e.entityId)}`} entry={e} />)}
          {r.sale && <EntryTable title={`Eventual sale · ${codeOf(r.sale.entityId)}`} entry={r.sale} />}
          {r.flags.length > 0 && (
            <ul className="space-y-1 pt-0.5">
              {r.flags.map((f, i) => (
                <li key={i} className="flex gap-1.5 text-[10px] leading-snug text-ink/60">
                  <AlertTriangle size={11} className="mt-px shrink-0 text-amber-600" /><span>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function EntryTable({ title, entry }: { title: string; entry: EntityEntry }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/45">{title}</div>
      <div className="overflow-hidden rounded-lg border border-hairline bg-white">
        {entry.lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2 border-b border-hairline px-2 py-1 text-[11px] last:border-0">
            <span className="flex-1 text-ink/70">{labelize(l.account)}</span>
            <span className="figures w-20 text-right text-ink">{l.debit ? money(l.debit) : ""}</span>
            <span className="figures w-20 text-right text-ink/60">{l.credit ? money(l.credit) : ""}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 bg-paper/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-ink/35">
          <span className="flex-1">Dr / Cr</span><span className="w-20 text-right">debit</span><span className="w-20 text-right">credit</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  CATEGORIES, categoryKind, ZONES, GRADERS, ACQUISITION_METHODS,
  PRICING_STRATEGY_OPTIONS, type Card,
} from "@/lib/cards/types";

const inputCls =
  "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";
const lblCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50";

export function CardForm({
  action,
  initial,
  submitLabel,
  locations = [],
  strategies = [...PRICING_STRATEGY_OPTIONS],
}: {
  action: (fd: FormData) => Promise<void>;
  initial?: Partial<Card>;
  submitLabel: string;
  locations?: string[];
  strategies?: { key: string; label: string }[];
}) {
  const [graded, setGraded] = useState(initial?.condition_type === "graded");
  const [cat, setCat] = useState(initial?.sport_category ?? "");
  const kind = categoryKind(cat);
  const tcg = kind === "tcg";
  const sports = CATEGORIES.filter((c) => c.kind === "sport");
  const tcgs = CATEGORIES.filter((c) => c.kind === "tcg");
  const others = CATEGORIES.filter((c) => c.kind === "other");

  return (
    <form action={action} className="mt-5 space-y-4">
      <section className="space-y-3 rounded-xl border border-hairline bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Identity</div>
        <label className="block">
          <span className={lblCls}>{tcg ? "Card name" : "Player / name"}</span>
          <input name="player" defaultValue={initial?.player ?? ""} className={inputCls}
            placeholder={tcg ? "e.g. Charizard ex" : "e.g. Patrick Mahomes"} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={lblCls}>Year</span>
            <input name="year" type="number" defaultValue={initial?.year ?? ""} className={inputCls + " figures"} placeholder="2020" />
          </label>
          <label className="block">
            <span className={lblCls}>Category</span>
            <select name="sport_category" value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
              <option value="">—</option>
              <optgroup label="Sports">
                {sports.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
              <optgroup label="Trading card games">
                {tcgs.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
              {others.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={lblCls}>{tcg ? "Set / expansion" : "Set"}</span>
            <input name="set_name" defaultValue={initial?.set_name ?? ""} className={inputCls}
              placeholder={tcg ? "e.g. Surging Sparks" : "Prizm"} />
          </label>
          <label className="block">
            <span className={lblCls}>Card #</span>
            <input name="card_number" defaultValue={initial?.card_number ?? ""} className={inputCls + " figures"} />
          </label>
          <label className="block">
            <span className={lblCls}>{tcg ? "Finish / parallel" : "Parallel"}</span>
            <input name="parallel" defaultValue={initial?.parallel ?? ""} className={inputCls}
              placeholder={tcg ? "Holo, Reverse Holo…" : "Silver"} />
          </label>
          {tcg ? (
            <label className="block">
              <span className={lblCls}>Rarity</span>
              <input name="rarity" defaultValue={initial?.rarity ?? ""} className={inputCls} placeholder="e.g. Illustration Rare" />
            </label>
          ) : (
            <label className="block">
              <span className={lblCls}>Team</span>
              <input name="team" defaultValue={initial?.team ?? ""} className={inputCls} />
            </label>
          )}
          {tcg ? (
            <label className="block">
              <span className={lblCls}>Language</span>
              <input name="language" defaultValue={initial?.language ?? "EN"} className={inputCls + " figures"} placeholder="EN" />
            </label>
          ) : (
            <label className="block">
              <span className={lblCls}>Brand</span>
              <input name="brand" defaultValue={initial?.brand ?? ""} className={inputCls} placeholder="Topps, Panini…" />
            </label>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-hairline bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Condition</div>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="condition_type" value="raw" defaultChecked={!graded} onChange={() => setGraded(false)} className="accent-[#E8590C]" /> Raw
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="condition_type" value="graded" defaultChecked={graded} onChange={() => setGraded(true)} className="accent-[#E8590C]" /> Graded
          </label>
        </div>
        {graded && (
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={lblCls}>Grader</span>
              <select name="grader" defaultValue={initial?.grader ?? ""} className={inputCls}>
                <option value="">—</option>
                {GRADERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={lblCls}>Grade</span>
              <input name="grade" type="number" step="0.5" defaultValue={initial?.grade ?? ""} className={inputCls + " figures"} />
            </label>
            <label className="block">
              <span className={lblCls}>Cert #</span>
              <input name="cert_number" defaultValue={initial?.cert_number ?? ""} className={inputCls + " figures"} />
            </label>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-hairline bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Basis · pricing · location</div>
        {initial?.purchase_lot_id ? (
          <p className="text-xs text-ink/50">
            Basis comes from this card&apos;s <b>purchase lot</b> (the lot&apos;s current average at sale time).
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={lblCls}>
              Total Cost Basis $ <span className="font-normal normal-case tracking-normal text-ink/40">
                {initial ? "— leave blank to keep it as it is" : "— optional; add grading and other costs on the card page"}
              </span>
            </span>
            <input name="individual_basis" type="number" step="0.01" min="0"
              defaultValue={initial?.individual_basis ?? ""} className={inputCls + " figures"} />
          </label>
          <label className="block">
            <span className={lblCls}>Market value $</span>
            <input name="market_value" type="number" step="0.01" defaultValue={initial?.market_value ?? ""} className={inputCls + " figures"} />
          </label>
          <label className="block">
            <span className={lblCls}>Pricing strategy</span>
            <select name="pricing_strategy" defaultValue={initial?.pricing_strategy ?? "standard"} className={inputCls}>
              {strategies.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={lblCls}>Acquisition</span>
            <select name="acquisition_method" defaultValue={initial?.acquisition_method ?? ""} className={inputCls}>
              <option value="">—</option>
              {ACQUISITION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={lblCls}>Zone</span>
            <select name="zone" defaultValue={initial?.zone ?? ""} className={inputCls}>
              <option value="">—</option>
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={lblCls}>Location code</span>
            <input name="location_code" defaultValue={initial?.location_code ?? ""} className={inputCls + " figures"} placeholder="GR-12-C-03" />
          </label>
          <label className="col-span-2 block">
            <span className={lblCls}>Storage location (pick or type a new one)</span>
            <input name="storage_location" list="storage-locations" defaultValue={initial?.storage_location ?? ""}
              className={inputCls} placeholder="e.g. Black shelf · Box 3" />
            <datalist id="storage-locations">
              {locations.map((l) => <option key={l} value={l} />)}
            </datalist>
          </label>
          <label className="block">
            <span className={lblCls}>Status</span>
            {/* Read-only: status is a transition (sell/unsell/archive/list), not an editable field. */}
            <input value={initial?.status ?? "booked"} readOnly disabled className={`${inputCls} opacity-60`} />
            <span className="mt-1 block text-[10px] text-ink/40">Changes via the sell flow, archive, or listing actions.</span>
          </label>
        </div>
        <label className="block">
          <span className={lblCls}>Notes</span>
          <input name="notes" defaultValue={initial?.notes ?? ""} className={inputCls} />
        </label>
      </section>

      <button type="submit" className="w-full rounded-xl bg-flag py-3 font-bold text-white transition active:scale-95">
        {submitLabel}
      </button>
    </form>
  );
}

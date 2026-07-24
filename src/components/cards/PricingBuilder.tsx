"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Sparkles, Dices, Save, SaveAll, FilePlus, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import type { PipelineV1 } from "@/lib/cards/valuation";
import { savePricingTemplate, deletePricingTemplate, type PricingTemplate } from "@/app/cards/pricing/actions";
import { estimateCost, costFill, normalizeEstimate, type EstimateConfig, type CostBand } from "@/lib/cards/credits";

const inp = "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-flag";
const lbl = "mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink/50";

const SOURCES = ["manual", "cardladder", "ebay", "pricecharting", "auction"];
const AGG_LABELS: Record<string, string> = {
  median: "Median", mean: "Average", trimmed_mean: "Trimmed average",
  wavg_recency: "Recency-weighted avg", last_sale: "Most recent sale", min: "Lowest", max: "Highest",
};

type LockKey =
  | "name" | "tags" | "window" | "last_n" | "top_n" | "min_comps" | "scope"
  | "drop_top" | "drop_bottom" | "iqr" | "aggregate" | "multiplier" | "round";

type Form = {
  name: string; desc: string; tags: string; keywords: string;
  sources: string[];
  scope: string; grade_delta: string; grade_companies: string[];
  window_days: string; last_n: string; top_n: string; min_comps: string;
  drop_top: string; drop_bottom: string; iqr: string;
  aggregate: string; trim_pct: string; half_life: string;
  multiplier: string; round_99: boolean;
  est_mode: string; est_comparables: boolean; est_news: boolean; est_macro: boolean; est_pop: boolean; est_ai: string;
};

const EMPTY: Form = {
  name: "", desc: "", tags: "", keywords: "", sources: [],
  scope: "raw", grade_delta: "0", grade_companies: [],
  window_days: "90", last_n: "", top_n: "", min_comps: "3",
  drop_top: "", drop_bottom: "", iqr: "1.5",
  aggregate: "median", trim_pct: "0.1", half_life: "30",
  multiplier: "", round_99: false,
  est_mode: "off", est_comparables: true, est_news: false, est_macro: true, est_pop: false, est_ai: "light",
};

function formToEstimate(f: Form): EstimateConfig {
  if (f.est_mode !== "standard_plus" && f.est_mode !== "all_sales_plus") return { mode: "off" };
  return { mode: f.est_mode, comparables: f.est_comparables, news: f.est_news, macro: f.est_macro, pop: f.est_pop, ai: f.est_ai === "deep" ? "deep" : "light" };
}

const BAND_TONE: Record<CostBand, string> = { none: "bg-ink/20", low: "bg-pos", medium: "bg-amber-500", high: "bg-danger" };
function CreditBar({ config, showLabel = true }: { config: EstimateConfig; showLabel?: boolean }) {
  const { credits, band } = estimateCost(config);
  const pct = credits > 0 ? Math.max(costFill(credits) * 100, 8) : 0;
  return (
    <div className="flex items-center gap-1.5" title={`${credits} credits per estimate run`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div className={"h-full rounded-full " + BAND_TONE[band]} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="figures shrink-0 text-[9px] font-semibold text-ink/50">{credits ? `${credits} cr` : "free"}</span>}
    </div>
  );
}

const GRADE_COMPANIES = ["PSA", "BGS", "SGC", "CGC"];

// Built-in seeds have no params pipeline — mirror the legacy engine exactly so
// "duplicate" starts from the real behavior, not blank defaults (day-review).
const LEGACY_PIPELINES: Record<string, PipelineV1> = {
  standard: { window_days: null, aggregate: { fn: "trimmed_mean", trim_pct: 0.1 } },
  conservative: { window_days: null, aggregate: { fn: "min" }, adjust: { multiplier: 1.05 } },
  aggressive: { window_days: null, aggregate: { fn: "max" }, adjust: { multiplier: 0.95 } },
  hot: { window_days: null, aggregate: { fn: "max" }, adjust: { multiplier: 1.1 } },
  thin_market: { window_days: null, aggregate: { fn: "mean" }, adjust: { multiplier: 1.2 } },
  manual_lock: { window_days: null, aggregate: { fn: "median" } },
};

// Snap a loaded value to the nearest legal <select> option so the form always
// SHOWS what will be saved (off-list values rendered as blank while silently
// persisting — day-review).
function nearest(options: number[], v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "";
  const n = Number(v);
  return String(options.reduce((b, o) => (Math.abs(o - n) < Math.abs(b - n) ? o : b)));
}
const OPT = {
  window: [7, 30, 60, 90, 180, 365, 730, 1095],
  last_n: [3, 5, 8, 10, 15, 20, 30, 50, 100, 150, 200],
  top_n: [3, 5, 8, 10],
  min_comps: [1, 2, 3, 4, 5, 8, 10],
  iqr: [1.5, 2, 3],
  drop: [0.05, 0.1, 0.15, 0.2],
  trim: [0.05, 0.1, 0.15, 0.2, 0.25],
  half_life: [7, 14, 21, 30, 45, 60, 90],
  delta: [0, 0.5, 1, 1.5, 2],
};

// Elementary field guide — shown under every control.
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px] leading-snug text-ink/35">{children}</p>;
}

function numOr(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

function formToPipeline(f: Form): PipelineV1 {
  return {
    sources: f.sources.length ? f.sources : null,
    comp_scope: f.scope === "own_grade" || f.scope === "cross_grade" ? (f.scope as "own_grade" | "cross_grade") : undefined,
    grade_delta: f.scope !== "raw" ? numOr(f.grade_delta) ?? 0 : undefined,
    grade_companies: f.scope === "cross_grade" && f.grade_companies.length ? f.grade_companies : undefined,
    window_days: f.window_days === "" ? null : Number(f.window_days),
    last_n: f.last_n === "" ? null : Number(f.last_n),
    top_n: f.top_n === "" ? null : Number(f.top_n),
    min_comps: numOr(f.min_comps) ?? 1,
    guards: {
      drop_top_pct: numOr(f.drop_top),
      drop_bottom_pct: numOr(f.drop_bottom),
      iqr_k: numOr(f.iqr),
    },
    aggregate: {
      fn: (f.aggregate || "median") as NonNullable<PipelineV1["aggregate"]>["fn"],
      trim_pct: f.aggregate === "trimmed_mean" ? numOr(f.trim_pct) : undefined,
      half_life_days: f.aggregate === "wavg_recency" ? numOr(f.half_life) : undefined,
    },
    adjust: { multiplier: numOr(f.multiplier), round_99: f.round_99 },
  };
}

function pipelineToForm(p: PipelineV1 | undefined, base: Form): Form {
  if (!p) return base;
  return {
    ...base,
    sources: p.sources ?? [],
    scope: p.comp_scope ?? "raw",
    grade_delta: p.grade_delta != null ? nearest(OPT.delta, p.grade_delta) || "0" : "0",
    grade_companies: p.grade_companies ?? [],
    window_days: p.window_days == null ? "" : nearest(OPT.window, p.window_days),
    last_n: p.last_n == null ? "" : nearest(OPT.last_n, p.last_n),
    top_n: p.top_n == null ? "" : nearest(OPT.top_n, p.top_n),
    min_comps: nearest(OPT.min_comps, p.min_comps ?? 1) || "1",
    drop_top: p.guards?.drop_top_pct != null ? nearest(OPT.drop, p.guards.drop_top_pct) : "",
    drop_bottom: p.guards?.drop_bottom_pct != null ? nearest(OPT.drop, p.guards.drop_bottom_pct) : "",
    iqr: p.guards?.iqr_k != null ? nearest(OPT.iqr, p.guards.iqr_k) : "",
    aggregate: p.aggregate?.fn ?? "median",
    trim_pct: p.aggregate?.trim_pct != null ? nearest(OPT.trim, p.aggregate.trim_pct) || "0.1" : "0.1",
    half_life: p.aggregate?.half_life_days != null ? nearest(OPT.half_life, p.aggregate.half_life_days) || "30" : "30",
    multiplier: p.adjust?.multiplier != null ? String(p.adjust.multiplier) : "",
    round_99: !!p.adjust?.round_99,
  };
}

export function PricingBuilder({ templates }: { templates: PricingTemplate[] }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [locks, setLocks] = useState<Set<LockKey>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [loadedTitle, setLoadedTitle] = useState<string | null>(null); // the loaded template's name (for prompts)
  const [dirty, setDirty] = useState(false); // unsaved edits since load/save
  const [busy, setBusy] = useState<null | "ai" | "random" | "save" | "saveAs">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  // Warn before discarding unsaved edits to a template you loaded.
  const confirmDiscard = () => !(dirty && loadedTitle) || window.confirm(`Leave without saving changes to "${loadedTitle}"?`);

  // Catch a tab close / refresh with unsaved edits (browsers show a generic prompt).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const locked = (k: LockKey) => locks.has(k);
  const toggleLock = (k: LockKey) =>
    setLocks((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  function LockBtn({ k }: { k: LockKey }) {
    const on = locked(k);
    return (
      <button
        type="button"
        onClick={() => toggleLock(k)}
        title={on ? "Locked — re-rolls keep this value" : "Unlocked — re-rolls may change this"}
        className={"rounded p-0.5 " + (on ? "text-flag" : "text-ink/25 hover:text-ink/50")}
      >
        {on ? <Lock size={12} /> : <LockOpen size={12} />}
      </button>
    );
  }

  function loadTemplate(t: PricingTemplate, asCopy: boolean) {
    if (!confirmDiscard()) return;
    // Built-ins carry no pipeline — load the legacy-equivalent so a copy
    // starts from the real behavior.
    const pipeline = t.params?.pipeline ?? LEGACY_PIPELINES[t.key];
    const next = pipelineToForm(pipeline, { ...EMPTY });
    next.name = asCopy ? `${t.label} copy` : t.label;
    next.tags = (t.params?.meta?.tags ?? []).join(", ");
    next.desc = t.params?.meta?.desc ?? "";
    const est = normalizeEstimate(t.params?.estimate);
    next.est_mode = est.mode; next.est_comparables = !!est.comparables; next.est_news = !!est.news;
    next.est_macro = !!est.macro; next.est_pop = !!est.pop; next.est_ai = est.ai ?? "light";
    setForm(next);
    setEditingKey(asCopy ? null : t.key);
    setLoadedTitle(asCopy ? null : t.label);
    setLocks(new Set());
    setDirty(false);
    setMsg(null);
  }

  function reset(silent = false) {
    if (!silent && !confirmDiscard()) return;
    setForm(EMPTY); setEditingKey(null); setLoadedTitle(null); setLocks(new Set()); setDirty(false); setMsg(null);
  }

  async function remove(t: PricingTemplate) {
    if (!window.confirm(`Delete "${t.label}"? This can't be undone.`)) return;
    const res = await deletePricingTemplate(t.key);
    if (!res.ok) { setMsg({ kind: "err", text: res.error ?? "Delete failed." }); return; }
    if (editingKey === t.key) reset(true);
    setMsg({ kind: "ok", text: `Deleted "${t.label}".` });
    router.refresh();
  }

  // Only the LOCKED fields travel to the generator — everything else is fair game.
  function lockedPayload(): Partial<PipelineV1> & { label?: string } {
    const p = formToPipeline(form);
    const out: Partial<PipelineV1> & { label?: string } = {};
    // IMPORTANT (day-review): a locked field whose value is "off/none/raw"
    // must pin as explicit null — `undefined` vanishes in JSON and the lock
    // would silently do nothing.
    type Loose = Record<string, unknown>;
    const o = out as Loose;
    if (locked("name") && form.name.trim()) out.label = form.name.trim();
    if (form.sources.length) out.sources = form.sources; // chosen sources always stick
    if (locked("window")) o.window_days = p.window_days ?? null;
    if (locked("last_n")) o.last_n = p.last_n ?? null;
    if (locked("top_n")) o.top_n = p.top_n ?? null;
    if (locked("scope")) {
      o.comp_scope = p.comp_scope ?? "raw";
      o.grade_delta = p.grade_delta ?? null;
      o.grade_companies = p.grade_companies ?? null;
    }
    if (locked("min_comps")) o.min_comps = p.min_comps ?? 1;
    const guards: Loose = {};
    if (locked("drop_top")) guards.drop_top_pct = p.guards?.drop_top_pct ?? null;
    if (locked("drop_bottom")) guards.drop_bottom_pct = p.guards?.drop_bottom_pct ?? null;
    if (locked("iqr")) guards.iqr_k = p.guards?.iqr_k ?? null;
    if (Object.keys(guards).length) o.guards = guards;
    if (locked("aggregate")) o.aggregate = p.aggregate ?? { fn: "median" };
    const adjust: Loose = {};
    if (locked("multiplier")) adjust.multiplier = p.adjust?.multiplier ?? null;
    if (locked("round")) adjust.round_99 = p.adjust?.round_99 ?? false;
    if (Object.keys(adjust).length) o.adjust = adjust;
    return out;
  }

  async function generate(mode: "ai" | "random") {
    setBusy(mode);
    setMsg(null);
    try {
      const r = await fetch("/api/cards/pricing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          locked: lockedPayload(),
          keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Generation failed.");
      const next = pipelineToForm(d.pipeline as PipelineV1, { ...form });
      if (!locked("name")) next.name = d.label ?? next.name;
      if (!locked("tags")) next.tags = (d.tags ?? []).join(", ");
      next.desc = d.desc ?? next.desc;
      // keywords + sources are yours; generation NEVER touches them (an empty
      // sources list means "all" and must stay empty — day-review).
      next.keywords = form.keywords;
      next.sources = form.sources;
      setForm(next);
      setDirty(true);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Generation failed." });
    } finally {
      setBusy(null);
    }
  }

  async function save(mode: "over" | "as") {
    // "over" saves onto the loaded template; "as" always creates a NEW one.
    if (mode === "over" && editingKey && loadedTitle && !window.confirm(`Save over "${loadedTitle}"?`)) return;
    setBusy(mode === "as" ? "saveAs" : "save");
    setMsg(null);
    const res = await savePricingTemplate({
      key: mode === "as" ? null : editingKey,
      name: form.name,
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      desc: form.desc,
      pipeline: formToPipeline(form),
      estimate: formToEstimate(form),
    });
    setBusy(null);
    if (!res.ok) {
      setMsg({ kind: "err", text: res.error ?? "Save failed." });
      return;
    }
    setEditingKey(res.key ?? null);
    setLoadedTitle(form.name.trim() || loadedTitle);
    setDirty(false);
    setMsg({ kind: "ok", text: mode === "as" ? "Saved as a new format — it's in every pricing picker." : "Saved — it's now in every pricing picker." });
    router.refresh();
  }

  const summary = (t: PricingTemplate): string => {
    const p = t.params?.pipeline;
    if (!p) return "built-in engine rule";
    const bits = [
      p.aggregate?.fn ? AGG_LABELS[p.aggregate.fn] ?? p.aggregate.fn : "median",
      p.window_days != null ? `${p.window_days}d` : "all-time",
      p.last_n != null ? `last ${p.last_n}` : null,
      p.adjust?.multiplier != null && p.adjust.multiplier !== 1 ? `×${p.adjust.multiplier}` : null,
    ].filter(Boolean);
    return bits.join(" · ");
  };

  return (
    <div className="mt-5 space-y-4">
      {/* Saved formats */}
      <section className="overflow-hidden rounded-xl border border-hairline bg-white">
        {templates.map((t) => (
          <div key={t.key} className="flex items-center gap-2 border-b border-hairline px-3 py-2.5 last:border-b-0">
            <button
              onClick={() => loadTemplate(t, t.builtin)}
              className="min-w-0 flex-1 text-left"
              title={t.builtin ? "Built-in — loads as a copy" : "Edit this format"}
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink">{t.label}</span>
                {t.builtin && <span className="figures rounded bg-ink/10 px-1 py-px text-[9px] font-bold text-ink/50">built-in</span>}
              </span>
              <span className="figures block truncate text-[11px] text-ink/45">{summary(t)}</span>
              <span className="mt-1 flex items-center gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-ink/30">credits</span>
                <span className="w-24"><CreditBar config={normalizeEstimate(t.params?.estimate)} /></span>
              </span>
              {(t.params?.meta?.tags?.length ?? 0) > 0 && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {t.params!.meta!.tags!.map((tag) => (
                    <span key={tag} className="figures rounded bg-flag/12 px-1 py-px text-[9px] font-bold text-flag">{tag}</span>
                  ))}
                </span>
              )}
            </button>
            {!t.builtin ? (
              <button
                onClick={() => remove(t)}
                title="Delete this format"
                className="shrink-0 rounded-lg p-1.5 text-ink/40 hover:bg-paper hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <span className="w-[30px] shrink-0" aria-hidden />
            )}
          </div>
        ))}
      </section>

      {/* Builder */}
      <section className="space-y-3 rounded-2xl border border-hairline bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
            {editingKey ? "Edit format" : "Format"}
            {loadedTitle && <span className="ml-2 normal-case tracking-normal text-ink/40">· {loadedTitle}{dirty ? " · unsaved" : ""}</span>}
          </span>
          <button onClick={() => reset()} className="flex items-center gap-1 rounded-lg border border-hairline bg-white px-2 py-1 text-[11px] font-semibold text-ink/60 hover:text-flag">
            <FilePlus size={12} /> Create new
          </button>
        </div>

        <label className="block">
          <span className={lbl}>Name <LockBtn k="name" /></span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} className={inp} placeholder="e.g. Patient Vintage Median" />
        </label>

        {/* Which sales count as evidence */}
        <div className="rounded-xl border border-hairline bg-paper/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
            Which sales count <LockBtn k="scope" />
          </div>
          <select value={form.scope} onChange={(e) => set({ scope: e.target.value })} className={inp}>
            <option value="raw">Ungraded (raw) sales</option>
            <option value="own_grade">Same company &amp; grade as the card</option>
            <option value="cross_grade">Same grade number from other companies</option>
          </select>
          <Hint>
            Raw = ungraded sales only (the default). Same company &amp; grade = a PSA 9 card only counts PSA 9 sales.
            Other companies = borrow the same grade number from any grader — with wiggle room below.
          </Hint>
          {form.scope !== "raw" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className={lbl}>Grade wiggle (±)</span>
                <select value={form.grade_delta} onChange={(e) => set({ grade_delta: e.target.value })} className={inp}>
                  <option value="0">Exact grade only</option>
                  <option value="0.5">± 0.5</option>
                  <option value="1">± 1</option>
                  <option value="1.5">± 1.5</option>
                  <option value="2">± 2</option>
                </select>
                <Hint>How far from the card&apos;s own grade a sale may be and still count — ±0.5 lets a 9.5 speak for a 9.</Hint>
              </label>
              {form.scope === "cross_grade" && (
                <div>
                  <span className={lbl.replace("justify-between", "")}>Companies (none = any)</span>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {GRADE_COMPANIES.map((g) => (
                      <label key={g} className="flex items-center gap-1 rounded-full border border-hairline bg-white px-2 py-0.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={form.grade_companies.includes(g)}
                          onChange={(e) =>
                            set({ grade_companies: e.target.checked ? [...form.grade_companies, g] : form.grade_companies.filter((x) => x !== g) })
                          }
                          className="h-3 w-3 accent-[#c9a227]"
                        />
                        {g}
                      </label>
                    ))}
                  </div>
                  <Hint>Only these graders&apos; sales are borrowed. Leave all unchecked to accept any graded sale.</Hint>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={lbl}>Look-back window <LockBtn k="window" /></span>
            <select value={form.window_days} onChange={(e) => set({ window_days: e.target.value })} className={inp}>
              <option value="">All-time</option>
              {[7, 30, 60, 90, 180, 365, 730, 1095].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <Hint>How far back to look. Short = follows the market fast; long or all-time = steadier, better for cards that rarely sell.</Hint>
          </label>
          <label className="block">
            <span className={lbl}>Use last N sales <LockBtn k="last_n" /></span>
            <select value={form.last_n} onChange={(e) => set({ last_n: e.target.value })} className={inp}>
              <option value="">All in window</option>
              {[3, 5, 8, 10, 15, 20, 30, 50, 100, 150, 200].map((n) => <option key={n} value={n}>last {n}</option>)}
            </select>
            <Hint>Keep only the most RECENT n sales from the window.</Hint>
          </label>
          <label className="block">
            <span className={lbl}>Keep N highest <LockBtn k="top_n" /></span>
            <select value={form.top_n} onChange={(e) => set({ top_n: e.target.value })} className={inp}>
              <option value="">Off</option>
              {[3, 5, 8, 10].map((n) => <option key={n} value={n}>highest {n}</option>)}
            </select>
            <Hint>Then keep only the n PRICIEST. &quot;Average of the 5 highest ever&quot; = All-time window + highest 5 + Average.</Hint>
          </label>
          <label className="block">
            <span className={lbl}>Aggregate <LockBtn k="aggregate" /></span>
            <select value={form.aggregate} onChange={(e) => set({ aggregate: e.target.value })} className={inp}>
              {Object.entries(AGG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Hint>How the surviving sales become ONE number. Median ignores freak sales; recency-weighted leans on the newest.</Hint>
          </label>
          {form.aggregate === "trimmed_mean" && (
            <label className="block">
              <span className={lbl}>Trim each side</span>
              <select value={form.trim_pct} onChange={(e) => set({ trim_pct: e.target.value })} className={inp}>
                {["0.05", "0.1", "0.15", "0.2", "0.25"].map((p) => <option key={p} value={p}>{Number(p) * 100}%</option>)}
              </select>
              <Hint>Shave this share off BOTH ends before averaging.</Hint>
            </label>
          )}
          {form.aggregate === "wavg_recency" && (
            <label className="block">
              <span className={lbl}>Half-life</span>
              <select value={form.half_life} onChange={(e) => set({ half_life: e.target.value })} className={inp}>
                {[7, 14, 21, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
              <Hint>A sale this many days old counts half as much as one from today.</Hint>
            </label>
          )}
          <label className="block">
            <span className={lbl}>Min sales required <LockBtn k="min_comps" /></span>
            <select value={form.min_comps} onChange={(e) => set({ min_comps: e.target.value })} className={inp}>
              {[1, 2, 3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <Hint>Fewer surviving sales than this and the format ABSTAINS — the card keeps its previous or manual value instead of guessing.</Hint>
          </label>
        </div>

        <div className="rounded-xl border border-hairline bg-paper/60 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Guards — toss suspect sales</div>
          <Hint>These protect the number from shill bids, $1 lowballs, and one-off freak sales before anything gets averaged.</Hint>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className={lbl}>Outlier fence <LockBtn k="iqr" /></span>
              <select value={form.iqr} onChange={(e) => set({ iqr: e.target.value })} className={inp}>
                <option value="">Off</option>
                <option value="1.5">Classic (1.5)</option>
                <option value="2">Loose (2)</option>
                <option value="3">Very loose (3)</option>
              </select>
            </label>
            <label className="block">
              <span className={lbl}>Drop highest <LockBtn k="drop_top" /></span>
              <select value={form.drop_top} onChange={(e) => set({ drop_top: e.target.value })} className={inp}>
                <option value="">None</option>
                {["0.05", "0.1", "0.15", "0.2"].map((p) => <option key={p} value={p}>{Number(p) * 100}%</option>)}
              </select>
            </label>
            <label className="block">
              <span className={lbl}>Drop lowest <LockBtn k="drop_bottom" /></span>
              <select value={form.drop_bottom} onChange={(e) => set({ drop_bottom: e.target.value })} className={inp}>
                <option value="">None</option>
                {["0.05", "0.1", "0.15", "0.2"].map((p) => <option key={p} value={p}>{Number(p) * 100}%</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={lbl}>Final multiplier <LockBtn k="multiplier" /></span>
            <input value={form.multiplier} onChange={(e) => set({ multiplier: e.target.value })} type="number" step="0.01" min="0.5" max="2" placeholder="1.00" className={inp + " figures"} />
            <Hint>The last nudge: 0.97 prices 3% under the computed number (sells faster); 1.08 prices 8% over (scarcity premium).</Hint>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={form.round_99} onChange={(e) => set({ round_99: e.target.checked })} className="h-4 w-4 accent-[#c9a227]" />
            Round to .99 <LockBtn k="round" />
          </label>
        </div>

        <div>
          <div className={lbl.replace("justify-between", "")}>Comp sources (none checked = all)</div>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={form.sources.includes(s)}
                  onChange={(e) =>
                    set({ sources: e.target.checked ? [...form.sources, s] : form.sources.filter((x) => x !== s) })
                  }
                  className="h-3.5 w-3.5 accent-[#c9a227]"
                />
                {s}
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={lbl}>Suitability tags <LockBtn k="tags" /></span>
          <input value={form.tags} onChange={(e) => set({ tags: e.target.value })} className={inp} placeholder="low population, vintage, numbered…" />
        </label>

        <label className="block">
          <span className={lbl}>Describe the template you want</span>
          <textarea value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} rows={2} className={inp}
            placeholder="e.g. for low-pop vintage that rarely sells — lean on all-time sales, protect from lowballs, price a touch high for scarcity" />
          <Hint>Write what you&apos;re going for, then hit ✨ AI fill and it builds the format toward it. Your words are never overwritten.</Hint>
        </label>

        {/* Estimate layer — the AI valuation this template runs (credit-metered) */}
        <div className="rounded-xl border border-hairline bg-paper/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Estimate layer · AI</span>
            <span className="w-28"><CreditBar config={formToEstimate(form)} /></span>
          </div>
          <select value={form.est_mode} onChange={(e) => set({ est_mode: e.target.value })} className={inp}>
            <option value="off">Off — pricing math only (free)</option>
            <option value="standard_plus">A · Standard + context — adjust this template&apos;s price</option>
            <option value="all_sales_plus">B · All sales + context — ignore the math, read every sale</option>
          </select>
          <Hint>An estimate blends sales with comparables + market context for hard-to-price cards. It spends credits per run — the bar shows how much.</Hint>
          {form.est_mode !== "off" && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {([["est_comparables", "Comparables"], ["est_macro", "Market"], ["est_news", "Player news"], ["est_pop", "Scarcity"]] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1 rounded-full border border-hairline bg-white px-2 py-0.5 text-[11px]">
                    <input type="checkbox" checked={form[k] as boolean} onChange={(e) => set({ [k]: e.target.checked } as Partial<Form>)} className="h-3 w-3 accent-flag" /> {label}
                  </label>
                ))}
              </div>
              <label className="block">
                <span className={lbl.replace("justify-between", "")}>AI depth</span>
                <select value={form.est_ai} onChange={(e) => set({ est_ai: e.target.value })} className={inp}>
                  <option value="light">Light — fast, cheap</option>
                  <option value="deep">Deep — most thorough, costs more</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {form.desc && <p className="text-[11px] italic text-ink/50">{form.desc}</p>}
        {msg && (
          <p className={"flex items-center gap-1.5 text-xs " + (msg.kind === "ok" ? "text-pos" : "text-danger")}>
            {msg.kind === "ok" && <CheckCircle2 size={13} />} {msg.text}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={() => generate("ai")} disabled={busy !== null}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-flag py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busy === "ai" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} AI fill
          </button>
          <button onClick={() => generate("random")} disabled={busy !== null}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-flag py-2.5 text-sm font-bold text-flag disabled:opacity-50">
            {busy === "random" ? <Loader2 size={15} className="animate-spin" /> : <Dices size={15} />} Roll
          </button>
        </div>
        {/* Save = overwrite the loaded format · Save as new = a fresh one */}
        <div className="flex gap-2">
          <button onClick={() => save("over")} disabled={busy !== null || !form.name.trim() || !editingKey}
            title={editingKey ? `Save over "${loadedTitle}"` : "Load a saved format to Save over it"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-flag py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </button>
          <button onClick={() => save("as")} disabled={busy !== null || !form.name.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-flag py-2.5 text-sm font-bold text-flag disabled:opacity-50">
            {busy === "saveAs" ? <Loader2 size={15} className="animate-spin" /> : <SaveAll size={15} />} Save as new
          </button>
        </div>
        <p className="text-[10px] leading-snug text-ink/35">
          🔒 locked fields and your description survive every re-roll. <b>Save</b> overwrites the format you loaded; <b>Save as new</b> makes a fresh one.
        </p>
      </section>
    </div>
  );
}

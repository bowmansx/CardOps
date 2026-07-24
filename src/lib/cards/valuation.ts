// CardOps valuation (contract §5) — pure functions, no I/O, server+client safe.
// Grade ladder: every cell is "actual" (from ≥3 comps) or "modeled"
// (raw_value × grade multiplier) and always carries that tag + a confidence.

export type Comp = {
  grader: string | null;
  grade: number | null;
  sale_price: number | null;
  sale_date: string | null;
  source: string;
};
export type Multiplier = { grader: string; grade: number; era_bucket: string; multiplier: number };

export type LadderCell = {
  grader: string;
  grade: number;
  value: number | null;
  basis_source: "actual" | "modeled";
  comp_count: number;
};

const ACTUAL_MIN_COMPS = 3;

export function eraOf(year: number | null | undefined): "modern" | "vintage" {
  return (year ?? 2000) >= 1986 ? "modern" : "vintage";
}

function isRaw(c: Comp): boolean {
  return (c.grader ?? "RAW").toUpperCase() === "RAW";
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function trimmedMean(xs: number[], pct: number): number {
  if (xs.length < 4) return mean(xs);
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * pct);
  const t = s.slice(k, s.length - k);
  return mean(t.length ? t : s);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

type CardLite = {
  year: number | null;
  manual_price: number | null;
  market_value: number | null;
  price_locked: boolean;
  pricing_strategy: string;
  landed_cost: number | null;
  grader?: string | null;   // graded-scope pipelines anchor on these
  grade?: number | null;
};

/** As-is (raw) value: actual raw comps if present, else a manual/prior value. */
export function rawValue(card: CardLite, comps: Comp[]): number | null {
  const raw = comps.filter((c) => isRaw(c) && c.sale_price != null).map((c) => c.sale_price as number);
  if (raw.length) return round2(trimmedMean(raw, 0.1));
  return card.manual_price ?? card.market_value ?? null;
}

/** Apply the card's pricing strategy to its raw comp sale prices. */
export function applyStrategy(strategy: string, prices: number[], manual: number | null): number | null {
  if (strategy === "manual_lock") return manual;
  if (!prices.length) return null;
  const min = Math.min(...prices), max = Math.max(...prices);
  switch (strategy) {
    case "conservative": return round2(min * 1.05);
    case "aggressive": return round2(max * 0.95);
    case "hot": return round2(max * 1.1);
    case "thin_market": return round2(mean(prices) * 1.2);
    case "standard":
    default: return round2(trimmedMean(prices, 0.1));
  }
}

/** Market value for the card's own condition, per its strategy. */
export function marketValue(card: CardLite, comps: Comp[]): number | null {
  if (card.price_locked && card.manual_price != null) return card.manual_price;
  const raw = comps.filter((c) => isRaw(c) && c.sale_price != null).map((c) => c.sale_price as number);
  const v = applyStrategy(card.pricing_strategy, raw, card.manual_price);
  return v ?? card.manual_price ?? card.market_value ?? null;
}

// ── Custom pricing pipelines (builder v1) ───────────────────────────────────
// A user-authored strategy stores { v: 1, pipeline } in
// card_pricing_strategies.params. The interpreter runs the comp pool through
// SOURCES → WINDOW → LAST-N → GUARDS → MIN-COMPS → AGGREGATE → ADJUST.
// Legacy keys (params without v) keep the exact switch above.
export type PipelineGuards = {
  drop_top_pct?: number;
  drop_bottom_pct?: number;
  iqr_k?: number;         // fence multiplier; 1.5 = classic outlier fence
  abs_min?: number;
  abs_max?: number;
};
export type PipelineAggregate = {
  fn: "mean" | "median" | "trimmed_mean" | "wavg_recency" | "last_sale" | "min" | "max";
  trim_pct?: number;        // trimmed_mean
  half_life_days?: number;  // wavg_recency
};
export type PipelineV1 = {
  sources?: string[] | null;      // card_comps.source filter; empty/null = all
  comp_scope?: "raw" | "own_grade" | "cross_grade";
  //   raw        = ungraded sales only (default, legacy behavior)
  //   own_grade  = sales of the card's own grader+grade (± grade_delta)
  //   cross_grade= same grade value from OTHER/selected companies (± delta)
  grade_companies?: string[] | null; // cross_grade: which graders count; empty = any graded
  grade_delta?: number;              // ± grades around the card's own grade (0 = exact)
  window_days?: number | null;    // null = all-time (null-date comps only pass then)
  last_n?: number | null;         // keep newest N survivors
  top_n?: number | null;          // then keep the N HIGHEST-priced ("avg of 5 highest ever")
  min_comps?: number;             // fewer survivors ⇒ null (falls back)
  guards?: PipelineGuards;
  aggregate?: PipelineAggregate;
  adjust?: { multiplier?: number; round_99?: boolean };
};
export type PipelineContext = { grader?: string | null; grade?: number | null };
export type StrategyParams = {
  v?: number;
  pipeline?: PipelineV1;
  meta?: { tags?: string[]; desc?: string };
  estimate?: import("./credits").EstimateConfig; // AI estimate layer (credit-metered)
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quartile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function interpretPipeline(
  comps: Comp[],
  p: PipelineV1,
  ctx?: PipelineContext,
  now = Date.now(),
): number | null {
  // Comp scope: which sales even count as evidence for THIS card.
  const scope = p.comp_scope ?? "raw";
  const delta = p.grade_delta ?? 0;
  let pool: Comp[];
  // Float-safe boundary: a comp exactly delta apart must count (9.5 vs 9 ± 0.5).
  const inDelta = (g: unknown) => Math.abs(Number(g) - ctx!.grade!) <= delta + 1e-9;
  if (scope === "own_grade" && ctx?.grader && ctx.grade != null) {
    pool = comps.filter(
      (c) =>
        c.sale_price != null &&
        (c.grader ?? "").toUpperCase() === ctx.grader!.toUpperCase() &&
        c.grade != null &&
        inDelta(c.grade),
    );
  } else if (scope === "cross_grade" && ctx?.grade != null) {
    const companies = (p.grade_companies ?? []).map((s) => s.toUpperCase());
    pool = comps.filter(
      (c) =>
        c.sale_price != null &&
        !isRaw(c) &&
        c.grade != null &&
        inDelta(c.grade) &&
        (companies.length ? companies.includes((c.grader ?? "").toUpperCase()) : true),
    );
  } else {
    // raw scope — and the safe fallback when a graded scope is picked for a
    // card that has no grade to anchor on.
    pool = comps.filter((c) => isRaw(c) && c.sale_price != null);
  }
  if (p.sources && p.sources.length) pool = pool.filter((c) => p.sources!.includes(c.source));
  if (p.window_days != null) {
    const cut = now - p.window_days * 86_400_000;
    // Comps with no sale date only qualify when there's no window at all.
    pool = pool.filter((c) => c.sale_date != null && new Date(c.sale_date).getTime() >= cut);
  }
  pool = [...pool].sort(
    (a, b) =>
      (b.sale_date ? new Date(b.sale_date).getTime() : -Infinity) -
      (a.sale_date ? new Date(a.sale_date).getTime() : -Infinity),
  );
  if (p.last_n != null && p.last_n > 0) pool = pool.slice(0, p.last_n);
  if (p.top_n != null && p.top_n > 0) {
    // "Average of the N highest" — keep the priciest N of whatever survived.
    pool = [...pool].sort((a, b) => (b.sale_price as number) - (a.sale_price as number)).slice(0, p.top_n);
  }

  let entries = pool.map((c) => ({ price: c.sale_price as number, date: c.sale_date }));
  const g = p.guards ?? {};
  if (g.abs_min != null) entries = entries.filter((e) => e.price >= g.abs_min!);
  if (g.abs_max != null) entries = entries.filter((e) => e.price <= g.abs_max!);
  if (g.iqr_k != null && entries.length >= 4) {
    const sorted = entries.map((e) => e.price).sort((a, b) => a - b);
    const q1 = quartile(sorted, 0.25), q3 = quartile(sorted, 0.75);
    const fence = (q3 - q1) * g.iqr_k;
    entries = entries.filter((e) => e.price >= q1 - fence && e.price <= q3 + fence);
  }
  if (g.drop_top_pct || g.drop_bottom_pct) {
    const byPrice = [...entries].sort((a, b) => a.price - b.price);
    const dropTop = Math.floor(byPrice.length * (g.drop_top_pct ?? 0));
    const dropBot = Math.floor(byPrice.length * (g.drop_bottom_pct ?? 0));
    // Clamped end (never `|| undefined`): dropping everything must yield an
    // empty pool (→ min_comps abstain), not invert into keeping everything.
    const kept = new Set(byPrice.slice(dropBot, Math.max(0, byPrice.length - dropTop)));
    entries = entries.filter((e) => kept.has(e));
  }

  const minComps = Math.max(1, p.min_comps ?? 1);
  if (entries.length < minComps) return null;

  const prices = entries.map((e) => e.price);
  const agg = p.aggregate ?? { fn: "median" as const };
  let v: number;
  switch (agg.fn) {
    case "mean": v = mean(prices); break;
    case "trimmed_mean": v = trimmedMean(prices, agg.trim_pct ?? 0.1); break;
    case "last_sale": {
      // Order-independent (top_n may have re-sorted by price): pick max date.
      let best = entries[0];
      for (const e of entries) {
        const t = e.date ? new Date(e.date).getTime() : -Infinity;
        const bt = best.date ? new Date(best.date).getTime() : -Infinity;
        if (t > bt) best = e;
      }
      v = best.price;
      break;
    }
    case "min": v = Math.min(...prices); break;
    case "max": v = Math.max(...prices); break;
    case "wavg_recency": {
      const hl = agg.half_life_days ?? 30;
      let num = 0, den = 0;
      for (const e of entries) {
        const age = e.date ? Math.max(0, (now - new Date(e.date).getTime()) / 86_400_000) : hl * 4;
        const w = Math.pow(0.5, age / hl);
        num += e.price * w; den += w;
      }
      v = den > 0 ? num / den : mean(prices);
      break;
    }
    case "median":
    default: v = median(prices);
  }
  if (p.adjust?.multiplier != null) v *= p.adjust.multiplier;
  // Charm pricing only where it makes sense — never inflate sub-dollar values.
  if (p.adjust?.round_99 && v >= 1) v = Math.round(v) - 0.01;
  return round2(v);
}

/** The card's value AS OF a past moment: only sales that existed then count,
 *  and time-windows are evaluated from that moment (interpretPipeline's `now`).
 *  No manual/market fallback — a historical point either computes or is null. */
export function valueAt(
  card: CardLite,
  comps: Comp[],
  params: StrategyParams | null | undefined,
  atMs: number,
): number | null {
  if (card.price_locked && card.manual_price != null) return card.manual_price;
  const past = comps.filter((c) => c.sale_date != null && new Date(c.sale_date).getTime() <= atMs);
  if (params?.v === 1 && params.pipeline) {
    return interpretPipeline(past, params.pipeline, { grader: card.grader, grade: card.grade }, atMs);
  }
  const raw = past.filter((c) => isRaw(c) && c.sale_price != null).map((c) => c.sale_price as number);
  return applyStrategy(card.pricing_strategy, raw, null);
}

/** marketValue that understands builder pipelines; legacy keys unchanged. */
export function computeMarketValue(
  card: CardLite,
  comps: Comp[],
  params?: StrategyParams | null,
): number | null {
  if (card.price_locked && card.manual_price != null) return card.manual_price;
  if (params?.v === 1 && params.pipeline) {
    const v = interpretPipeline(comps, params.pipeline, { grader: card.grader, grade: card.grade });
    // Terminal fallback is engine-level and never toggleable (a failed
    // pipeline must not null a card's value).
    return v ?? card.manual_price ?? card.market_value ?? null;
  }
  return marketValue(card, comps);
}

/** Suggested list price with the inviolable floor (list ≥ landed_cost × 1.15). */
export function suggestedListPrice(market: number | null, landedCost: number | null): { price: number | null; floorApplied: boolean } {
  const floor = landedCost != null ? round2(landedCost * 1.15) : null;
  if (market == null) return { price: floor, floorApplied: floor != null };
  if (floor != null && floor > market) return { price: floor, floorApplied: true };
  return { price: market, floorApplied: false };
}

/** The full grade ladder (RAW + each seeded grader×grade for the card's era). */
export function buildLadder(card: CardLite, comps: Comp[], multipliers: Multiplier[]): LadderCell[] {
  const raw = rawValue(card, comps);
  const era = eraOf(card.year);
  // Only PRICED raw comps count, and the ≥3 rule applies to RAW too — so a
  // single comp or a manual/prior fallback is never badged "actual".
  const rawComps = comps.filter((c) => isRaw(c) && c.sale_price != null).length;
  const cells: LadderCell[] = [
    { grader: "RAW", grade: 0, value: raw, basis_source: rawComps >= ACTUAL_MIN_COMPS ? "actual" : "modeled", comp_count: rawComps },
  ];
  for (const m of multipliers.filter((m) => m.era_bucket === era || m.era_bucket === "all")) {
    const hits = comps.filter(
      (c) => (c.grader ?? "").toUpperCase() === m.grader.toUpperCase() && Number(c.grade) === Number(m.grade) && c.sale_price != null,
    );
    if (hits.length >= ACTUAL_MIN_COMPS) {
      cells.push({ grader: m.grader, grade: m.grade, value: round2(trimmedMean(hits.map((c) => c.sale_price as number), 0.1)), basis_source: "actual", comp_count: hits.length });
    } else {
      cells.push({ grader: m.grader, grade: m.grade, value: raw != null ? round2(raw * m.multiplier) : null, basis_source: "modeled", comp_count: hits.length });
    }
  }
  return cells;
}

/** Grade-Up: the best ladder cell whose value beats raw by more than the cost
 *  to grade there. Returns null if nothing clears the hurdle. */
export function gradeUp(
  ladder: LadderCell[],
  raw: number | null,
  gradingCost = 25,
): { grader: string; grade: number; value: number; upside: number; basis_source: "actual" | "modeled" } | null {
  if (raw == null) return null;
  let best: { grader: string; grade: number; value: number; upside: number; basis_source: "actual" | "modeled" } | null = null;
  for (const c of ladder) {
    if (c.grader === "RAW" || c.value == null) continue;
    const upside = c.value - raw - gradingCost;
    if (upside > 0 && (!best || upside > best.upside)) {
      best = { grader: c.grader, grade: c.grade, value: c.value, upside: round2(upside), basis_source: c.basis_source };
    }
  }
  return best;
}

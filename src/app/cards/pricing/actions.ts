"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { PipelineV1, StrategyParams } from "@/lib/cards/valuation";
import { normalizeEstimate } from "@/lib/cards/credits";

const SEED_KEYS = ["standard", "conservative", "aggressive", "hot", "thin_market", "manual_lock"];

async function authed(): Promise<SupabaseClient> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return supabase;
}

export type PricingTemplate = {
  key: string;
  label: string;
  params: StrategyParams | null;
  notes: string | null;
  builtin: boolean;
};

// All strategies, seeds first (fixed order) then customs alphabetically.
export async function listPricingTemplates(): Promise<PricingTemplate[]> {
  const supabase = await authed();
  const { data } = await supabase
    .from("card_pricing_strategies")
    .select("key, label, params, notes");
  const rows = (data ?? []).map((r) => ({
    key: r.key as string,
    label: r.label as string,
    params: (r.params as StrategyParams) ?? null,
    notes: (r.notes as string) ?? null,
    builtin: SEED_KEYS.includes(r.key as string),
  }));
  rows.sort((a, b) => {
    const ai = SEED_KEYS.indexOf(a.key), bi = SEED_KEYS.indexOf(b.key);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.label.localeCompare(b.label);
  });
  return rows;
}

// Slim list for the strategy pickers everywhere (intake modes + card form).
export async function listStrategyOptions(): Promise<{ key: string; label: string }[]> {
  try {
    return (await listPricingTemplates()).map(({ key, label }) => ({ key, label }));
  } catch {
    return [];
  }
}

const clamp = (n: number | null | undefined, lo: number, hi: number): number | undefined =>
  n == null || !Number.isFinite(Number(n)) ? undefined : Math.min(hi, Math.max(lo, Number(n)));

// Server-side sanitation so a wild AI/random roll can never save nonsense.
function sanitizePipeline(p: PipelineV1): PipelineV1 {
  const AGG = ["mean", "median", "trimmed_mean", "wavg_recency", "last_sale", "min", "max"];
  // Whitelist + lowercase sources (day-review: an AI-cased "eBay" would make a
  // filter silently abstain forever). "other" included — the paste importer
  // writes it.
  const SRC = ["manual", "cardladder", "ebay", "pricecharting", "auction", "other"];
  const out: PipelineV1 = {};
  if (Array.isArray(p.sources)) {
    const srcs = [...new Set(p.sources.map((s) => String(s).toLowerCase().trim()))]
      .filter((s) => SRC.includes(s))
      .slice(0, 8);
    if (srcs.length) out.sources = srcs;
  }
  if (p.comp_scope === "own_grade" || p.comp_scope === "cross_grade") {
    out.comp_scope = p.comp_scope;
    // Quantize to half-grades so saved deltas match the grading world.
    out.grade_delta = Math.round((clamp(p.grade_delta, 0, 3) ?? 0) * 2) / 2;
    if (Array.isArray(p.grade_companies) && p.grade_companies.length) {
      out.grade_companies = p.grade_companies.map((s) => String(s).toUpperCase()).slice(0, 8);
    }
  }
  out.window_days = p.window_days == null ? null : clamp(p.window_days, 1, 3650) ?? null;
  out.last_n = p.last_n == null ? null : clamp(p.last_n, 1, 200) ?? null;
  out.top_n = p.top_n == null ? null : clamp(p.top_n, 1, 50) ?? null;
  out.min_comps = clamp(p.min_comps, 1, 20) ?? 1;
  const g = p.guards ?? {};
  out.guards = {
    drop_top_pct: clamp(g.drop_top_pct, 0, 0.4),
    drop_bottom_pct: clamp(g.drop_bottom_pct, 0, 0.4),
    iqr_k: clamp(g.iqr_k, 0.5, 5),
    abs_min: clamp(g.abs_min, 0, 1_000_000),
    abs_max: clamp(g.abs_max, 0, 1_000_000),
  };
  const fn = AGG.includes(p.aggregate?.fn ?? "") ? p.aggregate!.fn : "median";
  out.aggregate = {
    fn: fn as NonNullable<PipelineV1["aggregate"]>["fn"],
    trim_pct: clamp(p.aggregate?.trim_pct, 0, 0.4),
    half_life_days: clamp(p.aggregate?.half_life_days, 3, 365),
  };
  out.adjust = {
    multiplier: clamp(p.adjust?.multiplier, 0.5, 2),
    round_99: !!p.adjust?.round_99,
  };
  return out;
}

export async function savePricingTemplate(input: {
  key?: string | null;
  name: string;
  tags: string[];
  desc?: string;
  pipeline: PipelineV1;
  estimate?: import("@/lib/cards/credits").EstimateConfig;
}): Promise<{ ok: boolean; key?: string; error?: string }> {
  const supabase = await authed();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the format a name." };

  const isEdit = Boolean(input.key?.trim());
  let key = input.key?.trim() || "";
  if (!key) {
    key = "c_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    if (!key || key === "c_") return { ok: false, error: "Name needs some letters or numbers." };
  }
  if (SEED_KEYS.includes(key)) return { ok: false, error: "Built-in formats can't be overwritten — duplicate them instead." };

  const params: StrategyParams = {
    v: 1,
    pipeline: sanitizePipeline(input.pipeline),
    meta: {
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 10),
      desc: input.desc?.trim() || undefined,
    },
    estimate: normalizeEstimate(input.estimate),
  };

  const friendly = (e: { message: string }) =>
    /policy|permission|denied/i.test(e.message) ? "Only the owner can save pricing formats." : e.message;

  if (isEdit) {
    // Explicit edit: upsert by the known key.
    const { error } = await supabase.from("card_pricing_strategies").upsert(
      { key, label: name, target_rule: "custom", params },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: friendly(error) };
  } else {
    // Create: INSERT (never upsert — a name that slugs to an existing key must
    // not silently overwrite it; day-review). On collision, auto-suffix.
    let saved = false;
    for (let n = 0; n < 8 && !saved; n++) {
      const tryKey = n === 0 ? key : `${key}_${n + 1}`;
      const { error } = await supabase
        .from("card_pricing_strategies")
        .insert({ key: tryKey, label: name, target_rule: "custom", params });
      if (!error) { key = tryKey; saved = true; break; }
      if (error.code !== "23505") return { ok: false, error: friendly(error) };
    }
    if (!saved) return { ok: false, error: "A format with this name already exists — rename it, or open it to edit." };
  }
  revalidatePath("/cards/pricing");
  return { ok: true, key };
}

// Delete a saved (custom) format. Built-in seeds can't be deleted.
export async function deletePricingTemplate(key: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await authed();
  const k = key?.trim();
  if (!k) return { ok: false, error: "Nothing to delete." };
  if (SEED_KEYS.includes(k)) return { ok: false, error: "Built-in formats can't be deleted." };
  const { error } = await supabase.from("card_pricing_strategies").delete().eq("key", k);
  if (error) return { ok: false, error: /policy|permission|denied/i.test(error.message) ? "Only the owner can delete formats." : error.message };
  revalidatePath("/cards/pricing");
  return { ok: true };
}

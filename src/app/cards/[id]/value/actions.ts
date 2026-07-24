"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { computeMarketValue, valueAt, type Comp, type StrategyParams } from "@/lib/cards/valuation";
import { coerceDateOrNull } from "@/lib/books/date";

async function authed(): Promise<SupabaseClient> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return supabase;
}

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v.toString().trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s || null;
}

const CARD_SELECT = "year, manual_price, market_value, price_locked, pricing_strategy, landed_cost, grader, grade";

// Recompute + persist market_value from current comps + strategy; log history.
async function recompute(supabase: SupabaseClient, id: string) {
  const { data: card } = await supabase.from("cards").select(CARD_SELECT).eq("id", id).single();
  if (!card) return;
  const { data: comps, error: compsErr } = await supabase
    .from("card_comps").select("grader, grade, sale_price, sale_date, source").eq("card_id", id);
  // Builder-authored strategies carry a params pipeline; legacy keys don't.
  const { data: strat, error: stratErr } = await supabase
    .from("card_pricing_strategies").select("params")
    .eq("key", (card as { pricing_strategy: string }).pricing_strategy).maybeSingle();
  // A failed read must not silently repric off empty/legacy data (day-review).
  if (compsErr || stratErr) return;
  const mv = computeMarketValue(card as never, (comps ?? []) as Comp[], (strat?.params as StrategyParams) ?? null);
  const prev = (card as { market_value: number | null }).market_value;
  const prevNum = prev == null ? null : Number(prev);
  // Only persist + log history when the price actually moved (no churn on
  // no-op strategy re-clicks or graded-comp adds that don't touch raw value).
  if (mv !== prevNum) {
    const nowMs = Date.now();
    const params = (strat?.params as StrategyParams) ?? null;
    const row: Record<string, unknown> = {
      market_value: mv,
      last_priced_at: new Date().toISOString(),
      value_30d: valueAt(card as never, (comps ?? []) as Comp[], params, nowMs - 30 * 86_400_000),
      value_365d: valueAt(card as never, (comps ?? []) as Comp[], params, nowMs - 365 * 86_400_000),
    };
    const { error: upErr } = await supabase.from("cards").update(row).eq("id", id);
    if (upErr) {
      if (!/value_30d|value_365d/.test(upErr.message)) throw new Error(`Value not saved: ${upErr.message}`);
      // Pre-migration fallback: snapshot columns not applied yet.
      delete row.value_30d;
      delete row.value_365d;
      const { error: retryErr } = await supabase.from("cards").update(row).eq("id", id);
      if (retryErr) throw new Error(`Value not saved: ${retryErr.message}`);
    }
    if (mv != null) {
      const { error: histErr } = await supabase.from("card_price_history").insert({ card_id: id, price: mv, strategy: (card as { pricing_strategy: string }).pricing_strategy });
      if (histErr) throw new Error(`Value saved but the history point wasn't: ${histErr.message}`);
    }
  }
}

// Public wrapper so other server surfaces (the comps paste-importer) can
// trigger a recompute after bulk-inserting sales.
export async function recomputeCard(id: string): Promise<void> {
  const supabase = await authed();
  await recompute(supabase, id);
  revalidatePath(`/cards/${id}/value`);
  revalidatePath(`/cards/${id}`);
}

export async function addComp(id: string, formData: FormData) {
  const supabase = await authed();
  const price = num(formData.get("sale_price"));
  // A negative comp poisons market_value (min/last_sale aggregates go negative
  // → NAV, exports, list defaults); a silent insert failure loses evidence.
  if (price == null || !(price > 0) || price > 1_000_000) {
    throw new Error("Sale price must be a positive number (max $1M).");
  }
  const { error } = await supabase.from("card_comps").insert({
    card_id: id,
    fingerprint: `manual-${id}`,
    source: "manual",
    grader: (str(formData.get("grader")) ?? "RAW").toUpperCase(),
    grade: Math.min(10, Math.max(0, num(formData.get("grade")) ?? 0)),
    sale_price: price,
    sale_date: coerceDateOrNull(str(formData.get("sale_date"))),
  });
  if (error) throw new Error(`Comp not saved: ${error.message}`);
  await recompute(supabase, id);
  revalidatePath(`/cards/${id}/value`);
}

export async function setStrategy(id: string, strategy: string) {
  const supabase = await authed();
  await supabase.from("cards").update({ pricing_strategy: strategy }).eq("id", id);
  await recompute(supabase, id);
  revalidatePath(`/cards/${id}/value`);
}

export async function setManualPrice(id: string, formData: FormData) {
  const supabase = await authed();
  const price = num(formData.get("manual_price"));
  const locked = formData.get("price_locked") != null;
  await supabase.from("cards").update({ manual_price: price, price_locked: locked }).eq("id", id);
  await recompute(supabase, id);
  revalidatePath(`/cards/${id}/value`);
}

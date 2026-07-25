// Usage telemetry (shadow-mode metering, 2026-07-25). One row per metered
// vendor call into public.usage_events: units consumed, real dollar cost where
// dollars are knowable, and the credits actually charged — the data that turns
// "12 credits for a deep estimate" from a guess into a priced fact.
//
// THREE COST SHAPES, one table (see the migration's comment for the full
// reasoning). Short version: always record units; record dollars only for
// pay-per-use vendors. A subscription's true per-call cost is its monthly fee
// allocated across the units it served, which is a month-end number — so
// cost_usd stays null there BY DESIGN, not as a missing value.
//
// Telemetry is measurement, not billing: record it even when the run wasn't
// charged (credits_charged = 0 says so). A failed telemetry write is checked
// and logged (rule 1) but never breaks the paid path the user is on.
import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd, type AiTokens } from "@/lib/ai/rates";

/** How a vendor bills us — decides whether cost_usd is knowable at call time. */
export type CostModel = "metered" | "subscription" | "free";

// The cost shape of every external vendor CardOps calls. Keys match
// service_config.key so the month-end allocation can find each monthly fee.
export const VENDOR_COST_MODEL: Record<string, CostModel> = {
  anthropic_vision: "metered",   // per token
  ximilar: "metered",            // per call
  thecardapi: "subscription",    // flat monthly + quota
  pricecharting: "subscription", // flat monthly + quota
  ebay_api: "free",              // free, rate-limited
  scryfall: "free",              // free, rate-limited
};

/** Record one AI model call (tokens + real dollars). */
export async function recordAiUsage(
  svc: SupabaseClient,
  row: {
    userId: string;
    feature: string; // mirror the ledger reason, e.g. 'estimate:standard_plus'
    model: string;
    usage: AiTokens;
    creditsCharged: number;
    ref?: string | null;
  },
): Promise<void> {
  const { error } = await svc.from("usage_events").insert({
    user_id: row.userId,
    vendor: "anthropic_vision",
    cost_model: "metered",
    feature: row.feature,
    model: row.model,
    units: 1,
    input_tokens: row.usage.input_tokens,
    output_tokens: row.usage.output_tokens,
    cache_write_tokens: row.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: row.usage.cache_read_input_tokens ?? 0,
    cost_usd: costUsd(row.model, row.usage),
    credits_charged: row.creditsCharged,
    ref: row.ref ?? null,
  });
  if (error) console.error(`[usage_events] ${row.feature} not recorded: ${error.message}`);
}

/**
 * Record one non-AI vendor call (a card-data lookup, an eBay call, …).
 * `unitCostUsd` is only meaningful for 'metered' vendors; for subscription and
 * free vendors it is ignored so a made-up per-call price can never contaminate
 * the cost data.
 */
export async function recordVendorUsage(
  svc: SupabaseClient,
  row: {
    userId: string;
    vendor: string;
    feature: string;
    units?: number;
    creditsCharged?: number;
    unitCostUsd?: number | null;
    ref?: string | null;
  },
): Promise<void> {
  const model = VENDOR_COST_MODEL[row.vendor] ?? "metered";
  const units = row.units ?? 1;
  const { error } = await svc.from("usage_events").insert({
    user_id: row.userId,
    vendor: row.vendor,
    cost_model: model,
    feature: row.feature,
    units,
    cost_usd: model === "metered" && row.unitCostUsd != null ? row.unitCostUsd * units : null,
    credits_charged: row.creditsCharged ?? 0,
    ref: row.ref ?? null,
  });
  if (error) console.error(`[usage_events] ${row.vendor}/${row.feature} not recorded: ${error.message}`);
}

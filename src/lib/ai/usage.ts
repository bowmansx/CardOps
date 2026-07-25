// AI cost telemetry (shadow-mode metering, 2026-07-25). One row per model
// call into public.ai_usage: real tokens, computed dollar cost, and the
// credits actually charged for the run — the data that turns "12 credits for
// a deep estimate" from a guess into a priced fact.
//
// Telemetry is measurement, not billing: record it even when the run wasn't
// charged (credits_charged = 0 says so). A failed telemetry write is checked
// and logged (rule 1) but never breaks the paid path the user is on.
import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd, type AiTokens } from "@/lib/ai/rates";

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
  const { error } = await svc.from("ai_usage").insert({
    user_id: row.userId,
    feature: row.feature,
    model: row.model,
    input_tokens: row.usage.input_tokens,
    output_tokens: row.usage.output_tokens,
    cache_write_tokens: row.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: row.usage.cache_read_input_tokens ?? 0,
    cost_usd: costUsd(row.model, row.usage),
    credits_charged: row.creditsCharged,
    ref: row.ref ?? null,
  });
  if (error) console.error(`[ai_usage] ${row.feature} not recorded: ${error.message}`);
}

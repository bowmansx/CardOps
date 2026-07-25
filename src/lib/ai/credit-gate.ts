// The enforcement gate (app side of credit metering, 2026-07-25).
//
// The DB's credit_spend NEVER refuses — by the time it runs the compute
// already happened, and hiding a real cost would be dishonest (it records a
// shortfall instead). Refusal belongs BEFORE the AI call, here: when the
// 'credit_enforcement' service_config flag is ON, callers check available
// credits first and refuse the run. Flag OFF = shadow mode, everything
// proceeds and merely records.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAll } from "@/lib/supabase/page";

export async function creditEnforcement(svc: SupabaseClient): Promise<boolean> {
  const { data, error } = await svc
    .from("service_config").select("enabled").eq("key", "credit_enforcement").maybeSingle();
  if (error) {
    // Fail OPEN: a config read blip must not lock every paying user out of
    // the feature. Shadow-mode spends still record whatever happens.
    console.error(`[credit-gate] enforcement flag unreadable (${error.message}) — not enforcing`);
    return false;
  }
  return Boolean(data?.enabled);
}

/** Spendable credits for a user: unexpired grant remainders, read complete (rule 5). */
export async function creditAvailable(svc: SupabaseClient, userId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const { rows } = await readAll<{ remaining: number | null }>((from, to) =>
    svc
      .from("credit_ledger")
      .select("remaining")
      .eq("user_id", userId)
      .neq("kind", "spend")
      .gt("remaining", 0)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.reduce((s, r) => s + Number(r.remaining ?? 0), 0);
}

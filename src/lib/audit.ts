// Audit writes that fail must FAIL LOUDLY (prevention rule, 2026-07-25): an
// audit trail that can fail silently is not an audit trail. Every
// audit_log write in the app goes through auditOrThrow — a failure throws and
// blocks (or loudly taints) the operation that triggered it. The actor union
// mirrors the audit_log actor CHECK constraint (20260736000000), so an actor
// the database would reject is a compile error here first.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditRow = {
  actor: "web" | "mcp" | "cron" | "assistant" | "ebay-sync" | "ebay";
  action: string;
  target: string;
  payload?: unknown;
  result?: string;
};

export async function auditOrThrow(client: SupabaseClient, row: AuditRow): Promise<void> {
  const { error } = await client.from("audit_log").insert(row);
  if (error) throw new Error(`audit_log write failed (${row.action}): ${error.message}`);
}

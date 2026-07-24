// Zoho Books connector (Beau, 2026-07-24). Formats CardOps' neutral push entries
// as Zoho Manual Journals and posts them to a business's org. Reads the chart of
// accounts so the user can map ours -> theirs.
//
// push() is money-critical and outward-facing: it is only ever called from an
// explicitly-confirmed action, never a cron and never automatically.
import { zohoConfigured, zohoFetch } from "@/lib/zoho/client";
import type { AccountingConnector, ConnectorContext, ExternalAccount, PushEntry, PushOutcome } from "./types";

type ZohoAccount = { account_id?: string; account_name?: string; account_type?: string };

/** Zoho's Manual Journal shape. */
export type ZohoManualJournal = {
  journal_date: string;
  reference_number: string;
  notes: string;
  line_items: { account_id: string; debit_or_credit: "debit" | "credit"; amount: number; description?: string }[];
};

/** Neutral entry -> Zoho payload. Returns null when anything is unmapped, so an
 *  incomplete entry can never be half-posted. */
export function toZohoJournal(entry: PushEntry): ZohoManualJournal | null {
  // Both guards matter: a FRAGMENT of a transaction can balance on its own (a
  // dealer sale is two self-balancing halves), so completeness is checked here
  // too rather than relying on the caller.
  if (!entry.balanced || !entry.complete) return null;
  const line_items = [];
  for (const l of entry.lines) {
    if (!l.account_id) return null;
    line_items.push({ account_id: l.account_id, debit_or_credit: l.side, amount: l.amount, description: l.description || undefined });
  }
  if (!line_items.length) return null;
  return { journal_date: entry.date, reference_number: entry.reference, notes: entry.notes, line_items };
}

export const zoho: AccountingConnector = {
  id: "zoho",
  label: "Zoho Books",
  enabled: () => zohoConfigured(),
  needsOrg: true,

  async listAccounts(orgId: string): Promise<ExternalAccount[]> {
    const d = await zohoFetch<{ chartofaccounts?: ZohoAccount[] }>(
      `/books/v3/chartofaccounts?organization_id=${encodeURIComponent(orgId)}`,
    );
    return (d.chartofaccounts ?? [])
      .filter((a) => a.account_id && a.account_name)
      .map((a) => ({ id: String(a.account_id), name: String(a.account_name), type: a.account_type ?? null }));
  },

  async pushEntry(entry: PushEntry, ctx: ConnectorContext): Promise<PushOutcome> {
    // Belt-and-braces: never post an entry belonging to a different org.
    // Pre-flight refusals: nothing is sent, so the caller may safely un-claim.
    if (entry.external_org_id !== ctx.orgId) {
      return { ok: false, attempted: false, error: "entry belongs to a different organization" };
    }
    if (!entry.complete) {
      return { ok: false, attempted: false, error: "incomplete transaction (partial lines) — refused" };
    }
    const payload = toZohoJournal(entry);
    if (!payload) return { ok: false, attempted: false, error: "unmapped account or unbalanced — refused" };
    try {
      const d = await zohoFetch<{ journal?: { journal_id?: string } }>(
        `/books/v3/journals?organization_id=${encodeURIComponent(ctx.orgId)}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      return { ok: true, attempted: true, externalId: d?.journal?.journal_id ?? null };
    } catch (err) {
      // Sent, outcome unknown — the caller must quarantine, never auto-retry.
      return { ok: false, attempted: true, error: err instanceof Error ? err.message : "post failed" };
    }
  },
};

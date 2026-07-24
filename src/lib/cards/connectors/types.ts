// CardOps accounting connectors (Beau, 2026-07-24). CardOps keeps its OWN books;
// a connector is the OPTIONAL sync that mirrors them into whatever bookkeeping app
// the user runs — Zoho today, QuickBooks next, CSV always, or nothing at all.
//
// The pipeline is deliberately backend-neutral:
//   journal_entries -> buildPushEntries() -> [connector].push()
// so adding QuickBooks is one file, not a redesign (same shape that worked well
// for the price-source adapters).

/** One row of CardOps' internal double-entry ledger. */
export type LedgerRow = {
  entity_id: string | null; // the card_businesses id this books under
  entry_date: string;
  source: string; // 'receipt' | 'sale' | ...
  source_ref: string | null;
  line: number;
  account: string; // internal account key (inventory, cogs, cash, ...)
  debit: number;
  credit: number;
  memo?: string | null;
};

/** An account in the user's bookkeeping app, for the mapping screen. */
export type ExternalAccount = { id: string; name: string; type?: string | null };

/** internal account key -> the external account id it posts to. */
export type AccountMap = Record<string, string>;

export type PushLine = {
  account_key: string; // ours
  account_name: string; // suggested/label
  account_id: string | null; // theirs, once mapped
  side: "debit" | "credit";
  amount: number;
  description: string;
};

/** One balanced transaction, ready for any backend to format + post. */
export type PushEntry = {
  business_id: string | null;
  business_code: string;
  external_org_id: string | null; // the org/realm this business syncs to
  date: string;
  reference: string;
  notes: string;
  lines: PushLine[];
  balanced: boolean;
  /** Line numbers form a contiguous 0..n-1 run — i.e. we have the WHOLE
   *  transaction, not a fragment that happens to balance on its own. */
  complete: boolean;
};

/** One entry's outcome. Per-entry (not batched) so the caller can claim/settle
 *  each one individually — that claim is what makes re-pushing idempotent.
 *  `attempted` distinguishes "we never sent it" (safe to un-claim and retry)
 *  from "we sent it and don't know the result" (must NEVER be auto-retried). */
export type PushOutcome = { ok: boolean; attempted: boolean; externalId?: string | null; error?: string };

export type ConnectorContext = {
  orgId: string;
};

export type AccountingConnector = {
  id: string; // 'zoho' | 'quickbooks' | 'csv'
  label: string;
  /** Credentials present in this environment? */
  enabled: () => boolean;
  /** Does each business need an org/realm id (Zoho org, QBO realm)? */
  needsOrg: boolean;
  /** Pull the user's chart of accounts so they can map ours -> theirs. */
  listAccounts?: (orgId: string) => Promise<ExternalAccount[]>;
  /** Post ONE entry. Money-critical + outward-facing: only ever called from an
   *  explicitly-confirmed action, one entry at a time, never a cron. */
  pushEntry?: (entry: PushEntry, ctx: ConnectorContext) => Promise<PushOutcome>;
};

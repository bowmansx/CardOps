// Backend-neutral ledger translation (Beau, 2026-07-24). Groups CardOps' internal
// journal_entries into balanced per-business transactions and applies the user's
// account mapping. Every connector consumes this same shape, so the accounting
// logic lives here once and each backend only formats + posts. Pure — no I/O.
import type { LedgerRow, PushEntry, PushLine, AccountMap } from "./types";

/** Internal account key -> a sensible name in the user's chart of accounts.
 *  Shown on the mapping screen so the right target is obvious. */
export const SUGGESTED_ACCOUNTS: Record<string, { name: string; type: string }> = {
  cash: { name: "Cash / Bank", type: "cash" },
  inventory: { name: "Card Inventory (dealer)", type: "stock" },
  investment_assets: { name: "Trading Cards — at cost (investment)", type: "other_asset" },
  card_assets: { name: "Cards held (hobby)", type: "other_asset" },
  cogs: { name: "Cost of Cards Sold", type: "cost_of_goods_sold" },
  sales_revenue: { name: "Card Sales", type: "income" },
  capital_gain_loss: { name: "Realized Gain/Loss on Cards", type: "income" },
  hobby_income: { name: "Hobby Income — Cards", type: "income" },
  platform_fees: { name: "Selling Fees", type: "expense" },
  shipping_expense: { name: "Shipping", type: "expense" },
  nondeductible_costs: { name: "Nondeductible Selling Costs", type: "equity" },
  due_from_entity: { name: "Due from Business (owner loans out)", type: "other_asset" },
  due_to_owner: { name: "Member Loan — Owner", type: "other_liability" },
  investment_in_entity: { name: "Investment in Business", type: "other_asset" },
  owner_equity: { name: "Owner Contributions", type: "equity" },
  intercompany_advance: { name: "Due from Affiliate", type: "other_asset" },
  intercompany_payable: { name: "Due to Affiliate", type: "other_liability" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export type BuildOptions = {
  /** business id -> { org id it syncs to, short code } */
  businesses: Map<string, { org: string | null; code: string }>;
  /** business id -> that business's account mapping (ours -> theirs) */
  accountMapFor?: (businessId: string | null) => AccountMap | undefined;
};

export type BuildResult = {
  entries: PushEntry[];
  /** short codes of businesses with no org configured */
  businessesWithoutOrg: string[];
  /** internal account keys with no external account mapped */
  unmappedAccounts: string[];
  /** entries whose org AND every account id resolve — the only ones postable */
  postable: number;
};

/**
 * Group ledger rows into one balanced entry per (business · source · source_ref),
 * routed to that business's org, with the account mapping applied. Never posts.
 */
export function buildPushEntries(rows: LedgerRow[], opts: BuildOptions): BuildResult {
  const groups = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const key = `${r.entity_id ?? "none"}::${r.source}::${r.source_ref ?? "none"}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const entries: PushEntry[] = [];
  const noOrg = new Set<string>();
  const unmapped = new Set<string>();

  for (const [, g] of groups) {
    const first = g[0];
    const biz = first.entity_id ? opts.businesses.get(first.entity_id) : undefined;
    const org = biz?.org ?? null;
    const code = biz?.code ?? "UNASSIGNED";
    if (first.entity_id && !org) noOrg.add(code);
    const map = opts.accountMapFor?.(first.entity_id) ?? {};

    const lines: PushLine[] = [...g]
      .sort((a, b) => a.line - b.line)
      .map((r) => {
        const account_id = map[r.account] ?? null;
        if (!account_id) unmapped.add(r.account);
        const isDebit = round2(r.debit) > 0;
        return {
          account_key: r.account,
          account_name: SUGGESTED_ACCOUNTS[r.account]?.name ?? r.account,
          account_id,
          side: (isDebit ? "debit" : "credit") as "debit" | "credit",
          amount: round2(isDebit ? r.debit : r.credit),
          description: r.memo ?? "",
        };
      });

    const debits = lines.filter((l) => l.side === "debit").reduce((a, l) => a + l.amount, 0);
    const credits = lines.filter((l) => l.side === "credit").reduce((a, l) => a + l.amount, 0);

    entries.push({
      business_id: first.entity_id,
      business_code: code,
      external_org_id: org,
      date: first.entry_date,
      reference: `CARDOPS-${first.source}-${first.source_ref ?? "none"}`,
      notes: `CardOps ${first.source} · ${code}`,
      lines,
      balanced: Math.abs(round2(debits) - round2(credits)) < 0.005,
      // A truncated read can leave a fragment that balances on its own (a dealer
      // sale is two self-balancing halves), so require contiguous 0..n-1 lines.
      complete: (() => {
        const ns = g.map((r) => r.line).sort((a, b) => a - b);
        return ns.every((n, i) => n === i);
      })(),
    });
  }

  return {
    entries,
    businessesWithoutOrg: [...noOrg].sort(),
    unmappedAccounts: [...unmapped].sort(),
    postable: entries.filter((e) => e.external_org_id && e.balanced && e.complete && e.lines.every((l) => l.account_id)).length,
  };
}

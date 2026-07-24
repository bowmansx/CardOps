import { describe, it, expect } from "vitest";
import { buildPushEntries, SUGGESTED_ACCOUNTS, entriesToCsv, toZohoJournal, connectorOptions, getConnector, type LedgerRow, type BuildOptions } from "@/lib/cards/connectors";
import { zoho } from "@/lib/cards/connectors/zoho";

const AF = "af-id";
const PERS = "pers-id";
const businesses: BuildOptions["businesses"] = new Map([
  [AF, { org: "931036422", code: "AF" }],
  [PERS, { org: null, code: "PERS" }], // no bookkeeping org configured
]);

const rows: LedgerRow[] = [
  { entity_id: AF, entry_date: "2026-07-10", source: "receipt", source_ref: "r1", line: 0, account: "inventory", debit: 100, credit: 0, memo: "cards" },
  { entity_id: AF, entry_date: "2026-07-10", source: "receipt", source_ref: "r1", line: 1, account: "cash", debit: 0, credit: 100, memo: "paid" },
  { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s1", line: 0, account: "cash", debit: 180, credit: 0 },
  { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s1", line: 1, account: "sales_revenue", debit: 0, credit: 200 },
  { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s1", line: 2, account: "platform_fees", debit: 20, credit: 0 },
  { entity_id: PERS, entry_date: "2026-07-01", source: "receipt", source_ref: "r2", line: 0, account: "investment_assets", debit: 50, credit: 0 },
  { entity_id: PERS, entry_date: "2026-07-01", source: "receipt", source_ref: "r2", line: 1, account: "cash", debit: 0, credit: 50 },
];

const fullMap = () => ({ inventory: "a1", cash: "a2", sales_revenue: "a3", platform_fees: "a4", investment_assets: "a5" });

describe("buildPushEntries", () => {
  it("groups one entry per (business . source . source_ref)", () => {
    const { entries } = buildPushEntries(rows, { businesses });
    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.reference.includes("sale"))!.lines).toHaveLength(3);
  });

  it("routes each entry to the business's org (null when unconfigured)", () => {
    const { entries, businessesWithoutOrg } = buildPushEntries(rows, { businesses });
    expect(entries.find((e) => e.business_code === "AF")!.external_org_id).toBe("931036422");
    expect(entries.find((e) => e.business_code === "PERS")!.external_org_id).toBeNull();
    expect(businessesWithoutOrg).toContain("PERS");
  });

  it("maps debit/credit + amount and preserves line order", () => {
    const sale = buildPushEntries(rows, { businesses }).entries.find((e) => e.reference.includes("sale"))!;
    expect(sale.lines[0]).toMatchObject({ account_key: "cash", side: "debit", amount: 180 });
    expect(sale.lines[1]).toMatchObject({ account_key: "sales_revenue", side: "credit", amount: 200 });
    expect(sale.lines[2]).toMatchObject({ account_key: "platform_fees", side: "debit", amount: 20 });
  });

  it("every entry balances", () => {
    expect(buildPushEntries(rows, { businesses }).entries.every((e) => e.balanced)).toBe(true);
  });

  it("flags unmapped accounts; nothing is postable without a mapping", () => {
    const { unmappedAccounts, postable } = buildPushEntries(rows, { businesses });
    expect(unmappedAccounts).toContain("inventory");
    expect(postable).toBe(0);
  });

  it("counts postable only when the org AND every account id resolve", () => {
    // Map AF's accounts only; PERS has no org so it can never be postable.
    const { postable, entries } = buildPushEntries(rows, {
      businesses,
      accountMapFor: (id) => (id === AF ? fullMap() : undefined),
    });
    expect(postable).toBe(2); // AF receipt + AF sale
    expect(entries.find((e) => e.business_code === "PERS")!.lines.every((l) => l.account_id === null)).toBe(true);
  });

  it("suggests a target account name for every key the ledger emits", () => {
    for (const k of ["inventory", "cash", "sales_revenue", "capital_gain_loss", "due_to_owner", "investment_in_entity"]) {
      expect(SUGGESTED_ACCOUNTS[k]).toBeTruthy();
    }
  });
});

describe("toZohoJournal", () => {
  const mapped = () => buildPushEntries(rows, { businesses, accountMapFor: () => fullMap() }).entries.find((e) => e.reference.includes("receipt") && e.business_code === "AF")!;

  it("formats a fully-mapped entry as a Zoho manual journal", () => {
    const j = toZohoJournal(mapped())!;
    expect(j.journal_date).toBe("2026-07-10");
    expect(j.line_items).toHaveLength(2);
    expect(j.line_items[0]).toMatchObject({ account_id: "a1", debit_or_credit: "debit", amount: 100 });
  });

  it("refuses an entry with ANY unmapped account (never half-posts)", () => {
    const unmappedEntry = buildPushEntries(rows, { businesses }).entries[0];
    expect(toZohoJournal(unmappedEntry)).toBeNull();
  });

  it("refuses an unbalanced entry", () => {
    expect(toZohoJournal({ ...mapped(), balanced: false })).toBeNull();
  });
});

describe("entriesToCsv", () => {
  it("emits a row per line and guards spreadsheet formula injection", () => {
    const evil: LedgerRow[] = [
      { entity_id: AF, entry_date: "2026-07-10", source: "receipt", source_ref: "x", line: 0, account: "inventory", debit: 1, credit: 0, memo: "=cmd|calc" },
      { entity_id: AF, entry_date: "2026-07-10", source: "receipt", source_ref: "x", line: 1, account: "cash", debit: 0, credit: 1 },
    ];
    const out = entriesToCsv(buildPushEntries(evil, { businesses }).entries);
    expect(out.split("\n")).toHaveLength(3); // header + 2 lines
    expect(out).toContain("'=cmd|calc"); // neutralized
  });
});

describe("registry", () => {
  it("exposes the backends with their availability", () => {
    const ids = connectorOptions().map((c) => c.id);
    expect(ids).toContain("zoho");
    expect(ids).toContain("csv");
    expect(connectorOptions().find((c) => c.id === "csv")!.enabled).toBe(true); // always available
    expect(getConnector("zoho")?.needsOrg).toBe(true);
    expect(getConnector("nope")).toBeUndefined();
  });
});

describe("safety properties (from the adversarial push review)", () => {
  const mapped = () => buildPushEntries(rows, { businesses, accountMapFor: () => fullMap() })
    .entries.find((e) => e.reference.includes("receipt") && e.business_code === "AF")!;

  it("uses the FULL source_ref in the reference (a truncated key could collide and silently skip a real post)", () => {
    const long: LedgerRow[] = [
      { entity_id: AF, entry_date: "2026-07-10", source: "receipt", source_ref: "aaaaaaaa-1111-2222-3333-444444444444", line: 0, account: "cash", debit: 1, credit: 0 },
      { entity_id: AF, entry_date: "2026-07-10", source: "receipt", source_ref: "aaaaaaaa-9999-8888-7777-666666666666", line: 0, account: "cash", debit: 2, credit: 0 },
    ];
    const refs = buildPushEntries(long, { businesses }).entries.map((e) => e.reference);
    expect(new Set(refs).size).toBe(2); // same first 8 chars, still distinct
  });

  it("marks a FRAGMENT incomplete even when it balances on its own", () => {
    // A dealer sale is two self-balancing halves; a truncated read leaves the
    // revenue half looking balanced. It must not be postable.
    const fragment: LedgerRow[] = [
      { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s9", line: 2, account: "cash", debit: 50, credit: 0 },
      { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s9", line: 3, account: "sales_revenue", debit: 0, credit: 50 },
    ];
    const e = buildPushEntries(fragment, { businesses, accountMapFor: () => fullMap() }).entries[0];
    expect(e.balanced).toBe(true);   // it does balance...
    expect(e.complete).toBe(false);  // ...but it is only part of the transaction
  });

  it("a complete entry is marked complete, and only complete entries count as postable", () => {
    expect(mapped().complete).toBe(true);
    const fragment: LedgerRow[] = [
      { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s9", line: 5, account: "cash", debit: 5, credit: 0 },
      { entity_id: AF, entry_date: "2026-07-12", source: "sale", source_ref: "s9", line: 6, account: "sales_revenue", debit: 0, credit: 5 },
    ];
    expect(buildPushEntries(fragment, { businesses, accountMapFor: () => fullMap() }).postable).toBe(0);
  });

  it("toZohoJournal refuses an incomplete entry", () => {
    expect(toZohoJournal({ ...mapped(), complete: false })).toBeNull();
  });

  it("pre-flight refusals report attempted=false so the caller can safely un-claim", async () => {
    const wrongOrg = await zoho.pushEntry!({ ...mapped(), external_org_id: "999" }, { orgId: "931036422" });
    expect(wrongOrg).toMatchObject({ ok: false, attempted: false });

    const incomplete = await zoho.pushEntry!({ ...mapped(), complete: false }, { orgId: "931036422" });
    expect(incomplete).toMatchObject({ ok: false, attempted: false });

    const unmapped = buildPushEntries(rows, { businesses }).entries.find((e) => e.business_code === "AF")!;
    expect(await zoho.pushEntry!(unmapped, { orgId: "931036422" })).toMatchObject({ ok: false, attempted: false });
  });
});

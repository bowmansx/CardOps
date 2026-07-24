// CSV connector (Beau, 2026-07-24). Always available, needs no credentials and no
// org: it turns the push entries into a journal CSV that imports into Zoho,
// QuickBooks, Xero — or a spreadsheet. This is the "no integration" path that
// keeps CardOps useful on its own.
import type { AccountingConnector, PushEntry } from "./types";

// Guard against a leading =,+,-,@ being executed by a spreadsheet.
function cell(v: unknown): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function entriesToCsv(entries: PushEntry[]): string {
  const head = ["date", "reference", "business", "account_key", "account_name", "external_account_id", "debit", "credit", "description"];
  const rows = [head.map(cell).join(",")];
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([
        e.date, e.reference, e.business_code, l.account_key, l.account_name, l.account_id ?? "",
        l.side === "debit" ? l.amount.toFixed(2) : "",
        l.side === "credit" ? l.amount.toFixed(2) : "",
        l.description,
      ].map(cell).join(","));
    }
  }
  return rows.join("\n");
}

export const csv: AccountingConnector = {
  id: "csv",
  label: "CSV export",
  enabled: () => true,
  needsOrg: false,
};

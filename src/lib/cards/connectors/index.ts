// The connector registry. Adding QuickBooks is one file dropped in here — the
// ledger translation and the mapping UI are backend-neutral.
import { zoho } from "./zoho";
import { csv } from "./csv";
import type { AccountingConnector } from "./types";

export const CONNECTORS: AccountingConnector[] = [zoho, csv];

export function getConnector(id: string): AccountingConnector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** What the settings screen shows: every backend + whether it's usable here. */
export function connectorOptions(): { id: string; label: string; enabled: boolean; needsOrg: boolean }[] {
  return CONNECTORS.map((c) => ({ id: c.id, label: c.label, enabled: c.enabled(), needsOrg: c.needsOrg }));
}

export * from "./types";
export * from "./ledger";
export { entriesToCsv } from "./csv";
export { toZohoJournal } from "./zoho";

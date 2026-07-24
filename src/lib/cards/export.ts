// CardOps translation layer (contract §6): profile-driven CSV export. A
// format profile is DATA (card_format_profiles row), not code — adding a
// platform = adding a row. field_map values:
//   "field"   → card column value
//   "_title"/"_price" → computed
//   "=LITERAL" → constant literal (e.g. "=Add", "=1")

import { categoryKind } from "@/lib/cards/types";

export type FormatProfile = {
  name: string;
  column_order: string[] | null;
  field_map: Record<string, string>;
};

type CardRow = Record<string, unknown>;

// Code-level profiles that work without a DB row (a matching
// card_format_profiles row, if created later, overrides these).
// Whatnot columns follow their seller-hub bulk-upload template — verify
// against the current template before a big upload; Shipping Profile is
// left blank on purpose (account-specific).
export const BUILTIN_PROFILES: Record<string, FormatProfile> = {
  // Insurance rider / loss-claim: itemized inventory at current market value.
  insurance: {
    name: "insurance",
    column_order: ["Item", "Category", "Condition", "Cert #", "Serial #", "Est. value (USD)", "SKU"],
    field_map: {
      "Item": "_title",
      "Category": "sport_category",
      "Condition": "_condition",
      "Cert #": "cert_number",
      "Serial #": "serial_number",
      "Est. value (USD)": "_market",
      "SKU": "sku",
    },
  },
  whatnot: {
    name: "whatnot",
    column_order: [
      "Category", "Sub Category", "Title", "Description", "Quantity", "Type",
      "Price", "Shipping Profile", "Offerable", "Hazmat", "Condition Type",
      "Condition Description", "Cost Per Item", "SKU",
    ],
    field_map: {
      "Category": "_category_group",
      "Sub Category": "sport_category",
      "Title": "_title",
      "Description": "_description",
      "Quantity": "=1",
      "Type": "=Buy it Now",
      "Price": "_price",
      "Shipping Profile": "=",
      "Offerable": "=TRUE",
      "Hazmat": "=Not Hazmat",
      "Condition Type": "_grading_status",
      "Condition Description": "_condition",
      "Cost Per Item": "=",
      "SKU": "sku",
    },
  },
};

export function computeField(card: CardRow, src: string): string {
  if (src.startsWith("=")) return src.slice(1);
  if (src === "_title") {
    return [card.year, card.player, card.set_name, card.parallel, card.card_number ? `#${card.card_number}` : ""]
      .filter(Boolean).join(" ").trim();
  }
  if (src === "_price") {
    const p = (card.manual_price ?? card.market_value) as number | null;
    return p == null ? "" : String(p);
  }
  if (src === "_market") {
    // Current market value (for insurance/valuation) — not your discounted ask.
    const p = (card.market_value ?? card.manual_price) as number | null;
    return p == null ? "" : String(p);
  }
  if (src === "_condition") {
    return card.condition_type === "graded"
      ? `${card.grader ?? ""} ${card.grade ?? ""}`.trim()
      : String(card.raw_grade_estimate ?? "Raw");
  }
  if (src === "_category_group") {
    return categoryKind(card.sport_category as string | null) === "sport"
      ? "Sports Cards"
      : categoryKind(card.sport_category as string | null) === "tcg"
        ? "Trading Card Games"
        : "Trading Cards";
  }
  if (src === "_grading_status") {
    return card.condition_type === "graded" ? "Graded" : "Near Mint";
  }
  if (src === "_description") {
    const title = computeField(card, "_title");
    const cond = card.condition_type === "graded"
      ? `${card.grader ?? ""} ${card.grade ?? ""}`.trim()
      : `Raw${card.raw_grade_estimate ? ` (est. ${card.raw_grade_estimate})` : ""}`;
    const serial = card.serial_number ? `, serial numbered ${card.serial_number}` : "";
    return `${title}. ${cond}${serial}. See photos for condition.`;
  }
  const v = card[src];
  return v == null ? "" : String(v);
}

function esc(v: string): string {
  // Neutralize CSV formula injection — Excel/Sheets execute cells that begin
  // with = + - @ (or a control char). Prefix those with an apostrophe.
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCsv(cards: CardRow[], profile: FormatProfile): string {
  const cols = profile.column_order ?? Object.keys(profile.field_map);
  const header = cols.map(esc).join(",");
  const rows = cards.map((card) =>
    cols.map((col) => esc(computeField(card, profile.field_map[col] ?? col))).join(","),
  );
  return [header, ...rows].join("\r\n");
}

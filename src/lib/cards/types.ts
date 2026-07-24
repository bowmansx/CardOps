// CardOps shared types + option vocab (client-safe).

// ── Category registry (Beau, 2026-07-18) ────────────────────────────────────
// Categories are first-class: a KIND (sport vs tcg) drives category-aware
// forms/AI (sports get Player/Team/RC; TCGs get Card name/Rarity/Language),
// `code` drives SKU prefixes, `short` labels the filter chips. The `key` is
// what's stored in cards.sport_category — existing keys must never change.
export type CategoryKind = "sport" | "tcg" | "other";
export type CardCategory = {
  key: string;
  label: string;
  short: string;
  code: string;
  kind: CategoryKind;
};

export const CATEGORIES: CardCategory[] = [
  { key: "Football",   label: "Football",                      short: "FB",      code: "FB", kind: "sport" },
  { key: "Basketball", label: "Basketball",                    short: "BK",      code: "BK", kind: "sport" },
  { key: "Baseball",   label: "Baseball",                      short: "BB",      code: "BB", kind: "sport" },
  { key: "Hockey",     label: "Hockey",                        short: "HK",      code: "HK", kind: "sport" },
  { key: "Soccer",     label: "Soccer",                        short: "SOC",     code: "SC", kind: "sport" },
  { key: "Pokemon",    label: "Pokémon",                       short: "PKMN",    code: "PK", kind: "tcg" },
  { key: "MTG",        label: "Magic: The Gathering",          short: "MTG",     code: "MT", kind: "tcg" },
  { key: "LoL TCG",    label: "League of Legends (Riftbound)", short: "LoL",     code: "LL", kind: "tcg" },
  { key: "Other",      label: "Other",                         short: "Other",   code: "OT", kind: "other" },
];

export function categoryKind(key: string | null | undefined): CategoryKind {
  return CATEGORIES.find((c) => c.key === key)?.kind ?? "other";
}
export const isTcg = (key: string | null | undefined) => categoryKind(key) === "tcg";

// Legacy flat list (dropdown order) — derived so nothing drifts.
export const SPORT_CATEGORIES: string[] = CATEGORIES.map((c) => c.key);
export const CARD_STATUSES = [
  "intake", "review", "booked", "listed", "sold", "hold", "graded_out", "archived",
] as const;
export const ZONES = ["GR", "RP", "BULK", "LIST", "HOLD"] as const;
export const GRADERS = ["PSA", "BGS", "SGC", "CGC", "HGA", "ISA", "GMA", "OTHER"] as const;
export const ACQUISITION_METHODS = [
  "purchased", "inherited", "partnership_split", "trade", "pull",
] as const;

export type Card = {
  id: string;
  sku: string;
  player: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  parallel: string | null;
  sport_category: string | null;
  team: string | null;
  rarity: string | null;
  language: string | null;
  brand: string | null;
  storage_location: string | null;
  is_rookie: boolean | null;
  is_auto: boolean | null;
  is_relic: boolean | null;
  serial_number: string | null;
  condition_type: string;
  grader: string | null;
  grade: number | null;
  cert_number: string | null;
  status: string;
  zone: string | null;
  location_code: string | null;
  market_value: number | null;
  manual_price: number | null;
  pricing_strategy: string;
  purchase_lot_id: string | null;
  individual_basis: number | null;
  acquisition_method: string | null;
  acquisition_source: string | null;
  notes: string | null;
  created_at: string;
};

// ── Pricing standards ───────────────────────────────────────────────────────
// One shared list for every picker (manual form, all three intake modes).
// Today these mirror the six seeded card_pricing_strategies rows; when the
// pricing builder ships, this becomes the user's own recipe list.
export const PRICING_STRATEGY_OPTIONS = [
  { key: "standard", label: "Standard" },
  { key: "conservative", label: "Conservative" },
  { key: "aggressive", label: "Aggressive" },
  { key: "hot", label: "Hot" },
  { key: "thin_market", label: "Thin market" },
  { key: "manual_lock", label: "Manual lock" },
] as const;

// ── Self-generating tags ────────────────────────────────────────────────────
// Cards tag THEMSELVES from their own fields — no manual tagging, never stale.
// Used for row chips and (via the matching column filters) the tag facets.
export function deriveTags(c: Partial<Card>): string[] {
  const t: string[] = [];
  const rpa = !!c.is_rookie && !!c.is_auto && !!c.is_relic;
  if (rpa) t.push("RPA");
  else {
    if (c.is_rookie) t.push("RC");
    if (c.is_auto) t.push("AUTO");
    if (c.is_relic) t.push("PATCH");
  }
  if (c.serial_number) {
    const den = /\/\s*(\d+)/.exec(c.serial_number)?.[1];
    t.push(den ? `/${den}` : "#'d");
  }
  if (c.condition_type === "graded" && c.grader) {
    t.push(c.grade != null ? `${c.grader} ${c.grade}` : c.grader);
  }
  if (c.rarity) t.push(c.rarity);
  if (c.brand) t.push(c.brand);
  return t;
}

// Facet chips on the inventory — each maps to a real column filter, so the
// "tags" are searchable without a tag table.
export const TAG_FACETS = [
  { key: "rc", label: "RC", full: "Rookie Card" },
  { key: "auto", label: "AUTO", full: "Autograph" },
  { key: "patch", label: "PATCH", full: "Memorabilia / Patch" },
  { key: "rpa", label: "RPA", full: "Rookie Patch Auto" },
  { key: "numbered", label: "#'d", full: "Serial numbered" },
  { key: "graded", label: "Graded", full: "Graded (slabbed)" },
  { key: "raw", label: "Raw", full: "Raw (ungraded)" },
  { key: "psa", label: "PSA", full: "PSA graded" },
  { key: "bgs", label: "BGS", full: "Beckett (BGS) graded" },
  { key: "sgc", label: "SGC", full: "SGC graded" },
  { key: "cgc", label: "CGC", full: "CGC graded" },
] as const;

// Deadline-style status tone for chips.
export const STATUS_TONE: Record<string, string> = {
  intake: "bg-ink/10 text-ink/60",
  review: "bg-warn/15 text-warn",
  booked: "bg-sky-600/15 text-sky-700",
  listed: "bg-flag/15 text-flag",
  sold: "bg-pos/15 text-pos",
  hold: "bg-ink/10 text-ink/60",
  graded_out: "bg-violet-600/15 text-violet-700",
  archived: "bg-ink/10 text-ink/40",
};

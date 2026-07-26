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
// Tax classification. THREE values, not two: `hobby` is not a softer `investment`
// — it decides whether a LOSS is deductible at all (§183 disallows hobby losses,
// §165(c)(2) allows investment ones). Collapsing them would quietly change the
// answer to a question the IRS asks.
export const TAX_BUCKETS = ["investment", "dealer", "hobby"] as const;
export type TaxBucket = (typeof TAX_BUCKETS)[number];

// Physical disposition of an asset, orthogonal to the sales funnel `status`.
// A vaulted asset is not "hold" — it has a funnel position AND a location.
export const ASSET_STATES = [
  "in_my_possession", "at_appraisal", "out_for_crossover",
  "at_auction_house_on_consignment", "vaulted", "pledged_as_collateral",
  "crossover_failed",
] as const;
export type AssetState = (typeof ASSET_STATES)[number];

// States that mean the asset is out of your hands and must carry a return date.
export const ASSET_STATES_REQUIRING_RETURN: readonly AssetState[] = [
  "at_appraisal", "out_for_crossover", "at_auction_house_on_consignment",
  "pledged_as_collateral", "crossover_failed",
];

// What a document proves. This is what turns a folder of PDFs into an evidence
// packet — and what lets the app say "your basis has no supporting document".
export const DOCUMENT_PROVES = [
  "basis", "reported_value", "grade", "insured_value", "custody", "title",
  "provenance", "other",
] as const;
export type DocumentProves = (typeof DOCUMENT_PROVES)[number];

// ZONES retired 2026-07-26. The five codes (GR/RP/BULK/LIST/HOLD) had no
// definition anywhere in the repo, and three of them duplicated a `status`
// value — GR/graded_out, LIST/listed, HOLD/hold — so two fields could disagree
// about the same card with nothing to reconcile them. What each was reaching
// for now has a real home:
//   status      — where the card is in the selling lifecycle (DB-enforced)
//   asset_state — where it physically is (custody, guarded, logged)
//   location    — which shelf, free text, remembers what you type
// The `cards.zone` column is left in place; existing values are still readable
// and nothing writes it any more.
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
  // The shared print identity this card resolves to (set by DB trigger).
  // Null when the card is too sparse to fingerprint — no player and no set.
  identity_id: string | null;
  // Tax classification: recorded, never determined by the app. Inherited from
  // the purchase lot at creation; changed only via card_reclass_tax_bucket.
  tax_bucket: TaxBucket | null;
  tax_bucket_source: "lot_default" | "explicit_override" | null;
  tax_bucket_set_at: string | null;
  tax_bucket_reason: string | null;
  // Physical disposition, ORTHOGONAL to `status`. Null for ordinary inventory.
  asset_state: AssetState | null;
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
  /** Trigger-maintained sum of card_basis_items. Never written directly. */
  basis_items_total: number | null;
  /** False = no cost basis was ever stated. Keeps 0 from reading as fact. */
  basis_entered: boolean | null;
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

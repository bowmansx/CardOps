// Funding-path modeling for card acquisition (Beau, 2026-07-21). Cards are funded
// PERSONALLY; when they end up in an entity it's either a SALE to the entity or an
// ADVANCE the owner paid personally (booked as a member loan or an equity
// contribution). This module is a pure "what would each option book, and how does
// it come out?" engine behind the Card Booking Simulator — decision-support only,
// NOT tax advice. Every entry it returns balances by construction.
//
// It reuses the same double-entry builders the live ledger uses (cardSaleLines /
// assetAccount), so a simulated outcome matches what a real posting would produce.

import {
  cardSaleLines,
  assetAccount,
  linesBalance,
  type JournalLine,
  type EntityEntry,
  type TaxTreatment,
} from "./journal";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// How personally-funded cards end up in whatever holds them.
export type FundingPath =
  | "keep_personal" // cards stay on the owner's personal books
  | "sale_to_entity" // owner SELLS personally-held cards to the entity (related-party) → basis resets to the price
  | "loan_to_entity" // owner pays for the entity's cards personally; the entity owes the owner (member loan / due-to-owner)
  | "capital_contribution"; // owner contributes the cards/cash as equity into the entity (increases owner's basis in the entity)

export const FUNDING_PATHS: FundingPath[] = ["keep_personal", "sale_to_entity", "loan_to_entity", "capital_contribution"];

export const FUNDING_LABEL: Record<FundingPath, string> = {
  keep_personal: "Keep personal (cards stay on your books)",
  sale_to_entity: "Sell to the entity (related-party sale)",
  loan_to_entity: "Advance / paid personally → member loan",
  capital_contribution: "Contribute as capital (equity)",
};

export const FUNDING_BLURB: Record<FundingPath, string> = {
  keep_personal: "You bought them, you hold them. Basis = your cost. Nothing moves between books.",
  sale_to_entity: "You sell your personally-held cards to the entity. You recognize gain/loss (price − your cost); the entity's basis becomes the price it paid you.",
  loan_to_entity: "You paid for the entity's cards out of pocket. The entity records the cards at your cost and owes you the money back (a loan).",
  capital_contribution: "You put the cards/cash into the entity as equity. No gain to you now; your basis in the entity goes up by what you put in.",
};

export type Character = "capital" | "ordinary" | "hobby" | "none";
const CHARACTER: Record<TaxTreatment, Character> = { dealer: "ordinary", investment: "capital", hobby: "hobby" };

export type FundingInput = {
  cost: number | string | null; // what the owner paid out of pocket for the cards
  transfer_price?: number | string | null; // sale_to_entity: price the entity pays the owner (defaults to cost)
  path: FundingPath;
  owner_entity_id: string | null; // whose personal books funded it (usually "Personal")
  owner_treatment: TaxTreatment; // how the owner held them before any transfer (usually "investment")
  entity_id: string | null; // the receiving entity (ignored for keep_personal)
  entity_treatment: TaxTreatment; // how the receiving entity will hold them
  settled?: boolean; // sale/advance paid in cash now (true) vs left as a receivable/payable (false)
};

// Rename a specific account on a set of lines (e.g. cash → due_from_entity when a
// related-party sale isn't paid in cash yet). Preserves debit/credit + memo.
function relabel(lines: JournalLine[], from: string, to: string, memo?: string): JournalLine[] {
  return lines.map((l) => (l.account === from ? { ...l, account: to, memo: memo ?? l.memo } : l));
}

/**
 * The acquisition entries a funding path produces — one balanced entry per affected
 * entity (the owner's books, and, when a transfer happens, the receiving entity's).
 *
 *   keep_personal:        [ owner: Dr <owner asset> · Cr Cash ]
 *   sale_to_entity (P):   [ owner: the SALE under owner's treatment (basis = cost, proceeds = P),
 *                           entity: Dr <entity asset> P · Cr Cash|Due-to-owner P ]   (basis resets to P)
 *   loan_to_entity:       [ owner: Dr Due-from-entity · Cr Cash,
 *                           entity: Dr <entity asset> · Cr Due-to-owner ]            (basis = cost)
 *   capital_contribution: [ owner: Dr Investment-in-entity · Cr Cash,
 *                           entity: Dr <entity asset> · Cr Owner Equity ]            (basis = cost)
 */
export function acquisitionEntries(a: FundingInput): EntityEntry[] {
  const cost = round2(num(a.cost));
  if (cost <= 0) return [];
  const price = round2(a.transfer_price == null ? cost : num(a.transfer_price));
  const settled = a.settled !== false; // default: paid in cash now

  if (a.path === "keep_personal") {
    return [{
      entityId: a.owner_entity_id ?? null,
      lines: [
        { account: assetAccount(a.owner_treatment), debit: cost, credit: 0, memo: "cards bought (held personally)" },
        { account: "cash", debit: 0, credit: cost, memo: "paid" },
      ],
    }];
  }

  if (a.path === "sale_to_entity") {
    // Owner side = a disposition of the cards at the transfer price, booked under
    // the OWNER's treatment (reuses the same sale builder the ledger uses).
    let ownerLines = cardSaleLines(
      { sale_price: price, fees: 0, shipping_income: 0, shipping_cost: 0, basis_drawn: cost },
      a.owner_treatment,
    );
    if (!settled) ownerLines = relabel(ownerLines, "cash", "due_from_entity", "sold to entity (unpaid)");
    return [
      { entityId: a.owner_entity_id ?? null, lines: ownerLines },
      {
        // Entity buys the cards → basis RESETS to the price it paid.
        entityId: a.entity_id ?? null,
        lines: [
          { account: assetAccount(a.entity_treatment), debit: price, credit: 0, memo: "cards bought from owner (basis = price)" },
          settled
            ? { account: "cash", debit: 0, credit: price, memo: "paid owner" }
            : { account: "due_to_owner", debit: 0, credit: price, memo: "owed to owner" },
        ],
      },
    ];
  }

  // loan_to_entity or capital_contribution: no gain to the owner now; the entity
  // carries the cards at the owner's cost. They differ only in the owner's
  // offsetting account (a receivable/loan vs. equity in the entity) and the
  // entity's credit (a payable to the owner vs. contributed capital).
  const isLoan = a.path === "loan_to_entity";
  return [
    {
      entityId: a.owner_entity_id ?? null,
      lines: [
        isLoan
          ? { account: "due_from_entity", debit: cost, credit: 0, memo: "advance to entity (loan)" }
          : { account: "investment_in_entity", debit: cost, credit: 0, memo: "capital put into entity" },
        { account: "cash", debit: 0, credit: cost, memo: "paid for the entity's cards" },
      ],
    },
    {
      entityId: a.entity_id ?? null,
      lines: [
        { account: assetAccount(a.entity_treatment), debit: cost, credit: 0, memo: "cards acquired (basis = cost)" },
        isLoan
          ? { account: "due_to_owner", debit: 0, credit: cost, memo: "member loan from owner" }
          : { account: "owner_equity", debit: 0, credit: cost, memo: "owner capital contribution" },
      ],
    },
  ];
}

// Who holds the cards after acquisition, at what basis, under what treatment.
export function holderAfter(a: FundingInput): { entityId: string | null; basis: number; treatment: TaxTreatment } {
  const cost = round2(num(a.cost));
  if (a.path === "keep_personal") return { entityId: a.owner_entity_id ?? null, basis: cost, treatment: a.owner_treatment };
  const basis = a.path === "sale_to_entity" ? round2(a.transfer_price == null ? cost : num(a.transfer_price)) : cost;
  return { entityId: a.entity_id ?? null, basis, treatment: a.entity_treatment };
}

export type ScenarioInput = FundingInput & {
  sale_price?: number | string | null; // model an eventual sale at this price (optional)
  fees?: number | string | null; // selling fees on the eventual sale
  shipping_cost?: number | string | null;
  holding_months?: number | null; // for the long-term-vs-short-term note (investment)
};

export type ScenarioResult = {
  acquisition: EntityEntry[];
  sale: EntityEntry | null; // the eventual sale, booked on the holder's books
  holder_entity_id: string | null;
  holder_basis: number;
  holder_treatment: TaxTreatment;
  acquisition_gain: number; // gain the OWNER recognizes at transfer (sale_to_entity only)
  acquisition_character: Character;
  final_gain: number; // gain the HOLDER recognizes at the modeled sale price (net of selling costs)
  final_character: Character;
  self_employment_exposed: boolean; // dealer holder → final gain carries SE tax
  long_term_possible: boolean; // investment holder + held ≥ 12 months
  balanced: boolean; // every entry (acquisition + sale) balances
  flags: string[]; // CPA flags to raise — NOT advice
};

/**
 * Run one funding scenario end-to-end: how the cards get in, who then holds them,
 * and (optionally) how an eventual sale comes out — with the tax character and the
 * CPA flags to raise. Pure; no I/O. Decision-support only, NOT tax advice.
 */
export function simulate(s: ScenarioInput): ScenarioResult {
  const cost = round2(num(s.cost));
  const acquisition = acquisitionEntries(s);
  const holder = holderAfter(s);

  // Gain the owner recognizes at a related-party sale (price − cost).
  const acquisition_gain = s.path === "sale_to_entity"
    ? round2((s.transfer_price == null ? cost : round2(num(s.transfer_price))) - cost)
    : 0;
  const acquisition_character: Character = s.path === "sale_to_entity" ? CHARACTER[s.owner_treatment] : "none";

  // Optional eventual sale on the holder's books.
  let sale: EntityEntry | null = null;
  let final_gain = 0;
  let final_character: Character = "none";
  if (s.sale_price != null && num(s.sale_price) > 0) {
    const price = round2(num(s.sale_price));
    const fees = round2(num(s.fees));
    const shipCost = round2(num(s.shipping_cost));
    const net = round2(price - fees - shipCost);
    final_character = CHARACTER[holder.treatment];
    // The headline gain MUST match the income line the journal actually books:
    //   hobby     → receipts − basis  (selling costs are NON-deductible → they do
    //               NOT reduce taxable income; they sit in nondeductible_costs)
    //   dealer    → net − basis       (fees/shipping ARE deductible)
    //   investment→ net − basis       (selling costs reduce amount realized)
    final_gain = holder.treatment === "hobby" ? round2(price - holder.basis) : round2(net - holder.basis);
    sale = {
      entityId: holder.entityId,
      lines: cardSaleLines({ sale_price: price, fees, shipping_income: 0, shipping_cost: shipCost, basis_drawn: holder.basis }, holder.treatment),
    };
  }

  // SE-tax exposure: the holder's dealer sale, OR the owner's own dealer disposition
  // when selling dealer inventory to the entity (ordinary + SE to the owner NOW).
  const owner_se = s.path === "sale_to_entity" && s.owner_treatment === "dealer" && acquisition_gain > 0;
  const holder_se = sale != null && holder.treatment === "dealer" && final_gain > 0;
  const self_employment_exposed = owner_se || holder_se;

  // A purchase (sale_to_entity) restarts the BUYER's holding clock, so the entity
  // can't inherit the owner's prior months; carryover-basis paths let it tack/run.
  const holderTacksHolding = s.path !== "sale_to_entity";
  const long_term_possible = holder.treatment === "investment" && holderTacksHolding && (s.holding_months ?? 0) >= 12;

  const flags: string[] = [];
  if (s.path === "sale_to_entity") {
    flags.push("Related-party sale (you → your own entity): §267 rules apply — a LOSS is generally DISALLOWED (not deductible now) and a gain may be recharacterized. Confirm with your CPA.");
    if (acquisition_gain > 0) {
      flags.push(`You'd recognize a ${money(acquisition_gain)} gain now, taxed as ${acquisition_character}${owner_se ? " + self-employment tax (~15.3%)" : ""}.`);
    } else if (acquisition_gain < 0) {
      flags.push(`Your ${money(-acquisition_gain)} loss is likely DISALLOWED under §267 — not deductible now; it can instead reduce the entity's gain on a later sale to an outside buyer. Confirm with your CPA.`);
    }
  }
  if (s.path === "loan_to_entity") flags.push("Booked as a member loan (the entity owes you). Paper the loan; the IRS can impute interest on family/related loans — confirm with your CPA.");
  if (s.path === "capital_contribution") flags.push("Booked as a capital contribution — it raises your equity basis in the entity, it is not a deductible expense.");
  if (holder.treatment === "dealer") flags.push("Dealer: profits are ordinary income + self-employment tax (~15.3% on net), but ordinary/necessary business expenses are deductible.");
  if (holder.treatment === "investment") {
    if (s.path === "sale_to_entity") flags.push("The entity BOUGHT these, so its holding period restarts at the purchase — long-term status depends on how long the ENTITY holds them, not your prior holding.");
    else flags.push((s.holding_months ?? 0) >= 12
      ? "Investment held ≥ 1 year → long-term capital gain rates (lower)."
      : "Investment held < 1 year → short-term (ordinary rates). Crossing 1 year flips it to long-term.");
  }
  if (holder.treatment === "hobby") flags.push("Hobby: income is taxable but selling costs are NOT deductible — usually the worst of both; confirm this is really the right classification with your CPA.");

  const balanced = acquisition.every((e) => linesBalance(e.lines)) && (sale == null || linesBalance(sale.lines));

  return {
    acquisition, sale,
    holder_entity_id: holder.entityId, holder_basis: holder.basis, holder_treatment: holder.treatment,
    acquisition_gain, acquisition_character,
    final_gain, final_character,
    self_employment_exposed, long_term_possible, balanced, flags,
  };
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

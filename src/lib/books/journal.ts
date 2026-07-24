// Journal line builders (Beau, 2026-07-20). Pure double-entry: turn a business
// event into balanced debit/credit lines against the internal chart of accounts.
// No I/O — the posting route reads events and writes the returned lines. Every
// builder MUST return lines whose debits equal credits (linesBalance asserts it).

export type JournalLine = { account: string; debit: number; credit: number; memo?: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type SaleInput = {
  sale_price: number | string | null;
  fees: number | string | null;
  shipping_income: number | string | null;
  shipping_cost: number | string | null;
  basis_drawn: number | string | null;
};

// How a card is taxed determines how its sale is booked. NOT tax advice — the
// mapping below is a reasonable default; confirm treatment with a CPA.
export type TaxTreatment = "dealer" | "investment" | "hobby";
export const TAX_TREATMENTS: TaxTreatment[] = ["dealer", "investment", "hobby"];
export const TREATMENT_LABEL: Record<TaxTreatment, string> = {
  dealer: "Dealer (inventory / ordinary income)",
  investment: "Investment (capital gain/loss)",
  hobby: "Hobby (income taxable, costs not deductible)",
};

/**
 * A card sale as double-entry, booked per its tax treatment. All three branches
 * balance by construction (Σ debit-side amounts == Σ credit-side amounts):
 *   dealer:     Cash · Fees · Shipping · Sales Revenue · COGS · Inventory
 *   investment: Cash · Investment Assets (basis) · Capital Gain/Loss (proceeds−basis)
 *   hobby:      Cash · Nondeductible Costs (fees+ship) · Card Assets (basis) · Hobby Income
 * Handles losses / refunds (a negative amount flips to the opposite side).
 */
export function cardSaleLines(s: SaleInput, treatment: TaxTreatment = "dealer"): JournalLine[] {
  const price = round2(num(s.sale_price));
  const fees = round2(num(s.fees));
  const shipIn = round2(num(s.shipping_income));
  const shipCost = round2(num(s.shipping_cost));
  const basis = round2(num(s.basis_drawn));
  const net = round2(price - fees + shipIn - shipCost); // cash actually received
  const revenue = round2(price + shipIn); // gross receipts

  const lines: JournalLine[] = [];
  const dr = (account: string, amt: number, memo: string) => {
    if (amt > 0) lines.push({ account, debit: round2(amt), credit: 0, memo });
    else if (amt < 0) lines.push({ account, debit: 0, credit: round2(-amt), memo });
  };
  const cr = (account: string, amt: number, memo: string) => {
    if (amt > 0) lines.push({ account, debit: 0, credit: round2(amt), memo });
    else if (amt < 0) lines.push({ account, debit: round2(-amt), credit: 0, memo });
  };

  if (treatment === "investment") {
    // Capital asset: amount realized (net of selling costs) vs basis = gain/loss.
    // Selling fees/shipping reduce the amount realized rather than deducting.
    dr("cash", net, net >= 0 ? "net proceeds" : "net outlay");
    cr("investment_assets", basis, "release investment at basis");
    cr("capital_gain_loss", round2(net - basis), "realized capital gain/loss");
    return lines;
  }

  if (treatment === "hobby") {
    // Hobby: gross receipts − COGS is taxable income; selling costs are NOT
    // deductible → they land in a non-deductible account (visible, not expensed).
    dr("cash", net, net >= 0 ? "net proceeds" : "net outlay");
    dr("nondeductible_costs", round2(fees + shipCost), "nondeductible selling costs");
    cr("card_assets", basis, "release card at basis");
    cr("hobby_income", round2(revenue - basis), "hobby income (receipts − COGS)");
    return lines;
  }

  // dealer (default): full inventory / COGS / business income.
  dr("cash", net, net >= 0 ? "net proceeds" : "net outlay");
  dr("platform_fees", fees, "platform fees");
  dr("shipping_expense", shipCost, "shipping");
  cr("sales_revenue", revenue, "card sale");
  dr("cogs", basis, "cost basis");
  cr("inventory", basis, "inventory relief");
  return lines;
}

/** True when the entry is balanced (debits == credits within a cent). */
export function linesBalance(lines: JournalLine[]): boolean {
  const d = lines.reduce((a, l) => a + l.debit, 0);
  const c = lines.reduce((a, l) => a + l.credit, 0);
  return Math.abs(round2(d) - round2(c)) < 0.005;
}

// ── Receipts & intercompany advances ────────────────────────────────────────
// A cost receipt is either the paying entity's own purchase (its pool or specific
// cards), or an ADVANCE to an affiliate — where the receiving company then books
// the money on ITS OWN books (a second, balanced entry). Each entity's entry
// balances on its own; the intercompany advance/payable net out at consolidation.
export type EntityEntry = { entityId: string | null; lines: JournalLine[] };

export type ReceiptDisposition = "pool" | "cards" | "advance";
export type ReceiptInput = {
  amount: number | string | null;
  entity_id: string | null; // who paid
  disposition: ReceiptDisposition;
  treatment?: TaxTreatment | null; // pool/cards: how the acquirer holds them
  to_entity_id?: string | null; // advance: which affiliate received it
  advance_disposition?: "pool" | "cards" | null; // how the receiver books it
  advance_treatment?: TaxTreatment | null; // advance: how the RECEIVER holds them
};

/** The asset account card basis lives in, per treatment — so a purchase debits and
 *  a later sale credits the SAME account (dealer=inventory, investment=investment_
 *  assets, hobby=card_assets). Keeps the ledger's asset accounts consistent. */
export function assetAccount(t?: TaxTreatment | null): string {
  return t === "investment" ? "investment_assets" : t === "hobby" ? "card_assets" : "inventory";
}

/**
 * The journal entries a receipt produces — one per affected entity, each balanced.
 *   pool / cards: [ payer:  Dr Inventory · Cr Cash ]
 *   advance:      [ payer:  Dr Intercompany Advance · Cr Cash,
 *                   payee:  Dr Inventory · Cr Intercompany Payable ]
 * (pool vs cards is the same double-entry — the difference is WHERE the cost
 *  basis lands in the card system, handled separately, not in the ledger.)
 */
export function receiptEntries(r: ReceiptInput): EntityEntry[] {
  const amt = round2(num(r.amount));
  if (amt <= 0) return [];

  if (r.disposition === "advance") {
    if (!r.to_entity_id) return []; // a malformed advance books nothing (the route validates this)
    const toCards = r.advance_disposition === "cards";
    return [
      {
        entityId: r.entity_id ?? null,
        lines: [
          { account: "intercompany_advance", debit: amt, credit: 0, memo: "advance to affiliate" },
          { account: "cash", debit: 0, credit: amt, memo: "paid" },
        ],
      },
      {
        // The receiver holds the cards per ITS treatment → the matching asset account.
        entityId: r.to_entity_id,
        lines: [
          { account: assetAccount(r.advance_treatment), debit: amt, credit: 0, memo: toCards ? "cards purchase (via advance)" : "pool funding (via advance)" },
          { account: "intercompany_payable", debit: 0, credit: amt, memo: "advance from affiliate" },
        ],
      },
    ];
  }

  // The paying entity's own purchase — into the asset account for its treatment.
  return [
    {
      entityId: r.entity_id ?? null,
      lines: [
        { account: assetAccount(r.treatment), debit: amt, credit: 0, memo: r.disposition === "cards" ? "cards purchase" : "pool funding" },
        { account: "cash", debit: 0, credit: amt, memo: "paid" },
      ],
    },
  ];
}

# Card cost receipts + intercompany advances

Design (Beau, 2026-07-21). A cost receipt is classified, and its double-entry posts
to the internal journal. NOT tax advice — confirm intercompany treatment with a CPA.

## The three dispositions
1. **Pool** — the receipt funds the paying entity's card pool (bulk basis).
2. **Cards** — the receipt is the cost of specific card(s) for the paying entity.
3. **Advance** — the paying entity advances the money to *another* business, which
   then decides on **its own books** whether the money goes to *its* pool basis or
   *its* specific purchases. (This is the "secondary set of bookkeeping" — the
   receiving company re-classifies.)

## The double-entry (what posts to journal_entries)
- **pool / cards** — one balanced entry for the payer:
  `Dr Inventory · Cr Cash`. (pool vs cards is the same *ledger* entry; the
  difference is where the cost basis lands in the card system — see below.)
- **advance** — TWO balanced entries, tied by the intercompany accounts:
  - payer: `Dr Intercompany Advance (asset) · Cr Cash`
  - payee: `Dr Inventory · Cr Intercompany Payable (liability)`
  The advance/payable **net to zero at consolidation**; separately, each entity's
  standalone books are correct. This is exactly the two-sided treatment you asked
  for. Logic is pure + tested (`src/lib/books/journal.ts` `receiptEntries`).

## What's built (this phase)
- `card_receipts` table (payer entity, amount, disposition, advance target +
  the receiver's disposition, optional image/vendor/note). Owner-only.
- `/api/cards/receipts` — create (posts the journal), list, delete (also removes
  the receipt's journal lines).
- `/cards/receipts` — capture + classify UI, incl. the advance two-step (advance
  to → they book it as pool/purchases).

## Deferred (gated / next steps)
- **Card cost-basis mutation.** Recording a receipt currently posts the *ledger*
  entry but does NOT yet move the card system's cost basis — i.e. it doesn't add to
  `card_pool.total_cost` (a pool `add` adjustment) or set specific cards'
  `individual_basis`. That touches the money-critical, append-only pool ledger /
  RPC, so it's the careful next step (with a card picker for the 'cards' path).
- **Receipt image → vision extract** (amount/vendor) — reuse the existing receipt
  OCR pattern; on the existing Anthropic key.
- **Zoho push** — the receipt/advance journal entries feed the same gated Zoho push
  as sales, once the entity decision lands.
- **Surface intercompany balances** on `/cards/books` (advance-to / payable-from per
  entity) from journal_entries.

See [[cardops-accounting-and-advisor]], [[card-entity-decision]], [[zoho-setup]].

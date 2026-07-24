# CardOps ↔ MasterOps books, the Tax Advisor, and versatility

Design + phased plan (Beau, 2026-07-20). Three connected asks: (1) make CardOps a
*module of a business's books* — inventory as an asset, sales/purchases on the P&L
& balance sheet, flowing through MasterOps into the user's accounting backend
(Zoho for Beau); (2) a tax-optimization advisor over the bookkeeping; (3) where the
CardOps infrastructure generalizes.

---

## Part 1 — The connected-books architecture

**The shape:** CardOps owns cards (inventory, cost basis, sales/P&L). MasterOps owns
a **canonical books layer** (entities → accounts → journal entries) that CardOps
posts *into*. A pluggable **accounting adapter** translates the canonical journal to
the user's backend (Zoho Books, QuickBooks, Xero, or MasterOps-internal). Same
adapter pattern as the bank-sync sources — so "someone else with QuickBooks" just
swaps the adapter; CardOps never changes.

```
CardOps sale/purchase ─┐
Other asset modules  ──┼─▶ MasterOps canonical journal ─▶ [adapter] ─▶ Zoho / QBO / Xero / internal
(properties, machines) ┘        (entity, accounts, $)
```

**Accounting model (the double-entry that makes it real):**
- **Card inventory = a current asset** = aggregate **cost basis** of unsold cards
  (pool avg basis + individual-basis cards). Market value is shown as an *unrealized
  gain memo*, but the balance sheet asset is cost basis (that's what tax/GAAP use).
- **A sale posts a journal entry:** Dr Cash/Clearing (net proceeds) · Dr Fees
  (platform fees) · Cr Sales Revenue (gross) · Dr COGS (cost basis) · Cr Inventory
  (cost basis). Net P&L = revenue − fees − COGS = exactly the profit `card_sell`
  already computes. **Every number already exists** in CardOps — we're just booking it.
- **A purchase posts:** Dr Inventory · Cr Cash (or pool funding).
- **Entity attribution:** every card/lot/pool belongs to a business entity; the
  journal entry carries that entity, so each business's balance sheet & P&L only
  reflect its own cards.

**Category → account mapping:** a small map `(entity_id, internal_account) →
backend_account_id` (e.g. "Card Sales Revenue" → Zoho account 984000). Per entity,
because the same internal account maps to different real accounts per company. Flag
`TRANSFER` / `OWNER_DRAW` / intercompany so multi-entity moves don't double-count P&L.

**Sync options (in safety order — build in this order):**
1. **Internal ledger only** — post the journal into MasterOps' own ledger. Safe,
   reversible, no external side effects. Gives a working balance sheet & P&L *inside*
   MasterOps immediately. ← **start here.**
2. **Queue-for-review** — stage postings; user approves a batch before it hits Zoho.
3. **Live push to Zoho/QBO** — money-critical + outward-facing; **gated behind an
   explicit per-sale or batch confirm**, never silent/unattended (same caution as the
   eBay listing hold).

**What's the minimal first slice?** A read-only **"Business Books" view**: per entity,
compute Card Inventory (cost basis) as an asset + realized card P&L (revenue − fees −
COGS from `card_sales`) for a period. No posting, no new side effects — just surface
the numbers so cards already *show up* on the balance sheet & P&L. Then layer the
internal journal, then the review queue, then the gated Zoho push.

---

## Part 2 — The tax-optimization advisor

A system that watches the books + transactions + inventory and suggests tax-optimal
moves. **Framing (important):** this is bookkeeping-hygiene + *flags to raise with a
CPA*, never filing/return advice — you asked me elsewhere not to give personalized
financial advice, and the same guardrail applies to tax. Every actionable suggestion
ends in "confirm with your CPA."

**Tiers of value:**
1. **Clean bookkeeping first** (you can't optimize a mess): uncategorized
   transactions, missing receipts, unreconciled charges, cards with no cost basis.
   Mostly already built (the transactions platform + reconciliation) — surface it as
   a "books health" score.
2. **This-year tax reduction:**
   - **Dealer vs. investor** (the big one for cards): dealer = ordinary income + SE
     tax but *full* expense deductions + inventory accounting; investor = capital
     gains + limited deductions. Which you are changes everything — flag it to decide
     with your CPA.
   - **Loss harvesting:** cards/positions below cost basis you could sell before
     year-end to offset realized gains.
   - **Timing:** accelerate deductible expenses / defer income (cash basis); Section
     179 on equipment.
   - **Holding period:** cards held >1 year get long-term capital-gains treatment (if
     investor) — flag ones approaching the 1-year mark before you sell.
3. **Future setup:** S-corp election once profit justifies the SE-tax savings;
   SEP-IRA / Solo-401k from business income; entity/trust structure (your AF-in-a-
   trust idea); cost-basis method (specific-ID vs average).
4. **Beyond-your-data flags:** "your income pattern suggests an S-corp could save
   ~$X in SE tax — ask your CPA"; "quarterly estimate likely due DATE — avoid the
   penalty"; "you may qualify for CREDIT." Informational nudges, not advice.

**Build:** a **rules engine** (deterministic: uncategorized count, missing receipts,
quarterly-estimate calendar, loss-harvest candidates, holding-period flags, gain/loss
totals) → an **AI synthesis layer** (Claude/Haiku on the existing key, gated) that
turns the numbers into a plain-English prioritized list + the beyond-data flags. A
`tax_insights` surface that refreshes periodically. Phase it: (1) books-health +
rules flags, (2) AI narrative, (3) entity-aware routing once your CPA sets structure.

---

## Part 3 — Versatility: what else the CardOps engine serves

CardOps is really a **"collectible/asset: intake → value → list → sell → P&L"
engine.** Reusable layers: camera+AI intake, multi-source valuation + comps + pricing
strategies, pool/lot **cost-basis accounting**, grade/condition estimation,
marketplace listing + settlement, portfolio NAV + movers + alerts + news, showcase.

**Transfers cleanly (do these first if expanding):** other collectibles that are
marketplace-priced with grading + comps — **Pokémon/other TCGs, sports memorabilia,
coins (PCGS/NGC), comics (CGC), Funko, sneakers, watches, stamps, vinyl, LEGO sets.**
Same loop, mostly a taxonomy + a price-source adapter (Scryfall-style) away. General
**reseller/flip inventory** (thrift, electronics refurb) fits too — buy/sell with
cost basis + fees + marketplace is the exact CardOps loop.

**Stretches (backbone reuses, specifics differ):** business **equipment/machines**
and **real estate** — "asset register + value-over-time + attribute-to-entity" reuses,
but they use *depreciation schedules*, not marketplace comps, and MasterOps already
has properties/machines. **Bullion/metals** fit via a spot-price feed (a card with a
live price).

**The honest answer to "am I reaching too far?":** the *intake/comp/grade* core is
collectible-specific — don't force it onto campgrounds. But the **entity-attributed
asset + cost-basis + P&L bridge we're building in Part 1 is domain-agnostic** — it
works for *any* MasterOps asset module (cards, properties, machines, equipment). So
the highest-versatility move is to **build the books bridge generically** — CardOps is
simply the *first* asset module to post to the books; properties/machines/future
modules plug into the same canonical journal. That is the real "immense versatility"
backbone, and it's the same work either way.

---

## Recommended build order
1. **Read-only "Business Books" view** (per-entity card inventory asset + realized
   P&L) — safe, immediate, proves the model. *(foundation — build now)*
2. Generic **canonical journal** + internal ledger posting (any asset module).
3. **Books-health + rules-based tax flags** (bookkeeping hygiene, quarterly, harvest,
   holding period, dealer-vs-investor prompt).
4. **AI tax-advisor synthesis** (gated, disclaimered).
5. Accounting **adapters**: Zoho push (gated) → QuickBooks → Xero.
6. Extend the asset-module pattern to a second collectible taxonomy / a second module.

See [[transaction-platform]], [[masterops-txns]], [[cardops]], [[zoho-setup]].

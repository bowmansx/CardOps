# Personal bookkeeping in Zoho + per-entity routing (decision brief)

**Decision-support only — NOT tax advice.** Confirm structure/treatment with your
CPA. This answers "what's the best way to set up personal bookkeeping in Zoho?" and
documents how MasterOps routes each card transaction to the right Zoho org so the
whole thing works whether Personal is a Books org, an entity, or neither.

## TL;DR recommendation

**Set up a dedicated "Personal" Zoho Books organization** and point the MasterOps
`Personal` entity at it (`entities.zoho_books_org_id`). That gives you a real
personal balance sheet, your card portfolio as an asset, and a clean realized-gain
schedule to hand your CPA for Schedule D — without commingling anything into a
business org. It also preserves your "lean toward A" default: even with a personal
org, you decide **per transaction** whether personal card activity posts there or
just stays as clean records. Nothing forces you to one answer.

## The options (and why the dedicated org wins)

| Option | What it is | Verdict |
|---|---|---|
| **Dedicated Personal Books org** | A separate Zoho Books organization just for personal finances; the `Personal` entity maps to it | ✅ **Recommended** — clean separation, real personal books, Schedule-D-ready gain schedule |
| **Personal as an entity, no org** ("A") | `Personal` stays an entity but has no Books org; the app keeps basis / holding / realized-gain records you hand to your CPA | ✅ Great default; the simplest; **already how it works today** |
| Personal tracked inside a business org via classes/tags | Personal activity tagged inside e.g. AF's books | ❌ Not recommended — commingles personal + business; messy for taxes/audit |
| A brand-new legal entity for personal holdings | e.g. a personal holding LLC | ⚠️ A real legal/tax step — your call + your CPA/attorney; the app treats it like any other entity once it exists |

Key point: **personal card investing is Schedule D on your 1040, not a business
return.** A personal Books org is for *your* visibility + clean numbers, not because
the IRS wants a P&L for it. That's why "no org, clean records" (A) is a perfectly
valid setup and stays the default.

## Why you never have to choose once (the versatility)

Every entity row already carries its own `zoho_books_org_id`, and the push looks it
up **per transaction**. So the same system handles all of these at once, and you can
change your mind per card/lot:

- card booked under **AF** → posts to AF's org (`931036422`)
- card booked under **HOP** → posts to HOP's org (`931034783`)
- card booked under **Personal** → posts to your Personal org **if you set one up**,
  otherwise stays as clean records (A)
- card left on **Card Operations** → no org yet; held until you attribute it

This is the same "no single choice" principle as the entity brief — routing follows
the attribution you already set on each transaction.

## How your actual card funding maps (your words)

You fund cards **personally**; when they belong to an entity it's one of these. The
Booking Simulator (`/cards/books/simulator`) shows each one side by side:

1. **Sell the cards to the entity** → you recognize gain/loss (price − your cost) on
   your **personal** books; the entity buys them in at the price (new basis = price).
   ⚠️ Related-party sale — §267 can disallow a loss; CPA flag.
2. **You advanced the money / paid personally** → the entity records the cards at your
   **cost** and owes you back — booked as a **member loan** (due-to-owner) or a
   **capital contribution** (owner equity). No gain to you now.
3. **Keep them personal** → they stay on your personal books at cost.

The internal double-entry engine already produces the exact entries for all three
(both sides), so the eventual live push just translates those to each org.

## Chart-of-accounts starter (internal key → suggested Zoho account)

When you (or your CPA) set up the accounts in each org, this is the mapping the push
will use. Personal org needs the investment/gain accounts; AF/HOP (dealers) need the
inventory/COGS/revenue set. All orgs that ever receive an owner-funded purchase need
the due-to-owner / owner-equity accounts.

| Internal key | Account type | Suggested name |
|---|---|---|
| `investment_assets` | Asset | Trading Cards — at cost (investment) |
| `inventory` | Asset | Card Inventory (dealer) |
| `card_assets` | Asset | Cards held (hobby) |
| `capital_gain_loss` | Income/Equity | Realized Gain/Loss on Cards (Schedule D) |
| `sales_revenue` | Income | Card Sales |
| `cogs` | COGS | Cost of Cards Sold |
| `platform_fees` / `shipping_expense` | Expense | Selling Fees / Shipping |
| `hobby_income` | Income | Hobby Income — Cards |
| `nondeductible_costs` | Equity/Memo | Nondeductible Selling Costs |
| `due_from_entity` | Asset | Due from [Entity] (owner loans out) |
| `due_to_owner` | Liability | Member Loan — Owner |
| `investment_in_entity` | Asset/Equity | Investment in [Entity] |
| `owner_equity` | Equity | Owner Contributions |
| `intercompany_advance` / `intercompany_payable` | Asset / Liability | Due from / to Affiliate |

## "Line everything up" — who does what

**The app is already lined up** (versatile, per-entity, no single choice needed):
per-entity routing, the internal ledger, the simulator, and the backend-agnostic CSV
export all work today. The live Zoho **push adapter** (map these keys → each org's
real Zoho account IDs, then post) is the remaining build — gated, confirm-before-post.

**What only you can do in real Zoho** (I did **not** touch your live books — creating
orgs/accounts is standing config + has tax implications you and your CPA should own):

1. If you want personal books: **create a "Personal" Zoho Books organization**, then
   set `Personal.zoho_books_org_id` to its org id (one line, or I can do it on your
   say-so).
2. In **AF** (`931036422`) and **HOP** (`931034783`): confirm the chart of accounts
   has the dealer set above **plus** due-to-owner / owner-equity (for owner-funded
   buys).
3. Tell me the **Personal policy**: post personal card activity to the personal org,
   or keep it as clean records (A). Either is fully supported.

Then the only thing left is building + arming the gated push adapter — no entity
decision blocks it.

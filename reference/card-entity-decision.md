# Card business — which entity books it? (decision brief)

> **CORRECTION (2026-07-21):** This is **not a single, one-time entity pick.** Beau
> books cards under **multiple entities + Personal on a transaction-by-transaction
> (and group-by-group) basis** — that versatility is the whole point and is already
> built (per-card/group/receipt `entity_id` + `treatment`; the books + internal
> ledger route per-entity). The three "options" below are the **menu you draw from
> per transaction**, not a fork you resolve once. AF (`931036422`) and HOP
> (`931034783`) are both live Zoho orgs and push-ready; Personal has no business
> Books org by design. The only genuinely-open items for the live push are (a) the
> per-org chart-of-accounts mapping and (b) the policy for Personal-booked cards
> (skip business Zoho vs. a personal ledger) — neither is "pick one entity."

Below is **decision-support only — NOT tax advice.** Confirm treatment + structure
with your CPA. The point of this doc is to lay out the mechanics + what each means
for the MasterOps build, so you (and your CPA) can decide **per transaction**.

## The fundamental fork: dealer vs. investor (the biggest lever)

- **Investor** (you personally): card profits are **capital gains**. Held **>1 year
  → long-term** rates (lower); **<1 year → short-term** (ordinary rates). Deductions
  are **limited** (most investment expenses are nondeductible post-TCJA). **No
  self-employment tax.** Simplest structure; reported on Schedule D. Risk: if you
  trade very actively, the IRS can reclassify you as a dealer anyway.
- **Dealer** (Architect's Foundry or House of Packs): card profits are **ordinary
  business income** → income tax **+ self-employment tax (~15.3% on net)**, BUT you
  **deduct all ordinary/necessary business expenses** (fees, shipping, supplies,
  grading, software, mileage, home office…) and use **inventory / COGS** accounting
  (which the MasterOps books already do). Reported on Schedule C / the entity return.
- The call hinges on: **how actively you trade** (frequency/volume/intent), **how
  much you spend** on the business (deductions), and your other income. Classic
  tradeoff — **dealer = SE tax but full deductions; investor = no SE tax + long-term
  rates but few deductions.**

## The three options + system readiness

| Option | Treatment | Zoho Books org | Notes |
|---|---|---|---|
| **You personally** (investor) | Capital gains | none (personal isn't a Books org) | Simplest; long-term rates on >1yr holds; few deductions; reclassification risk if very active |
| **Architect's Foundry** (dealer) | Ordinary + SE | `931036422` ✅ ready | Routes card income through an existing operating entity; full deductions; inventory/COGS |
| **House of Packs** (dealer) | Ordinary + SE | `931034783` ✅ ready | ⚠ You'd noted **HoP is winding down** (no ops past 2025) — using it **revives** it, which may conflict with that plan |

## What each means for the build

- **AF-dealer or HOP-dealer → SAME tax treatment (dealer).** The internal journal I
  already built (inventory · COGS · revenue · fees) fits both. The only difference
  between AF and HOP is the **target Zoho org** (both are ready). So I can build the
  gated Zoho push for **whichever entity you attribute cards to** — the accounting
  model is identical; you just point it at the org.
- **Personal-investor → DIFFERENT model.** Capital gains (Schedule D), not a business
  P&L. The dealer journal isn't the right treatment; instead you track **basis +
  holding period + realized gains** — which the Business Books + tax advisor already
  surface — and hand that to your CPA. **No Zoho Books posting** (personal isn't a
  Books org). This path is "clean Schedule-D records," not "post to Zoho."

## Practical pointers for the CPA conversation

- Your **holding data already matters**: cards held >1yr get long-term rates *if*
  investor — the advisor flags cards nearing the 1-year mark.
- If **dealer**, either give the CARD "Card Operations" entity its own Zoho org, **or**
  route card income straight into AF/HOP (attribute cards to that entity — the intake
  picker + bulk-assign now do this).
- **Related-party angle**: selling your personal cards *into* a dealer entity has its
  own tax rules — flag it.
- **Trust ownership** (your AF-in-a-trust idea) is a separate layer on top of whichever
  you pick.

## Recommended sequencing (not tax advice)

1. This is a dealer-vs-investor call for your CPA — the numbers to inform it (realized
   gains, holding split, expense level) are on `/tax` and `/cards/books`.
2. **Land on DEALER (AF or HOP)** → attribute cards to that entity → I build the gated
   Zoho push to its org (the journal is ready; AF and HOP are the same treatment, so I
   don't even need you to pick between the two to start — just "dealer, entity X").
3. **Land on INVESTOR (personal)** → the books + advisor already give the Schedule-D
   inputs; no Zoho posting, and I'd tune the reporting to capital-gains framing
   (long-term vs short-term split by holding period).

Related: [[zoho-setup]], [[cardops-accounting-and-advisor]], [[cardops]].

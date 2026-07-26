# Money — basis, sales, books

The part where being wrong costs real dollars, so it's the part with the
guards.

## Cost basis

Two sources for what a card cost to ACQUIRE, and no third:

- **A purchase lot** — one purchase EVENT (cost, date, source, tax bucket). The
  card draws that lot's running average at sale, and the draw is reversed on
  un-sell through an append-only trail. Speed Book creates one per batch.
- **`individual_basis`** — a stated figure. **Optional** since 2026-07-25 and
  defaults to 0; `basis_entered` records whether a number was ever *stated*, so
  an un-costed card is findable and flagged rather than reading as free.

On top of either sits a third **category** (not a third source): **cost lines**
— grading, appraisal, sales tax, shipping in, plus user-defined kinds. They
accrete after acquisition, which is also what they are in tax terms.

    total basis = (lot average OR individual_basis) + cost lines

A lot-funded card can carry cost lines without the lot's balance moving.

## Rules that hold

- **A sold card's basis is locked.** Profit is recorded at sale and may already
  be posted to real books. Un-sell, edit, re-sell — that path is DB-enforced
  and leaves a trail. A restatement flow with a books-drift flag is
  deliberately NOT built.
- **Status is a transition, not a field.** The sold boundary and lot balances
  move only through `card_sell` / `card_unsell`, enforced by triggers.
- **Reports partition by SOURCE**, never by whether a card has a lot — that
  would count a lot card's cost lines twice.

## Books

Double-entry underneath, pluggable connectors on top. Zoho Books today, one org
per business. Nothing posts automatically: the preview screen posts nothing,
and Post confirms first, naming the business and the count. Already-posted
entries are skipped; anything unbalanced or unmapped is refused rather than
half-posted.

## Tax

Three treatments — dealer, investment, hobby — recorded per card, inherited
down a chain. **The app never makes the call.** It stores Beau's
classification, his stated reason, the timestamp, and an append-only trail.
Bookkeeping hygiene and flags to raise with a CPA; never filing, never advice.

## The harness

`supabase/tests/money-core.test.sql` — 48 assertions, paste it into the
Supabase SQL editor. The red error box is expected: raising is how it rolls its
own test data back. Run it after any change to sell/unsell/lot/basis SQL.

## Open

<!-- -->

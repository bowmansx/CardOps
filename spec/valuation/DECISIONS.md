# DECISIONS — valuation

**Yours.** Answers to the questions in [[FINDINGS]], and anything settled.
This file outranks [[FINDINGS]] — where they disagree, this wins.

---

## Answered

### CardOps is a PRODUCT, with metered pricing  *(2026-07-28)*

> "cardops is a tool in the form of an app/website that people will need to
> purchase computing power beyond their free amount for."

This was the question that outranked all the valuation ones, and it settles
several things at once.

**It is multi-tenant and commercial.** Not an internal tool. That means:

1. **PriceCharting's licence is a live problem.** Their API terms are
   internal-use-only, and `price-sources/pricecharting.ts` is already wired.
   Under an internal-tool reading that was arguable; under this one it is not.
   Either get a redistribution licence, or the connector serves only Beau's own
   account and never a customer's. **This needs resolving before a second user
   exists**, not after.
2. **Scryfall data cannot sit behind the credit meter.** Their terms forbid
   paywalling their data. Catalogue lookups that use it have to stay free even
   when other things are metered.
3. **Pooled outcomes need real privacy machinery.** Pooling one user's realised
   sales into everyone's model is now a data-sharing decision with a customer
   on the other side of it, not a personal preference.
4. **The metered model is confirmed as the shape**, which fits what is already
   built: the credit ledger, per-run cost metering, per-photo byte accounting.
   It also resolves the tension recorded in the strategy - the research
   recommended a flat $50-150/mo subscription; Beau's answer is compute-metered
   with a free tier, and that is now the decision rather than an open question.

**Consequence for this whole area:** the extrapolation ladder's upper rungs cost
money per card. Under a metered model that is a feature rather than a problem -
the spend is visible and chosen - but it makes the "bulk floor checked FIRST"
rule non-negotiable. A 5,000-card collection buy must not bill for 5,000
lookups.

---

## Settled by default, until you say otherwise

- The ladder position is **derived, not chosen** — the app climbs as little as
  it can and reports the rung it reached.
- Bulk detection runs **first**, before any paid lookup, so a 5,000-card
  collection buy cannot cost 5,000 API calls.
- An extrapolated figure is a **model output**, and what produced it travels
  with it wherever it is shown.

# Market research — 2026-07-26

Eight agents, five angles, 108 findings of which 93 carry a real source.
Commissioned because Beau asked to have his blind spots filled in on what
people actually need from an app like this.

**The full raw output** (every finding with its source) is in the workflow
transcript at `.claude/projects/*/subagents/workflows/wf_f8cdbfe9-d2b/`.
This file is the part worth keeping.

---

## The correction

**"Nobody tracks cost basis" was true in 2022 and is false in 2026.** Slabfy,
Whuppit, CardLogx, Viewible, InVelocity, CardZen and Mascot all attack cost
basis and margin, at $7–40/mo. Slabfy Pro ships consignment tracking and
card-show P&L at $40; its Shop tier is $149.

Both Claude sessions advising Beau — this one included — had been treating cost
basis as the moat. It is table stakes for the segment.

## The wedge

**Per-card inventory that closes into a real double-entry general ledger,
across multiple legal entities, with every number traceable to a document.**

- Of ~15 card products surveyed, **none** advertises an accounting integration
  (QuickBooks / Xero / Zoho) and none mentions double-entry, journal entries or
  a chart of accounts. They stop at "margin" and hand off a CSV.
- The reseller accounting tools that *do* have real books — Seller Ledger, My
  Reseller Genie — are marketplace-generic and have no concept of a card, a
  purchase lot, a grading cost line or a cert number.
- CPAs writing for this hobby in 2025–26 still recommend **a spreadsheet** as
  the cost-basis system of record. That is the real competitive baseline.

Defensible because it is architectural, not a feature: a scanner app cannot
grow a general ledger without rebuilding its data model; CardOps can reach
scanning parity in a sprint.

**Multi-entity is the sharp edge nobody else has.** Zero of eight products
checked let one operator keep two businesses' inventory and books apart. Beau
built it reflexively because he runs several businesses.

Also validated: **the purchase-lot running average is what tax practitioners
actually prescribe** for bulk lots. It was not an idiosyncratic design. But see
the allocation caveat below.

## Fix before tenant #2

**`card_fingerprint()` omits `is_auto` and `is_relic`, and nothing filters them
downstream.** Verified: both appear zero times in `src/lib/cards/valuation.ts`
and `src/lib/cards/market-sales.ts`.

So a signed copy and a base copy of the same card share one identity **and one
pooled `card_market_sales` history that every tenant reads**. Grade was
correctly excluded from the fingerprint *and* is filtered downstream; autograph
was excluded and is not.

This is the single most-repeated credibility complaint in the market — it is
the documented complaint against Ludex — except in a shared catalog it poisons
every tenant at once, and because the history accumulates, the pollution is
permanent. Fixing it later means splitting identities and re-partitioning
history.

Blast radius today: one user. It only grows.

## Wrong right now

**`src/lib/cards/settings.ts` defaults PSA grading to $25.** Per the research,
PSA paused every tier under $80 on 2026-06-02 against a backlog that went from
10M to 14M cards; realistic all-in is ~$100/card.

Every "should I grade this?" answer is computed against a price that no longer
exists, and it errs toward *yes*. A one-line default change; the real gap is
that there is no declared-value → service-level ladder, even though declared
value is what picks the tier and the app already holds a per-card valuation.

## Other confirmed gaps

- **Basis is born on the buy side, and the eBay integration is entirely
  sell-side.** Every route is list / relist / revise / ship / sync / offers /
  cancel / feedback — nothing ingests purchases. The documented failure mode is
  *abandonment*, not absence: people start tracking and quit because entry is
  manual. Auto-ingesting own eBay buys with price, shipping, tax and fees split
  out is Whuppit's entire wedge. The OAuth plumbing exists.
- **Import is the switching cost and it is hardcoded.** Fixed headers, no
  mapping UI, and `card_format_profiles` (which has `direction='both'` and
  `learned_from_import`) is never read on the import path — while
  `spec/00-what-cardops-is.md` names format ingestion as a native goal. Nobody
  switches if it means re-keying 5,000 cards.
- **Confidence is captured and nothing consumes it.** No review queue, and no
  record of "the AI said X, I corrected it to Y". Identification accuracy is
  where the market spread is enormous, and this data is unrecoverable
  retroactively.
- **Flat running average is wrong for a mixed lump-sum buy.** IRS Pub 551
  prescribes relative-FMV allocation when one payment buys multiple assets. The
  flat average is right for bulk commons and wrong for a $10k collection
  holding one $2,000 rookie and 900 commons. `CLAUDE.md`'s claim that the flat
  average is what practitioners prescribe needs narrowing to *bulk*.
- **1099-K reverted to $20,000 AND 200 transactions** for TY2025–26 (OBBBA,
  July 2025, retroactive). The naive read is that basis tracking got less
  urgent; the correct read is the reverse — most serious sellers now get **no
  form at all**, so their own records *are* the tax record with nothing to check
  them against. Any messaging built on the $600 threshold is wrong.
- **Consignment inflates the 1099-K.** The marketplace reports the consignor's
  full sale price as your gross. Getting to true income needs the sale booked
  as revenue and the payout as an expense line so the top line reconciles to
  the form. That is a double-entry problem, which is why Slabfy can ship
  consignment tracking and still not solve it.

## What to avoid

- **Scanning and price guides as a headline.** eBay's Trading Card Price Guide
  is free, in-app, scans to the exact parallel, covers two years including
  accepted Best Offers, and as of June 2026 added portfolios that track value
  and list. The venue where cards sell is giving away the layer CollX charges
  $10/mo for. Scanning must be good enough not to lose the deal; it can never
  be why you win.
- **A marketplace, or holding anyone's money or cards.** CollX's worst reviews
  are payment and shipping disputes, and those reviewers abandon the tracker
  too. COMC is the live cautionary tale.
- **Card-show POS.** The lane filled in 2025–26 and one entrant is free.
  Capturing show-day cash and trades *into the ledger* is a books feature and
  is the part worth having.
- **A sales-tax engine or nexus determination.** Jurisdictional quicksand, and
  it violates the posture that has kept this product honest. Record and flag;
  never compute an obligation.
- **Set registry / completion / census.** Needs a catalog of what EXISTS;
  `card_identities` is a catalog of what has been SEEN. Different, and
  unbridgeable without licensed checklist data.
- **Chasing the casual collector with a cheap tier.** Served free by eBay and
  TCDB, and it drags the roadmap toward features a dealer does not need.
- **An AI-grading accuracy race.** Photo quality matters more than the model.
  The defensible thing is the capture STANDARD — edge detection, deskew,
  sharpness gating, templates, retained originals with crop geometry. Market
  the standard and the evidence trail; never claim a percentage you cannot
  source.

## The uncomfortable part

Beau asked for a product serving "a wide variety of uses and people". The
research's answer is that **the variety is the trap**: the casual collector is
served free by eBay, the flipper lane filled in 2025–26 at under $10/mo, and
the high-end investor needs population and census data CardOps cannot source.
The winnable market is small and rich — dealers who have crossed into being a
business, with an LLC, a CPA, and increasingly consignors whose money is mixed
with theirs.

**Beau's own answer differs and may be better.** He wants Claude-style metered
pricing: mostly free to a level of compute and storage, pay when you exceed it.
That is not the flat $50–150/mo the research recommends, but it reaches the
same place by a different route — a dealer at volume consumes real compute and
storage and pays accordingly, while a hobbyist costs nothing and pays nothing.
It also fits what is already built: the credit ledger, the per-run cost
metering, the per-photo byte accounting. Worth noting the tension rather than
resolving it here.

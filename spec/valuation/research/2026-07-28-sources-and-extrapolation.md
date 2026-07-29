# Deep dive — sources, extrapolation, context, calibration

*2026-07-28. Five-agent research pass. Kept whole so any claim in [[FINDINGS]]
can be traced back. Not edited after the fact.*

**Verified locally before reporting:** the grade_delta pooling issue is real
(valuation.ts:187 drops the grade), but the default is 0 and no seeded
strategy sets it — so it is a latent trap, not a live defect. The research
called it live; that was overstated.

---

# Valuation & Extrapolation — Design Brief

**For:** Beau
**Date:** 2026-07-28
**Status:** discussion document. It ends in questions, not a plan. Nothing here is built.

---

## Before anything: what the research falsified

Standing rule is to diff every spec against the repo and say which claims were wrong. Three were, and one of them is a live defect.

**1. `reference/pricing-factors.md` §1 overstates the two planned comp connectors.** The line reads:

> Automated comp feeds (eBay orders API, PriceCharting API) — replaces pasting

Neither can do that. The eBay orders API returns *your own* sales only. The PriceCharting API returns current guide values and has no sales history at any tier. Together they cannot replace pasting for third-party sold comps, because **no reachable, permitted API supplies third-party sold comps at all.** That line should be corrected, because right now it stands up an expectation that pasting goes away.

**2. `interpretPipeline` has a real bias in it today.** In `src/lib/cards/valuation.ts` lines 146-188, `own_grade` and `cross_grade` filter comps to within `± grade_delta` of the card's grade — and then line 188 throws the grade away:

```ts
let entries = pool.map((c) => ({ price: c.sale_price as number, date: c.sale_date }));
```

With `grade_delta = 1`, a PSA 9 comp at $100 and a PSA 10 comp at $600 both enter the same pool, and both a PSA 9 and a PSA 10 come out around $350. The 9 is overvalued ~3.5x, the 10 undervalued ~1.7x. `grade_delta` currently buys sample size by injecting bias, and the bias grows with exactly the delta a thin card is forced to use. Anyone who raised `grade_delta` to escape a `min_comps` abstention traded an abstention for a wrong number — the worse of the two outcomes under your own posture. This is section 3, rung 3.

**3. The claim that "the engine has nowhere to put a range" is half wrong.** `card_estimates` (the AI path) already has `low`, `high`, `confidence`, `rationale`, `sources`. It is `card_valuations` — the deterministic pipeline's output — that has only `value`, `basis_source`, and a `confidence numeric(3,2)` that nothing in the codebase ever computes honestly or checks. So the range shape exists on the expensive path and not on the free one, which is backwards.

One thing I could **not** verify: the exact current text of eBay's API License Agreement. `developer.ebay.com` timed out repeatedly. The gen-AI clause below is reported by a secondary source and matters enough that you should read the agreement yourself before anything eBay-sourced reaches Card Intel.

---

## 1. What we can actually get

The honest headline: **there is no reachable, permitted API that sells third-party sold comps.** Not at any price a solo operator can pay. Everything that looks like one is walled, dead, guide-prices-only, your-own-sales-only, or a scraper wearing API documentation.

### Reachable and permitted

| Source | What it actually returns | Lookback | Cost | Catch |
|---|---|---|---|---|
| **eBay Fulfillment API** (`getOrders`) | **Your own** settled sales — real prices including accepted Best Offers, with fees and dates | **2 years** (raised from 90d in Feb 2023) | Free, seller OAuth | Your sales only. Never market-wide comps. **And blocked today** — see below. |
| **eBay Browse API** | **Active listings only** — lowest live BIN, supply depth | Live (10-15 min index lag) | Free, 5,000 calls/day | An ask is not a sale. Labeling it a comp would be the exact posture violation. |
| **Terapeak** (Seller Hub) | eBay sold data **including the accepted Best Offer price** — the figure a normal sold search hides | **3 years** | **Free** to every seller | **No API, ever.** UI only. Human in the loop, paste. |
| **Fanatics Collect Sales History** | Realized prices from the #2 high-end auction venue | Full archive | Free, public | No API; the host 403s automated requests. Human read → paste. |
| **Heritage auction archives** | Realized hammer prices, vintage and high-end | Full archive | Free after registration | No API. Their developer portal doesn't resolve. Worth one email. |
| **130point** | Free sold lookup across eBay/Fanatics/Goldin/Heritage, surfaces accepted offers | 15M+ items | Free | Consumer tool, no API, and structurally downstream of eBay's own restrictions. |
| **PriceCharting / SportsCardsPro** | **Current guide values** across grades | None — **no history at any tier** | ~$6-99/mo | License is **internal use only**. See below. Already wired (`price-sources/pricecharting.ts`). |
| **JustTCG** | Blended TCG market prices, condition and foil specific | 7/30/90/180d series | $0 / $19 / $49 / $149 mo | TCG only, **not sports**. Blended index, not individual sales. Cleanest license found anywhere. |
| **Scryfall / pokemontcg.io / TCGdex / TCGCSV** | Complete TCG catalogs + **format legalities** | n/a | Free | Scryfall's terms **forbid paywalling its data** — see the credits note below. |
| **PSA public API** | Cert lookup, possibly pop | n/a | Free tier ~100 calls/day | Not prices. 100/day means cache per identity, refresh slowly. |
| **Card Hedge** | Claims 40M+ transactions incl. **historical sales**, eBay/Fanatics/Heritage | Unverified | ~$0.01/call | **The only automatable third-party sold-comp candidate found.** Provenance unverified — see below. |
| **GemRate** | Unified PSA+BGS+SGC+CGC pop, daily, with cross-grader universal IDs | Daily | Partner deal, price unpublished | Retention rights unknown, and retention is the whole feature. |
| **balldontlie ALL-STAR** | Injuries + player stats across NBA/NFL/MLB/NHL/NCAA, one bill | Live | **$9.99/mo** | The licensed event feed. See section 4. |

### Walled — do not architect around getting these

| Source | Why it's closed |
|---|---|
| **eBay Marketplace Insights** | *The* sold-comp API. "Limited Release... only to select developers approved by business units." Community threads through mid-2026 show consistent denials; June 2026 thread says eBay "no longer provide access besides for major partners." No paid tier, no self-serve, no volume threshold. **And its lookback is exactly 90 days** — it could never backfill your history even if granted. This is not a hard application to write. It is a closed door. |
| **Card Ladder** | 100M+ sales, the richest corpus in the hobby. Enterprise-only API, no public docs, no pricing. Terms forbid reproducing or commercially exploiting any portion of the content. |
| **Market Movers** | No developer API. Consumer subscription product. |
| **TCGplayer** | Stopped accepting new API applicants late 2024, still closed. Now an eBay subsidiary. Was listing data anyway, not sold transactions. |
| **eBay Feed API** | Limited Release, affiliate-gated, and carries **active** listings. High approval cost for data that doesn't answer the question. |
| **Whatnot Seller API** | Developer preview, not accepting applicants. Own-storefront data anyway. |
| **Alt, COMC, CollX** | No developer surface. Alt is a direct competitor to what you're building. |

### Dead

**The eBay Finding API and `findCompletedItems` were decommissioned 2025-02-05.** This was the historical free path to sold data. Any tutorial, library, or spec proposing it is describing a world that ended eighteen months ago. If a proposal reaches for it, that is a dead end, not an integration.

### Off the table on terms — not on technique

Every one of these is technically easy and would be a day of work.

- **Scraping eBay.** The User Agreement bans robots, scrapers, and "other automated means to access our Services **for any purpose**." Effective 2026-02-20 they expanded the list to name "LLM-driven bots" specifically. This includes driving the Terapeak UI headlessly.
- **The case law does not rescue it.** hiQ v. LinkedIn established that scraping logged-out public pages doesn't violate the CFAA — and then hiQ **lost on breach of contract**: $500,000 judgment, permanent injunction, court-ordered destruction of the scraped corpus. Meta v. Bright Data went the other way only because Bright Data had terminated its accounts first. **You hold an eBay seller account and have accepted their User Agreement.** You are in the hiQ posture, not the Bright Data posture. "It's public data" is not a defense available here.
- **The exposure is your selling account, not an API key.** eBay is also your listing/sync counterparty.
- **Apify-style scraper marketplaces** (Fanatics Collect, Goldin, eBay sold, Beckett pop) look exactly like legitimate API vendors and are priced like SaaS. Paying an intermediary does not create rights the intermediary never had. In this space, **paying money is not evidence of a license** — several paid endpoints are less legitimate than the free ones.
- **MLB Stats API** restricts to individual, non-commercial, non-bulk use. **Sports-Reference** explicitly prohibits building tools on their scraped data and training AI on it. Both are exactly what CardOps would be doing.

### Three live licensing issues in the repo right now

**a) PriceCharting is internal-use-only.** Their terms permit use by the subscriber and their employees, "strictly within the organization," and state Price Data "cannot be used in any software, application, or system that is accessible to third parties." The connector is **compliant today** because CardOps is your internal tool. It becomes a breach the moment a second tenant logs in. Nobody has recorded whether CardOps is a single-tenant tool or a product, and that unrecorded decision is what determines whether this connector may keep running.

**b) eBay's June 2025 license change may forbid eBay data reaching Card Intel.** The agreement added "Restricted APIs" — anything offering data on market trends, pricing, sales volumes, or user behavior — and bars ingesting that data "into any generative artificial intelligence model or tool licensed from or otherwise made available by a third party" without eBay's written consent. A separate, broader clause bars using eBay content to train AI. Card Intel sends comps to a third-party LLM. **That is exactly the prohibited shape** if the comps came from a Restricted API. The scope boundary is genuinely ambiguous — whether ordinary Browse/Fulfillment data is swept in is unclear from the secondary source. Resolve it against the actual agreement text before building any eBay-to-Card-Intel path. *This is the single most consequential constraint in the research.*

**c) Scryfall forbids paywalling its data, and `scryfall.ts` sits in a credit-metered app.** Their terms say you may not require payments or subscriptions in exchange for access to Scryfall data. If any credited toggle's output is Scryfall data, that's a plain reading of paywalling. It also violates your own rule — Scryfall costs nothing to fetch, so a `COST` above zero on it would be charging for work not done. (Separately: their bulk files go JSONL-only after 2026-07-20; if anything consumes the old JSON format that is a dated breakage.)

**d) A defect worth four lines.** `price-sources/pricecharting.ts` lines 13-17 assign `grader: "PSA"` to PriceCharting's grade-7/8/9/9.5 fields. Those buckets are **grader-agnostic** ("Grade 9", not "PSA 9") — only the 10s are grader-specific. A quote that is actually a cross-grader blend will pass a `grade_companies: ['PSA']` filter as if it were PSA-specific. Fix: `grader: null` on those four rows.

### And one operational blocker that isn't a licensing question

Per CLAUDE.md, eBay is deliberately single-homed on Master-Ops. The OAuth RuName is registered against `master-ops-iota.vercel.app`, and copying `EBAY_*` vars here does nothing until a CardOps redirect URI is added in eBay's developer portal. **The one clean deep sold-data source — your own 2-year order history — is unreachable from CardOps until that portal change happens.** It's a portal change, not code, and it gates the entire eBay side.

### The bottom line

Every source of third-party realized sales is walled, guide-prices-only, own-sales-only, human-readable-only, or of unverified provenance. The only two candidates that could ever automate third-party sold comps are (a) a Card Hedge license contingent on diligence, and (b) a direct conversation with Heritage.

**This means `min_comps` abstention is not a stopgap waiting for a connector. It is the permanent, correct behavior for most cards, and the paste importer is permanent infrastructure.** Any spec claiming CardOps will "automatically pull comps" for arbitrary cards is proposing something no reachable, permitted source supports.

The UI should distinguish **"no comps found"** from **"no comps obtainable."** They are different facts and they imply different actions.

---

## 2. When a card needs extrapolation

Every trigger below is computable from data already in the database. Nothing here needs a new source.

**A caveat that applies to the whole section: every threshold is currently a guess, and cannot be anything else yet.** Migration 20260745 flagged every row in `card_market_sales` as `pre_auto_split = true` — "excluded from valuation until re-gathered" — and nulled `card_identities.last_refreshed_at` to force a re-fetch. The clean set is presently empty. Until it refills, there is no data from which to measure a sensible threshold. The numbers below are starting points to be replaced by measurement, not defaults to defend.

| Signal | How it's measured | Starting threshold | How much I trust it |
|---|---|---|---|
| **Comp count** | Sales at the card's own grader+grade inside the window | < 8 → borrow evidence; < 3 → the pipeline already abstains (`ACTUAL_MIN_COMPS = 3`) | 3 is already in the code and reasonable. **8 is a guess.** |
| **Staleness** | Days since the newest surviving comp | > 90d → widen; > 365d → the comp is a historical fact, not current evidence | **Guess.** Hobby regime changes make this segment-dependent. |
| **Price dispersion** | Ratio of the 75th to the 25th percentile comp price | > 2.0x → the "market value" is not a point; > 4x → say so loudly | **Guess**, and the one most worth measuring first. |
| **Grade borrow** | Any surviving comp whose grade ≠ the card's | Any borrow at all is a trigger; the size of the adjustment is the severity | High confidence this matters. Magnitude unknown. |
| **Grader borrow** | Any surviving comp from a different grading company | Same — always flag | High confidence. Cross-company equivalence is contested and drifts. |
| **Attribute mismatch** | Comp came from a sibling identity, not this one | Always a rung-6 event | Structural, not a threshold. |
| **Source concentration** | Fraction of comps sharing one seller / one listing block | > 50% from one seller → possible wash or shill | **Guess**, but the failure mode is real and there is no guard today. |
| **Below break-even** | Estimated value under the cost to sell one card | ~$3-5 | Arithmetic, not a guess — see rung 0. |

Two design points about how these should combine:

**They should select a rung, not fire a boolean.** "Needs extrapolation" isn't yes/no. The measurement that matters is *how far up the ladder the card forced you to climb*, and that is derived — per your own settled note, it is not a user preference.

**Bulk detection runs first, before any of them.** Also already settled. Worth restating why: a 5,000-card collection buy must not cost 5,000 lookups, and below break-even the valuation question is the wrong question entirely.

---

## 3. The ladder of methods

Ordered most-like-evidence to most-inferred. **The framing that matters: you climb only as far as you must, and the app reports the rung it reached.** Every rung down is a larger assumption, and the range must widen every time — if a rung-6 estimate ever prints a tighter band than a rung-1 estimate, the uncertainty model is broken. That's a cheap property test and it belongs in the vitest suite.

### Rung 0 — Bulk floor (checked first)

**Needs:** an estimate of your cost to sell one card. **Outputs:** a *mode*, not a number — "bulk" or "single" — with the break-even shown.

Documented 2026 bulk rates: $15-25 per 1,000 cards to a buyer, $25-40 per 1,000 sorted direct. Roughly $0.015-0.04/card. Against that: ~13-15% marketplace fees, ~$1.00-1.30 tracked shipping, ~$0.30 supplies, and three minutes of handling at $20/hr is another dollar. **Break-even lands somewhere around $3-5.** Below it, singling the card destroys value.

**How wrong:** the number itself is nearly unbreakable, because the dominant uncertainty is your labor and channel, not the market — and you know those. Express it as a rate range tied to sort state, never a per-card point. What it can get wrong is the *classification*: routing a $40 card to bulk because the estimate was thin. That failure is caught by the value-uncertain cards never being auto-routed — only confidently-worthless ones.

This rung also enforces "never charge for data you don't fetch" at the routing layer instead of the pricing layer, which is where it's cheapest.

### Rung 1 — This card's own comps, own grader and grade

**Needs:** 3+ (ideally 8+) sales of this exact card at this exact grade inside the window. **Outputs:** the existing `PipelineV1` result, plus a band from the empirical spread of the survivors. **How wrong:** as wrong as the comp set is unrepresentative — see the selection problems in section 7. For a liquid card, this is genuinely the answer, and nothing outranks it.

### Rung 2 — The shared identity's history

**Needs:** `card_market_sales` rows for the same `identity_id` from other owners. **Outputs:** same as rung 1 with a bigger sample. **How wrong:** same as rung 1, plus whatever poison is in the shared pool (section 7, gap D). Already built; already the main reason the identity catalog exists.

### Rung 3 — Same card, other grades — ADJUSTED, not pooled

**This is where the live bug is, and it is the highest-leverage single change available.**

The fix comes from real-estate appraisal. An appraiser doesn't average a 3-bedroom with a 4-bedroom — they **adjust the comp to the subject first**, using an adjustment derived from pairs of sales that differ in only that one attribute. Card version: multiply a PSA 9 comp by the estimated 10/9 ratio for that stratum before it enters the pool, instead of dropping it in raw.

Appraisal also gives you the quality metric for free: **gross adjustment**. Track how much each comp had to be moved. A comp needing a 5x adjustment is not a comp — refuse it. A comp needing 1.2x is nearly direct evidence. Weight by adjustment size, and widen the band in proportion to the average adjustment. That converts `grade_delta` from a bias generator into principled evidence-borrowing with an honest error term.

**Needs:** nothing new. `card_market_sales` already stores grader and grade per row, which is all the adjustment estimation requires. **Outputs:** an adjusted comp set plus per-comp adjustment magnitude, which should be visible: *"4 comps, 3 of them grade-adjusted."*

**How wrong, unadjusted:** 3.5x on the example above. **How wrong, adjusted:** as wrong as the multiplier is — which brings us to the multiplier problem.

### The grade multiplier is not one number

Documented spread of the PSA 10 / PSA 9 ratio: **2x to 50x**. Modern roughly 2-5x. Vintage pre-1980 roughly 10-20x (a 1968 Topps Ryan runs ~$300k in a 10 against ~$30k in a 9). Iconic modern rookies 5-10x.

**A single global multiplier per grader+grade is a 10x-error instrument.** The multiplier is a per-stratum quantity and must itself carry a sample size and a band. Price tier is a required stratifier, not an optional one — grade behavior differs enormously between a $3 card and a $3,000 card, and pooling them makes every band useless.

Three things about `buildLadder()` specifically:

- **No slab floor.** Line 309 computes `raw × multiplier` with no floor term. A common worth $0.25 raw is not worth $2.50 in a PSA 10 — it's worth roughly whatever a graded slab of anything floors at. The correct form is `max(raw × multiplier, slab_floor(grader, grade))`. `gradeUp()` reaches the right "don't grade" answer for pure commons by accident; for mid-tier cards where the floor binds, it can be wrong in the *profitable* direction.
- **No monotonicity.** Each cell with ≥3 comps takes its own independent trimmed mean, so a thin-sample PSA 9 cell can legally print above the PSA 10 cell. That renders as an obviously broken ladder and destroys trust instantly. The standard fix (isotonic / pool-adjacent-violators) averages only cells that are already contradicting each other, has no tuning parameters, and is about twenty lines. *(Note: this is isotonic regression used as a monotonicity repair on a handful of cells, which is fine. Isotonic used as a general calibration curve is a different thing and is a trap at your data scale — section 6.)*
- **`card_grade_multipliers` already has the hook and nothing uses it.** The table's CHECK constraint permits `source in ('seed','fitted')`. I grepped `src/` — there are three readers and **no writer of `'fitted'` anywhere**. Every multiplier in production is a hand-seeded constant. That's the natural landing place for fitted multipliers, and adoption becomes a data change rather than a code change. Two gaps to close if you go there: the table has no column for sample size or uncertainty (a multiplier from 4 pairs is indistinguishable from one from 4,000), and the key lacks a price tier.

**And a naming problem:** `LadderCell.basis_source` distinguishes `'actual'` from `'modeled'`. It needs a third state, because a hand-seeded guess and a data-fitted estimate are not the same claim.

### Rung 4 — Same card, different grading company

**Needs:** a cross-company equivalence factor. **Outputs:** an adjusted comp with a larger gross adjustment than rung 3. **How wrong:** unbounded, because there is no neutral source. The community consensus (BGS 9.5 sits between PSA 9 and PSA 10; CGC Gem 10 slightly under PSA 10; SGC 10 comparable to PSA 10) is exactly that — consensus, not measurement. It also drifts as graders change enforcement. Your grading rubric already encodes company personalities; your own encoded, revisable, dated opinion may be more honest here than a borrowed number.

### Rung 5 — Old comps aged forward by an index

**Needs:** a real, constant-quality index for the card's segment. **Outputs:** a repriced old sale. **How wrong:** this is either the most valuable technique on the list or the most dangerous, depending entirely on whether the index is real.

The critical property: **index adjustment creates no information.** It moves an old number and strictly increases its variance. If you had one comp before adjusting, you have one comp after. Presenting the result as a fresh data point is the sin. Label it as one aged comp.

The honest version comes from Case-Shiller: they modeled the price gap as a random walk and showed the error variance grows **linearly with the time between sales**. So the band on an aged comp widens with the square root of the gap — a comp two years stale carries roughly 2.8x the drift uncertainty of one three months stale. That's implementable and it's a rule, not a feeling.

Worth noting: this is also strictly better than `PipelineV1`'s existing `wavg_recency`, which uses an arbitrary exponential with a user-chosen `half_life_days`. A variance-based weight is estimated from data rather than chosen, and drops into the same aggregate slot with no API change.

**But:** building a trustworthy index needs hundreds of repeat sale pairs per period, which you do not have. Until then, index adjustment would import error while looking authoritative. Later-stage capability, gated on volume, and it should refuse to publish a period with too few pairs rather than print a noisy one.

### Rung 6 — Sibling cards, with shrinkage

This is the rung that makes a zero-comp card answerable, and it's the one place where the statistics genuinely earn their keep.

**In plain terms:** with two sales, the average of those two is a bad estimate — not biased, just noisy. Shrinkage says use neither the card's own average alone nor the group average alone, but a **blend**, where the weight on the card's own data grows with how many sales it has and with how genuinely different the cards inside the group are from each other.

The single useful parameter is *how many real sales it takes before the card's own data outweighs its group.* That number is estimated from your own data, not chosen. And it's estimated with two SQL aggregates over `card_market_sales` grouped by identity — no new schema.

**Two things make this the right tool rather than a fancy one:**

First, **the error bar falls out of the same arithmetic.** The blend weight and the width of the range are the same computation. You don't do extra work to get honesty. And because it operates on log prices (ratios, not dollars — card prices are right-skewed and behave multiplicatively), the resulting dollar range is automatically asymmetric: it can't go below zero and it has a long right tail, which is the correct shape for a price.

Second, **the blend weight is itself a legible honesty statement.** "This figure is 30% your card's own sales, 70% comparable cards" is a sentence a reseller can evaluate.

**The group must be a hierarchy, not one flat bucket.** A single group like "all modern basketball" is too heterogeneous to shrink toward usefully. The structure that degrades gracefully:

1. Exact identity, exact grader+grade
2. Same identity, other grades (rung 3's adjusted comps)
3. Same player + year + set, other numbers and parallels
4. Same player, same era
5. Same set + year
6. Sport × era × price tier

A card with zero sales inherits from the tightest level that has data, and the band widens automatically with how far you had to climb. **Every join key for levels 3-6 already exists in `card_identities`** — player, set_name, year, sport_category, card_number, parallel, is_auto, is_relic. These are plain `GROUP BY` queries against an existing shared table.

**How wrong:** the band tells you, which is the point. The failure mode to guard against is that shrinkage lets you always produce *some* number. That is a temptation, not a feature.

### Rung 7 — Model-only (attributes in, price out)

**My recommendation: don't build this as a per-card price predictor. It is the rung that looks most authoritative and fails hardest exactly where you'd deploy it.**

A hedonic regression on player + set + parallel + grade is thousands of parameters once you count categorical levels honestly, and needs tens of thousands of sales before it means anything. The specific failure matters: **a parallel appearing in one sale absorbs that sale's entire residual as its coefficient.** In-sample fit looks superb; the model has memorized the data. Predictions for rare attribute combinations — which is precisely the thin card you wanted help with — are extrapolations with enormous, uncommunicated variance. It fails invisibly, because the fit statistics look great.

**There is a defensible redirect, though, and it's genuinely useful:** don't predict prices, estimate the *adjustment factors*. Because `card_identities` gives repeated observations of the same real-world card, you can look only at variation *within* the same identity — same card, different grades — which cancels out all the player/set/year/parallel confounding without spending a single parameter on it. What comes out is exactly the grade adjustments rung 3 needs, with proper error bars. Parameter count drops from thousands to dozens.

So: hedonic as a price predictor, no. Hedonic as the producer of the `'fitted'` rows in `card_grade_multipliers`, yes.

### Rung 8 — Abstain

**This rung must survive.** Shrinkage will always produce a number if you let it, and the ability to say "we genuinely don't know, mark it yourself" is what keeps the rest of the ladder honest. If even the top group is empty, abstain and ask for a manual mark.

---

## 4. Context signals worth the cost

The signals split by **mechanism**, not by topic. Only three families move price enough to justify paying for.

### Tier 1 — worth integrating

**1. Graded population *velocity*, not level.** The pop count is largely already in the price. The pop *change* is not. Reported rules of thumb: >20% annual growth reads as active oversupply; a >20% jump in one month in PSA-10 pop is the scarcity premium actively eroding.

This is the highest-value context signal available, and it's **blocked on a source.** `credits.ts` sets `pop: 0` with the comment "model judgment, no fetch — must stay 0 until a source exists," and `estimate-run.ts` tells the model not to cite pop counts. That is already the correct posture and shouldn't change until a real feed lands.

If one does: store snapshots keyed `(identity_id, grader, grade, observed_at)` so the derivative is derivable, and model it on **relative** supply (pop 10 ÷ pop 9), not absolute count — a pop-10 PSA 10 is only scarce if pop 9 is 500. Four caveats that must be surfaced rather than buried: pop is cumulative graded and not float; pop is *endogenous* with price (high price pulls submissions, so pop grows *because* price rose); crackouts and resubmissions double-count; and "pop 1" is a cliff, not a curve — the premium evaporates the instant a second copy grades.

And when it arrives, use pop to inform the grade *multiplier* — it's the best available explanation for why the 10/9 ratio varies 2x-50x — not as a direct price predictor.

**2. Step-function player events.** Cards reprice on discrete status changes, not on continuous performance. The schema is not `player_stats`, it's `player_events` with a closed enum of about a dozen types: debut, call-up, injury, trade, signing, suspension, retirement, HOF ballot, HOF induction, award, milestone, death. Each row is a fact with a date and a URL that gets shown to you — not a score the model computed.

**This reframing is what makes the area affordable.** Injuries, transactions, and awards are on the *cheap* tiers. Play-by-play and box scores — which you don't need — are what the expensive tiers sell. **balldontlie ALL-STAR at $9.99/mo** covers injuries across every sport you hold on one bill. Sportradar has no self-serve tier, a reported $1,250/mo floor, and sells Tier 3 data priced for sportsbooks. Do not open that conversation.

**3. TCG format legality.** Free, structured, factual, and **forward-dated**. Both pokemontcg.io and Scryfall expose per-card `legalities` as a first-class field. Rotation dates and ban announcements are published on a schedule. This is one of the very few signals that lets the app warn *before* a price move rather than explain it after, and it's a boolean the app can state as fact with no hedging — which fits abstain-over-guess perfectly. Store legalities on the identity, diff on catalog refresh, emit an event when status changes.

**4. Print run, parsed from the serial number you already store.** This sounds like a licensing problem and is actually a string-parsing problem. For any serialized card the print run is *printed on the card* and already sits in the parallel text you capture ("/99", "1/1", "Gold /10"). Extract it to a typed `print_run` with a `print_run_source` and you have exact, authoritative, zero-cost scarcity on precisely the population that's most scarcity-sensitive. Nothing purchasable improves on it.

The permanent gap: unserialized parallels mostly have unpublished runs. `print_run` must be nullable and "unknown" must render as unknown — an unserialized parallel is not `print_run = large`, it is *not stated*. Same discipline as `basis_entered`.

**5. Active-listing supply — top of the post-cutover queue.** How many identical cards are listed right now, and the lowest live BIN. It bounds the ask directly, and a thick stale listing pool is itself the signal that the last comp was optimistic. Achievable via Browse, already half-planned in pricing-factors §5, costs nothing extra — and gated entirely on the eBay redirect-URI registration, not on vendor access.

### Tier 2 — marginal. Free or near-free only, never paid.

- **Prospect ranking position** (Bowman specifically). Tightest ranking-to-price coupling in sports cards. But every ranking source is subscription-walled or under MLBAM's commercial restriction. The *call-up* half is properly licensed via the event feed; the *ranking* half should be a quarterly manual paste. A cron here is overkill and a licensing risk.
- **Release calendar.** No structured feed exists, and the signal has degraded — announcement windows have collapsed from ~six months to sometimes days. A small hand-maintained table for annotating charts. Do not build a scraper. Do not attach a cost.
- **TCG tournament meta share.** Limitless has a free documented API. But meta share moves *played raw singles*; it moves graded slabs and sealed very little. Rank it far below rotation and bans. If your Pokémon holdings are graded singles, skip it.
- **HOF, awards, milestones.** Real step changes, no API, and trivial volume — one election per sport per year. Hand-entered rows with source URLs. The public ballot tracker crossing 75% weeks before the announcement is a legitimate free advance signal — worth a calendar reminder, not a cron.

### Tier 3 — do not build

- **Box scores and play-by-play.** A 28-point game does not move a card. The market reprices on narrative thresholds and status changes, not stat lines. **This is the biggest trap in the space**, because it's also the most heavily marketed and most expensive data.
- **Headline volume and sentiment scores.** The signal lives in the event *type*, not in how many articles mention a player.
- **Macro indicators, social sentiment, "hype scores."** No mechanism.

### One thing to fix in what already ships

`news.ts` builds Google News RSS URLs and hand-parses the XML. Google deprecated its News API and killed the aggregator RSS endpoints in 2018; what survives is unsupported — no SLA, no versioning, silent format changes. A July 2026 sampling found the feed skews old: **median item age ~6.6 days, only 7.6% under six hours.** For a signal whose entire value is catching a step-change early, that means the market has already moved. Fine for "why did this card move," actively misleading for "should I list today."

Two cheap fixes: date-gate it and show the item's age on screen so a six-day-old headline never reads as breaking; and get high-value events from the licensed feed where they're structured and dated, demoting RSS to color. Also, per prevention rule 8, an RSS failure must surface — right now it would read identically to "nothing happened."

### The budget

Roughly **$10-60/month total**, plus one partner conversation (GemRate) and one email (Heritage). Not $1,250+. If a proposal reaches four figures a month for stats feeds, it is buying Tier 3.

---

## 5. The confidence model

### The argument for a range

Two cards are both "worth $200." One sold forty times between $190 and $210. The other sold twice, at $80 and $320. Identical mean. Opposite decisions.

**Emitting a single number destroys exactly the information that matters, at the exact moment the decision is made.** That's the whole argument, and I think it's decisive. The range should be the primary output and the point estimate a derived convenience.

But a range without a stated meaning is decoration, so three things have to be nailed down.

### First: which range? There are two, and they differ a lot

- **"What is this card worth?"** — a statement about the market's level. Narrower.
- **"What will *this copy* actually fetch?"** — a statement about a single draw from a noisy distribution. **Much wider**, because it includes the sale-to-sale scatter, not just the uncertainty about the average.

**A listing decision needs the second. An inventory valuation arguably needs the first.** Showing the first while you're making the second decision is precisely the "more certain than it is" failure, and it's an easy one to make without noticing.

My recommendation: **the default range is the second one**, because listing is what the app is for. If the books layer or an insurance export needs the first, it should be labeled differently and live somewhere else.

### Second: report the median, not the mean

On a right-skewed distribution these differ substantially. The median is the honest 50/50 "what will it sell for" figure. The mean is dragged up by the long tail and is the wrong summary for a decision.

Related: `PipelineV1`'s aggregate should *declare what it targets*. `median` targets the median clearing price; `mean` targets the expected one. Scoring a median-targeting pipeline with a mean-based error metric will always make it look biased low — which matters in section 6.

### Third: the number attached to the range must be a claim you can check

"80% confident" should mean: **across all estimates carrying that label, about 80% of eventual realized prices land inside the range.** That's a checkable empirical claim.

Today, `runEstimate()` asks the model for `confidence: 'low' | 'medium' | 'high'`, it lands in `card_estimates.confidence`, and **nothing in the codebase ever checks whether a "high" estimate is more often right than a "low" one.** By your own posture, an unvalidated certainty label is a defect that is shipping now, not a missing feature.

There's a hard arithmetic limit worth building in as a rule: **the highest confidence level you can honestly offer is capped by how many resolved outcomes you have.** A valid 95% claim needs about 19 resolved estimates minimum; 90% needs 9; 80% needs 4. And for stability you want several observations out in the tail, so with 40 resolved estimates you're honestly capped nearer 85% than 95%. Below the threshold, the honest output is "not enough resolved estimates to state a range at this confidence" — which is `min_comps` discipline turned inward on the app's claims about itself.

### The interim move while n is small

Replace the confidence word with the facts it was derived from:

> **9 sales · newest 6 days old · spread ±18% · all at this grade**

versus

> **1 sale at this grade · 6 sales at other grades, adjusted · newest 4 months old**

You can evaluate those yourself, and they cannot be wrong. **This is what the grade estimator already does** — its prompt says ranges must be asymmetric, and explicitly: *"never output a numeric confidence percentage; a photo model cannot calibrate one."* That discipline exists in the repo already. Valuation should adopt it rather than invent a second, weaker standard.

### The structural gap

`card_estimates` has `low`, `high`, `confidence`. `card_valuations` — the deterministic pipeline's output — has `value`, `basis_source`, `comp_count`, `window_days`, and a `confidence numeric(3,2)` that nothing computes honestly. `interpretPipeline`, `computeMarketValue`, `marketValue`, `rawValue` and `valueAt` all return `number | null`. `LadderCell` has no interval.

So the free path can say "I have a number" and "I abstain," but cannot say *"somewhere between $40 and $110, most likely $65, and that band is mostly my uncertainty rather than market spread."* **Every technique in section 3 outputs a distribution and there is nowhere to put it.** That type is the gating constraint, not a parallel workstream.

The shape I'd propose is a superset so nothing breaks — keep `point`, add `lo`, `hi`, the interval level, the rung reached, direct comp count, adjusted comp count, blend weight, average gross adjustment, staleness, and an abstention reason. Database side, `card_valuations` needs `value_low`, `value_high`, `method`, and the sample sizes. Paste-ready migration, applied by you.

**One guardrail:** a shrunk estimate must be *visually distinct* from a comp-backed one. If $65 from nine real sales and $65 from a group prior render identically, the range machinery has bought nothing.

### And a scoring note for later

Coverage alone is trivially gameable — quote "$0 to $1,000,000" and score 100%. The governing principle is **the narrowest range that still hits its stated rate.** The standard tool (an interval score: pay the width if you're inside, pay a distance penalty if you're outside) is what tells you whether a change to `guards` or `min_comps` actually helped, rather than just widening every range until it stopped missing. Without it, "improve calibration" degenerates into making everything wider while the dashboard turns green.

---

## 6. The learning loop, honestly

### The trap, first

You produce an estimate. You list near it. The card sells **only if a buyer arrives willing to pay that**. You then score the estimate against the sale price.

But the sale happened *because* the estimate was low enough. **Every card where the estimate was too high is deleted from the evaluation set by the very mechanism you're evaluating.** The surviving sample is enriched with cards you priced at or below market.

The consequence is worse than "slightly optimistic." The naive backtest **gets more flattering as the model gets more aggressive**, because aggressive pricing shifts more of the over-estimates from "scored as wrong" to "never scored at all." The feedback loop points the wrong way. You would converge, confidently, on being wrong.

**The single most valuable correction costs nothing and needs no statistics: publish the sell-through rate next to every accuracy number, with an explicit sentence.**

> Measured on 62 of 100 listings. The 38 that did not sell are not in this figure and would make it worse.

That turns a hidden bias into a visible caveat.

And a framing rule that follows from it: **two questions must never be blurred on a screen.** "What does this card sell for?" is answerable from sold comps and validatable. "Will this card sell at *my* ask?" requires unsold data and is currently unanswerable. Presenting the first as if it answered the second is the actual failure mode.

### The clean signal the app currently throws away

**Every price cut is a directly observed over-estimate with a magnitude.** Listed at $260, cut to $220, cut to $185, sold at $185 — the model was 40% high and you know it exactly. No censoring, no correction needed. It's the cleanest accuracy data the app can possibly generate, and it's generated by normal selling behavior.

What the repo records today, verified:

- `src/app/api/ebay/list/route.ts:292` writes `listing_refs.ebay = { offer_id, listing_id, url, status, title, listed_at }`. **The ask price is not in it.** The price reaches only `audit_log.payload.price` — an audit trail, not a queryable series.
- `src/app/api/ebay/end/route.ts:52` does `refs.ebay = { ...refs.ebay, status: 'ended' }`. **No ended_at, no reason, no final price, and it overwrites the blob.** Sold vs unsold vs withdrawn is unrecoverable afterward.
- `cards.listed_at` / `cards.sold_at` are single scalars — a relist overwrites the first exposure.
- There is no `card_listing_events` table anywhere in `supabase/`.

**The two facts most needed for honest calibration — what you asked, and whether it failed to sell at that ask — are the two the app currently discards.** Everything else in this section is blocked on fixing that. It's an append-only table, one row per event, with the estimate id frozen alongside so a later evaluation isn't contaminated by a pipeline that has since changed.

On the unsold half: **a listed-and-unsold card is evidence, but it is not a data point and must never be scored like one.** What it says is "no buyer willing to pay this arrived within this window," and the strength of that statement depends entirely on the window and how often the card trades. A $5,000 card listed three days tells you essentially nothing. A $30 card listed six months while four comparable copies cleared at $22 tells you a great deal. The right treatment is survival-style: it lowers a confidence or widens a range. It must never render as "the market says this is worth less than your ask."

That data is also what would finally calibrate `sellEstimate()` in `liquidity.ts` — whose own header already promises exactly this: *"the model calibrates against Beau's own listed_at→sold_at outcomes once real sales exist."* The data model just has to keep them.

### The free backtest that already exists

`valueAt(card, comps, params, atMs)` in `valuation.ts` is already a strict no-lookahead point-in-time evaluator — it filters comps to `sale_date <= atMs` **and** passes `atMs` as `now` so windows are evaluated from that moment. That's precisely the primitive a walk-forward backtest needs, and it was already written.

Walk forward through `card_market_sales`: for each sale, predict from everything that existed just before it, record the ratio. Report typical error, signed bias, and **abstention rate** per pipeline.

Why this matters disproportionately: `card_market_sales` is **cross-tenant and hangs off the identity**, so it accumulates every owner's sales of the same card. That's orders of magnitude more observations than your own inventory will ever produce. It costs zero credits — the rows are already on file. It's deterministic, and it belongs in `test/` as a regression test on the default pipeline. It lets you compare pipeline configs by measurement instead of intuition.

**And crucially it is not contaminated by the selection loop** — those sales weren't selected by *your* asking prices, so the model isn't grading its own homework. It is still sold-only (a comps feed only contains listings that cleared), so it validates "does my aggregate of past sales predict the next sold price" and **not** "will this sell at my ask." State that wherever the number appears.

Two methodological musts: split by **time**, never randomly (sales of the same card in the same week are not independent and random folds leak), and exclude `pre_auto_split = true`, same as `runEstimate` already does.

**The timing constraint:** every row is currently flagged `pre_auto_split`. The clean set is empty. This backtest is ready to run and has nothing to run on until the re-gather accumulates.

### How much can actually be learned

Blunt arithmetic. If typical estimate error is around ±35%:

| Resolved observations | Smallest bias you can detect |
|---|---|
| 25 | ~15% |
| 100 | ~7% |
| 400 | ~3.5% |

**A single global bias correction needs roughly 100 resolved observations before it's worth applying** — and even then only if the measured bias exceeds about 10%. Below that you are fitting noise, and the sign will flip next quarter.

At 300 sales a year you get ~25 a month. **Any monthly adaptive learning is noise.** The honest cadence is a rolling 12-month window recomputed quarterly.

**Segmentation is where this dies.** 300 sales split by sport (5) × graded/raw (2) × price tier (3) is 30 cells averaging 10 observations each. At n=10, the honest confidence interval on a segment multiplier spans roughly ×0.80 to ×1.24 — statistically indistinguishable from ×1.00. Rendering "×1.12 for graded basketball" from 10 sales is fabricating a finding.

**Not learnable at your scale, ever, from your own data:** per-player effects, seasonality, interaction terms, anything with more than ~10 free parameters, and per-cell grade multipliers. Those are only reachable through the pooled identity-level market data, never through one inventory.

### Where it becomes theatre — named plainly

- **Monthly recalibration.** 25 observations. Noise.
- **Per-segment multipliers from single-digit samples.** Fabrication with a decimal point.
- **Searching for segments.** With 30 candidate cells you will find several "significant" ones by construction. Segments must be declared in advance.
- **Isotonic regression as a general calibration curve.** Needs on the order of 1,000 resolved observations; below that it chases noise in the calibration plot and performs *worse* than a simple two-parameter fit. Three or four years away at solo scale. *(Different from the ladder-monotonicity repair in section 3, which touches only cells already contradicting each other.)*
- **Heckman correction.** This is the textbook answer to the selection problem and I'd push back on any spec proposing it. It needs a variable that affects *whether* a card sells but not *what* it sells for, and no credible one exists here. It assumes a distribution shape card prices don't have. And with a few hundred observations it produces a confident correction factor that flips sign on the next refit — the exact overfitting-dressed-as-learning failure. Even the academic housing literature cites it more than it trusts it.

### The one technique that gets better as data gets thinner

For segments specifically, the alternative to "one global number" versus "a free number per segment" is to fit both and **let the data decide how much to trust each**. A segment with 5 observations barely moves off the global; a segment with 200 mostly gets its own number. Nothing has to be greyed out or hard-thresholded — the estimator degrades continuously.

This also dissolves the per-user cold-start problem with the same mechanism: a new user gets the pooled calibration immediately (strictly better than nothing), while a heavy user's own data progressively dominates their own numbers. No cutover, no "you need 50 sales before we personalize" rule.

One honesty requirement: when a displayed number is 90% pooled prior, say so.

### Two rules for whatever gets built

**Abstention applies to the app's claims about itself.** Below ~30 resolved observations in a segment, the accuracy panel says "not enough resolved estimates to score this yet," not a number.

**It must be free.** Backtesting and calibration read rows already on file and do arithmetic. A "recalibrate" button that debits credits would repeat the `news`/`macro`/`pop` mistake exactly — a `COST` above zero is a claim that something was fetched, and `test/credits.test.ts` pins that contract.

### One metric warning

Do not score with percentage error (MAPE). It is asymmetric: under-predicting can be at most 100% wrong, over-predicting is unbounded. **Anything minimizing it will systematically push your estimates down** — and you have an independent business reason to fear over-estimating, so the two effects compound into a model that quietly under-prices inventory while its dashboard says it's improving. It also explodes on cheap cards, so a handful of $2 commons would dominate the score for an inventory whose money is in the $500+ cards. Dollar error and R² are similarly misleading here for different reasons. Score on ratios, in log space.

---

## 7. The gaps you haven't asked about

This is the section that matters most.

### A. "Worth" and "what I'll net, this month" are different numbers — and the second one is per-*seller*

Your brief treats value as one figure. It's at least four: market value, auction-realized, BIN-with-offers, and liquidate-this-week. The app already knows landed cost and days-to-sell and will soon know fees, so it *can* answer the useful one.

The part that isn't obvious: **there are two separate models here and pooling the second one across users would be wrong, not merely private.**

- The **market model** ("what does this card sell for") *should* be pooled. It already is — `card_market_sales` hangs off the identity. Those are public completed-sale records, not user data.
- The **execution model** ("does *this* seller realize above or below market, and how fast") **must** be per-user. It encodes photo quality, feedback score, shipping speed, patience, store subscription, return policy. Telling a new seller with 3 feedback that they'll clear at the same price as a top-rated seller with 10,000 is a money-critical claim the data does not support.

The fairness failure to name: a pooled execution model trained mostly on one prolific seller encodes *that seller's behavior* as "the market." A conservative seller drags everyone's estimates down; an aggressive one drags them up — and the app renders it as market truth.

### B. A value is a distribution, and the app's two output paths disagree about that

Covered in section 5, but the gap worth naming here is the *inconsistency*: the AI estimate path already emits low/high; the free pipeline path emits a bare number with an uncomputed confidence score. The same card can produce two differently-shaped truths depending on which button you pressed, and the more expensive one is the more honest one.

### C. The estimate becomes evidence, whether or not it was meant to

Once the app prints a value it will end up in an insurance claim, a partnership dispute, a consignment agreement, a probate filing, or a tax return. "Decision support, never a guarantee" is right, but **it has to be on the artifact**, not only in a code comment.

Three consequences:

1. **Store every estimate immutably with its date, its inputs, its rung, and the pipeline that produced it.** A dated stored estimate is far more defensible than a number regenerated months later from changed data. `card_estimates` stores `sources` but nothing records *which pipeline* produced a deterministic value — `card_valuations` has no strategy reference at all.
2. **The word matters.** "Value" implies a fact. "Estimate," "indication," "model value" set different expectations. This is the word that appears on an insurance claim one day.
3. **This is structurally the same posture problem as tax classification**, which you've already solved once. The app *records* your classification and never determines it. An FMV figure is the same shape of claim — and it currently has no equivalent guardrail.

### D. The shared catalog cuts both ways, and provenance can be severed

`card_market_sales` hangs off the shared identity, so every owner inherits everyone's history. That's a real moat. It also means **one bad paste, one wash sale, or one shill bid poisons every other user's estimate for that identity — permanently, because history accumulates.** There is no provenance weighting, no outlier quarantine, and no dispute path today.

Worse, and this is new: **`card_id` is now nullable and the foreign key is `on delete set null`** (bootstrap part 3, lines 989-993). That was the right call for the stated reason — deleting a card must not destroy history other owners depend on. But the side effect is that **deleting a card severs the only link back to who contributed those rows.** There is no `added_by` column. So a poisoned row can become permanently un-attributable, which means it can be neither disputed nor bulk-reverted.

The fix is much cheaper before there are other users than after.

### E. Nobody has decided what counts as one sale

Related to D but distinct. The dedup key is `(identity_id, source, external_id)`. That handles re-seeing the same listing. It does not handle:

- The same physical card resold three times (legitimately three sales, but not three independent observations of demand)
- A sale that was **returned** — still recorded as sold
- A relist of the same unsold item under a new listing id, if a vendor ever reports asks alongside sales
- Auction vs Buy-It-Now vs accepted-offer, which are **systematically different prices for the same card** and are currently indistinguishable — there is no format column, only `platform` and a `raw` jsonb

That last one caps how much precision is achievable at all. Grinding the estimator from ±30% to ±20% is pointless if unmeasured format mix contributes ±15%. And accepted Best Offers are commonly *displayed at the original asking price*, so a comp set drawn from listing data reads high by an unknown margin — which for a thin card where two comps set the value can move the estimate materially, invisibly.

Minimum action: record format where the vendor supplies it, flag what you can't classify, and never call the comp set "the market" in UI copy. It is "recorded sales we could see."

### F. The re-gather is a one-time free window, and it is open right now

Because every row is flagged `pre_auto_split` and `card_identities.last_refreshed_at` was nulled, **the sales history is going to refill from scratch.** Two schema decisions are cheap now and cost a second re-gather later:

1. **Sale format as a first-class column** (gap E).
2. **A pop snapshot captured alongside each fetch**, if and when a pop source lands, so growth rates are derivable rather than lost.

Worth noting that migration 20260745 is itself the model for how all of this should behave: it chose to flag irrecoverably-ambiguous data and exclude it rather than let it silently contaminate valuations. That is the same call the extrapolation work has to make repeatedly.

### G. Regime change makes old comps lie, and `window_days` is a blunt instrument

The hobby repriced violently in 2020-21 and again after. A 2021 comp is not a comp. The only defense today is a user-chosen window, which is a hard cutoff applied uniformly — it treats a stable vintage card and a volatile modern rookie identically. Rung 5 is the principled answer and it's gated on data volume you don't have.

Related: any conformal or calibration work assumes the past resembles the future. Market drift violates that. Calibrate on a rolling window and treat a sudden coverage drop as a **regime-change alarm**, not as something to smooth over.

### H. What happens when you disagree with the number

There's a `manual_price` and a `price_locked` flag, so an override exists mechanically. But an override is *also data* — it's a labeled human correction, and it's arguably the highest-quality training signal the app can get. Right now it's a silent overwrite. Whether an override feeds the calibration loop (and whether it's recorded with a reason, like the tax-classification trail) is undecided.

### I. Licensing determines architecture, not just connectors

Three of the section-1 issues aren't connector questions, they're product questions with code consequences:

- **Single-tenant or product** decides whether PriceCharting may keep running at all.
- **The eBay gen-AI clause** decides whether eBay-sourced comps may reach Card Intel — which is a data-flow constraint in the middle of the app, not an integration detail.
- **Data-retention terms** (eBay's cache-freshness and 30-day destruction clauses; GemRate's unknown position) collide with the core design premise that `card_market_sales` is a permanently accumulating shared history. Read narrowly those clauses govern live listings and personal data. Read broadly they're hostile to the whole table. **Minimum defensive action regardless: tag every market-sale row with its source so an eBay-sourced subset can be aged out independently, rather than discovering later that the whole table is entangled.**

---

## 8. Questions for you

Real forks. Each one changes the design.

**1. Is CardOps your internal tool, or a product?**
This is the highest-leverage unanswered question in the document and it isn't a valuation question. It decides whether the PriceCharting connector may keep running (their license is internal-use-only), whether Scryfall data may sit behind credits, what you ask GemRate for, and whether pooled-outcome design needs privacy machinery at all. The architecture is already multi-tenant. The license posture assumes it isn't. One of those has to give, and the answer is much cheaper before the second user than after.

**2. Range or number — and if a range, is it "what is it worth" or "what will this copy fetch"?**
I recommend a range as the primary output with the point derived, and I recommend the *second* meaning by default, because listing is what the app is for. But it changes every screen showing a value today, and the second range is noticeably wider than the first, which will feel worse to look at. Say which one is the default, and whether the other one is even shown.

**3. Do we spend the re-gather window on sale format and pop snapshots?**
The sales table is empty and about to refill. Adding a format column now costs almost nothing. Adding it after the re-gather costs a second re-gather. Same for a pop snapshot table, if you think a pop source is ever coming. This is a decision with an expiry date on it.

**4. Do we start recording listing events — what you asked, every markdown, and how it ended?**
Without this, the learning loop cannot be honest, and price cuts (the cleanest accuracy signal available) are being thrown away right now. It's an append-only table plus changes to the eBay list and end routes — and it's entangled with the cutover, since eBay is single-homed on Master-Ops. If the answer is no, then "the app learns from results" should come off the roadmap rather than being built on a biased sample.

**5. Do other users' realized outcomes improve your estimate, and yours theirs?**
The catalog is already shared for *market* data, which is the case where pooling is clearly right. Pooling *outcomes* is different — powerful, and also the poisoning and fairness risk. If yes, my recommendation is: pool **ratios only** (realized ÷ estimate), never dollars, never basis, never profit; never compute a pooled statistic from fewer than five distinct users and five distinct transactions; aggregate coarsely, never per identity; opt-in with the trade stated plainly. And do not retroactively pool data collected under a different understanding.

**6. What is the number called, and what does the app say when it lands in an insurance claim?**
"Value," "estimate," "indication," "model value" are four different promises. And separately: is there an explicit non-appraisal statement on the artifact, in the same way tax classification carries "recorded, never determined"? This is a wording decision with legal weight and it should be made deliberately, once.

**7. Card Hedge: a week of diligence, or accept that pasting is permanent?**
It's the only genuinely reachable candidate that could automate third-party sold comps, priced in a way that fits exactly this shape of app. It's also the one whose provenance I could not verify. Before wiring anything: read their terms, confirm redistribution and display rights for a multi-tenant app, confirm lookback depth, and **ask directly where their eBay sales come from.** If they scraped it, you inherit a dependency on someone else's terms violation and their right to sublicense it to you is doubtful. A vendor who cannot answer that cleanly is a liability, not a source. If you'd rather not spend the week, that's a legitimate answer — but then the paste importer should be treated as permanent infrastructure and given real UI investment, starting with a Terapeak-shaped parser.

**8. Grading-company equivalence: your view encoded, or refuse to cross companies?**
Rung 4 needs a cross-company factor and there is no neutral source for one. The options are your own opinion — encoded, dated, revisable, and clearly labeled as your judgement — or abstaining across companies entirely and accepting fewer comps. Your grading rubric already encodes company personalities, so half the work exists. I lean toward your encoded opinion, because a stated and revisable judgement is more honest than a borrowed number of unknown provenance. But it does mean the app is shipping your opinion as a factor in a money-critical output, and you should decide that on purpose.

---

## What I'd do first, if you asked

Not a plan — just the ordering that falls out of the above, in case it's useful.

Three things are free, unblocked, and independent of every question in section 8: **fix the `grade_delta` pooling bias** (it is producing wrong numbers today), **fix the PriceCharting grader labels** (four lines), and **add monotonicity plus a slab floor to the ladder** (a ladder that prints a 9 above a 10 destroys trust faster than any inaccuracy).

Everything statistical is gated on data that is presently excluded by design. Anything built before the re-gather must degrade to seed constants and abstain, and must not be presented as data-fitted before it is.
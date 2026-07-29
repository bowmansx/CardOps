# FINDINGS — valuation

Loop-written. [[DECISIONS]] outranks anything here.

**If the research file reads like bad news, read its banner first.** It answers
one question — can third-party sold comps be automated — and the answer is no.
That is not a verdict on the project: the wedge was never pricing data, every
competitor faces the same wall, and eBay giving its price guide away free
commoditises that layer rather than closing it to us. What it changes is that
the paste importer is permanent infrastructure and should be funded like one.

**Status 2026-07-28:** research complete. Parts 1-5 are my reasoning; Part 6
below is what the research added or changed, verified against the repo where it
made a claim about our code. Full output kept whole at
`research/2026-07-28-sources-and-extrapolation.md`.

---

## Part 1 — The five systems, kept apart

Beau's brief reads as one thing and is really five. They fail differently, and
three are much cheaper than the other two.

| | System | Difficulty | Why |
|---|---|---|---|
| 1 | **Sourcing** real sales | Hard, but not technical | Contracts and terms of service, not code. Some doors are simply shut. |
| 2 | **Triggering** — is the evidence thin? | Easy | Every input is already in the database. |
| 3 | **Extrapolating** | Medium | A ladder of known techniques. The hard part is honesty, not maths. |
| 4 | **Explaining** — show the work | Medium | Mostly UI over `PipelineV1`, which already exists. |
| 5 | **Calibrating** — learn from outcomes | **Hardest, and it has a trap** | See Gap 5. |

---

## Part 2 — The ladder, and why it is a ladder

*(my reasoning)*

The instinct behind the brief is "use real data where we have it and extrapolate
where we don't." That is right, but "extrapolate" is not one thing. It is a
sequence of increasingly large assumptions, and **the design principle is that
you climb only as far as you are forced to, and the app tells you which rung it
reached.**

Roughly, most evidence-like first:

1. **This card's own recent sales** — nothing outranks it.
2. **The same identity's shared sales** (other owners' history for the same
   printed card). Already built.
3. **Same card, adjacent grade** — a PSA 9 comp used to value a PSA 10 via a
   grade multiplier. One assumption: that the multiplier holds here.
4. **Same card, different grading company** — adds an assumption about
   cross-company equivalence, which is contested and drifts.
5. **Same card, older sales, index-adjusted forward.** Valid only if the index
   is real. Otherwise it is laundering an old price with a decimal on it.
6. **Sibling cards** — the same player and set at a different parallel or
   serial number, scaled by a scarcity relationship.
7. **Model-only** — attributes in, price out, fitted across the catalog. Most
   inferred, most dangerous, and the one that looks most authoritative.
8. **Bulk floor** — the card is worth roughly nothing and should consume no
   compute at all.

The important consequence: **rung 8 must be checked first, not last.** Most
cards in a real collection are bulk. If the system spends an API call or an AI
token before establishing that, the cost model collapses on the first 5,000-card
collection buy.

---

## Part 3 — On the dial Beau described

He asked for a control spanning "the full spectrum of what you can do and what
they want you to do", possibly a horizontal scale, possibly with a second axis.

*(my reasoning, and it is a disagreement)*

**One slider is the wrong shape, because at least three independent things are
being conflated.** Sliding "more extrapolation" on a card with forty real comps
is offering someone a control whose only function is to make the answer worse.

I would propose three separate controls, and one deliberate non-control:

- **Posture** — Conservative · Market · Aggressive. Where in the observed
  distribution the number sits. This is the one that genuinely maps to
  *"arrive at a value they have confidence in."*
- **Effort** — how much to spend. Free (own comps) · Standard (shared history,
  index adjustment) · Deep (external lookups, AI reasoning). This is a **spend**
  control and connects directly to the metered-pricing idea.
- **Evidence floor** — how thin is too thin before the app abstains. A
  threshold with a sane default, not a slider.
- **NOT a control: how far up the ladder to climb.** That is *derived*. The app
  climbs as little as it can and reports the rung it reached. Making it
  selectable turns an honest constraint into a preference.

If a second axis is genuinely wanted, the honest one is **horizon** — flip /
season / long hold — because it changes which comps are even relevant. That
already exists as a Card Intel setting.

---

## Part 4 — The gaps in the brief

*(my reasoning — this is the section Beau asked me to find, and it matters most)*

### Gap 1 — "What is it worth" and "what will it sell for, from me, this month" are different numbers

The brief treats value as one figure. It is at least four: market value,
auction-realised value, buy-it-now-with-offers value, and liquidate-this-week
value. The app already knows landed cost, days-to-sell and (soon) fees, so it
can answer the second question — which is the one an actual decision needs.
Building a "value" that ignores this is building the number nobody uses.

### Gap 2 — A value is a distribution, not a number

Two cards can both be "worth $200": one sold forty times between $190 and $210,
the other twice, at $80 and $320. Identical mean, opposite decisions. **Emitting
a single number destroys exactly the information that matters most**, and it is
destroyed at the moment of the decision. This is the strongest argument for a
range as the primary output, with the point estimate as a derived convenience.

### Gap 3 — The estimate becomes evidence, whether or not it was meant to

Once the app prints a value it will end up in an insurance claim, a partnership
dispute, a consignment agreement, a probate filing or a tax return. "Decision
support, never a guarantee" is the right posture, but it has to be **on the
artifact**, not only in a code comment. It also argues for storing every
estimate with its date, its inputs and its rung — a dated stored estimate is far
more defensible than a number regenerated months later from changed data.

### Gap 4 — The shared catalog cuts both ways

`card_market_sales` hangs off the shared identity: every owner of a card
inherits everyone's accumulated history. That is a real moat. It also means
**one user's bad paste, or a wash sale, or a shill bid, poisons every other
user's estimate for that identity** — permanently, because history accumulates.
There is no provenance weighting, no outlier quarantine and no dispute path
today. The risk scales with users, and the fix is much cheaper before there are
any.

### Gap 5 — The learning loop has selection bias baked in, and it flatters

This is the biggest trap in the brief.

You only observe the sale price of cards that **sold**. A card estimated too
high does not sell, and therefore never produces a data point. So comparing
estimates to realised sales measures the model *only on the cases where it was
low enough to transact* — and will report that it is well calibrated while
being systematically optimistic.

The correction is that **a listed-and-unsold card is evidence too** — evidence
of an over-estimate — and the loop has to count it. Without that, "the app
learns from results" is a mechanism for becoming confidently wrong.

### Gap 6 — Who the number is for changes what it should be

A seller wants an optimistic number ("list here"). A buyer wants a conservative
one ("pay no more than"). An accountant wants a defensible one ("this is FMV on
this date"). One output cannot serve all three honestly. This may be what the
"spectrum" control should actually select.

### Gap 7 — How much can be learned at Beau's scale

A solo operator might realise a few hundred sales a year, spread over hundreds
of distinct identities. That is enough to learn **one global bias correction**,
and possibly a handful of per-segment multipliers. It is nowhere near enough to
fit a model per player or per set. Any design that implies otherwise is
overfitting theatre, and it will look like it is working right up until it
costs money.

### Gap 8 — Regime change makes old comps lie

The hobby repriced violently in 2020–21 and again after. A 2021 comp is not a
comp. Index-adjusting stale sales forward is either the most valuable technique
on the list or the most dangerous one, depending entirely on whether a real
segment index is available — which is a sourcing question, not a maths one.

---

## Part 5 — Questions for Beau

Real forks. Each changes the design.

1. **Is the primary output a range or a number?** A range is more honest and
   harder to act on. My recommendation is a range, with a point estimate
   derived from your Posture setting — but it changes every screen that shows a
   value today.
2. **Should the app ever refuse to give a number?** Today `min_comps` already
   makes it abstain. Should extrapolation always produce *something*, or should
   "we genuinely don't know" stay a valid answer?
3. **Who is the default number for** — you as a seller, or a neutral FMV? This
   decides whether the default posture is optimistic or conservative.
4. **Does one user's realised sale improve everyone's estimate?** The catalog is
   already shared. Pooling outcomes is powerful and it is also the poisoning
   risk in Gap 4. Shared, or per-user only?
5. **What is the honest name for the model output?** "Value" implies a fact.
   "Estimate", "indication", "model value" all set different expectations —
   and this is the word that appears on an insurance claim one day.
6. **How much are you willing to spend per card?** The ladder's upper rungs cost
   real money. A bulk card must cost zero. Where is the line, and is it your
   choice per card or a global setting?
7. **Do you want listed-and-unsold tracked?** It is the fix for Gap 5 and it
   requires the app to know what you listed and at what price — which means the
   eBay sell-side data it already has.
8. **Is grading-company equivalence something you have a view on?** Rung 4 needs
   a cross-company multiplier, and there is no neutral source for it. Your own
   opinion, encoded and revisable, may be more honest than a borrowed one.


---

## Part 6 — What the research added

*(Five-agent pass, 2026-07-28. Claims about our own code were verified before
being recorded here.)*

### The headline, and it reshapes everything

**There is no reachable, permitted API that sells third-party sold comps.** Not
at any price a solo operator can pay.

- **eBay Marketplace Insights** — the sold-comp API — is "Limited Release... only
  to select developers approved by business units." Community threads through
  mid-2026 show consistent denials. No paid tier, no self-serve. **And its
  lookback is 90 days**, so it could never have backfilled history anyway.
- **The eBay Finding API and `findCompletedItems` were decommissioned
  2025-02-05.** Any tutorial or library proposing them describes a world that
  ended eighteen months ago.
- **Card Ladder** holds 100M+ sales — enterprise-only, terms forbid reproducing
  any portion.
- **TCGplayer** stopped accepting API applicants in late 2024 and is now an eBay
  subsidiary.

**So the paste importer is probably permanent infrastructure, not a stopgap**,
and should be funded like it.

### What IS reachable

| Source | What it gives | Catch |
|---|---|---|
| **Terapeak** (in Seller Hub) | eBay sold data going back **3 years**, including **the accepted Best Offer price** — the figure a normal sold search hides. **Free** to every seller. | No API, ever. UI only. A Terapeak-shaped paste parser is probably the single highest-value data feature available. |
| **eBay Fulfillment API** | **Your own** settled sales, 2-year lookback, real prices including accepted offers, with fees | Blocked by the eBay cutover today |
| **eBay Browse API** | Active listings — lowest live BIN, supply depth | An ask is not a sale. Labelling it a comp would be a posture violation. |
| **Fanatics Collect / Heritage archives** | Realized prices, high-end and vintage | No API; human read then paste |
| **balldontlie ALL-STAR** | Injuries + stats across NBA/NFL/MLB/NHL/NCAA | **$9.99/mo**, one bill, properly licensed |
| **PSA public API** | Cert lookup | ~100 calls/day; cache per identity forever |
| **Card Hedge** | Claims 40M+ transactions including historical sales, ~$0.01/call | **The only automatable third-party sold-comp candidate found.** Provenance unverified — see Q7. |

### Scraping is off the table on terms, not on difficulty

eBay's User Agreement bans automated access "for any purpose", and **as of
2026-02-20 they expanded it to name LLM-driven bots specifically.** That
includes driving the Terapeak UI headlessly. *hiQ v. LinkedIn* established that
scraping public pages is not a CFAA violation — and then hiQ **lost on breach of
contract for $500,000.** Technically a day of work; not available to us.

### A licensing conflict that is live right now

**PriceCharting's licence is internal-use-only, and the connector is already
wired** (`price-sources/pricecharting.ts`). CardOps' architecture is
multi-tenant. Those two facts cannot both stand. This is not a valuation
question — see Q1.

### Corrections to our own documents and code

1. **`reference/pricing-factors.md` §1 is wrong.** It says automated comp feeds
   via "eBay orders API, PriceCharting API — replaces pasting". The orders API
   returns *your own* sales only; PriceCharting returns current guide values
   with **no sales history at any tier**. Neither replaces pasting. That line
   stands up an expectation that pasting goes away.
2. **`interpretPipeline` has a latent trap at `valuation.ts:187`** — *verified*.
   `own_grade` and `cross_grade` filter comps to within `± grade_delta`, then
   `pool.map(c => ({ price, date }))` **throws the grade away**. A PSA 9 at $100
   and a PSA 10 at $600 both enter one pool and both cards come out near $350.
   *The default is 0 and no seeded strategy sets it, so nothing is wrong today
   — the research called it a live defect and that was overstated.* But the only
   reason to widen the delta is to escape a `min_comps` abstention, so **the
   feature's sole use case is the one where it is wrong.** This is rung 3
   implemented without the adjustment step that makes rung 3 legitimate.
3. **The two output paths disagree about shape.** `card_estimates` (the paid AI
   path) already has `low`, `high`, `confidence`, `rationale`, `sources`.
   `card_valuations` (the free deterministic path) has only `value` plus a
   `confidence` nothing computes honestly, **and no reference to which strategy
   produced it.** The more expensive path is the more honest one, which is
   backwards.

### Two gaps sharper than mine

**Gap 1 was half right.** There are two models, not one, and they have opposite
pooling rules. The **market** model ("what does this card sell for") *should* be
pooled — those are public completed sales. The **execution** model ("does *this*
seller realize above or below market, and how fast") **must be per-user**,
because it encodes photo quality, feedback score, shipping speed, patience and
return policy. A pooled execution model trained mostly on one prolific seller
encodes that seller's behaviour as "the market", then renders it as truth.

**Gap 4 is worse than I wrote.** `card_market_sales.card_id` is nullable with
`on delete set null`, and there is **no `added_by` column**. That nullable FK
was the right call — deleting a card must not destroy history other owners
depend on — but the side effect is that deleting a card **severs the only link
back to who contributed those rows.** A poisoned row can become permanently
un-attributable, so it can be neither disputed nor bulk-reverted.

### A decision with an expiry date

**`card_market_sales` is empty and about to refill.** Adding a sale-format
column (auction / BIN / accepted-offer) and a pop-snapshot table costs almost
nothing now. Adding either after the re-gather costs a second re-gather. If a
pop source is ever coming, the table wants to exist before the data does.

### The question that outranks all the valuation ones

**Is CardOps your internal tool, or a product?** It decides whether the
PriceCharting connector may keep running, whether Scryfall data may sit behind
credits (their terms forbid paywalling it), what you ask GemRate for, and
whether pooled-outcome design needs privacy machinery at all. **The architecture
is already multi-tenant; the licence posture assumes it is not.** One of those
has to give, and it is far cheaper to answer before the second user than after.

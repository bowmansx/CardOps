# VALUATION_ENGINE — the design the build prompt assumed existed

**Written 2026-07-30, from scratch.** The build prompt opened *"Read first:
`reference/VALUATION_ENGINE.md`... Roughly 60% of this spec is already designed
there"*, and it was not in the repo — the second time that document has been
cited and been absent. Beau confirmed he is not aware of it existing anywhere.

So this fills the hole. **It is grounded in what the repo already does rather
than invented**, because the single biggest finding from diffing the spec was
that much of the "new" design is already shipped under other names.

---

## 0. What already exists — read this before designing anything

| The spec calls it | The repo has | State |
|---|---|---|
| Liquidity ladder, classes A–G (§2) | `liquidity.ts` — six MEASURED tiers | **Shipped, tested** |
| Comp store | `card_comps` (per-card) + `card_market_sales` (per-identity, shared) | Shipped |
| `CompSource` adapter | `PriceSourceAdapter.fetchSales` → `ObservedSale[]` | Shipped |
| Multiplier table | `card_grade_multipliers` | Shipped, no prior/observed split |
| Configurable method | `PipelineV1` in `valuation.ts` | Shipped |
| `data_sources` registry | `card_data_sources` + `rights` in code | Migration 20260752, unapplied |
| Recency weighting | `weightedPrices`, 180-day half-life | Shipped |

**The ladder is the big one.** `tierOf` already classifies from measured
velocity, carries its sample size, and returns `unknown` rather than guessing.
That is precisely the discipline §2 asks for. Building a parallel A–G ladder
would give the app two classifiers that disagree.

---

## 1. The liquidity ladder — extend, do not replace

Existing tiers, from `tierOf(velocity)`:

| Tier | Rule | Meaning |
|---|---|---|
| `hot` | ≥8 sales/month | Trades constantly; pricing is the only variable |
| `liquid` | ≥3/month | Sells steadily |
| `moderate` | ≥1/month | A market exists, patience is part of the price |
| `thin` | <1/month, or too few to rate | Occasional sales |
| `stale` | No sale in >365 days | Had a market once |
| `unknown` | No dated sales at all | Not enough to say |

**The one class genuinely missing** is the distinction the build prompt is right
about and this ladder cannot express: `unknown` currently conflates two
completely different situations.

- **`TOO_NEW`** — no history because the card did not exist long enough. The
  product is weeks old. Comparable-product transfer applies: same brand and
  parallel tier from the prior year's equivalent product, adjusted for player
  tier.
- **`TOO_RARE`** — history exists for the SET, but this variant does not trade.
  A /5 parallel of a card whose base version sells daily. Analog transfer
  applies: reach across parallels within the same card.

**Never apply a TOO_RARE method to a TOO_NEW card.** The first extrapolates from
siblings that exist; the second from a product that no longer exists. Getting
this backwards prices a 2026 rookie off a 2019 sibling that is not comparable, or
a /5 off a product year that says nothing about scarcity.

**Implementation:** add `too_new` and `too_rare` as refinements of `unknown`,
decided by the identity's issue year against the earliest sale ANY variant of
that set has. Do not add a seventh tier to `tierOf` — add a `reason` field, so
existing consumers keep working and nothing has to be re-mapped.

---

## 2. Method precedence — blending is a last resort

```
class hot | liquid          → direct comps only. No blending. Period.
class moderate              → direct comps, widened window
class thin | stale          → direct comps + ONE transfer method, compared
class too_rare              → analog transfer across parallels
class too_new               → comparable-product transfer
never                       → a bare model output with no evidence behind it
```

**When two methods produce estimates:**

- **Within 20% of each other** — blend weighted by confidence², raise confidence
  modestly, and say in the narrative that two independent methods corroborated.
- **Beyond 20% apart** — **DO NOT BLEND.** Present both, widen the range to span
  them, drop confidence, and state the disagreement. A confident-looking average
  of two numbers 3× apart is the worst output the engine can produce: it destroys
  the information that mattered (they disagree) and replaces it with false
  precision.

This mirrors `partitionByBasis` and `stackAdvice`: where the app cannot reconcile
two things honestly, it reports both and says so.

---

## 3. Analog transfer

Transfer a known price across an axis, using a multiplier, with a mandatory
back-test.

```
1. Pick the axis: grade | parallel | grader | sibling-player
2. Find the nearest neighbour on that axis WITH comps.
3. Resolve the multiplier: observed → prior. Using a prior costs confidence.
4. Apply it. Record which multiplier, and whether it was observed or prior.
5. BACK-TEST: run the same transfer from the neighbour to a THIRD point that
   also has comps, and measure the error.
      error > 35%  → downgrade to range-only. No point estimate.
      no third point → treat as if it failed. An untested transfer is a guess.
6. Emit the range regardless. Never a bare number.
```

**Step 5 is the load-bearing one.** A method that cannot reproduce a price we
already know does not get to assert one we do not. `adjustToGrade` already has
the right shape — it returns `null` rather than converting when it has no
multiplier — and this extends that discipline to the whole transfer.

**Real grade multipliers range roughly 3× to 20× and sometimes INVERT** — a
graded 9 can sell below raw when the grade disappoints relative to the card's
reputation. A fixed table is confidently wrong. This is why priors and observed
values are separated, and why using a prior must cost something.

---

## 4. Confidence

Confidence is a claim about how often the engine should be right. It is not a
vibe, and **it must be calibrated against outcomes or it means nothing**.

Start from evidence and subtract for every assumption:

```
base by class:   hot 0.85 · liquid 0.75 · moderate 0.60 · thin 0.40
                 stale 0.30 · too_rare 0.25 · too_new 0.20

then subtract:
  −0.10  any prior_ multiplier used (per distinct multiplier, max −0.20)
  −0.15  back-test error 15–35%
  −0.10  comps span >180 days
  −0.10  fewer than 5 comps
  −0.05  per unresolved extrapolation trigger
  −0.20  methods disagree beyond 20%
  −0.15  any comp excluded for unknown price basis
then add:
  +0.05  two independent methods agree within 20%
  +0.05  ≥3 comps from the last 30 days

clamp to [0.05, 0.95]. NEVER 1.0 — the engine is never certain.
```

**These numbers are priors and are almost certainly wrong.** They are a starting
shape, not a finding. Phase 3's calibration curve is what makes them real, and
until it has Track A data they should be treated as arbitrary. Say so in the UI.

---

## 5. The reasoning trace

Every valuation returns, and never a bare number:

```
{ estimate, range: [low, high], confidence, class, class_reason,
  method, methods_considered[], comps_used[], candidates_rejected[],
  multipliers_used[{ key, value, source: observed|prior, n }],
  triggers[], narrative, guardrails_tripped[], lens, priced_at, expires_at }
```

`candidates_rejected` is the highest-value field and the one nobody builds.
Storing what was CONSIDERED and thrown out, with the reason, does two jobs: it
explains a thin comp set instead of leaving it looking like absence, and every
manual re-inclusion is training data about where the rules are miscalibrated.

The precedent is already in the codebase: `partitionByBasis` returns both halves,
and `distill` reports `excluded` with a note naming the platforms. Same idea,
scaled up.

---

## 6. What this design deliberately does NOT decide

- **Class thresholds.** The existing velocity cutoffs (8/3/1 per month) were set
  by judgement and have never been validated. Phase 3 should propose changes;
  they must not auto-tune.
- **The 20% disagreement boundary.** A guess. Calibration should move it.
- **The 35% back-test ceiling.** Also a guess, from the build prompt.
- **Whether `card_comps` and `card_market_sales` should ever merge.** They serve
  different scopes and eight consumers read the first. Leave them.

---

## 7. Open, and blocking

- **Prior multiplier tables.** The build prompt says "seed `prior_value` from the
  January 2026 tables (grade multipliers, parallel premiums, scarcity tiers)".
  Those tables are not in the repo. `reference/pricing-factors.md` is a factor
  MAP, not a multiplier table. Without them there are no priors to seed, and the
  engine starts with observed-only — which means it abstains far more often
  early on. **That may actually be the right behaviour**, but it is a different
  product than the prompt describes and should be a decision, not a surprise.
- **`card_valuations` is `unique (card_id, grader, grade)`** — a current-value
  table. The immutable append-only log the spec requires needs that constraint
  dropped and a migration story for existing rows.

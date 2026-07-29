# Valuation — how a card gets a number

The area of the app that answers *what is this card worth*, and — the harder
half — *what do we say when we don't really know*.

Started 2026-07-28 from Beau's brief. This folder is **yours to write in**; the
loop only writes [[FINDINGS]] and the dated files under `research/`.

## The files

| File | Who writes it | What it holds |
|---|---|---|
| [[BRIEF]] | **You** | What you want it to do. The original ask lives here verbatim. |
| [[FINDINGS]] | Loop | What research turned up: sources, methods, gaps, and the questions that need your answer. |
| [[DECISIONS]] | **You**, or both | Answers to the open questions, and anything settled. This outranks [[FINDINGS]]. |
| `research/` | Loop | Dated deep-dive outputs, kept whole so a claim can be traced back. |

## The five problems, named separately

Beau's brief is really five systems. Keeping them apart matters, because they
fail differently and three of them are much easier than the other two.

1. **Sourcing** — where real past sales come from, and what the terms let us
   store. Mostly a research and contracts problem, not an engineering one.
2. **Triggering** — deciding *this* card doesn't have enough real evidence.
   Measurable and cheap.
3. **Extrapolating** — producing a defensible number anyway. A ladder of
   methods, climbed only as far as you must.
4. **Explaining** — showing the work, the sources, and everything that was
   *available and not used*, so the number can be argued with and adjusted.
5. **Calibrating** — recording estimates, comparing them to later real sales,
   and learning. The one with a trap in it (see [[FINDINGS]]).

## What already exists — read this before designing anything

Most of the *calculation* machinery is built. The gap is sourcing, extrapolation
and calibration, not arithmetic.

- **`PipelineV1`** (`src/lib/cards/valuation.ts`) is already a configurable
  pricing pipeline stored as jsonb on `card_pricing_strategies`. It supports
  source filtering, comp scope (raw / own-grade / cross-grade with a grade
  delta and a company list), time windows, last-N, top-N, `min_comps`
  abstention, outlier guards (IQR fence, top/bottom percentile trims, absolute
  bounds), six aggregate functions including a recency-weighted average with a
  half-life, and a final multiplier.
- **`buildLadder()`** produces a per-grade, per-company value ladder.
  **`gradeUp()`** does grade arbitrage.
- **`card_identities`** is a shared cross-tenant catalog; `card_market_sales`
  hangs off the IDENTITY, so every owner of the same card shares one
  accumulated history.
- **`liquidity.ts`** estimates days-to-sell. News scoring exists. A grade
  estimator from photos exists.
- [[pricing-factors]] (`reference/pricing-factors.md`) already maps the factor
  space at a high level.

**So the "interactive system where people build their own calculation" is
largely a UI over an engine that already runs.** That is a very different piece
of work from writing the engine, and it is worth not forgetting.

## The standing rule for this whole area

The same one that governs the rest of the app, and it bites hardest here:

> **Never present a figure as more certain than it is.** A card with two comps
> from 2023 and a card with forty from last month must not produce numbers that
> look alike. Abstain over guess.

An extrapolated value is a *model output*, not a price. Wherever one is shown,
what produced it and how thin the evidence was must travel with it.

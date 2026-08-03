# COMPONENTS — everything started, where it is, what would finish it

**Machine-checked.** `node scripts/component-check.mjs` verifies every `Files:`
path exists and flags any module in `src/lib/cards` or `src/components/cards`
that no entry claims. A hand-written inventory rots in a fortnight; this one
fails loudly instead.

**Status vocabulary — the distinctions that matter:**

| | Meaning |
|---|---|
| `shipped` | Built, tested, and something reads it. |
| `partial` | Works, but a named piece is missing. **The piece is named.** |
| `stalled` | Blocked on a decision or an external answer. **The blocker is named.** |
| `designed` | Written down, no code. |
| `discussed` | Said out loud, never written down until now. |
| `shelved` | Deliberately paused. **A choice, not a blocker.** Kept here so it is findable, not so it nags. |

`partial` and `stalled` are different on purpose. Partial is work; stalled is a
question. And `shelved` is neither — it is a decision to stop, which deserves to
be recorded as a decision rather than decaying into a stale open item. Mixing
these three is how a to-do list becomes a wall of guilt.

---

## Valuation & pricing

### observed-sale-spine
**Status:** shipped
**Files:** `src/lib/cards/observed-sale.ts`, `src/lib/cards/distill.ts`, `src/lib/cards/price-basis.ts`
**Done:** Every sales source normalizes into `ObservedSale`; the distill sits above the adapters; hammer→all-in conversion with un-citable venues excluded and reported.
**Left:** Nothing.

### source-rights
**Status:** partial
**Files:** `src/lib/cards/price-sources/types.ts`, `src/lib/cards/price-sources/index.ts`, `src/lib/cards/price-sources/manual.ts`
**Done:** persist / redisplay / pool declared per source and consulted by the write path, default-denying unknown sources. `mayPoolFrom(source, credential)` makes poolability depend on whose key paid.
**Left:** `deleteOnTerminationDays` is declared and no tooling executes it — The Card API §5 requires deleting stored rows within 30 days of cancelling, and nothing can currently do that.

### byo-source-configs
**Status:** stalled
**Files:** `supabase/migrations/20260752000000_source_instances.sql`
**Blocker:** Migration not applied. Nothing reads `card_source_configs` or `card_data_sources` yet, and no credential store exists — `credential_ref` names a secret that has nowhere to live.
**Left:** Apply the migration, build the secret store, build the settings UI, teach the orchestrator to use a user's key.

### net-proceeds
**Status:** shipped
**Files:** `src/lib/cards/net-proceeds.ts`, `src/components/cards/WhatYouKeep.tsx`
**Done:** Break-even by inverting the fee equation; tiered eBay rates verified against their own page; fee rate prefers Beau's own settled sales over any table.
**Left:** Nothing, but see `ebay-store-fees` below.

### price-provenance
**Status:** shipped
**Files:** `src/components/cards/PriceProvenance.tsx`, `src/components/cards/MarketBySource.tsx`, `src/components/cards/SalesHistoryChart.tsx`
**Done:** Source, count, window, freshness on every price, tapping through to the sales themselves. Honest "no comp at this grade". Attribution rendered where a licence requires it.

### paste-lane
**Status:** shipped
**Files:** `src/lib/cards/paste-sales.ts`, `src/components/cards/PasteComps.tsx`, `src/app/api/cards/market-sales/paste/route.ts`
**Done:** Parses any pasted sold table, preview-then-confirm, every rejection reported with its line number. Ambiguous dates refused rather than guessed.
**Left:** Nothing.

### cold-tier-rollups
**Status:** partial
**Files:** `src/lib/cards/rollup.ts`, `src/app/api/cards/market-sales/compact/route.ts`
**Done:** Compaction into per-identity/grade/period statistics that carry provenance. Additive — deletes nothing.
**Left:** Nothing READS the rollups. `rollupsToSeries` exists and no chart calls it, so history older than the hot window is computed and then ignored. Also gated on `CRON_SECRET`, so it 401s until the cutover.

### own-book-source
**Status:** partial
**Files:** `src/lib/cards/price-sources/own-book.ts`
**Done:** A user's own settled sales as comps — the highest-trust source available and it needs nobody's permission, because a seller is a party to their own transaction. Price is settled not scraped, identity is exact rather than title-matched, condition is known rather than inferred from a ~12%-populated grader field, and accepted Best Offers carry their real negotiated number. Title is deliberately left NULL so the pooling decision never has to be retrofitted through stored data.
**Left:** Nothing reads it yet — the orchestrator needs a caller that supplies the rows. `rights.pool` is false pending the Lane C decision.

### orchestrator
**Status:** partial
**Files:** `src/lib/cards/orchestrator.ts`
**Done:** Valuation engine Phase 1.4. Walks sources cheapest-first and stops on SUFFICIENCY rather than on success — a source returning rows is not a reason to stop, the question is whether the evidence supports an answer at the confidence asked for. Budget checked before the call, not after. A failed source is distinguished from an empty one and is not charged for.
**Left:** No caller. Needs wiring to a route that supplies `read` with the real Supabase queries, and the sufficiency thresholds are judgement rather than calibrated.

### valuation-engine
**Status:** designed
**Files:** `BUILD_LOG.md`, `reference/VALUATION_ENGINE.md`
**Done:** The spec diffed against the repo (five findings, two of which change its Phase 1), and the missing design written from scratch 2026-07-30 — grounded in what exists rather than invented, because the ladder, the comp store, the adapter interface and the configurable method were all already shipped under other names.
**Left:** Implementation. The one genuinely missing piece of the ladder is splitting `unknown` into `too_new` and `too_rare` — different failure modes needing different transfer methods, and applying one to the other prices a 2026 rookie off a 2019 sibling.
**Blocked on a decision:** the prior multiplier tables the prompt says to seed from do not exist in the repo. Starting observed-only means the engine abstains far more often early — which may be RIGHT, but it is a different product than the prompt describes.

---

## Camera

### glare-sweep
**Status:** partial
**Files:** `src/lib/cards/homography.ts`, `src/lib/cards/stack.ts`, `src/lib/cards/sweep.ts`, `src/lib/cards/sweep-frames.ts`, `src/components/cards/CameraSheet.tsx`
**Done:** Registration from the corners edge detection already finds; glare-removed and raking-light surface composites from one pass; coaching; memory released before the result paints.
**Left:** **Never met a real card under a real lamp.** Three constants need tuning on contact — `minMove` 0.06, `SPECULAR` 200, `target` 8. See `TEST-THE-CAMERA.md`.

### surface-map-safety
**Status:** shipped
**Files:** `src/lib/cards/photo-set.ts`
**Done:** A surface map is excluded from listings by `capture_meta` rather than by role, kept for grading, and captioned so a grader is not told a lit highlight is damage.

### camera-legibility
**Status:** shipped
**Files:** `src/components/cards/CameraSheet.tsx`
**Done:** Zero translucent text, nothing below 13px, solid panels, controls as solid chips. Third attempt; the first two treated the symptom.

### sweep-template
**Status:** shipped
**Files:** `src/lib/cards/templates.ts`, `supabase/migrations/20260751000000_sweep_template.sql`
**Done:** `sweep: true` on a shot arms the sweep; template applied and live.

---

## Intake

### intake-session-list
**Status:** shipped
**Files:** `src/lib/cards/intake-session.ts`, `src/components/cards/IntakeSessionList.tsx`
**Done:** Q1. Cards booked this sitting stay on screen; archive not delete; photos-missing flagged.

### sticky-fields-and-clear
**Status:** discussed
**Blocker:** Q2 from Beau's queue, 2026-07-28. Never started.
**Left:** A value set on one card carries to the next until changed, with an X to clear per field. Needs three visual states: inherited, set here, cleared.

### card-groups
**Status:** discussed
**Blocker:** Q3. Never started.
**Left:** A Card Groups section, plus Add-to-Group in the photograph step. Beau later refined this: auto-generated objective groups (sport → year → brand → product line) browsable as facets, with user-created groups as a separate thing, and tags covering the rest.

### facets-and-tags
**Status:** discussed
**Blocker:** Q4. Never started.
**Left:** A reorderable, query-driven facet browser plus user tags. Beau: tags for patch/auto/etc., and something for associating cards with another owner.

### ownership-consignment
**Status:** stalled
**Blocker:** Q5. Beau was asked whether a nullable `owned_by` excluding cards from all totals works as step one, and never answered.
**Left:** Consignment/ownership so someone else's cards can be intaken without polluting Beau's own totals.

---

## Money & books

### basis-and-cost-lines
**Status:** shipped
**Files:** `src/lib/cards/basis.ts`, `src/components/cards/BasisBreakdown.tsx`

### provenance-columns
**Status:** shipped
**Files:** `supabase/migrations/20260750000000_sale_provenance.sql`, `src/lib/cards/market-sales.ts`
**Done:** provenance / added_by / price_basis / fetched_at / is_graded, applied and written to.

---

## Platform

### tier-2-config-authoring
**Status:** shelved
**Shelved:** 2026-07-30 by Beau — "i think i'm going too far right now... let's
shelf it but keep it in our summary of projects opened." Nothing was built, so
there is no cost to picking it up later.
**Why it is worth keeping:** it is the shape that makes the credit model make
sense, and the fence is already in place — `PipelineV1` has only trading-card
nouns in it, so the schema itself constrains what a generated config can express.
**Left:** Let a user describe what they want in words and have the model emit a validated config — `PipelineV1`, a photo template, a source setup — rather than code. Scoped to trading-card concepts; anything outside flagged for approval rather than refused or run. Every generated config diffed and confirmed before it takes effect, and recorded on the valuation it produced.

### credit-metering
**Status:** shipped
**Files:** `src/lib/cards/credits.ts`
**Note:** The rule that governs it: a `COST` above zero is a claim that something was fetched. Pinned by `test/credits.test.ts`.

---

## Blocked on someone other than us

### ebay-store-fees
**Status:** stalled
**Blocker:** Unknown whether Beau has an eBay Store subscription. If he does, the verified fee schedule is the wrong page and every break-even is off.

### thecardapi-coverage
**Status:** stalled
**Blocker:** The $9 coverage test has not been run. 50 cards of known value, count the matched quotes. That number decides whether pricing is a coverage problem or a depth problem.

### ebay-written-permission
**Status:** discussed
**Left:** eBay's own API licence names "express prior written permission" for aggregated transaction data. Nobody has ever asked. Free, and it decides whether a contributed pool can legally exist.

### seller-hub-optin
**Status:** stalled
**Blocker:** Seller Hub is not switched on for Beau's eBay account — tested, `/sh/ovw` redirects to the opt-in exactly as `/sh/research` does. Free, one click, and it gates Terapeak.

### pricecharting-permission
**Status:** stalled
**Blocker:** Their terms forbid use in software accessible to third parties. Permission contact is brady@vgpc.com. Until asked, that connector shows nothing to anyone but Beau.

---

## Discussed and deliberately NOT built

Recorded so they stop resurfacing as new ideas.

- **Lane B pooling** — users uploading Seller Hub CSVs into a shared pool. Researched 2026-07-30 and killed on four grounds; the strongest is that eBay pre-empted the consent argument in contract, and exports cap at 90 days anyway.
- **Scraping** — eBay's terms ban automated access and named LLM-driven bots on 2026-02-20; hiQ lost to LinkedIn on breach of contract for $500k.
- **News sentiment / social hype scoring** — weak signal-to-price correlation, unbounded scope.
- **A global spectrum setting** for valuation aggression — per-run lenses instead, because different purposes need different behaviour on the same card.
- **Deleting hot sales after compaction** — the rollup keeps statistics and loses the tap-through evidence. Deliberately deferred as its own decision.

---

## Recommendations nobody asked for

Judgement, not findings.

1. **`git push`.** 22 commits are local. Nothing from the last two days is on a phone.
2. **Scope Obsidian Git to `spec/`.** It is auto-committing source under `notes:` timestamps and watching a directory where builds write thousands of files.
3. **Read the rollups.** The cold tier computes history nothing displays — the clearest "built and not wired" item on this page.
4. **Answer Q5 (ownership).** It is the only queue item blocked purely on a decision, and it blocks consignment entirely.
5. **Tier 2 before Tier 3.** Config authoring gets ~90% of "make it your own" at ~5% of the risk, and its schema is exactly the boundary a sandbox would need later.

---

# The app that existed before this registry

Added 2026-07-30 when `component-check` reported 57 untracked modules. Anything
below marked `shipped` is in production and working; where I have read the code
this session and know a caveat, the caveat is stated rather than smoothed over.

## Camera & photo

### edge-detection
**Status:** shipped
**Files:** `src/lib/cards/edges.ts`, `src/lib/cards/camera.ts`, `src/lib/cards/exposure.ts`
**Done:** Hough-based card detection with sub-bin peak refinement, distance/tilt readout, auto-snap gating, and the glare measurement that decides whether a sweep can help at all.

### photo-templates
**Status:** shipped
**Files:** `src/lib/cards/templates.ts`, `src/lib/cards/photo-set.ts`, `src/lib/cards/session.ts`, `src/components/cards/SessionMenu.tsx`
**Done:** Template runs with per-shot targets, the session menu (reorder/retake/inspect), and one place deciding which photos represent a card.

### photo-upload
**Status:** shipped
**Files:** `src/lib/cards/upload.ts`, `src/components/cards/AddPhotos.tsx`, `src/components/cards/Lightbox.tsx`, `src/components/cards/PhotoSettings.tsx`, `src/components/cards/GradingSheet.tsx`

## Intake & identification

### intake-flows
**Status:** shipped
**Files:** `src/components/cards/FullIntake.tsx`, `src/components/cards/BatchIntake.tsx`, `src/components/cards/SpeedBook.tsx`, `src/components/cards/CardForm.tsx`

### find-card
**Status:** shipped
**Files:** `src/lib/cards/match.ts`, `src/components/cards/FindCard.tsx`
**Done:** FIND — "which card in my inventory is this". Identifying fields required or a year-only query scores 1.0; cert conflict scores 0.

## Estimation & AI

### ai-estimates
**Status:** shipped
**Files:** `src/lib/cards/estimate.ts`, `src/lib/cards/estimate-run.ts`, `src/components/cards/CardEstimates.tsx`, `src/components/cards/AutoEstimateSettings.tsx`
**Done:** Two modes (standard+context, all-sales+context) over the underlying sales rather than a distilled quote.

### grade-estimate
**Status:** shipped
**Files:** `src/lib/cards/grading-ev.ts`, `src/components/cards/GradeEstimate.tsx`, `src/components/cards/GradeEV.tsx`
**Done:** Per-company grade estimate, and the grade-or-flip EV using a uniform distribution over the grade interval with unpriceable grades kept and their mass reported.

### card-intel
**Status:** shipped
**Files:** `src/lib/cards/news.ts`, `src/components/cards/CardIntel.tsx`
**Note:** `news` reads real scored headlines; `macro` and `pop` are free and labelled judgement, after they were found charging credits for nothing.

### pricing-pipeline
**Status:** partial
**Files:** `src/lib/cards/valuation.ts`, `src/components/cards/PricingBuilder.tsx`
**Done:** `PipelineV1` — configurable comp scope, grade delta, windows, IQR guards, six aggregates, min-comps abstention. `adjustToGrade` returns null rather than guessing when it cannot convert.
**Left:** This is the closest thing to the valuation engine's ladder, and the engine spec does not acknowledge it exists. Reconcile before building a second pricing path.

## Market & selling

### liquidity
**Status:** shipped
**Files:** `src/lib/cards/liquidity.ts`, `src/components/cards/LiquidityPanel.tsx`
**Done:** velocity, tiering, weighted prices, sell estimate, ETA.

### movers
**Status:** shipped
**Files:** `src/lib/cards/movers.ts`, `src/components/cards/MoversView.tsx`

### sell-flow
**Status:** shipped
**Files:** `src/components/cards/SellForm.tsx`, `src/components/cards/CardStatusControl.tsx`
**Note:** Fee presets moved out into `net-proceeds.ts` on 2026-07-29 — they were unreachable inside the component, which is why no break-even could exist.

### ebay-connector
**Status:** stalled
**Files:** `src/components/cards/EbayHub.tsx`, `src/components/cards/EbayListPanel.tsx`, `src/components/cards/EbayLogo.tsx`
**Blocker:** Cutover interlock. eBay stays single-homed on Master-Ops; the OAuth RuName is registered against `master-ops-iota.vercel.app`, so copying `EBAY_*` here does nothing until a CardOps redirect URI is added in eBay's developer portal.

### comps-paste-legacy
**Status:** partial
**Files:** `src/components/cards/CompsPaste.tsx`
**CORRECTION (2026-07-30):** I first logged this as "two paste paths writing to
different tables — reconcile or retire", written from memory. Reading the code
shows that was overstated. They are two SCOPES, not two implementations of one
thing:

- `card_comps` — comps attached to THIS CARD. Read by eight places (grade-EV,
  intel, the daemon, the sell page, both refresh paths). AI-parsed, and it
  accepts SCREENSHOTS, which the deterministic parser cannot.
- `card_market_sales` — market history attached to the IDENTITY, shared across
  every owner of that card.

`compsAsSales` already bridges the first into `ObservedSale`, and `estimate-run`
combines all three sources. The data model is deliberate and works.

**What IS real:** the UX. Two "paste your comps" boxes on two different pages,
with different capabilities and different destinations, and nothing telling a
user which is which — so the same action produces different results depending on
which page they happened to be on.
**Left:** Make the distinction legible, or route both through one screen that
picks the destination itself. Do NOT merge the tables.

## Books, lots & admin

### books-and-ledger
**Status:** shipped
**Files:** `src/components/cards/PostToLedger.tsx`, `src/components/cards/PushToBooks.tsx`, `src/components/cards/CardBooksControl.tsx`, `src/components/cards/BookingSimulator.tsx`, `src/components/cards/ConnectorMapping.tsx`
**Note:** Nothing posts to real books automatically or from a cron.

### lots-and-bulk
**Status:** shipped
**Files:** `src/components/cards/LotsManager.tsx`, `src/components/cards/BulkManager.tsx`, `src/components/cards/MultiCasePanel.tsx`, `src/components/cards/CardsMoreMenu.tsx`

### browse-and-show
**Status:** shipped
**Files:** `src/components/cards/CardBrowser.tsx`, `src/components/cards/ShowMode.tsx`, `src/components/cards/ShowcaseManager.tsx`, `src/components/cards/LabelActions.tsx`

### admin-settings
**Status:** shipped
**Files:** `src/components/cards/CardOpsSettings.tsx`, `src/components/cards/BusinessesManager.tsx`, `src/components/cards/ReceiptsManager.tsx`, `src/components/cards/AlertControl.tsx`, `src/components/cards/PriceSparkline.tsx`

### export
**Status:** shipped
**Files:** `src/lib/cards/export.ts`
**Note:** Free complete export is ranked as the most credible trust signal available to a one-man product against funded incumbents.

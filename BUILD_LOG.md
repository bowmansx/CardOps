# BUILD_LOG

Judgment calls, one entry per decision: what, why, commit. Newest first.

---

# Valuation Engine

## 2026-07-30 — Pre-Phase-1: the spec diffed against the repo

Required by `CLAUDE.md`: *"Diff every spec against the repo before implementing
it... Verify each claim, then SAY which ones were wrong before building."* That
rule was added on 2026-07-25 after a spec cited a `VALUATION_ENGINE.md` that was
not in the repo.

### FINDING 1 — `reference/VALUATION_ENGINE.md` still does not exist

The build prompt opens: *"Read first: `reference/VALUATION_ENGINE.md`... Roughly
60% of this spec is already designed there."*

It is not there. `reference/` holds 22 files and that is not one of them; no file
in the repo mentions it. So each of these, cited as an existing design to
implement, has no source: the source registry, the liquidity ladder A–G
("implement classes A–G exactly as specified in §2"), analog transfer
("implement §4 pseudocode"), the confidence formula, the reasoning trace.

**Consequence:** ~60% of the spec is not "already designed", it is undesigned.
Phase 2 cannot implement §2 because there is no §2. Either the document exists
outside the repo and needs pasting in, or the ladder and analog method are design
work before they are implementation work.

### FINDING 2 — four proposed tables already exist under other names

| Spec proposes | Exists as | Note |
|---|---|---|
| `comps` | `card_comps` | fingerprint, card_id, source, grader, grade, sale_price, currency, sale_date, listing_url, raw, fetched_at |
| `comps` (identity-keyed) | `card_market_sales` | Closer to intent: keyed on `identity_id`, shared cross-tenant. Gained provenance / price_basis / added_by / is_graded / fetched_at on 2026-07-29 (20260750, APPLIED). |
| `valuations` | `card_valuations` | **Conflict:** existing is `unique (card_id, grader, grade)` — a CURRENT-value table. Immutable append-only with `superseded_by` requires dropping that constraint. ALTER, not CREATE, and existing rows need a migration story. |
| `multipliers` | `card_grade_multipliers` | No prior/observed split, no observation_count, no IQR. The spec's version is a real upgrade but it is an ALTER on a live table. |

`valuation_outcomes` and `data_sources` are genuinely new.

### FINDING 3 — the adapter interface already exists, built 2026-07-29

`PriceSourceAdapter.fetchSales?(card, opts): Promise<SalesResult>` returning
`ObservedSale[]`, plus `enabled()`, `handles()`, `salesBasis()` and a `rights`
block. `fetchComps` and `fetchSales` are the same function; building `CompSource`
beside it gives the app two adapter registries for one job.

`data_sources.legal_basis` is a weaker form of `rights`, which already separates
persist / redisplay / pool — three different permissions the enum collapses into
one. Keep the richer shape, add the operational columns around it.

### FINDING 4 — BOTH recommended external adapters are legally blocked

Verified within the last 24 hours against the vendors' own published terms.

**Card Hedge** ("Recommend Card Hedge for breadth") — published terms grant no
storage and no re-display right; a verification pass on 2026-07-29 refuted it on
exactly that ground. Its ToS "Effective Date" also renders as the current date on
every load, so there is no establishing which version was accepted.

**PriceCharting** ("BASELINE ONLY... store every pull as history since it keeps
none") — read 2026-07-29 at pricecharting.com/page/terms-of-service:

> "Price Data cannot be used in any software, application, or system that is
> accessible to third parties, including customers, clients, or the general
> public, without express written permission."

Storing their computed values and showing them to users is precisely the
prohibited act. Internal business use additionally requires a LEGENDARY
subscription. `rights.redisplay` is already false on that adapter for this
reason. Permission has a contact: brady@vgpc.com.

**The spec does not mention the source that passes.** The Card API is already
integrated, returns real individual sales rather than computed values, and its
§4a explicitly permits "Caching and storing API responses locally in your own
database to serve your users" and "Displaying card prices, transaction history,
and market data within your own product interface."

**DECISION:** Phase 1's second adapter is **The Card API**. Same interface, same
cost tier, and the only one of the three that may lawfully be stored and
re-displayed — which is the whole premise of a durable comp store.

### FINDING 5 — `buyer_premium_included boolean` is a regression

The repo has `price_basis` as `all_in | hammer | unknown`. The third state is
load-bearing: Goldin quotes hammer with ~22% to come, and Lelands / SCP / Hakes /
REA are houses whose premium no source we have states. A boolean forces those to
`false`, which reads as "no premium" and under-states every one. The enum lets
them be excluded and REPORTED as excluded. Keeping the enum.

### WHAT IS GENUINELY NEW AND GOOD

Recorded so it is not lost among the corrections. Five of the six NEW pieces are
strong:

1. **Track A / Track B.** The sharpest idea here. Validating a valuer on your own
   sales is circular — you priced it, listed it there, it sold. Separating
   unbiased prediction from pricing-efficiency measurement is correct and rare.
2. **The candidate ledger**, and treating exclusion overrides as training data.
3. **Prior vs observed multipliers** with a confidence penalty for priors.
   `adjustToGrade` already returns null when it cannot convert — the right shape.
4. **Per-run lenses** rather than a global setting.
5. **TOO_NEW vs TOO_RARE** as distinct failure modes needing different methods.
6. `data_sources` as a monitored registry — worth having as an extension of
   `rights`, not a parallel system.

### OPEN, BLOCKING PHASE 2 (not Phase 1)

- Does `VALUATION_ENGINE.md` exist outside the repo? If not, the ladder and
  analog transfer need designing first.
- "Seed prior_value from the January 2026 tables" — those tables are not in the
  repo either. `reference/pricing-factors.md` is a factor MAP, not a multiplier
  table.

---

# BUILD_LOG — foundation-fixes

Judgment calls made while executing the foundation plan (2026-07-25 review →
fixes). One entry per decision: what, why, commit.

## Item 1 — Master-Ops card crons retired
- Removed exactly the six card entries from Master-Ops vercel.json; the four
  MasterOps crons (refresh, alerts, recap, subs-sync) untouched. Verified on
  the Vercel crons page post-deploy: four scheduled, feature enabled.
  Master-Ops commit `02a7563`. Resolved en route: the master-ops Vercel
  project does own master-ops-iota.vercel.app (earlier "No Production
  Deployment" reading was dashboard flakiness).

## Item 2 — status is a transition
- **Enforced at the DB, not just the app.** The server-action whitelist alone
  is routable-around via raw PostgREST with a user JWT, so the real rule lives
  in triggers: guard_card_sale now guards the sold boundary in BOTH directions
  and drops the owner exemption; a new insert guard blocks cards being born
  'sold'. Non-sold moves (booked/listed/graded_out/archived) stay free — the
  eBay listing routes and archiveCard keep working unchanged.
- **CSV import whitelist = {booked, archived}.** 'listed' from a CSV would
  assert a live marketplace listing no listing_refs backs — excluded. Anything
  else (incl. 'sold') coerces to 'booked' and is counted in the new `coerced`
  return field rather than rejecting the whole file: bulk imports shouldn't
  die on one legacy status string, but the user must see the count.
- **Harness is paste-ready SQL, not a node runner.** No docker/psql/supabase
  CLI on this machine, so a vitest+pg harness could ship only unexecuted.
  Instead: supabase/tests/money-core.test.sql — one transaction, temp results
  table, PASS/FAIL output, unconditional ROLLBACK; safe to paste against the
  live DB (Beau's native migration workflow). Item 8 extends the same file.
  NOT yet executed — I could not run it here; first paste-run pending.
- The RPCs leave cardops.in_sell set for the rest of their transaction; in
  production each request is its own transaction so it cannot leak, but the
  harness resets it after every RPC call before testing the guards.

## Item 4a — funding.ts reviewed (report, no changes)
- It is NOT the pool implementation: a pure simulation engine for the Booking
  Simulator (funding paths, §267/SE flags), balanced by construction, no I/O,
  and it never touches card_pool — so purchase lots do not invalidate it.
  Soft edges only (degenerate negative/zero transfer prices produce odd
  display-only entries); left alone deliberately.

## Item 3 — purchase-lot basis
- **Naming**: `purchase_lots`, never "lots" — `card_lots` already means
  SELL-side listing bundles. Buy-side and sell-side stay distinct words
  everywhere.
- **Ledger untouched**: books/post reads `basis_drawn` off `card_sales`, so
  swapping the draw source required zero books-layer changes.
- **Lot economics guarded like the sold boundary**: remaining/total columns
  move only under the RPC handshake; label/source/date/tax_bucket stay freely
  editable. A card may only link to a lot owned by the same user (FK alone
  would accept foreign lot ids — FK checks bypass RLS).
- **Per-entity pooled basis** on the Books page now follows the CARDS (each
  live lot-card contributes its lot average to its own entity) instead of the
  old card_pool.entity_id column — exact when a lot's cards share an entity,
  and the only definition that survives cards moving between entities.
- **Legacy fold, unconditional**: any funded card_pool row becomes a per-user
  "Legacy pool" purchase lot and its live pooled cards link to it, BEFORE the
  drop — zero data loss even if "effectively empty" hides something. The
  migration opens with a verification SELECT so Beau sees row counts at paste
  time.
- **CSV import cost**: not required per-row (a bulk file shouldn't die on a
  missing column) — defaults individual_basis 0; the create form and Full
  Intake DO require an explicit cost (0 allowed). Speed Book's lot cost now
  requires >= 0 instead of > 0 (a genuinely free lot is legal).
- **Harness rewritten in the same commit** (13 assertions) since it seeded
  card_pool, which this migration drops — the paste sequence stays coherent.
  This absorbs most of item 8's scope. Still not executed locally (no
  Postgres here); first paste-run pending.

## Item 4b/c — audit integrity
- Widened the audit_log actor CHECK to the actors the code actually writes
  ('ebay-sync', 'ebay') instead of collapsing them to 'cron' — the trail is
  more informative and the constraint drop/add is name-agnostic (scans
  pg_constraint). Migration 20260736000000.
- auditOrThrow everywhere (19 sites). Typed actor union = compile-time mirror
  of the CHECK, so a future actor/constraint mismatch is a tsc error first.
- Two deliberate exceptions to throw-on-failure:
  (1) the three eBay list routes audit AFTER a live publish — a thrown 500
      would invite a retry and a double-listing, so audit failure surfaces as
      a warnings[] entry on an ok:true response;
  (2) the sync's per-order audit failure lands in failures[] (response +
      run-summary audit row) so one order's audit problem doesn't abort the
      rest of the run — the settlement itself stands either way.
- account-deletion now logs FIRST and acks second: no logged receipt → 5xx →
  eBay redelivers. Previously it acked notices it silently failed to record.

## Item 6 — free gates
- `npm run check` = types + tests (now 205: +7 readAll contract tests) +
  forbidden-pattern greps. All green at introduction — a gate that starts red
  gets ignored.
- **Lint deferred from the gate**: 30 pre-existing eslint errors (mostly
  react-hooks) predate this work; `check:lint` exists separately and joins
  `check` after a cleanup pass. Type-aware no-floating-promises likewise
  waits for that green baseline.
- Grep gates (check-forbidden.mjs): fire-and-forget `.then(noop,noop)` writes;
  raw audit_log inserts outside auditOrThrow; any resurrection of
  card_pool/use_pool_basis.
- Honest coverage map: the greps catch the swallow-by-.then class and audit
  bypass; the readAll test pins the pagination primitive; "awaited but
  {error} discarded" is NOT machine-catchable here — that class is held by
  prevention rule 1 and review, not tooling.

## Item 7 — mechanical wave (one commit, rules 1-6/9-10 applied)
- Sales & P&L: totals from a complete paged read + banner; the visible list
  stays "most recent 1000" (rule 2's legal use).
- Reports page: private pageAll deleted in favor of readAllSafe + page banner;
  card_sales ordered (sold_at desc, id) — lot children tie on sold_at.
- CPA CSV + journal export + push-preview: unique `.order("id")` tiebreakers
  (intercompany advance halves tie on all previous keys).
- Books page: interco + (already) lot reads feed the partial banner.
- Portfolio: snapshots keep the NEWEST 400 (desc + reverse); live-total read
  via readAllSafe — on failure the chart ends at the last good snapshot with a
  banner instead of a $0 today-point. Cards-index banner renders "—" on a
  failed read, never $0/−100%.
- Group filter membership paged to completion, ordered by card_id.
- eBay hub: card match map pages to completion; sales slice explicitly newest-
  first. Sync: card + lot match sets and the cancelled-order guard all read
  via readAll, ordered, FAIL-CLOSED (a failed page aborts the run instead of
  settling against an empty set).
- Lot sell validates fees/shipping like the single-card path (the RPC only
  checks sale price). Create/edit forms clamp money 0..10M and grade 0..10;
  CSV import treats negative money as absent.
- addComp checks its insert error, requires positive price, and dates go
  through coerceDateOrNull — NEW: invalid dates become null, NOT today
  (substituting today would corrupt comp recency weighting; coerceDate keeps
  its today-fallback for receipts where "when" defaults to now).
- Every vendor fetch now carries AbortSignal.timeout (10s price sources, 15s
  eBay/Zoho); card-news already had timeouts.
- NOT in this wave (deliberate): push-preview claim-status display (T2, gated
  with the push-honesty trio in next-steps.md); sync post-settle reversal,
  getOrders 300-cap redesign, lot-cancel repair, fee allocation remainder —
  behavioral eBay changes, folded into the cutover checklist (item 9).

## Liquidity v1 (design discussed with Beau 2026-07-25, five decisions resolved)
- Q1 tiers-vs-score → tier label + raw facts (sales/mo, last sale, active
  months), never a bare 0-100: precision we don't have breeds distrust.
- Q2 → both readouts: 30-day chance (%) AND expected time to sell.
- Q3 → slider ±50% default with a ±90% expander toggle.
- Q4 → SellInputs is a deliberately widenable bag; eBay Browse/Insights and
  own days-on-market calibration plug in without touching call sites.
- Q5 → value screen only for v1; browser-list chips later.
- Player tier v1 = comps across Beau's OWN cards of that player, capped at
  200 ids (URL limit) with the cap surfaced in the label — honest proxy until
  player-wide vendor data lands (phase 2, TheCardAPI daily cache).
- Model floors the "overpayer tail" at 3% so absurd prices show ~tiny-but-
  nonzero odds instead of zero; refuses to estimate below 2 sales/yr.

## eBay/cron hardening (cutover step 0 — executed)
- reverseOrderSettlement (src/lib/ebay/reverse.ts) is the ONE reversal used by
  both the manual cancel route and the sync's new cancelled-after-settlement
  detection: singles via card_unsell, lot children resolved through
  card_lot_items → card_lot_unsell once per lot (child-by-child reversal
  stranded card_lots in 'sold').
- Sync now REVERSES settlements on orders that cancel after payment, then
  writes the durable guard + an ebay_cancel_reversed audit row. getOrders
  pages to 3000 with a truncated flag; truncation lands in failures[] so the
  run reads partial, and the hub surfaces ordersTruncated.
- Fee/shipping allocation via allocate() (cents-exact, remainder on last
  line); the estimated 13.25% + $0.30 fee is computed once per ORDER and
  allocated — the $0.30 was previously charged per LINE on combined orders.
- Post-publish DB writes in list/list-lot/relist are checked: a live listing
  that CardOps failed to record returns loud "do NOT list again" warnings
  (list paths) or a 500 naming the live listing (relist) — never a silent
  success that the sync can never settle, never a retryable-looking failure.
- card-alerts: notified_at stamps only after >0 deliveries (0-delivery
  crossings stay armed); stamp/re-arm writes checked; readAll calls got
  deterministic orders.
- card-estimates: role-roster filter (demoted users stop spending credits),
  insert-then-debit ordering (both cron and interactive route), per-user
  try/catch isolation, 240s time budget with a loud deadline note.
- price-refresh: the non-owner budget share is scoped to the role roster,
  fail-closed if the roster can't be read.
- daemon: unchanged cards advance last_priced_at so the reprice cursor
  reaches the tail; history-point inserts checked.

## Lint cleanup + gate promotion
- All 31 errors fixed for real (no blanket disables): nested components hoisted
  to module scope (value ThenCell, portfolio Stat, CardEstimates Toggle,
  PricingBuilder LockBtn via lockProps); SellForm auto-fee and MoversView busy
  DERIVED in render instead of setState-in-effect; login moved to
  useSearchParams under a Suspense boundary (kills the state+effect and the
  build-time constraint the old comment worked around); raw <a> → next/link.
- En route, two real rule-1 catches the lint surfaced: recompute()'s
  pre-migration retry never checked its own error, and its history insert was
  fire-and-forget — both now throw loudly.
- requestNowMs (src/lib/now.ts) is the sanctioned clock read for server
  components — the purity lint can't tell RSCs from client components, and a
  named helper beats scattered eslint-disables.
- `npm run check` now runs types + LINT + tests + forbidden greps. Remaining
  lint output: 5 warnings (unused disable directives) — cosmetic.

## Adversarial review of my own hardening — confirmed findings, fixed
The diff-review workflow (22/29 agents completed; 7 died on a session limit)
CONFIRMED real defects in my own commits. All fixed:
- **CRITICAL**: the sync's cancel-reversal fired on cancelState !==
  NONE_REQUESTED — which includes a buyer merely REQUESTING cancellation —
  and then wrote the permanent ebay_cancelled_orders blacklist. A declined
  request would have erased settled revenue forever. Now: reversal fires
  only on terminal CANCELED (or our own durable marker); pending requests
  hold settlement without reversing or marking.
- **HIGH**: the PAID gate ran before the cancel branch, so completed
  cancellations reporting FULLY_REFUNDED never reached the reversal at all.
  Cancel handling now precedes the payment gate; only SETTLEMENT requires
  PAID.
- reverseOrderSettlement now REFUSES to auto-reverse any sale already
  pushed to the real books (card_push_log check, fail-closed) — a cron must
  not orphan an external Zoho journal; the problem string names the
  references to fix manually. Lot resolution is ownership-scoped on the
  service client.
- releaseClaim gained a 10-minute age guard (an in-flight push's claim
  can't be yanked into a double-post) and its missing sibling
  markClaimPosted ("It's in the books") — the stuck-claim panel now has
  both recovery paths rule 8 demands.
- Push route reports aborted claim-write stops; PushToBooks treats
  aborts/errors as failure (a hard abort rendered as "0 posted" green).
- Estimate responses surface cache_warning when the estimate wasn't stored
  (and the client shows it); moversDigest advances movers_seen only after
  a real delivery, checks its prefs upsert, and its readAll calls got
  deterministic orders — the same class the review's dead verifiers had
  queued, confirmed by hand.
- Hub surfaces getOrders truncation into its errors panel (rule 10 applied
  to BOTH callers, not one).
Checked by hand (verifiers lost to the session limit): daemon's
unconditional cursor stamp on locked cards is intentional rotation; the
estimates "run lock" concern matches the previously-refuted overlap class
(daily schedule + 300s cap cannot self-overlap).

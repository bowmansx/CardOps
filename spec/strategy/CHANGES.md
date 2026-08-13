# CHANGES — what I updated, and why

Newest first. One entry per run. Most entries will be a single line saying
nothing material changed — that is the routine working, not failing.

Full history of the document itself is in `journal/`.

---

## 2026-08-13 - ten quiet days; nothing moved anywhere

**Not material, and this time not because of the push boundary.** `origin/main`
is still `eb7624e` (2026-08-03). Beau's working copy is also still at
2026-08-03 — its newest commit is `14f4fd3`, and `git log --since=2026-08-03`
is empty in both. Ten days with no commits on either side. No strategy rewrite,
no republish, no research.

Checked: `git pull --ff-only` and `git fetch` on the loop clone (no movement),
`git log --since` on both repos, and a read-only diff of `BRIEF.md` between the
two — byte-identical, last changed 2026-07-30. `spec/INBOX.md` untouched since
2026-07-26.

**Unchanged, not re-counted as new:** the working copy is still 38 commits
ahead of `origin/main`, and the same three migrations are still pending and
unpasted — `20260751_sweep_template`, `20260752_source_instances`,
`20260753_parallel_ratios`. Confirmed by listing `supabase/migrations` in both
trees, not carried over from the last entry. The ranked list still does not
reflect that unpushed work, for the reason given on the 3rd.

**The CHANGES.md conflict flagged on the 3rd is still coming**, untouched by
this entry: the working copy carries overnight-loop entries origin has never
seen, and this file now has two top-of-file hunks origin-side. Keep both,
newest first, when those 38 commits are pushed.

---

## 2026-08-03 - nothing on main; the work is real but unpushed

**Not material, from where this document can see.** `origin/main` has not moved
since the 30th — zero commits, HEAD still `3a2ac9d`. `BRIEF.md` has no new
entries from Beau, committed or working-tree. No strategy rewrite, no
republish, no research.

Checked: `git pull --ff-only`, `git log --since=2026-07-30` on the loop clone
(empty), `BRIEF.md`, and a read-only look at the working copy.

**Noted, not acted on.** Beau's working copy is now **38 commits ahead** of
`origin/main` — 71 files, ~8,700 lines, all unpushed. The last entry recorded
four; that count is stale, not wrong. Among them: the valuation engine got a
route and a panel, the paste lane got wired end to end, and the camera sweep
landed. Several of those close things this document ranked. **They are not
reflected in the ranking, because ranking work I cannot read from a pushed
commit would be guessing.** The next run that sees them on `main` should treat
them as material.

**Three migrations are pending** in that range and unpasted here:
`20260751_sweep_template`, `20260752_source_instances`,
`20260753_parallel_ratios`. Not pasted, not merged, per the rules.

**A conflict is coming in this file.** The overnight build loop writes its own
entries into `spec/strategy/CHANGES.md` in the working copy — there is already
a `2026-08-02 (overnight, into the 3rd)` entry there that origin has never
seen. This entry adds a second top-of-file hunk. When those 38 commits are
pushed, resolve by keeping both, newest first.

---

## 2026-07-30 - the #1 item shipped, and the pricing question closed

**Material, and unusually so.** 31 commits and ~9,300 lines since the 28th. The
top-ranked item in three consecutive revisions of this document is built, and a
decision recorded in `spec/valuation/DECISIONS.md` closed the only open question
this document had been carrying since the first entry. Archived as
`journal/2026-07-30.md`.

Checked: `BRIEF.md` (no new entries from Beau), `git log --since=2026-07-28`,
`spec/valuation/DECISIONS.md`, `spec/strategy/GO-LIVE.md`,
`spec/valuation/research/2026-07-29-vendor-access.md`, and the code behind each
claim I was about to change.

### What SHIPPED, and it closes ranked items

- **The forward money engine — "what you keep."** `net-proceeds.ts` (593 lines),
  `WhatYouKeep.tsx`, real eBay fee tiers with the per-order band and sales tax.
  This was "the one thing" and it was estimated at 2-3 weeks. It took two days.
- **Price provenance** (#2). `PriceProvenance.tsx`, `MarketBySource.tsx`.
- **The grading fee reality** (#1), partly. Defaults moved from PSA 25 / BGS 22 /
  SGC 18 / CGC 18 + $8 to **50 / 30 / 25 / 25 + $12**, and `GradeEV.tsx:86` now
  renders the configured fee where it used to caption a hardcoded "~$20". The
  tier picker is what remains, and it is re-ranked to #4.
- **The midpoint EV bug** (#6a). `grade-ev/route.ts` now works across the whole
  estimate instead of collapsing "PSA 8 to 10" to a single 9.
- **Q1** — the intake session card list. As predicted, a wiring job on tables
  that had sat unreferenced since day one.

### What is NEW, versus what was already known

**New, and it is a finding rather than a restatement:**

- **`paste-sales.ts` has zero consumers in `src/`.** 330 lines, 262 lines of
  tests, shipped 2026-07-29, and nothing calls it. There is no route and no
  screen. Verified by grep, not inferred.
- **There are now two fee models in one app.** `net-proceeds.ts` reaches the card
  page, `SellForm` and `WhatYouKeep`; `grade-ev/route.ts` still computes
  `FEES[g] + SHIP` on its own. "The same fee-and-net function is the missing
  input in grade EV" was the *argument for building it*, and that half did not
  land. Both of these are why **"the one thing" is now "finish what just
  landed"** rather than a new build.
- **The build-and-forget pattern is named as a pattern**, because the paste
  parser makes it four: `card_intake_sessions`, `card_grading_submissions`,
  `card_format_profiles`, and now this. Previous entries reported each instance
  separately without connecting them.
- **The buy sheet is unblocked** and moves from #11 to #1, because it was gated
  on the money engine. It is gated on the $9 coverage test instead.
- **PriceCharting's licence enters the ranked list at #2.** It was in
  `GO-LIVE.md` as a deferred item; the product decision makes it a live one, and
  free distribution does not save it — the term is about *who* uses the data.

**Already known, folded in rather than presented as new:** the Q4 answer (the
objective hierarchy is a query), the sticky-fields answer, the sales-are-public
decision, and the go-live licence register. All were written on the 28th and
29th and are referenced, not re-derived.

### The pricing question is CLOSED, and it went Beau's way

`DECISIONS.md`, 2026-07-28: *"cardops is a tool in the form of an app/website
that people will need to purchase computing power beyond their free amount
for."* Compute-metered with a free tier, over the research's flat $50-150/mo.
The first entry in this log recorded that tension deliberately unresolved; it is
now resolved, and the strategy says so rather than continuing to hold it open.

Three consequences moved into Posture because they constrain code, not
marketing: catalogue lookups must never consume credits (Scryfall), a hard stop
rather than a soft one, and bulk floor checked first.

### The comps question is answered, and the pass before it was wrong

`research/2026-07-29-vendor-access.md` verified thecardapi's tiers against live
pages. The carried question — whether any tier below Enterprise can backfill —
has an answer: **no, except via the $99 Unlimited Lookback add-on, Pro-gated.**
But it matters less than it appeared, because the lookback clamps `date_from`
and `card_market_sales` is append-only: a 14-day window run daily becomes a year
of history in a year.

Worth recording that the *previous* research pass concluded there was no
reachable permitted API and that pasting was permanent — and that the API was
already in the repo, on a free tier whose 3-day window produced nothing. It
asked what was free and reported that as the map of what exists. Same failure
mode as the 2026-07-27 retraction: reasoning from a note instead of from the
thing.

### Not acted on, per the rules

- **Beau's working copy is ahead of `origin/main` by four commits** that this run
  did not read: attribution rendering, Terapeak/Seller Hub, PriceCharting terms,
  and a pre-call page. `CLAUDE.md` there also references migration **20260751**,
  which is not in `origin/main` — only `20260750_sale_provenance` is. Unpushed,
  not merged, not touched.
- No migration pasted, no branch merged, no cron secret set.
- No market research run. Vendor facts here come from the 2026-07-29 pass
  already in the vault.

---

## 2026-07-28 (queue) - the strategy doc is now the to-do list too

Beau: "state of play (known as strategy in obsidian) is going to serve as our to
do list as well."

Added a "Beau's queue" section above the ranked list. Two kinds of thing now
live in this document and they are deliberately kept apart: what to build ranked
by value, and his specific asks in the order he made them. The queue is never
re-ranked.

Three items in: the intake session card list, an Add to Group dropdown in the
photograph step, and a Card Groups section.

WHAT CHECKING FOUND, and it changes the scope of all three:

- `card_intake_sessions` and `card_intake_items` have existed since the
  20260713 init - session with mode and item_count, items with photos,
  vision_raw, extracted, confidences, cert_lookup, and a
  pending/needs_review/committed/discarded status. ZERO references in src/. The
  model was designed on day one and never wired up. Q1 is connecting a table,
  not inventing one.
- card_groups and card_group_items exist, are RLS'd, and /api/cards/groups
  already does create, rename, delete, add and remove - with CardBrowser and
  the cards page consuming it. Q3 is not "start a section"; it is building a
  destination page for something already working underneath.
- SessionMenu.tsx already implements Q1's exact UI shape one level down, for
  photos within a card. Same pattern, and the two-tap-to-discard rule should
  carry up.

Flagged rather than decided: what a "group" actually is. card_lots (sell-side
bundles) and purchase_lots (buy-side cost events) both overlap it. Three
concepts each half-answering the same question is the failure mode to avoid.

---

## 2026-07-27 (retraction) - there was no live bug

I claimed 20260745 was unpasted and that production was querying a column that
did not exist. Wrong. Beau pasted 745, 746 and 747 on the morning of the 27th
and screenshotted each success. I checked the git log, saw the code merged, and
reasoned from the OUTBOX note I had written BEFORE he pasted rather than from
what happened. Stale state.

What survives: `estimate-run.ts:47` really does discard the error on the market
history read and fall back to `[]`. Not failing today, but a future read error
would read as "no history" and price the card anyway. Worth fixing.

Also reframed: "Leaking right now" is now "The card-data question, for later".
Beau is buying real API subscriptions and the lookup schedule is an unhad
design conversation - the free tier's 3-day window is not the thing to optimise
against. The one question worth carrying forward is whether any tier below
Enterprise can backfill.

---

## 2026-07-27 (later) - the research came back and displaced my own #1

A 2026 landscape pass returned after the first entry was written. It read the
actual source, and it corrected four things - including my top recommendation.
Archived as `journal/2026-07-27b.md`.

**My #1 was wrong, and wrong in an avoidable way.** I ranked buy-side eBay
ingestion first. It is **blocked on the eBay cutover** - the RuName is
registered against the Master-Ops origin, which is documented in `CLAUDE.md`
under an interlock I have read many times. I recommended a week of work that
cannot start. Checking the blocker list against my own ranking would have
caught it.

**The new one thing: a forward money engine.** The argument that won: every
money number in the app is written *after* the sale, and the only
forward-looking one is `suggestedListPrice()` - `max(market, landed_cost x
1.15)`. A hardcoded 15% that knows nothing about eBay's 13.25% fee, per-order
fees, promoted listing rates or shipping class. It is also the only feature that
spends the moat at the moment of the decision, and the same pure function can
render the forecast and feed `cardSaleLines()`, so the app can later show
"forecast net $412, actual $407, delta $5".

**Four corrections to the earlier research, found by reading the repo:**

1. The grading engine uses the user's configured fees (PSA 25 default), not $20.
   But `GradeEV.tsx:125` *captions* it "~$20" - the screen misdescribes its own
   math, which is a small posture problem of its own. Fix is hours, not weeks.
2. **`card_grading_submissions` already exists and is completely dead** - zero
   references in `src/`. The modelling argument was half-won and forgotten.
3. Consignment is not absent: `at_auction_house_on_consignment` is a real asset
   state with a due-date rule tested in the money-core harness. What is missing
   is *inbound* consignment - holding someone else's card.
4. A real bug: `grade-ev/route.ts:53` takes the midpoint of low and high, so the
   screen cannot say "expected +$61, but 30% of outcomes lose money".

**New section: "Leaking right now."** No card cron has run anywhere since
2026-07-25. The interlock was correct while Master-Ops ran them; it stopped on
the 25th, so the justification is gone and the hold now has a running cost. If
thecardapi's free tier has the 3-day lookback the research claims, each silent
day is history nothing can buy back. Flagged, not acted on - there is a
documented hardening gate and the charter forbids setting `CRON_SECRET`
unprompted.

**Also new and cheap:** price provenance chips (no competitor shows where a
number came from, and `MarketSaleRow` already carries `source`), PSA cert
verification (free API, converts a vision guess into a checked fact), and
free-complete-export-as-a-promise (CSV export is paywalled across the whole
category; this is the most credible trust signal available to a one-man
product and costs almost nothing).

**Three posture violations added to "what not to build":** projected future
value or asset-class framing, grade estimates shown to a *buyer*, and any tax
output that computes a figure rather than reporting day counts.

---

## 2026-07-27 — first entry

Set up the folder and wrote the strategy from what already existed: the market
research of 26 July, `reference/product-strategy.md`, the git log, and Beau's
vault. Archived as `journal/2026-07-27.md`. Published to the page.

**What is actually new in this entry**, versus the research it was built from:

- The **ranked build list** did not exist. The research named gaps; it did not
  order them against effort. Buy-side eBay ingestion is placed at #1, above
  everything currently in flight on the camera.
- **Beau's metered-pricing instinct is recorded as an open tension** rather
  than resolved in favour of the research's flat-subscription recommendation.
  It fits what is already built — the credit ledger, per-run cost metering,
  per-photo byte accounting — and that argument had not been written down.
- The **posture section** was pulled up from `CLAUDE.md` into the strategy
  itself, because two of the research's suggestions conflicted with it and
  there was no single place that said so.

**Known to be stale in this entry:** a fresh 2026 landscape pass was running
when this was written and had not returned. Whatever it changes will be added
in the next entry and named as a change, not folded in silently.

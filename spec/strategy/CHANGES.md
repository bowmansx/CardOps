# CHANGES — what I updated, and why

Newest first. One entry per run. Most entries will be a single line saying
nothing material changed — that is the routine working, not failing.

Full history of the document itself is in `journal/`.

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

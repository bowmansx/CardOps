# Capture modes, and the grading round trip

Beau, 2026-07-26. He asked for four things that turn out to be one thing:

> *"an option when taking a photo to do a 'search for card'"* ·
> *"an option for 'update' when taking a photo"* ·
> *"say i'm sending out 10 cards for grading, i'd like to be able to say hey
> i'm gonna take photos of these 10 cards"* ·
> *"by taking a photo of a newly graded card, it's also searching for an old
> one"*

## The insight

**Photographing a card currently means exactly one thing: create a new one.**
That is the whole problem. Identification and creation are welded together,
when identification is the primitive and creation is only one of the things you
might do with it.

Split them and the four requests collapse into one pipeline with three exits:

```
        photograph  →  identify  →  ┌── ADD     create a new card
                                    ├── FIND    show me the one I own
                                    └── UPDATE  change the one I own
```

`ADD` is what exists today. `FIND` is the new primitive. `UPDATE` is `FIND`
plus an edit. Nothing else needs inventing — the identification step is already
built and already returns per-field confidence.

**`FIND` is worth building even alone.** Standing at a show holding a card,
"do I already own this, and what did I pay?" is a question the app cannot
currently answer at all.

## Matching, and the multiples problem

Matching runs on `card_identities` — the canonical catalog keyed by
`card_fingerprint()`. **Grade is deliberately not in the fingerprint**, so a
raw copy and a graded copy of the same card resolve to the SAME identity. That
was built for shared pricing history; it is exactly the lookup needed here.

Beau raised the obvious problem: *"there is the consideration about having
multiple of a card in all of this."* Own three copies and identity matching
finds all three.

**It largely solves itself, and the grading flow is why.** Match order:

1. Cards on the **`at_grader` list** — usually one to ten cards, and a returning
   graded card is nearly always unambiguous against that set.
2. Cards of that identity **in inventory**, most recent first.
3. Nothing matched → offer to ADD.

Never merge silently. More than one candidate always means the user picks, with
SKU, cost basis and photo shown for each.

## The grading round trip

The flagship flow, and the sharpest expression of what makes this product
different: it is the only path where *decide → pay → book* closes.

### Out

1. **Photograph the stack** in `FIND` mode. Each card matches to inventory.
2. Anything unmatched is flagged rather than skipped — a card you are about to
   post to a grader is not a card to lose track of.
3. For each: the **grade estimate** already computed from its photos gives an
   expected grade, and its **valuation at that grade** gives the declared value.
4. Declared value picks the **service tier**, tier gives the **fee**, and the
   fee is the number the user needs before they fill in the grader's form.
   *This is what the submission is worth doing at, and what it costs to find
   out.*
5. Confirm → all of them move to `asset_state = 'at_grader'` through
   `card_move_asset`, which is guarded and writes an append-only custody log.
   Cards in that state are **blocked from selling**, which is what Beau asked
   for and is machinery that already exists.
6. The fee lands as a `grading_fee` **cost line** on each card — pending until
   the invoice is real, so basis is not inflated by an estimate.

### Back

1. **Photograph the returned stack.** `UPDATE` mode, matching biased to the
   `at_grader` list.
2. Per card, prefilled from the slab: grader, grade, cert number.
   `condition_type` raw → graded.
3. **The same row is updated. Never a new card, never a delete.** It is the
   same physical object; its cost basis, purchase-lot draw and photo history
   all live on that row. Creating a replacement destroys the basis and breaks
   the lot arithmetic behind it.
4. New photos attach through the existing template flow — a slab wants
   different shots than a raw card.
5. `asset_state` returns to `in_my_possession`; the actual invoice reconciles
   the pending fee.
6. Estimated grade vs **returned grade** is recorded. After thirty cards that
   is a real accuracy number for the estimator, and it is unrecoverable if not
   captured at the moment it is known.

### The forgotten path

Nobody presses buttons reliably. Photograph a graded card that was never marked
out, match it to an ungraded copy in inventory, and offer: *"you own this
ungraded — is this the same card, returned from grading?"* Same update, no
prerequisite.

### Already in the schema

`public.card_grading_submissions` exists in the bootstrap with grader, cost,
expected_grade, returned_grade and roi columns — **and zero code references it
anywhere.** The table is waiting for this flow. Note when wiring it: it has no
`user_id` and its RLS uses `has_card_access()`, which `CLAUDE.md` says is an
app-entry gate and never row scoping. That needs fixing at the same time.

## Sold, and a decision that just got made

Beau: *"we should be keeping a separate section of 'sold' items... someone may
choose to make an update to sold items which might include updating their cost
basis, then that could lead to asking if they want to update their connected
bookkeeping app."*

**That reverses a standing decision, deliberately.** `CLAUDE.md` and
`spec/90-decisions.md` both record that a sold card's basis is LOCKED — profit
is recorded at sale and may already be posted to real books, so the path is
un-sell, edit, re-sell. The restatement flow "with a books-drift flag" is
listed as *deliberately not built, wants Beau's decision first*.

He has now made that decision, and the shape he describes is right:

- Editing a sold card's basis **restates** the recorded profit.
- If that sale was already posted to books, the card is flagged **books-drift**
  and the user is asked whether to push the correction.
- Both the original and the restatement stay on the record. A restatement that
  overwrites history is worse than no restatement.

## Watchlist — buy side

*"a watchlist that lets you put in cards that you don't already own... keep
track of the market analysis of these cards."*

`public.card_watchlist` **already exists and is dead code** — zero references in
`src/`, and `/cards/watchlist` actually reads `card_alerts`. So this is wiring,
not inventing. It attaches to `card_identities`, which is where the shared
market history already lives, so a watched card gets the same accumulating comp
data as an owned one at no extra fetch cost.

This is also the first genuinely **buy-side** surface in the app.

## The capture mat

*"is there a type of reference page we should give the users for them to print
off and set their cards on?"*

Yes, and it does more than hold the card straight. A printable sheet with:

- **A neutral mid-grey field.** Best contrast against both white and black card
  borders, and it gives the camera something honest to white-balance against.
- **A calibration rectangle at a known printed size**, with its dimensions in
  the corner. Photograph it once and the app solves for that phone's actual
  focal length instead of assuming a 65° field of view — which is currently the
  largest single source of error in the distance readout.
- **Corner registration marks** so framing is repeatable across a 12-shot
  template and across sessions.
- **A distance ladder** — printed marks that read true at 6", 8", 10" — so the
  on-screen number can be sanity-checked against something physical.

Print at 100% scale, no fit-to-page: the calibration only works if the printed
rectangle is the size it claims. The sheet should say so on its face, and the
app should verify by checking the measured aspect against the expected one
before trusting a calibration.

A rigid version is an obvious physical product later. The PDF costs nothing and
makes every metric in the camera more accurate.

## Order to build

1. **`FIND`** — the primitive, useful alone, unblocks everything else.
2. **`UPDATE`** — `FIND` plus an edit on the same row.
3. **Grading out** — batch `FIND` → declared value → tier → `at_grader`.
4. **Grading back** — batch `UPDATE` → grade + cert + fee reconciliation.
5. **Watchlist** — wire the dead table.
6. **Sold view + restatement** — needs the books-drift flag designed first.
7. **The mat** — a PDF, any time; it makes 1-4 better but blocks none of them.

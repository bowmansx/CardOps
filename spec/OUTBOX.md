# OUTBOX — the loop talking back

**The mirror of [[INBOX]].** You write there, I write here. This is the one
file under `spec/` the loop is allowed to touch, and it never touches anything
else of yours.

Read it, ignore it, delete sections you're done with. **Answer in [[INBOX]]**,
not here — anything typed in this file gets overwritten.

---

## Waiting on your answer

**1. Autograph contamination — the only urgent one.**
`card_fingerprint()` covers sport, year, set, player, number, parallel. It does
**not** include `is_auto` or `is_relic`, and I verified both appear zero times
in `valuation.ts` and `market-sales.ts` — so nothing filters them downstream
either. A signed copy and an unsigned copy of the same card therefore share one
identity **and one pooled sales history that every tenant reads**.

Grade was correctly kept out of the fingerprint and IS filtered downstream.
Autograph was kept out and isn't. This is the most-repeated credibility
complaint in the whole market, and in a shared catalog it would hit every
tenant at once.

Blast radius today is one user. It grows with every account, and fixing it
later means splitting identities and re-partitioning accumulated history.
**It needs a migration, so it stops with you.** Say go and I'll write
paste-ready SQL.

**2. PSA fee default is $25; reality is ~$100.**
`src/lib/cards/settings.ts` has `grading_fees: { PSA: 25, ... }`. Research says
PSA paused every tier under $80 on 2026-06-02 against a backlog that grew from
10M to 14M cards. So every "should I grade this" answer is computed against a
price that no longer exists — and it errs toward telling you to grade.

I can change the defaults in a line. What I'd rather build is the declared-value
→ tier → fee ladder, since the app already holds a per-card valuation and that
stays right on its own. Which?

---

## Shipped

- **Zones retired.** Gone from every intake form, the card page and `types.ts`.
  Three of the five duplicated a `status` value, so two fields could disagree
  about the same card with nothing to reconcile them. The `cards.zone` column
  is left alone — old values stay readable, nothing writes it now.
- **Edge detection core** — on the `edge-detection` branch, not merged. Finds
  the card's four edges and derives distance, viewing angle, frame fill and a
  size guess. Per-side support is exposed for your thin-yellow highlight:
  three sides lit and one dark tells you which way to move your thumb.
- Earlier today, merged and live: photo prefs and presets, photo templates,
  the cost-basis breakdown, direct browser-to-storage upload, and corner and
  surface shots feeding both grade estimates and eBay listings.

---

## Noticed, didn't act

- **A 30-agent review found the edge module was lying.** It fabricated a card
  from pure noise in 199 of 200 frames, several times naming a size and a
  distance in inches — while its own docstring promised it never guesses. Fixed
  before commit, and the tests that should have caught it now exist. Recorded
  here because I had told you the opposite in chat.
- **Edge-detection performance work is NOT done.** ~590 KB of typed arrays per
  frame, `Math.hypot` where `sqrt` would do, an unbounded peaks array. Harmless
  in tests, real at 10fps on a phone. It lands with the camera wiring.
- **`card_grading_submissions` already exists in the schema** — grader, cost,
  expected_grade, returned_grade, roi — with **zero code references anywhere**.
  Your grading flow has a table waiting for it. It also has no `user_id`, and
  its RLS uses `has_card_access()`, which your own CLAUDE.md says is an
  app-entry gate and never row scoping. Fix that when it gets wired.
- **`card_watchlist` is dead code too** — zero references; `/cards/watchlist`
  actually reads `card_alerts`. Your buy-side watchlist is wiring, not
  building.
- **Nothing gates on scan confidence.** Per-field and overall confidence are
  captured and shown on the review screen, but the eBay listing route has no
  confidence check — a card identified at 40% can be listed at a price derived
  from a misidentification.
- **Import is your switching cost and it's hardcoded.** Fixed headers, no
  mapping UI, and `card_format_profiles` is never read on the import path —
  while `spec/00-what-cardops-is.md` names format ingestion as a native goal.

---

## Blocked

- **Storage quotas (P4).** Your metered "like a Claude subscription" answer
  gives the shape — free to a level of compute and storage, pay beyond it — but
  not the numbers. What is the free storage allowance, and the price beyond it?
  The measurement is all built.
- **Off-site backup destination** (R2 / Drive / S3). Gates seeding the Mantle
  and gates a real backup script — which matters more now than it will later,
  because your inventory is still nearly empty and losing it costs nothing
  today.
- **Wave B UI.** Schema built 2026-07-25; you asked to be consulted before B
  gets built.

---

## Written up for you

- **`reference/DESIGN_CAPTURE_MODES.md`** — your search / update / bulk-grading
  ideas, structured. Short version: photographing a card currently means only
  *create a new one*, and splitting identification from creation turns four
  requests into one pipeline with three exits — **Add / Find / Update**.
  Covers the grading round trip, why the multiples problem mostly solves
  itself, and the printable capture mat.
- **`reference/market-research-2026-07-26.md`** — 108 findings, 93 sourced.
  The wedge, what to avoid, and the correction that cost basis stopped being a
  differentiator around 2025.

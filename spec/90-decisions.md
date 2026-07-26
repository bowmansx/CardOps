# Decisions log

Why things are the way they are. The loop reads this before proposing anything
that would undo one — and if it proposes undoing one anyway, it has to name the
decision it's reversing and say why.

Newest first.

## 2026-07-25

- **Cost basis is optional at intake, defaulting to 0.** Beau: *"i don't like
  that it forces me to put my cost basis in to save the card."* The old hard
  requirement existed because un-costed cards corrupted basis under the old
  global pool — so it was replaced, not deleted, by `basis_entered`, which keeps
  "I didn't say" distinguishable from "it genuinely cost nothing".
- **Cost lines are a third CATEGORY, not a third basis source.** Preserves the
  two-source rule literally while letting a lot-funded card carry a grading fee
  without the lot's balance moving.
- **A sold card's basis is locked.** Un-sell, edit, re-sell. A restatement flow
  with a books-drift flag was considered and deliberately not built — it needs a
  decision on how drift should behave.
- **Photos upload browser → storage directly.** The server-action body limit was
  a hard ceiling on photo quality, and crossing it hung the save with no error.
  A 12-shot grading template is ~10 MB; no amount of shrinking makes that fit
  without destroying what the template is for.
- **A PR containing a migration is never auto-merged.** Merging code whose
  schema isn't applied points production at columns that don't exist.
- **The global `card_pool` is gone.** It couldn't answer the audit question and
  let unfunded cards dilute funded basis. Do not reintroduce it.

## 2026-07-24

- **CardOps is its own app, its own repo, its own Vercel project**, split out of
  the Master-Ops monorepo. Its own Supabase project followed on 2026-07-25.
- **Tax classification is recorded, never determined.**
- **12 prevention rules** in `CLAUDE.md`, one per bug class that appeared three
  or more times in the foundation review.

## Reversing something here

Fine — write the reversal in [[INBOX]] and say why. The loop won't quietly undo
a decision, but it will happily undo one you've told it to.

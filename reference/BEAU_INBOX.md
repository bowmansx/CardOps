# Beau's inbox — steering the loop

**This file is yours. The loop READS it and never writes to it.**

`next-steps.md` is the other way round: the loop rewrites it at the end of
every iteration to record what actually happened. If you edited that file
you would be fighting its pen. Put things here instead.

## How to use it

Write whatever you want next, in whatever form. Bullets, a paragraph, a
half-thought at midnight — it does not need to be well specified. If it is
vague, the loop will come back with questions rather than guess.

Anything under **Do next** outranks everything in `next-steps.md`. The loop
checks here FIRST, every iteration.

Edit it on GitHub (pencil icon → commit to `main`) rather than in
`C:\dev\CardOps` — the loop uses that working directory and a `git checkout`
will collide with uncommitted edits.

## Do next

<!-- Add items here. Delete them when they're done, or leave them — the loop
     will tell you what it finished rather than silently clearing your list. -->

_(empty)_

## Don't touch

<!-- Anything you want left alone, for any reason. No justification needed —
     "leave the pricing page alone this week" is a complete instruction. -->

_(empty)_

## Notes for the loop

<!-- Context that isn't a task: decisions you've made, things you tried, what
     the last box of cards felt like to scan. This is where a real answer to a
     blocked question goes — e.g. "storage tiers: 5GB free, 50GB at $9/mo",
     which unblocks P4 on the spot. -->

_(empty)_

---

## Answers the loop is waiting on

These are genuinely blocked until you decide. Answer any of them in **Notes**
above and the work becomes buildable immediately.

- **Storage quotas (P4)** — plan tiers and prices. Nothing to enforce without
  them.
- **Off-site backup destination** — R2, Drive or S3. Gates seeding the Mantle,
  because losing evidence documents is the catastrophic failure for an asset
  whose value lives in its paperwork.
- **Credits: org-scoped or user-scoped** — changes the money core. Cheap to
  decide now, expensive later.
- **Wave B UI** — you asked to be consulted before B gets built; only the
  schema was green-lit.
- **`VALUATION_ENGINE.md`** — cited by the Wave B spec, never actually in the
  repo. Blocks the discovery-plan display.

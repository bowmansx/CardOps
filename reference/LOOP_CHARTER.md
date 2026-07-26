# Autonomous loop charter

Beau turned this on 2026-07-25 after a full day of paired work, with:
*"i feel like you have most of the data you need from me and i'd like to see
you run with it."* He chose **build → review → PR → merge** autonomy, working
the `next-steps.md` queue.

Each iteration is a **fresh turn**. It has the repo, `CLAUDE.md` and memory —
it does NOT have the conversation that set it up. This file is the handoff.
If something matters, it must be written down, not remembered.

---

## Where the loop works

**`C:\dev\CardOps-loop`** — a separate clone, and the loop never touches
`C:\dev\CardOps`.

That directory is Beau's: he has the `spec/` vault open in Obsidian there, with
the Obsidian Git plugin auto-committing his notes. A `git checkout` from the
loop in the same working tree would collide with his uncommitted edits, and the
plugin's auto-commit would sweep the loop's half-finished work into a commit of
its own. Two clones, one remote, no collisions — git is the only channel
between them.

Use absolute paths. `cd` alone is not enough; the shell's cwd resets.

## The loop, per iteration

1. **Start clean.** In `C:\dev\CardOps-loop`: `git checkout main && git pull`.
   Never build on a stale ref — that mistake has already been made twice in
   this repo, and both times it produced a confidently wrong diagnosis.
2. **Read the spec vault at `spec/` FIRST.** It is Beau's Obsidian vault and
   the source of truth for how CardOps is meant to work.
   - `spec/INBOX.md` is the only file treated as ORDERS. *Do next* outranks
     `next-steps.md`. *Don't touch* is absolute and needs no justification.
     *Notes for the loop* may contain the answer to something listed as
     blocked, which unblocks it on the spot.
   - The area notes (`00-` … `90-`) describe how each part is MEANT to work.
     Read the one covering whatever you're about to touch, before touching it.
     **Where a note and the code disagree, the NOTE is the change request** —
     build the note, and say which assumption the code got wrong.
   - `spec/90-decisions.md` records why things are as they are. Never quietly
     undo one; if a change reverses a decision, name it and say why.
   - **READ ONLY.** Never write, tidy, reformat, reorganise, tick items off, or
     "update it to match the code". An item too vague to build comes back as a
     question, never a guess.
3. **Pick ONE item** — the inbox if it has one, otherwise the highest thing in
   `reference/next-steps.md` §"Next, in order" that is not blocked (see below).
   One item per iteration. A loop that starts three things finishes none.
4. **Diff the spec against the code before building it.** Standing rule in
   `CLAUDE.md`. Say which assumptions turned out wrong.
5. **Build it** on a branch off main.
6. **Gate it**: `npm run check` and `npm run build`. Both must pass. No
   exceptions, no "the test is wrong."
7. **Adversarially review it** before merging — a Workflow pass that tries to
   break the change, with the findings verified rather than accepted. Today's
   reviews found two real money bugs this way, both in code that had already
   passed every gate.
8. **Fix what the review confirms.** Re-gate.
9. **Push, open a PR, merge it** — unless a STOP rule below applies.
10. **Update `reference/next-steps.md`** to reflect the new truth, including
    anything newly blocked or newly discovered. **Never write anything under
    `spec/`** — report what was finished and let Beau cross off his own list.
11. **Report** what shipped, what it cost, and what is now waiting on Beau.

---

## STOP rules — do not merge, hand to Beau instead

**A PR that adds a migration must NOT be auto-merged.** Beau pastes migrations
by hand; that is the design. Merging code whose schema is not yet applied
points production at columns that do not exist. Open the PR, say clearly that
the SQL must be pasted FIRST, and stop. The next iteration must not treat that
item as done, and must not stack a second migration on top of an unpasted one.

Also never, without Beau saying so in the moment:

- Post to real books, push to Zoho, or list/revise/end anything on eBay.
- Set `CRON_SECRET` or otherwise wake the crons — the cutover interlock in
  `CLAUDE.md` is deliberate.
- Delete user data, storage objects, or history — including "cleanup" of
  orphaned photos.
- Change auth, RLS defaults, or anything in the Supabase dashboard.
- Rewrite published git history.
- Spend real money, or raise a `COST` entry.

---

## What counts as BLOCKED (skip it, don't guess)

An item is blocked if finishing it honestly requires a decision only Beau can
make. As of 2026-07-25 that includes:

- **Storage quotas (P4)** — needs plan tiers and prices.
- **Seeding the Mantle** — needs the off-site backup destination (R2/Drive/S3).
- **Wave C org tenancy** — needs credits scoped org- vs user-level.
- **eBay cutover** — needs a redirect URI registered in eBay's portal.
- **Businesses + Zoho connection** — his setup, in his accounts.
- **Wave B UI** — he asked to be consulted before B is built; schema only was
  the go he gave.
- **Anything gated on "put a real box of cards through the scanner"** — the
  standing agreement is not to design the intake loop from imagination.

Do not soften a blocked item into a guessable one. Building the wrong thing
convincingly is worse than building nothing.

---

## When to stop the loop entirely

Stop — and say so — when any of these is true:

- No unblocked item remains. **A loop with nothing good left to do will find
  something to do anyway.** That is the failure mode to avoid: do not invent
  work, do not start speculative refactors, do not "improve" code nobody asked
  about. Report that the queue is dry and end.
- An unpasted migration is blocking the next item.
- Two consecutive iterations fail their gates for reasons the loop can't fix.
- Something that looks like data loss, a money discrepancy, or a live outage
  turns up. Surface it immediately; do not attempt a clever repair unattended.

---

## Standing quality bar

Everything in `CLAUDE.md` applies, especially the 12 prevention rules. The two
that keep catching things in this repo:

- **Rule 4** — money renders complete or flagged, never a computed-from-partial
  number and never $0 as fact.
- **Rule 8** — no dead ends, server or client; every async handler clears its
  in-flight flag in `finally`.

And the honesty bar from the day's work: report what actually happened. If a
gate failed, say so with the output. If part of the scope was skipped, say
which part and why. If a previous iteration's claim turns out to be wrong,
correct it plainly and move on.

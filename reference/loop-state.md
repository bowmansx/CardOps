# Loop state

Machine bookkeeping. The loop owns this file and rewrites it every iteration;
nothing here is for Beau to maintain.

Its only job is to make **"what changed in the vault since I last looked"** a
precise question instead of a guess. Without a recorded commit there is no
"since", and the loop would have to re-read every note each pass and infer
which parts are new — which is exactly how a correction to a description gets
mistaken for a request to build something.

    git diff <last_seen_commit>..HEAD -- spec/

---

last_seen_commit: a9b84cc
last_seen_at: 2026-07-27T04:10:00
last_action: built the photo notes out — template targets, the session menu,
             FIND and the grading batch. OUTBOX rewritten with three migrations
             waiting on Beau (20260745, 20260746, 20260747).

## How the loop uses it

1. Diff `spec/` between `last_seen_commit` and `HEAD`.
2. **A changed AREA NOTE is a candidate, not an order.** Report what changed
   and ask whether to build it. An edit can equally mean "build this",
   "your description was wrong", or "thinking out loud" — and the difference
   is not visible in a diff.
3. **`spec/INBOX.md` is the green light.** Anything under *Do next* gets built
   without further asking. It is also where priority and extra context live.
4. **`spec/ideas/` changes are never candidates.** Note them if relevant,
   never act on them.
5. Update `last_seen_commit` at the END of the iteration, once the work is
   done or the question has been asked — never before, or a crash loses the
   change silently (prevention rule 7: stamp state only after the effect).

## If the recorded commit is missing from history

Fall back to reporting the vault's current state and asking Beau what is new.
Do NOT treat every note as changed — that would present the entire spec as a
pile of fresh requests.

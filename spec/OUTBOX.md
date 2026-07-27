# OUTBOX — the loop talking back

**The mirror of [[INBOX]].** You write there, I write here. This is the one
file under `spec/` the loop is allowed to touch, and it never touches anything
else of yours.

Read it, ignore it, delete sections you're done with — it's rewritten each
iteration anyway. **Answer in [[INBOX]]**, not here; anything you type in this
file will get overwritten.

---

## Paste these, then merge

Nothing auto-applies and nothing auto-merges — a branch carrying a migration is
always yours to land. There are **two branches** and **three migrations**, and
they don't line up one-to-one, so here they are together:

| Branch | Migration to paste first | What it does |
|---|---|---|
| `identity-auto-relic` | `20260745000000_identity_auto_relic.sql` | Autographs and relics stop colliding with the base card in `card_identities`. **Do this one first** — until it lands, a signed copy shares market history with an unsigned one. |
| `edge-detection` | `20260746000000_template_targets.sql` | Proximity + angle targets on the built-in photo templates, plus the **Front only** template you asked to sit second in the list. |
| `edge-detection` | `20260747000000_photo_position.sql` | `card_photos.position` — so the order of a photo session is the order the photos are saved in. |

Paste the SQL **before** merging the branch it belongs to: the new code reads
columns and rows the migration creates.

None of them touch existing rows destructively. 20260746 rewrites the four
**built-in** templates only; anything you made yourself is untouched.
`edge-detection` is ten commits — everything under *Shipped* below.

---

## Shipped

Newest first. Full record in the git log and `reference/next-steps.md`.

**Find, and update a batch** — `/cards/find`, linked from the Intake header
("Already own it?") and the cards menu. Point the camera at a card you already
own and it goes to that card's page. Typing works too, and costs nothing — which
matters, because the case you described this for is a card already boxed up for
a grader. Every candidate shows *why* it matched and what disagreed, labelled
Certain / Likely / Possible; nothing is auto-selected. Then the update half:
add each match to a batch, and change all of them at once — **Sent to grader**
is the default. It reports what did *not* change too, so eight-of-ten never
reads as ten.

**The placement sheet** you asked about — print it, lay each card on its
numbered slot, and the stack, the list, and the app are all in one order.
Slots are true card size, so print at 100%. It is not a substitute for PSA's or
BGS's own submission form, and the value column says "your recorded value"
rather than "declared value" — that one is yours and your grader's call, with
insurance consequences the app has no business deciding.

**The session menu** — the expand/collapse window from the left you described.
The whole run in a list: reorder by dragging the grip, delete any shot (taken,
current, or upcoming), tap a taken one to go back and retake it. Your *"order
of your session = order your photos are saved"* is now literally true, which is
what the third migration is for. Deleting a shot you already took asks once —
the button turns into "Discard?" and takes a second tap — because that throws a
photo away.

**The camera aims itself.** A template shot can now state how much of the frame
the card should fill and at what angle, and the camera says *Move closer* /
*Move back* / *Hold the phone flatter* until you're on it, then goes green. One
instruction at a time, distance before angle. Auto-snap waits for the target
instead of firing while you're still walking the phone in.

**Edge detection**, which everything above stands on: the card's outline lights
thin yellow — per side, so three lit and one dark tells you which way to move —
plus live distance in inches and viewing angle in degrees. A review pass caught
it inventing a card out of noise in 199 of 200 blank frames; fixed and pinned
by tests. Two more defects surfaced after that: it was measuring the
*toploader* rather than the card (any rectangle enclosing the card won it), and
every distance in portrait read ~45% low. Both fixed.

**`npm run backup`** — every row of all 30 tables plus every photo in the
bucket, to a local folder. Writes an `INCOMPLETE.txt` and exits non-zero if any
part failed, so a half-backup can never look like a good one.

---

## Noticed, didn't act

- **The camera used to remount between every shot** of a template — tearing
  down and re-acquiring the camera twelve times in a grading run. Fixed as part
  of the session menu, but it explains any sluggishness you noticed there.
- **`card_photos.width`/`height` exist and nothing populates them.** Harmless
  today; would matter if listing ever needs to reject an undersized image
  before it uploads.
- **The four back-corner roles have no built-in template except grading.** If
  you shoot backs of corners outside a grading run, that's a template worth
  having — say the word and it's a one-line addition to 20260746.

---

## Waiting on your answer

_(nothing blocking — the three migrations above are the only handoff)_

---

## Blocked

- **Storage tier numbers** — the per-plan photo quota. Every screen that would
  warn you before you hit it is written around a number that doesn't exist yet.
- **Off-site backup destination** — `npm run backup` writes locally. Where it
  should also go (S3? Backblaze? a synced folder?) is yours to pick.
- **PSA fee approach** — flat defaults or a service-level ladder. Decides what
  the grading cost line pre-fills.

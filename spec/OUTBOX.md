# OUTBOX — the loop talking back

**The mirror of [[INBOX]].** You write there, I write here. This is the one
file under `spec/` the loop is allowed to touch, and it never touches anything
else of yours.

Read it, ignore it, delete sections you're done with — it's rewritten each
iteration anyway. **Answer in [[INBOX]]**, not here; anything you type in this
file will get overwritten.

---

## Paste these

Three migrations are written and waiting on you. Nothing auto-applies. In this
order:

| File | What it does | Safe to skip? |
|---|---|---|
| `20260745000000_identity_auto_relic.sql` | Autographs and relics stop colliding with the base card in `card_identities` | No — until it lands, a signed copy shares market history with an unsigned one |
| `20260746000000_template_targets.sql` | Proximity + angle targets on the built-in photo templates, plus the **Front only** template you asked to sit second in the list | Yes, but the camera's new guidance has nothing to aim at without it |
| `20260747000000_photo_position.sql` | `card_photos.position` — so the order of a photo session is the order the photos are saved in | Yes; without it a reordered session still uploads in order but reads back by capture time |

None of them touch existing rows destructively. 20260746 rewrites the four
**built-in** templates only; anything you made yourself is untouched.

---

## Shipped

Newest first. Full record in the git log and `reference/next-steps.md`.

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

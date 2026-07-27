# OUTBOX — the loop talking back

**The mirror of [[INBOX]].** You write there, I write here. This is the one
file under `spec/` the loop is allowed to touch, and it never touches anything
else of yours.

Read it, ignore it, delete sections you're done with — it's rewritten each
iteration anyway. **Answer in [[INBOX]]**, not here; anything you type in this
file will get overwritten.

---

## Where things stand — 2026-07-27 evening

Everything below is **merged and live** on card-ops-zeta. Two migrations are
waiting on you; nothing breaks until you run them.

### Paste when you're ready

| Migration | What it does | If you skip it |
|---|---|---|
| `20260748000000_scan_on_open.sql` | The **Start scan** button — camera opens for framing, scanning waits for the tap | Nothing breaks. The default applies and you get the button anyway. Pasting it just lets you turn it OFF. |
| `20260749000000_graded_template.sql` | The **Graded slab** template — front, back, label close-up, auto-picks the slab guide | The template doesn't appear in the list. Nothing else is affected. |

Still unpasted from earlier: `20260745000000_identity_auto_relic.sql`, on the
unmerged `identity-auto-relic` branch. Autographs and relics still share market
history with the unsigned base card until it lands.

### The one test that decides the next big piece

Use a **raw card** — matte, on a dark non-glossy surface. Frame it, hit Start
scan, then move the phone around it for ~10 seconds and read the verdict line.

A PSA slab is the wrong test and that's a real finding, not a nitpick: polished
plastic reflects a far wider slice of the room than cardstock, so a lamp that's
sweepable on a raw card may be un-sweepable on a slab. It's also why the edge
detector locks onto the holder rather than the card.

What the answer decides:
- *"small enough to sweep around"* → build the glare compositor (Stage 2, ~9 days)
- *"doesn't move as you do"* → don't build it; the answer is a smaller lamp

### Honest state of the multi-frame scan

- **Stage 0, light measurement** — built, that's the readout you're testing
- **Stage 1, deskew + derived corner crops** — *not started*. Ships value either
  way: a square-on rectified front/back, and corner crops that beat hand-held
  close-ups because a phone can't focus close enough to compete
- **Stage 2, the glare-free compilation** — *not started, gated on the test above*

### Also unfinished

The **temporal tracker** — the piece that makes the lock glide instead of
wobble. Designed, not written. Jitter currently sits around 2.9px at the ~2°
angle a hand actually holds; the flat case is already 10× steadier than this
morning.

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

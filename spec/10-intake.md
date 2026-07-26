# Intake — getting a card in

The loop Beau actually spends his time in. Everything else is downstream.

## Three ways in

| Path | Shape | When |
|---|---|---|
| **Full (AI)** | One card, photograph → AI fills the fields → review → book | A card worth looking at |
| **Speed Book** | Rapid front-only, whole stack, one atomic commit against a purchase lot | Bulk, no API calls, works dormant |
| **Batch (AI)** | Set defaults once, rapid-fire capture, then AI reads every card in the background | A box you want identified but not fussed over |
| **CSV import** | Bulk rows, no photos | Migrating from a spreadsheet |

## The camera

In-app (`getUserMedia`), not `<input capture>` — an installed PWA on iOS opens
the library instead of the camera, which is why the in-app one exists.

- **Guide frame** in card or slab aspect; the capture crops to it.
- **Auto-snap** when the image is sharp and still, gated on consecutive frames.
- **Best-of-burst** — N frames per shot, sharpest wins. Not multi-frame merge.
- **A margin around the crop** so the card's real edge sits INSIDE the photo.
  Corners and edges are the grade; a crop flush to the edge hides chipping and
  can't be told apart from a card that's genuinely cut that way.
- **The uncropped frame is kept** alongside the crop, linked by `derived_from`,
  with `crop_geometry` recording the margin actually applied. A crop must never
  be the only record of an edge.
- **Templates** walk an ordered list of shots — "FRONT · TOP-LEFT / 2 of 12" —
  so you don't have to remember what's next with a card in one hand.
  Built-ins: front & back, eBay listing (6), grading (12), condition notes.

Photos upload **straight from the browser to Supabase Storage**; only paths
reach the server. Anything else runs into the server-action body limit, which
is what once hung booking a card on "Saving…" for ever.

## Settings that belong to the user

Quality (economy → archive), auto-snap, burst count, crop mode, margin %,
keep-originals, default template, and named presets ("bulk intake" vs
"consignment quality"). Every one changes how many bytes a card costs, so the
storage cost of each choice is shown **at the point of choice** rather than
discovered on a bill.

## What hurts today

<!-- THE MOST VALUABLE SECTION IN THIS VAULT. There is a standing agreement not
     to design the intake loop from imagination — put a real box of cards
     through it and write what actually annoyed you here. Anything in this
     section outranks a feature idea invented at a desk. -->

_(nothing recorded yet — the box of cards hasn't been run)_

## Known gaps

- **Dynamic lock-on border and deskew.** The guide is static. Edge detection
  with a live outline, and warping the detected quad to a true rectangle, would
  make every photo look scanned and measurably improve what the vision model
  reads. Deliberately held until a real box says capture angle is a problem.
- **Orphaned photos.** An upload that lands but fails to record leaves bytes in
  the bucket that no screen shows and no quota counts. `card_photo_orphans()`
  finds them; nothing deletes them. A sweeper needs a cron, and crons are
  fenced by the cutover interlock.

## Open

<!-- -->

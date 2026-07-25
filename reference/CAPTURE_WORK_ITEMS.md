# Capture & Photo — every idea, split and grouped

Written 2026-07-25 from Beau's capture message, decomposed so nothing lives
only in a chat transcript. Design detail lives in `DESIGN_PHOTO_SYSTEM.md`;
**this file is the tracker** — what each idea is, whether it's done, and which
package it belongs to.

Status key: **✅ built** · **◐ partial** · **📋 designed, not built** ·
**❌ not yet captured as work**

---

## 1. Every idea, individually

| # | Idea (Beau's words, condensed) | Status | Where |
|---|---|---|---|
| 1 | "Full (AI)" fills in nothing | ✅ | Root cause: the AI kill-switch seeded OFF after the split. Turned on + verified end-to-end |
| 2 | "manual" chip, and Re-read (AI) does nothing | ✅ | `2ad2a45` — both intake paths now say *why* and link to Services |
| 3 | Tell me whether it wants the FRONT or the BACK | ◐ | A small sheet title says "Photograph the front". Weak — see **P1** |
| 4 | Crop the background out, show just the card | ✅ | Already existed: CameraSheet crops to the guide |
| 5 | Also save the source file WITH the background | ✅ | `a84c3e2` + `041b0c8` — full frame stored as `variant='original'` |
| 6 | Auto-crop must not misrepresent the true edges | ✅ | Margin + original retained + `crop_geometry` recorded + "uncropped" viewer |
| 7 | Show ~a millimetre around the card edge | ✅ | 4% of card width ≈ 2–3mm |
| 8 | Saveable setting variations + user defaults | ✅ | **P2** — prefs on `card_user_prefs`, named bundles in `card_photo_presets`, settings screen + camera both read them |
| 9 | Extra files take up extra space | ✅ | `bytes` on every image, `user_storage_usage` rollup, shown on the credits page |
| 10 | Subscriptions cap how much data you can store | 📋 | Quota + warn + block — **P4** (needs billing) |
| 11 | Photo quality options, which change space used | ✅ | **P2** — Economy/Standard/High/Archive, each showing its storage cost at the point of choice |
| 12 | Save multiple different photos of a card | ✅ | **P3** — Add photos on the card page runs a template and attaches every shot |
| 13 | Users set up their own photo templates | ✅ | **P3** — `card_photo_templates`, built-ins + user-defined via `/api/cards/photo-templates` |
| 14 | e.g. all four corners front+back, surface angles | ✅ | **P3** — the "Grading — corners & surface" built-in, 12 shots |
| 15 | …to give better info for AUTO-GRADING | ❌ | `grade-estimate` exists but ignores corner/surface shots — **P5** |
| 16 | …and for eBAY LISTING export | ❌ | The eBay listing code uses **no photos at all** — **P5** |
| 17 | Border that locks on to the card | 📋 | Static guide exists; dynamic edge detection is **P1** |
| 18 | Auto-snap once focused | ✅ | `a84c3e2` — sharpness + stability + consecutive-frame gate |
| 19 | 3× snap, best of the set | ✅ | Best-of-burst. True multi-frame merge deliberately skipped (see design §2) |

**Two ideas had never been written down anywhere: #15 and #16.** They're also
the *reason* templates matter — a corner-shot template with nothing consuming
the corner shots is photography for its own sake.

---

## 2. Work packages (what groups together, and why)

### P1 — Capture ergonomics
*Everything you feel while holding a card.*

- **Prominent shot indicator** — big, unmissable "FRONT" / "BACK" (and later
  "CORNER 2 of 4"), not a small sheet title. Generalises directly to templates.
- **Dynamic lock-on border** — edge detection, live outline.
- **Deskew** — warp the detected quad to a true rectangle.

> Deskew is the sleeper here: it makes every photo look scanned regardless of
> holding angle **and** measurably improves what the vision model can read,
> which feeds identification confidence. The visible border is the smaller win.

Size: indicator ~1h · edge detection + deskew 2–3 days.
Depends on: nothing. **Do the indicator now; hold the rest until a real box of
cards says capture angle is a genuine problem.**

### P2 — Settings, presets and defaults ✅ BUILT 2026-07-25
*Idea 8 and 11. One table, one screen.*

- ✅ Capture mode, quality preset, auto-snap, burst count, crop mode, margin %,
  keep-originals, default template — added to **`card_user_prefs`**, not a
  second table: same concern, same one-row-per-user RLS, same upsert path.
  Migration `20260741000000_photo_prefs.sql`.
- ✅ Quality presets showing what each costs in storage at the point of choice
  (`estimateBytesPerCard` → at Standard with originals kept, "about 1.1 MB per
  card · 6.9 MB for a 12-shot grading set · a thousand cards ≈ 1.12 GB"). The estimate is labelled *about* everywhere it
  renders; the real number is measured per image into `card_photos.bytes`.
- ✅ Named bundles in `card_photo_presets` + `/api/cards/photo-presets`.
- ✅ The camera **obeys** all of it — `usePhotoPrefs()` feeds Speed Book, batch
  intake and the full form; quality drives resolution and JPEG quality, crop
  mode and margin drive the frame, `keep_originals` decides whether the
  uncropped frame is stored, `capture_mode: os_camera` hands off to the phone's
  own camera app.
- Two integrity choices worth remembering: a **zero crop margin is refused by
  the database**, because zero puts the card's real edge on the image boundary
  — the exact misrepresentation the margin exists to prevent; and **turning
  keep-originals off writes an audit row**, because it is the one setting that
  can quietly destroy evidence. Harness assertions 40–42 pin all three.

Depends on: nothing. Unblocks: P3, P4.

### P3 — Templates and multi-photo
*Ideas 12, 13, 14. The heart of what you asked for.*

- `photo_templates` (shots list: role, guide, crop policy, required)
- Built-ins: **Quick** (front) · **Standard** (front+back) · **Listing**
  (front, back, angled) · **Grading** (front, back, 4 corners ×2 sides, 2
  surface angles)
- Capture walks the shot list, showing which shot you're on (reuses P1's
  indicator)
- Card page: view, add and re-take any photo by role

Size: 12–18h. Depends on: P1 indicator, P2 prefs.

### P4 — Storage economics
*Ideas 9 and 10. Measurement is done; policy is not.*

- ✅ Bytes recorded per image, rolled up per user, displayed
- Quota per plan, warn at 80%, block **new originals** (never the card record)
  at 100%, with a stated way out
- Retention policy per derivative class — grading originals are evidence and
  persist; bulk front-only shots needn't outlive the sale
- **Never delete an original silently**

Size: 10–14h. Depends on: billing / org tenancy (`DESIGN_WAVE_C.md`).
Not urgent — but the measurement had to exist first, and now does.

### P5 — Downstream consumers
*Ideas 15 and 16 — the payoff that justifies P3.*

- **Auto-grading reads the corner and surface shots.** Today `grade-estimate`
  looks at front/back only. Feeding it the grading template's close-ups is the
  single biggest accuracy lever available, and it's why that template exists.
- **eBay listings carry photos.** `src/lib/ebay/listing.ts` currently sends
  none. Listings should pull the Listing template's roles in a defined order.

Size: grading 6–10h · eBay photos 6–8h. Depends on: P3.

---

## 3. Suggested order

1. **P1 indicator** (an hour, removes a daily annoyance)
2. **Use the app on a real box** — the friction list decides what follows
3. **P2 settings** (self-contained, unblocks the rest)
4. **P3 templates**
5. **P5 consumers** — because templates without consumers are just extra work
   at intake
6. **P4 quota** — lands with billing

P1's edge detection can jump the queue if the friction list says capture angle
is actually hurting; otherwise it waits, since auto-snap already solved the
part that was hurting most.

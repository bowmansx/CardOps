# Photo System — capture, crop, templates, storage

**Status: DESIGN. Stage 1 of the camera is next to build; the rest is captured
here so it isn't lost.** Written 2026-07-25 from Beau's requirements.

---

## 0. Why this is one design and not seven features

Beau asked for: a lock-on border, auto-snap, best-of-3, front/back prompting,
auto-crop that preserves the original, a visible margin around the card edge,
saveable presets and defaults, multiple photos per card, photo templates for
grading/eBay, and storage accounting against a subscription quota.

Those look like a list. They're actually **one pipeline with policy at each
stage**, and the policy is what a subscription plan sells:

```
  CAPTURE ──▶ QUALITY ──▶ DERIVE ──▶ RETAIN ──▶ ACCOUNT
  camera      resolution   crop /     which      bytes vs
  + template  + format     deskew     copies     plan quota
```

Every one of Beau's asks is a knob on one of those five stages. Designing them
together is what stops the storage bill from being a surprise.

---

## 1. The capture blocker (fixed 2026-07-25)

Today the app uses `<input type="file" capture="environment">`, which hands off
to the **OS camera app**. The app never sees a viewfinder, so a lock-on border
and auto-snap are *impossible* by construction — not unimplemented, impossible.

All three of those features require moving to `getUserMedia` + `<video>` +
`<canvas>`.

> ⚠ **The trade nobody mentions.** The OS camera does HDR, multi-frame noise
> reduction, exposure tuning and lens correction. A raw `getUserMedia` frame
> gets **none of it**. It is entirely possible to ship a beautiful auto-snapping
> scanner whose photos are *worse* than today's. **Keep the file-input path as a
> selectable fallback and compare output honestly at Stage 1** before building
> further on top.

---

## 2. Capture stages (build order)

**Stage 1 — in-app camera + static guide frame.** Card-aspect rectangle over
the video, manual shutter, fallback toggle to the OS camera. Low risk, and it
answers the quality question above before more is invested.

**Stage 2 — auto-snap + best-of-N.** Browsers do not expose autofocus-lock
state, so "focused" is inferred from three cheap per-frame measures on a
downscaled grayscale canvas:

| Signal | Method | Why |
|---|---|---|
| Sharpness | variance of Laplacian | The standard focus proxy |
| Stability | mean abs frame-to-frame delta | Hands settled, not mid-move |
| Fill | detected/guide area ratio | Card actually presented |

Fire when all three hold for *N* consecutive frames. Best-of-N is then nearly
free: keep the frame with the highest sharpness score. **True multi-frame
merging (align + average) is explicitly out of scope** — it's what phone ISPs do
with dedicated silicon, and on a flat, evenly-lit card the gain doesn't justify
subpixel alignment in JavaScript.

**Stage 3 — edge detection, live border, deskew.** Grayscale → blur → Sobel →
contour → largest quadrilateral, ~10fps on a downscaled frame. Plain canvas; do
**not** pull in OpenCV.js (~8MB wasm on a phone).

> The border is the visible feature. **Deskew is the one that pays**: warping
> the detected quad to a true rectangle makes every photo look scanned
> regardless of holding angle, and materially improves vision-model extraction
> — which feeds the confidence gate and doubt queue in Wave A.

---

## 3. Front/back prompting

Current `FullIntake` chains front → back with no statement of which side it
wants. Fix is small and belongs in Stage 1:

```
┌──────────────────────────────┐
│   ● FRONT          ○ back    │   ← current side, explicit
│  ┌────────────────────┐      │
│  │                    │      │
│  │   [guide frame]    │      │
│  │                    │      │
│  └────────────────────┘      │
│   Fill the frame · hold still│
└──────────────────────────────┘
```

Generalises directly to templates (§5): the same strip becomes
`● front  ○ back  ○ corner TL  ○ corner TR …`.

---

## 4. Crop policy — the integrity rule

Beau's concern is exactly right and worth stating as a rule:

> **Auto-crop must never be able to misrepresent a card's edges.**

Corners and edges *are* the grade. A crop that shaves a chipped corner is
evidence tampering, even when accidental. Therefore:

1. **The original is always retained**, unmodified, as the source of truth.
   The crop is a *derivative*, never a replacement.
2. **Crops carry a deliberate margin** (default ~1–2 mm of real-world card
   equivalent, i.e. a small percentage of detected card width) so the true edge
   is visible *inside* the frame rather than being the frame.
3. **Crop geometry is stored** (the quad + margin used), so any derivative can
   be re-derived or audited against the original.
4. Grading-relevant views (§5) are **never** auto-cropped tight.

```
card_photos  (existing table — additive columns)
  + role            text     'front' | 'back' | 'corner_tl' | … | 'surface_angle'
  + derived_from    uuid     null on originals; points at the source photo
  + crop_geometry   jsonb    {quad:[[x,y]×4], margin_pct, deskewed:bool}
  + width, height   int
  + bytes           bigint   REQUIRED — see §6, you cannot bill what you don't measure
  + capture_meta    jsonb    {device, mode:'in_app'|'os_camera', sharpness, template_id}
```

---

## 5. Photo templates

A template is an ordered list of **shots**, each with a role, a guide overlay,
and a crop policy. Beau's stated example — four corners front and back, plus
angled surface shots — is the grading template.

```
photo_templates
  id, user_id (null = built-in), name, is_default
  shots jsonb   [{ role, label, guide:'card'|'corner'|'free',
                   crop:'none'|'margin'|'tight', required:bool }]
```

Built-ins to ship with:

| Template | Shots | For |
|---|---|---|
| **Quick** | front | Speed Book / bulk |
| **Standard** | front, back | Default |
| **Listing** | front, back, angled front | eBay export |
| **Grading** | front, back, 4 corners ×2 sides, 2 surface angles | Auto-grade + condition evidence |

The capture screen walks the shot list, showing which shot it's on (§3) — so
templates and front/back prompting are the same mechanism.

---

## 6. Storage accounting — do this before signups, not after

This is the part with real commercial consequence, and it interacts with the
credit system already built.

**The problem:** a Grading-template capture at full resolution is ~12 photos ×
originals + derivatives. At 3 MB each that's ~70 MB **per card**. A thousand
cards is 70 GB — for one user. Supabase storage is billed by the gigabyte, and
unlike AI credits, **storage cost recurs every month forever** whether or not
the user ever opens the app again.

**Therefore:**

1. **`bytes` is mandatory on every stored object.** You cannot bill, cap, or
   even warn on what you don't measure. (Same lesson as the AI cost telemetry:
   measure first, price second.)
2. **A per-user storage rollup**, maintained on write, not computed by scanning
   a bucket:
   ```
   user_storage_usage  (user_id pk, bytes bigint, objects int, updated_at)
   ```
3. **Quality presets drive the bill**, so make the trade visible at the point of
   choice rather than at the invoice:

   | Preset | Long edge | ~Size | Note |
   |---|---|---|---|
   | Economy | 1200 px | ~150 KB | Fine for identification |
   | Standard | 1600 px | ~300 KB | Current default |
   | High | 2400 px | ~800 KB | Listing photos |
   | Archive | native | 2–5 MB | Grading evidence |

4. **Retention policy per derivative class** — originals of *grading* shots are
   evidence and should persist; originals of *bulk* front-only shots probably
   shouldn't outlive the card's sale by long. Make it a setting with an honest
   default, and **never delete an original silently.**
5. **Plan quota belongs on the org, not the user** (see `DESIGN_WAVE_C.md` —
   billing is org-scoped), and it is a **second meter alongside credits**:
   credits measure compute, bytes measure storage. Both need the same treatment
   — measure honestly, show the number, warn before the wall, never surprise.
6. **Approaching-limit behaviour must be designed, not defaulted**: warn at 80%,
   block *new originals* (not the card record) at 100%, and offer the
   downgrade/purge path. A user who cannot add a card because of storage must be
   told which knob fixes it.

---

## 7. Settings model

Everything above is per-user preference with a system default:

```
card_photo_prefs  (user_id pk)
  capture_mode       'in_app' | 'os_camera'
  quality_preset     'economy' | 'standard' | 'high' | 'archive'
  auto_snap          bool
  burst_count        int (1–5)
  auto_crop          'off' | 'margin' | 'tight'
  crop_margin_pct    numeric   -- default ~2%
  keep_originals     bool      -- default TRUE, and warn loudly when turned off
  default_template   uuid
```

Named presets are a saved bundle of the above so a user can flip between
"bulk intake" and "consignment quality" without re-tuning six knobs.

---

## 8. What I'd build, in order

1. **Stage 1 camera + guide frame + front/back prompting** — unblocks
   everything, answers the image-quality question early.
2. **`bytes` + storage rollup** — cheap now, and it's the measurement that makes
   every later decision (quota, presets, retention) possible.
3. **Stage 2 auto-snap + best-of-N** — the real ergonomic win for batch intake.
4. **Photo prefs + quality presets.**
5. **Templates** (Standard/Listing/Grading).
6. **Stage 3 edge detection + deskew + margin crop** — highest effort, and worth
   doing only after a real session says capture angle is a genuine problem.

Storage quota enforcement lands with billing (Wave C), not before — but the
**measurement** must exist from the first photo, or the history is unrecoverable.

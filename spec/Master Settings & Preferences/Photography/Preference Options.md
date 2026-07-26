Standard Metrics
	Describe distance in (Feet and Inches) or (Meters and Millimeters)

Checkboxes
	Always show Distance from lens to card?





---

> [!abstract]+ CLAUDE — everything in a box like this is mine
> Written 2026-07-26 by reading the code, not from memory. This is **what
> exists today**, so you're adding to a real list rather than guessing at one.
> Everything outside these boxes is yours; I won't touch it.

> [!abstract]+ CLAUDE — saved per user, already built
> Stored on `card_user_prefs`, one row each. Live on `/cards/settings` under
> **Photos & capture**.
>
> | Preference | Options | Default |
> |---|---|---|
> | Capture mode | In-app scanner · Phone camera | In-app scanner |
> | Photo quality | Economy · Standard · High · Archive | Standard |
> | Auto-snap when sharp and still | on · off | off |
> | Frames per shot (keeps sharpest) | 1–5 | 3 |
> | Cropping | With margin · Tight · None | With margin |
> | Margin around the card | 0.5% – 25% | 4% (≈2.5 mm) |
> | Keep the uncropped original | on · off | on |
> | Default template | any template | none |
>
> Two of these are guarded rather than free:
> - **A zero margin is refused by the database.** Zero puts the card's real
>   edge on the image boundary — the exact misrepresentation the margin exists
>   to prevent. Floor is 0.5%.
> - **Turning off keep-originals writes an audit row.** Allowed, it's your
>   storage — but it's the one setting that can quietly destroy evidence, so
>   "when did we stop keeping originals?" has an answer.

> [!abstract]+ CLAUDE — what each quality level costs
> | Level | Long edge | JPEG quality | ~per photo |
> |---|---|---|---|
> | Economy | 1200 px | 0.75 | ~150 KB |
> | Standard | 1600 px | 0.85 | ~300 KB |
> | High | 2400 px | 0.90 | ~800 KB |
> | Archive | 4000 px | 0.95 | ~3 MB |
>
> The settings screen shows the running cost as you choose — about 1.1 MB per
> card at Standard with originals kept, ~1.12 GB per thousand cards. Sizes are
> honest estimates; the real figure is measured per image on upload.

> [!abstract]+ CLAUDE — presets and templates, already built
> **Named presets** (up to 20) save the whole bundle above under one name —
> "bulk intake" vs "consignment quality" — so switching modes is one tap.
>
> **Templates** are the ordered shot lists the camera walks. Four built in:
> Front & back · eBay listing (6) · Grading — corners & surface (12) ·
> Condition notes. Custom templates up to 30, built from **15 shot roles**
> (front, back, slab, four front corners, four back corners, surface angle,
> edges, defect, other).

> [!warning]+ CLAUDE — in-camera, NOT saved as preferences
> These two live only for the current session and reset every time the camera
> opens. If you want them remembered, that's a real gap worth an INBOX line:
> - **Guide shape** — Card vs Slab
> - **Auto-snap toggle** — the in-camera button, separate from the saved default

> [!question]+ CLAUDE — your two items don't exist yet
> Both of the things you wrote above are new:
> - **Distance units** (feet/inches vs metric) — no such preference.
> - **Always show distance from lens to card** — no such preference, and the
>   measurement behind it isn't built either. It needs edge detection first;
>   see our exchange below.
>
> If you want them, they're small once edge detection exists. Two more rows in
> the same table.

> [!note]+ CLAUDE — one inconsistency I noticed
> The margin slider on the settings screen stops at 15%, but the database
> allows up to 25%. Nothing breaks; you just can't reach the top of the range
> from the UI. Say the word and I'll make them agree — 15% is already a very
> wide margin, so raising the slider or lowering the limit are both defensible.

---

Your Notes:

my prompt: ok so yeah, i took the prompt i sent in the last coupl days and copy pasted it at the bottom so i could be writing some of those ideas out in detail above it... again, it was just my reference.... but the big thing i was writin about was the new idea about the photography system... that different templates/standards can be created with it... what those templates could be made up of.... and then different metrics that your camera can be showing you.... like... can we have the app showing you approximately how far away from the card you are taking a photo of is from your camera lens? can we show how much of an angle your lens is at in comparison to the card you are taking a photo of? all the time, i would like to be able to see the distance and angle reference any time i am taking a photo , is that possible? then we also need to be creating a settings/preference master menu.... in photography, this would be a preference that could be turned on or off to ALWAYS be there... otherwise, it would just show whenever you are taking a photo that specifically is for one of those metrics

You: Both are possible. Here's the honest mechanism, because it changes what you should build first.

## Angle

Two ways, very different cost.

**Cheap, works today:** the phone reports its own tilt from the accelerometer. If the card is lying flat on a table, phone tilt _is_ the lens-to-card angle. No computer vision, a few lines of code. Breaks if the card is propped up or held.

**Accurate:** a rectangle photographed off-axis becomes a trapezoid. Measure how much the card's shape is skewed in frame and you get the true angle regardless of how the card is sitting. Needs the app to detect the card's edges.

## Distance

The browser gets no depth sensor — no LiDAR, nothing. But **a trading card is a known size**, 2.5″ × 3.5″, always. Once you can see how many pixels wide the card is, distance falls straight out of the geometry. That's a real measurement, not a guess, and it's accurate to a few percent.

Same dependency: it needs the card detected in frame.

## The thing worth noticing

Everything you've asked for over two sessions collapses into **one** piece of work:

**Edge detection** — finding the card's four corners in the live frame — gives you:

1. **Distance** (card's known size vs. pixels it fills)
2. **Angle** (how skewed the rectangle is)
3. **Deskew** — warping the card back to a true rectangle, so every photo looks scanned
4. **The lock-on border** you asked for on day one

Four features, one keystone. That reframes it: I've had edge detection filed as "nice polish, held until a real box of cards proves capture angle is a problem." It isn't polish. It's the foundation of the metrics system you're describing, and it should be built for that reason regardless of the box.

## One recommendation on units

Distance in inches is what you asked for, but I don't think it's what you _want_ for templates. What actually matters for a corner shot is that every corner shot is framed the same — and the honest measure of that is **"the card fills 62% of the frame."**

Show both: a live _"about 8 inches"_ readout because it's intuitive, and the framing percentage as what a template actually stores and matches against. Inches drift with lens differences between phones; framing percentage doesn't.

## Always-on

Yes, straightforward — it's a heads-up display on the viewfinder. One caveat: detecting edges every frame costs battery and makes the phone warm. I'd run it at a reduced rate on a downscaled frame, same trick the auto-snap already uses. You'd never notice the difference.

## The settings menu

Partly built already. There's a **Photos & capture** section on `/cards/settings` with quality, cropping, margin, auto-snap, burst, keep-originals, and named presets. "Always show distance and angle" is one more toggle in a section that exists — extending, not starting.

The rest of that master menu — a real preferences home rather than a strip on one page — is worth doing, and I'd do it once there's enough in it to justify the navigation.

## What I need from you

**Nothing, to start.** Edge detection is well-defined and it's the unlock for all of it.

But two things would shape it:

- **Does the tilt-only version buy you anything now?** It's a day of work versus a week, and it's correct whenever the card is flat on a surface — which I'd guess is how you shoot most of the time. Worth having early, or just wait for the real one?
- **How do templates store proximity?** My instinct is framing percentage with an inches readout for humans. If you specifically want inches as the stored value, say so — it's doable, it just needs a one-time calibration step per device.

Write either answer in `INBOX` and I'll pick it up, or tell me here and I'll get moving on edge detection now.
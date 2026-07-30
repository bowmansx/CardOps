# Testing the camera — 2026-07-30 morning

Written overnight on 2026-07-29. Everything below is verified by 729 tests
against synthetic pixel buffers and **none of it has met a real card under a real
lamp.** That is the gap this page exists to close.

> [!warning] NOT DEPLOYED
> 14 commits are sitting on local `main`. The camera work is not on
> card-ops-zeta.vercel.app until it is pushed, so none of this is testable on a
> phone yet. I stopped short deliberately: pushing deploys to production and I
> cannot verify camera behaviour without hardware.
>
> ```
> git push
> ```
>
> Both migrations ARE already applied and verified — the database is ahead of the
> deployed code, which is safe because they are additive with defaults.

---

## What changed, in the order you will meet it

1. **Everything is readable.** Every translucent text colour in the camera is
   gone. The rule the screenshot taught: text over a live feed needs its own
   opaque background, because white at 60% over dark moving video is grey on grey
   at any size. Controls are solid chips now — Auto is black-on-yellow when on.
2. **Start scan arms automatic capture.** It was defaulting to OFF, which is why
   nothing ever fired by itself. A button saying "Start scan" that then waits for
   a tap is a camera, not a scanner.
3. **Auto-snap waits for a genuinely NEW card** before firing again — the
   detector losing the card, or a big enough scene change. Previously a card left
   on the desk would fill a batch session with duplicates of itself.
4. **A sweep template exists.** Pick "Sweep scan — glare-free + surface" and the
   run walks you through front sweep → front surface → back sweep → edges, arming
   the sweep itself at each step.
5. **One sweep makes two photos** — the card with glare removed, and a
   raking-light SURFACE map showing scratches and print lines. The surface one is
   labelled everywhere it appears and is EXCLUDED from eBay listings.

---

## The three numbers that will need tuning

Every one is a single constant. Tell me the symptom and it is a one-line change.

| Symptom | Constant | Where | Now |
|---|---|---|---|
| "It won't count up — I'm moving and nothing happens" | `minMove` | `sweep.ts` → `SWEEP_DEFAULTS` | `0.06` (6% of the card's diagonal) |
| "It counts up instantly / the merge does nothing" | `minMove` too LOW | same | — |
| "It says glare is unresolved when the photo looks fine" | `SPECULAR` | `stack.ts` | `200` |
| "It removed the glare but the card looks washed out" | `SPECULAR` too LOW | same | — |
| "Eight is too many, my arm hurts" | `target` | `sweep.ts` → `SWEEP_DEFAULTS` | `8` frames |
| "Every frame is rejected as blurred" | `minSharp` | `sweep.ts` → `SWEEP_DEFAULTS` | `8` |

**The hint line tells you which gate is rejecting.** That is what it is for — if
the counter is stuck, the hint says whether it is not seeing the card, seeing it
blurred, or seeing it from the same angle as last time. Read the hint before
guessing at a number.

---

## What I most expect to be wrong

**`minMove` at 6%.** It is the number I had least basis for. Too high and the
sweep feels broken; too low and eight nearly-identical frames merge into
something no better than one photo — and `stackWorthKeeping` will correctly
refuse to call that enhanced, so the symptom is "it says the merge changed
nothing".

**The surface map in flat room light.** If the light is diffuse, no raking
reflection ever lands, and it will tell you so rather than showing a defect view
that proves nothing. That is correct behaviour and will look like a failure. A
desk lamp off to one side is the test.

**Whether a sweep is physically pleasant.** Eight frames each 6% apart is a real
arc. It may simply be too much to ask while holding a card steady with the other
hand.

---

## Two things worth checking that are not the camera

- **Do you have an eBay STORE subscription?** If yes, the fee schedule I verified
  against eBay's public page is the wrong page, and every break-even is off.
  Store fees live somewhere I did not read.
- **The $9 coverage test.** Upgrade The Card API to Starter, run
  `fetchCardApiSales()` against 50 cards you know the value of, count how many
  return a matched quote. That single number decides whether the pricing strategy
  is about coverage or about depth — two different conversations.

---

## Still unverified, and I want to be plain about it

**~~PriceCharting's terms.~~ RESOLVED overnight — read, and the cautious reading
was right.** Their terms say Price Data "cannot be used in any software,
application, or system that is accessible to third parties... without express
written permission", so `rights.redisplay: false` is confirmed rather than
guessed. Two things worth acting on: internal business use needs a **Legendary**
subscription (the cheap API tiers are personal-use only, so the $50 you were
looking at does not cover even your own company), and permission has a named
contact — **brady@vgpc.com**. That is a short email, and it is the difference
between the connector working for your friends or only for you.

**Terapeak — the BLOCKER is identified, its existence still is not.**

Seller Hub is not switched on for your eBay account. That is now tested rather
than inferred: `/sh/ovw`, the Seller Hub overview and the most basic page it has,
redirects to the same "Start using Seller Hub" opt-in as `/sh/research` does. So
the redirect never meant "Terapeak is gone" — it meant every `/sh/*` path is
behind an opt-in you have not taken.

It is **free** ("There's no charge to use Seller Hub") and one click, and it is
the gate in front of Terapeak whatever state Terapeak is in. I did not click it —
enabling a service on your account while you are asleep is not mine to do.

**Once it is on, thirty seconds settles the whole question:** open Seller Hub and
look for a Research tab. If it is there, Terapeak exists and the only thing that
was ever wrong was the door. If it is not, the claim about three years of sold
data comes out of the strategy — it is inherited from the same research pass that
said automated sold comps were impossible while one was already integrated in
this repo, and it should not be load-bearing on that provenance.

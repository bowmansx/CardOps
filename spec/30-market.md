# Market — what's it worth, what would it grade

## Pricing

Every card carries a **pricing standard** (`pricing_strategy`) that decides how
its value gets determined. Market value comes from accumulated sales evidence;
`manual_price` overrides it when Beau says otherwise.

**Sales history belongs to the CARD IDENTITY, not to a card.** `card_identities`
is a canonical catalog of cards AS PRINTED, keyed by a deterministic
`card_fingerprint()`, shared across every tenant. Twenty owners of the same card
share one accumulated history and one vendor fetch.

- **Grade is NOT in the fingerprint.** Identity is the print; grader and grade
  are properties of a copy and of each observed sale. The pricing code filters
  sales to the card's condition. Adding grade would re-fragment exactly what
  this unifies.
- **Normalization lives in SQL only.** Never mirror `card_fingerprint()` in
  TypeScript — two implementations drift, and a drifted fingerprint silently
  splits one identity into two.
- The refresh cron fetches **once per identity** and applies the result to every
  owner's card separately. Dedupe the fetch, never the apply.

## Grade estimates

Vision model, per-company ranges (PSA / BGS / SGC / CGC) with rationale and
caveats. Sees **every view the card has** — front, back, corners, surface,
edges — each captioned with which view it is, so a corner close-up is read as a
corner rather than a blurry whole card. The slab label is excluded: it says what
a grader already decided, which isn't evidence about the card.

The estimate records **which views it saw** and which it lacked, and the card
page shows it: *"From 8 views: front, back, corner_tl… Full set."* An estimate
from one photo and one from a full template are different claims, and a grade
rendered without saying which is a number presented as more than it is.

**Pre-grading intel, never a guarantee.** That line stays on the screen.

## Paid vs free

A toggle may only carry a price if it causes real work. `news` reads real scored
headlines and costs credits. `macro` and `pop` are **free**, labelled "judgment"
in the UI, and the prompt tells the model not to present them as data. A `COST`
entry above zero is a claim that something was fetched, and a test pins it.

## Open

<!-- -->

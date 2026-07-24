I'll build the capability map from the verified research.

# CardOps × PSA: Capability Map for Beau

The short version: PSA has exactly **one** official API, and it does exactly **one** thing well — look up a card by its cert number. Everything else Beau wants either rides on that single endpoint or has to come from somewhere other than PSA. Here's the honest breakdown of his three goals.

---

## Goal 1 — Link the PSA account to pick & prepare cards for grading

**Verdict: NOT POSSIBLE via PSA (no submission API exists).**

PSA's Public API is strictly **read-only cert verification**. There is no endpoint to create a grading submission, add line items to an order, pull grading prices or turnaround times, or generate/print a submission form. Grading is a physical mail-in process, and building a submission happens manually in PSA's logged-in web Submission Center. The dealer / Group Submission program is a business/logistics arrangement (bulk pricing) — it does **not** unlock any API access.

**What to use instead:** Build the "prep for grading" workflow entirely inside CardOps — let Beau flag cards, batch them, and generate an internal pick list / worksheet. Then the actual order gets keyed in and printed by hand at PSA's Submission Center, and the cards get mailed. CardOps can own everything up to the hand-off; it cannot POST the submission or track its status afterward (order status is website-only, no API to poll by order number). Grading prices/turnaround would have to be hard-coded or scraped — not contract-stable, so treat them as reference-only.

---

## Goal 2 — Auto-pull a card's details from a cert number seen in a photo

**Verdict: POSSIBLE via PSA today — this is the one goal PSA fully supports.** (With one caveat on the free-tier volume cap.)

This is the API's home turf and lines up perfectly with CardOps' existing AI vision:

1. OCR the 8-digit red-label cert number off the slab photo (CardOps vision already reads cards).
2. Call `GET /publicapi/cert/GetByCertNumber/{certNumber}` → returns PSA's authoritative record: year, brand/set, subject/player, card number, variety, category/sport, label type, assigned grade + grade description, plus population fields for that specific card+grade.
3. Call the images-by-cert method (referenced as `GetImagesByCertNumber`) → PSA's official front/back slab scans.

**Two real caveats:**
- **Cert images only exist for cards graded from ~October 2021 onward.** Older slabs return no image — expect nulls.
- **Validate the OCR.** Glare/angle can misread a digit. Trust the scan only when the response comes back valid and the returned card details match what the photo shows.

The exact image-endpoint name is community-confirmed (via the brad-newman/fetch-psa-api client) rather than emphasized in PSA's own prose — confirm it in the Swagger UI once Beau has a token, but it does work.

---

## Goal 3 — Pull sale stats / estimated values / population per card

**Verdict: PARTIAL for population, NOT POSSIBLE for prices/sale stats — via PSA.**

Break this into its two halves, because they're different:

**Population — PARTIAL.** The cert lookup returns a *slice* of pop data for the one card+grade you looked up: population at that exact grade, population graded higher, and total population for the spec. What it does **not** give you is the full grade-by-grade histogram (how many exist at each grade 1–10). PSA has no endpoint that accepts a spec ID and returns the full pop table — `SpecID` comes back in the response but is read-only, you can't feed it back in. So: aggregate/at-grade pop = yes; full population report = no via official API.

**Prices / sale stats / estimated values — NOT POSSIBLE via PSA.** PSA's Auction Prices Realized (APR) and Price Guide are **web-only tools on psacard.com with no API, no data feed, and no documented licensing path.** The API returns zero price fields. If CardOps needs values, PSA is simply not the source.

**What to use instead:**
- **Prices / sold comps:** CardOps already has an eBay Hub — that's the natural, ToS-clean source for graded sold comps. Supplement with **PriceCharting API** (graded comps + price history + pop + images by grade) if Beau wants a dedicated price feed.
- **Full population at scale:** **GemRate Partner API** (universal pop / gem rates / historical changes across PSA/BGS/SGC/CGC, with universal IDs to map a card across graders) or **TCGAPIs** (PSA cert lookup incl. images + pop, single endpoint, has a free 5/day demo tier).
- **Avoid** scraping psacard.com/pop or the APR pages — it violates PSA's ToS, is fragile, and breaks.

---

## Recommended build order (best payoff first)

1. **Cert-scan → auto-hydrate (Goal 2).** Highest payoff, lowest lift, and it reuses CardOps' vision + the eBay Hub. OCR the cert, call `GetByCertNumber` + images, auto-fill the card record and a listing. This is the feature PSA actually supports end-to-end. Ship this first.
2. **Grading prep workflow, internal only (Goal 1).** Let Beau flag/batch cards and generate a pick list inside CardOps. Be explicit in the UI that the actual order is keyed in and mailed manually — no false "send to PSA" button. Medium payoff, no external dependency.
3. **Values via eBay comps + PriceCharting (Goal 3 prices).** Lean on the eBay Hub Beau already has; add PriceCharting if he wants cleaner graded-by-grade history. This is where real money decisions get made, so it's high value but should sit on a source you can rely on.
4. **Population enrichment (Goal 3 pop).** Start with the at-grade pop already free in every cert lookup (no extra work). Only add GemRate/TCGAPIs later if Beau wants full histograms or cross-grader pop — that's a paid partnership, so defer until the volume justifies it.

---

## What Beau must provide or sign up for

**To do anything with PSA (Goals 2 + partial 3-pop):**
- **A standard PSA account** at psacard.com — that's the only requirement. No separate developer program or app approval.
- **Free tier = 100 API calls/day**, per account. Auth is **OAuth2 password grant using his actual PSA login credentials** — meaning CardOps must store/handle those credentials **server-side only** to mint the bearer token. Never in client-side code. (Flag: this is a real security consideration — it's his login, not a scoped API key.)
- There's an **End User Agreement** governing how cert data may be cached/displayed — worth a read before caching at scale.

**Paid PSA subscription — flagged:**
- The **100 calls/day free cap is a hard constraint** for any bulk/inventory workflow. A card business scanning many certs will hit it fast. Higher daily limits exist **but are not self-serve and not publicly priced** — Beau has to **email PSA (reported: publicapi@collectors.com) for a quote.** Budget unknown until he asks. **Mitigation:** cache every cert response permanently (cert data never changes), so you only ever call each cert once — this alone may keep him under 100/day for a while.

**Third-party services (only if he wants Goal-3 features PSA can't do):**
- **PriceCharting** — subscription/API key (graded price comps + history).
- **GemRate Partner API** — custom, contact-to-onboard partnership (full/cross-grader pop). No public price.
- **TCGAPIs** — API key; free 5 lookups/day demo, paid Business/Unlimited tiers for real volume.
- **eBay** — already connected in CardOps; no new signup for sold comps.

---

## The one-paragraph honest summary

PSA gives Beau a clean, official way to **turn a photographed cert number into a verified card record with images and at-grade population** — build that first, it's the whole payoff of a PSA integration. PSA **cannot** take a grading submission (do it manually), **cannot** give prices or sale stats (use eBay + PriceCharting), and **cannot** give a full population report (use GemRate/TCGAPIs, or live with the at-grade slice). The only cost gotcha is the **100 calls/day free cap** — aggressive caching buys time, but a real card business will eventually need to email PSA for a paid tier at an undisclosed price.
# CardOps — Product Strategy

**Source of truth, and the to-do list.** The published page at
<https://claude.ai/code/artifact/73cd1984-c3e3-44b6-be27-b3ec2e4a6baf> is
rendered from this file. Edit here, never there.

Two kinds of thing live here and they are kept apart: **what to build ranked by
value** (the strategy), and **Beau's queue** - specific things he has asked for,
in the order he asked. The queue is not re-ranked; it is his list.

*Last substantive update: 2026-07-30 · main @ 18ad78f · 572 test cases, 38 files*
*(Describes work done Tue 2026-07-28 through Wed 2026-07-29.)*

Related registers: [[GO-LIVE]] - what becomes real when other people pay.
[[../valuation/DECISIONS]] - the settled valuation and data-sourcing calls.

---

## The wedge

**Per-card inventory that closes into a real double-entry general ledger,
across multiple legal entities, with every number traceable to a document.**

This survived scrutiny after a belief we had both been building on turned out
to be false:

> "Nobody tracks cost basis" was true in 2022 and is false in 2026. Slabfy,
> Whuppit, CardLogx, Viewible, InVelocity, CardZen and Mascot all attack cost
> basis and margin, at $7–40/mo. It is table stakes for the segment.

What is *not* table stakes:

- Of ~15 card products surveyed, **none** advertises a QuickBooks / Xero / Zoho
  integration and none mentions journal entries or a chart of accounts. They
  stop at "margin" and hand off a CSV.
- The reseller accounting tools that *do* have real books — Seller Ledger, My
  Reseller Genie — are marketplace-generic and have no concept of a card, a
  purchase lot, a grading cost line or a cert number.
- CPAs writing for this hobby in 2025–26 still recommend **a spreadsheet** as
  the cost-basis system of record. That is the real competitive baseline.

**Multi-entity is the sharp edge nobody else has.** Zero of eight products
checked let one operator keep two businesses' inventory and books apart. Beau
built it reflexively because he runs several businesses.

Defensible because it is architectural, not a feature: a scanner app cannot
grow a general ledger without rebuilding its data model, while CardOps can
reach scanning parity in a sprint.

**As of 2026-07-29 the wedge has a screen.** `net-proceeds.ts` and
`WhatYouKeep.tsx` turn the ledger into a sentence said *before* the decision:
*"break-even $187 — lot #7's draw of $88, plus $32 grading, plus $4 shipping
in — and you keep $271 after fees."* That was the top-ranked item in the
previous three revisions of this document. It is built. The wedge is no longer
only architectural.

---

## The market, honestly

The winnable market is **small and rich**: dealers who have crossed into being
a business — an LLC, a CPA, and increasingly consignors whose money is mixed
with theirs.

The variety is the trap. The casual collector is served free by eBay and TCDB.
The flipper lane filled in 2025–26 at under $10/mo. The high-end investor needs
population and census data CardOps cannot source.

### Pricing: DECIDED, and it is Beau's answer, not the research's

The earlier revisions of this document held metered-versus-flat open as a
tension. It is closed. Recorded in [[../valuation/DECISIONS]], 2026-07-28:

> "cardops is a tool in the form of an app/website that people will need to
> purchase computing power beyond their free amount for."

**Compute-metered with a free tier**, over the research's flat $50–150/mo
recommendation. It fits what is already built — the credit ledger, per-run cost
metering, per-photo byte accounting — and it is now a decision rather than an
open question.

The decision has teeth, and three of them point at code:

1. **Catalogue lookups must never consume credits**, including after an
   allowance is exhausted. Scryfall's terms forbid paywalling their data; the
   moment "out of credits" hides a card's name, it is behind a paywall. A hard
   design constraint, not a preference.
2. **A hard stop, not a soft one.** A metered product that can run an unbounded
   bill on someone else's card is a support nightmare.
3. **Bulk floor checked FIRST, non-negotiable.** A 5,000-card collection buy
   must never bill for 5,000 lookups.

**Today CardOps is still Beau's tool, shared free with close friends.** None of
the go-live machinery is urgent. It is written down in [[GO-LIVE]] because most
of it is cheap before the first paying user and expensive after.

---

## The comps question — ANSWERED

The previous revision carried this as "for later" and named one unverified
question: *whether any tier below Enterprise can backfill*. It was checked
against live vendor pages on 2026-07-29 and the answer changed the plan.

**The premise of the pass before it was wrong.** It concluded there was "no
reachable, permitted API that sells third-party sold comps" — a conclusion Beau
reasonably read as the project being pointless. It had asked what was available
*for free* and reported that as the map of what exists. **The API was already
in the repo**: `price-sources/thecardapi.ts`, shipped 2026-07-21, on a free
tier with a 3-day lookback, which produces almost nothing, which got read as
"does not exist."

**Verified** (thecardapi.com pricing and terms, read 2026-07-29): Starter $9 →
10,000 rows/day, 14-day lookback, 500k stored records, single commercial
application. Builder $49 → 30 days. Pro $199 → 90 days. Unlimited Lookback is a
**$99 add-on**, Pro-gated. Their §4a explicitly permits SaaS products, caching
responses locally *to serve your users*, derived analytics as your own IP, and
displaying transaction history in your own interface.

So the carried question has an answer: **no tier below Pro-plus-add-on
backfills**, but that matters far less than it appeared to, because —

**The lookback tier limits BACKFILL, not accumulated depth.** `card_market_sales`
is append-only with dedup, so a 14-day window run daily becomes a year of
history in a year. That is the whole reason the cheap tier works, and it is why
banking early has value.

Settled, unless Beau says otherwise:

- **Buy the comps, don't build them.** eBay shipped a free camera-scan price
  guide backed by two years of their own transactions in March 2026. Accuracy
  is not a winnable axis against the company that owns the transactions.
  **Checkable is.**
- **Start at $9, not $298.** The Unlimited Lookback add-on buys the past *now*
  instead of waiting for it — a later decision, made once the coverage test
  says the data is worth backfilling.
- **Supply-driven at scale.** Ingest a feed and roll it up per identity; never
  pay per card per user. Cost then stops growing with adoption, and the credit
  meter stays honest because a warm identity fetched nothing.

**Still needs Beau: the $9 coverage test.** 50 cards whose value he knows,
count the matched quotes. Everything downstream waits on that number, and it is
an hour's work.

---

## Beau's queue

Specific asks, newest first, kept in his order rather than re-ranked.

**Every item so far turned out to be partly built already**, so each is phrased
as *finish / wire / build the destination* rather than *create*. Checking first
has changed the scope of every one, and it is worth keeping that habit: this
codebase has more in it than either of us remembers. (See "the build-and-forget
pattern" under *What to build* — it has now happened four times.)

### Q1 - the intake session card list  *(2026-07-28)* — **SHIPPED 2026-07-29**

> "below 'photograph the card' on intake, a running list of the cards being
> added during this photo session. it will be interactive... a delete button,
> the card can be clicked which will bring up whatever information you have
> compiled for that card so far but someone may likely just be taking new
> photos so that can be done as well."
>
> "once we confirm to move on from the intake, this same menu of cards will be
> brought up where we will either just have the menu to move on or there will be
> some things that can be done such as grouping etc."

`src/lib/cards/intake-session.ts` exists and is referenced; the cards booked
during a session stay on screen (commit `5fdb6d9`).

It was, as predicted, a wiring job rather than a new build:
`card_intake_sessions` and `card_intake_items` had existed since the 20260713
init with **zero references in `src/`**. The whole model was designed on day one
and never connected.

**The open question was resolved in favour of one component, more actions** —
the confirm-step list is the session list with the extra actions enabled, not a
separate review screen.

### Q2 - WIRE "Add to Group" into the photograph step  *(2026-07-28)* — open

> "a dropdown menu for 'Add to Group'. The dropdown menu will show all the
> current groups and then also have an add group button."

`card_groups` and `card_group_items` exist, are RLS'd per user, and
`/api/cards/groups` already implements create, rename, delete, add and remove.
`CardBrowser` uses it. **The dropdown in the photograph step still does not
exist** — the only reference is in `CardBrowser.tsx`.

**ANSWERED 2026-07-28 - sticky, not session-scoped:**

> "when you set something, that setting will stay for that card and the
> following cards until you change it. let's also put an X to remove the data in
> a selection box to the right of each box."

Better than either option offered. A session-wide setting cannot be changed
partway without either applying retroactively or silently not applying;
**sticky** means the value carries forward from the card where it was set,
every card keeps whatever was current when IT was captured, and changing it
mid-stack affects only what comes after. That is how a person actually works
through a box - the first thirty are from one purchase, then a different pile
starts.

And the X generalises: **every field in the photograph step gets a clear
control to its right**, not just the group. Sticky values need a way to say "not
this one" that is distinct from "I have not chosen yet".

So there are three states per field, and they need to be visually distinct:
inherited from the previous card, set explicitly on this card, and deliberately
cleared.

### Q3 - BUILD THE DESTINATION for Card Groups  *(2026-07-28)* — open

> "we also need to start a 'Card Groups' section anyways which will be what the
> add to group in the above paragraph works with."

Table, items table, RLS, full CRUD API and group filtering inside `CardBrowser`
all exist. What does not exist is a *destination* — a page where groups are the
primary object: rename, recolour, reorder, see what is in one, act on all of it.

**Q4's answer settled what a group IS**, which was the blocker: purely
user-created, many per card, and *not* the objective description of the card.
That is now a query. So this page can be built.

### Q4 ANSWERED - the objective hierarchy is a QUERY, not a group  *(2026-07-29)*

> "only one group it can be in which should be an objective description of the
> card of which there only is one description.... so maybe some order like
> 1 baseball 2 2025 3 brand 4 product line of the brand"
> "those could be auto generated... but then groups are more of a kind of user
> created thing like when they want to create their own sets"

**This collapsed most of Q4.** `sport_category`, `year`, `brand` and `set_name`
are already columns on `cards`. A hierarchy over them needs no membership
table, no assignment step, no maintenance, and it is always correct because it
is derived - fix a card's year and it moves in the tree by itself.

**And it dissolves the inheritance question**, which was the thing blocking all
of this. "Is a card in Box 3 also in 2024?" is meaningless for a derived tree:
each level is a filter, so a card in `Baseball > 2025 > Topps > Chrome` is
trivially in all four. That question only existed because the model assumed
stored membership.

**It exists at depth 1 already.** `CardBrowser` has a `grouped` boolean that
groups by `sport_category`, hardcoded. This is that, generalised.

**DO NOT FIX THE ORDER.** Different questions want different orders - "everything
Pokemon" against "everything from 2025" against "all my Prizm regardless of
year". A fixed tree makes one question easy and the rest awkward. Beau's order
is the default; the facets are reorderable and addable. Other columns already
worth offering: `parallel`, `player`, `condition_type`, `grader`,
`storage_location`, `acquisition_source`. Free, because it is all query-side.

**So groups become purely user-created**, and the "one group per card"
constraint is dropped - the thing that genuinely needed to be one-per-card was
the objective description, and that is now derived.

**Group versus tag is WEIGHT, not cardinality:**

- A **group** is a thing. A name, a purpose, an order you curate, a page of its
  own. "My PC", "For the June show", "Dave's consignment."
- A **tag** is an adjective. Applied in bulk, no page, no order. "to grade",
  "needs better photos."

The test: **would you ever reorder the cards inside it?** Yes = group. No = tag.

Already solved and worth not rebuilding: `cards.storage_location` exists, with
`card_storage_locations` behind it as a pick-list. Physical location is a field,
not a group.

**Naming collision, still unresolved.** `TAG_FACETS` in `lib/cards/types.ts` —
RC, AUTO, PATCH, RPA, numbered, graded, PSA, BGS, SGC, CGC — are **derived in
code from card fields**, not authored by anyone. User-authored labels are a
different thing wearing the same word. Whatever gets built needs a name that
does not collide, or every conversation about "tags" from here is ambiguous.
Migration `20260720020000` records the deliberate call that *"Tags themselves
are DERIVED in code from card fields (no tag table needed)"* — reversing it is
fine, but it gets named rather than quietly undone.

### Q5 - Three concepts, not one: facets, tags, and OWNERSHIP  *(2026-07-28)* — open

> "there will be tags and labels.... you might want to tag things such as if it's
> a patch, if it's an auto card, etc.... but then also if you are inputting
> someone else's cards you want to associate certain cards with another owner.
> i'm not exactly sure what's going to be the best system there"

The instinct that these do not all fit one system is correct. There are three
things here and only two of them are labels.

| | What it is | Who writes it | Consequence of getting it wrong |
|---|---|---|---|
| **Facets** (`TAG_FACETS`) | patch, auto, RC, numbered, graded, PSA... | Nobody - **derived from card fields** | A wrong filter. Cosmetic. |
| **Tags** | "to grade", "eBay listed", "sentimental" | You, freely | A messy list. Cosmetic. |
| **Ownership** | this card belongs to someone else | **Nobody - it is a fact** | **Money.** |

**Patch and auto should NOT become user tags.** They already exist as derived
facets computed from `is_relic` and `is_auto`, which the vision scan fills in
automatically. Making them hand-typed labels means the same fact stored twice,
disagreeing, with the hand-typed one wrong more often. If a facet is missing,
the fix is the derivation, not a label.

#### Ownership is not a tag, and this is the important part

If a consignor's card is in your possession and it is marked with a *tag*, then
deleting the tag silently absorbs someone else's property into your inventory
value. A tag is editable, unenforced, and carries no consequences by design -
which is exactly wrong for a fact with this much attached to it:

- It must **not** count in your inventory value or your net worth.
- It must **not** have a cost basis - you did not buy it.
- Its sale is **not** your revenue. It is a payout obligation.
- **The 1099-K problem:** the marketplace reports the consignor's full sale
  price as **your** gross. Reconciling to that form needs the sale booked as
  revenue and the payout booked as an expense, so the top line ties out. That is
  a double-entry problem, and it is precisely why competitors can ship
  "consignment tracking" and still not solve it.

**What exists:** `at_auction_house_on_consignment` is an asset state - that is
*your* card sitting at an auction house. **Outbound.** There is no concept
anywhere for *inbound* consignment. `entity_id` covers which of *your*
businesses owns a card, which is a different axis again.

**So ownership belongs in the books layer, not the label layer.** A field on the
card, a party record for the consignor, terms (split, fees, due date), and it
flows through basis, valuation, sale and the ledger. Months of work.

**Now decidable, where it was not before.** The earlier note called inbound
consignment "a CardOps-as-product decision rather than a CardOps-for-Beau one."
That decision was made on 2026-07-28: it is a product. So the blocker is gone
and this is a scheduling question, not an identity question.

**A cheap first step that is not the whole thing:** a nullable `owned_by`
pointing at a party, defaulting to you, that simply **excludes the card from
every total** when set. That is a day, it is honest, and it stops the worst
outcome - counting someone else's cards as your money - long before full
consignment accounting exists.

---

## What to build, ranked

### The build-and-forget pattern, named because it has happened four times

`card_intake_sessions` (day one, wired 2026-07-29 after ~16 days dead).
`card_grading_submissions` (exists, still zero references in `src/`).
`card_format_profiles` (exists, never read). And now **`paste-sales.ts`** —
330 lines with 262 lines of tests, shipped 2026-07-29, **zero consumers in
`src/`**. There is no screen and no route that calls it.

This is the single most reliable way work gets wasted here: the hard part gets
built and tested, and the last mile that makes it reachable does not. **Finishing
beats starting**, and the top of this list reflects that.

### The one thing

**Finish what just landed.** Two days of strong work shipped a money engine, a
price-basis layer, a licence-rights gate, provenance chips and a paste parser.
Two of those are not reachable from the product, and one claim in this document
is only half-true as a result.

- **The paste parser has no screen.** `paste-sales.ts` is the lane no API sells
  — a 130point or Seller Hub paste as a first-class `ObservedSale` source, with
  `rights` that permit persisting it. Nothing calls it. This is the thing that
  makes "we can show where the number came from" true on cards the vendor feed
  misses, and it is a route and a textarea.
- **The money engine is not yet the shared primitive it was ranked as.**
  `net-proceeds.ts` reaches the card page, `SellForm` and `WhatYouKeep`. It does
  **not** reach grade EV, which still computes `fee = FEES[g] + SHIP` in
  `grade-ev/route.ts` — so the grading decision and the selling decision use two
  different fee models. The whole argument for building it was one code path.
- **Then the forecast-versus-actual line.** Once the sale is booked from the
  same function that forecast it, the app can print *"forecast net $412, actual
  $407, delta $5 — fee tier changed."* No competitor can produce that sentence,
  and it is the clearest possible proof the numbers are real.

**Under a week**, and it converts three shipped-but-invisible things into
product.

### The rest

| # | What | Effort |
|---|---|---|
| 1 | **The buy sheet.** *Newly unblocked — it was #11 and gated on the money engine, which now exists.* Scan a stack and get a defensible offer: matched identities at a chosen haircut, bulk residual stated separately, days-to-sell, and an explicit band for how much rests on weak matches. Every other tool tells you what a card you own is worth; this tells you what to pay before you own it. **Gated on the $9 coverage test**, because an offer built on comps that miss is worse than no offer. | ~3 weeks |
| 2 | **Resolve the PriceCharting licence.** Their API terms are internal-use-only and `price-sources/pricecharting.ts` is already wired. Under "Beau's tool" that was arguable; under "a product" it is not, and *free* does not save it — the term is about **who** uses the data. Two clean paths: ask them for a redistribution quote (often an email, not a legal project), or restrict that connector to the operator's own account. **Cheap now, expensive after a second user exists.** | hours–days |
| 3 | **Cert verification against PSA.** Intake already reads grader/grade/cert off the slab. `GetByCertNumber` is free and cert data never changes, so cache forever, per identity. Converts a vision guess into a checked fact, and catches the one fraud that costs resellers money. *Sources conflict on the free rate limit — test with a live token before designing around volume. Population fields return null; do not plan on pop data.* | 2-3 days |
| 4 | **A grading tier picker.** The fee defaults are fixed — PSA 50 / BGS 30 / SGC 25 / CGC 25 + $12 ship, against the old 25/22/18/18 + $8 — and `GradeEV` now renders the configured fee rather than the old hardcoded "~$20" caption. What is still missing is *which tier*: PSA Economy $50 against Regular $79.99, with Value tiers paused since June 2026. The answer to "should I grade this" is tier-dependent and the app cannot express the question. | hours |
| 5 | **Year-end COGS close with a named exception list.** Beginning inventory + purchases - ending inventory, partitioned by SOURCE, read through `readAllSafe`. The differentiator is the header: *"debits = credits across 1,204 entries; 0 partial reads; 4 cards have no stated basis."* **Seasonal — the deadline is December and it is July.** | ~1 week |
| 6 | **Free, complete, one-click export, stated as a promise.** `/cards/export` and `export.ts` exist. What does not exist is the *commitment*: a page that says it is complete and free forever, and a test that proves it is not silently capped at 1000 rows (prevention rule 5). CSV export is paywalled across the entire category. For a one-man product competing with funded incumbents this is the most credible trust signal available, and it costs almost nothing. | 2-3 days |
| 7 | **Finish the grading loop.** The midpoint EV bug is **fixed** — `grade-ev/route.ts` now works across the whole estimate rather than collapsing "PSA 8 to 10" to a single 9. What remains: `card_grading_submissions` **exists and is dead**. Extend it to order level — grader, tier, order #, declared value, ship date. PSA Value Bulk is 140-160 *business* days, which makes a submission the longest-duration position in the business, and the app cannot see it at all. Then capture returned certs. *Migration — never auto-merges.* | 2-3 weeks |
| 8 | **Catalogue poisoning defences.** `card_market_sales` hangs off the shared identity, so one bad paste or wash sale reaches every owner. No provenance weighting, no outlier quarantine, no dispute path — and `card_id` is nullable `on delete set null` with **no `added_by`**, so deleting a card severs the only link to who contributed a row. A poisoned sale can become permanently un-attributable. **Cheapest to fix while Beau is the only contributor** — and the paste screen in "the one thing" is exactly what makes it stop being true. | ~1 week |
| 9 | **Bulk image ingest.** A folder or ZIP of flatbed images, fronts paired to backs, through the existing vision and identity trigger. A phone rig tops out at 80-120 cards/hour against 250/hour overhead. A 5,000-card collection buy currently never enters the system, or enters as an unpriced lump. **Hard constraint: identification-grade only, labelled as such — it can never back a condition claim, because the geometry is not there.** | 2-3 weeks |
| 10 | **Review queue ranked by money at risk.** Not a better model — triage. Surface the ambiguous /25 parallel first, auto-accept the base card, and when vision is torn between two identities name the discriminating attribute. Corrections write back to the shared catalog once, for everyone. The constraint is Beau's hours, not model accuracy. | 1-2 weeks |
| 11 | **Surface the capture record + a dispute pack.** Distance, angle, per-edge lock, sharpness and clipping are all measured and none of it is visible. Bundle a sold card's pre-ship set with timestamps and per-image sha256 (`evidence.ts` already hashes). *Audit first: `capture_meta` writes from two call sites only and `card_photos.width/height` are unpopulated, so this renders blanks for most of the library today.* | 1-2 weeks |

**Below the line, named so they are not forgotten:** card-show offline mode (the
offline write must queue as a *proposed* transaction, never an auto-post); eBay
own-sales ingest for real fees and payouts (**blocked on the RuName / cutover**;
it would also give the money engine a fee rate derived from settled sales rather
than a published schedule, which is the better input); inbound consignment
(months — now a scheduling call rather than an identity one, per Q5).

## What not to build

- **Scanning and price guides as the headline.** eBay's own price guide is
  free, in-app, scans to the exact parallel, and added portfolios in June 2026.
  The venue where cards sell is giving away the layer others charge $10/mo for.
  Scanning must be good enough not to lose the deal; it can never be why you win.
- **An accuracy race against eBay's comps.** Stated plainly after the vendor
  pass: you cannot out-accurate the company that owns the transactions.
  **Checkable is the winnable axis** — provenance, basis, and what you keep.
- **A marketplace, or holding anyone's money or cards.** Competitors' worst
  reviews are payment and shipping disputes, and those reviewers abandon the
  tracker too.
- **Card-show POS.** The lane filled in 2025–26 and one entrant is free.
  Capturing show-day cash and trades *into the ledger* is the part worth having.
- **A sales-tax engine or nexus determination.** Jurisdictional quicksand, and
  it violates the posture that has kept this product honest. Record and flag;
  never compute an obligation.
- **Set registry / completion / census.** Needs a catalog of what *exists*;
  `card_identities` is a catalog of what has been *seen*. Unbridgeable without
  licensed checklist data.
- **A cheap tier chasing the casual collector.** Served free elsewhere, and it
  drags the roadmap toward features a dealer does not need.
- **Any projected future value or "cards as an asset class" framing.** Also a
  dead commercial category — Collectable wound down Nov 2024, Dibbs Mar 2023,
  Mythic Markets 2021. Report what happened, never what will.
- **Grade estimates shown to a buyer.** Internal EV is the entire point. The
  moment "likely PSA 9" appears on a showcase or in listing copy it is a
  representation to a buyer about a third party's future act, using PSA marks.
  Every card that returns lower is a dispute. Keep it private.
- **A tax package that computes tax.** No rate applied, no form line numbers as
  headers, no ordering by tax advantage, no short/long label — raw day counts,
  and classification shown as *"as classified by you on <date>: <reason>."*
- **An AI-grading accuracy race.** Photo quality matters more than the model.
  The defensible thing is the capture STANDARD — edge detection, deskew,
  sharpness gating, templates, retained originals with crop geometry. Market
  the standard and the evidence trail; never claim a percentage you cannot
  source.
- **A pooled per-user execution model.** *(New 2026-07-29.)* Completed sales are
  public and pooled — Beau's call, and it is the network effect. But "does *this*
  seller realise above or below market, and how fast" is not a fact about the
  card; it encodes photo quality, feedback score, shipping speed, patience and
  return policy. Pooling it renders one prolific seller's behaviour as "the
  market" and hands a new seller with three feedback the numbers of a top-rated
  store. **Market data pooled, execution data never.**

---

## Confirmed gaps

| Gap | Why it matters |
|---|---|
| **PriceCharting is internal-use-only, and the connector is wired** | *New 2026-07-28.* The licence question that a commercial product turns into a real one. Ranked #2 because it is hours now and a rebuild later. |
| **`paste-sales.ts` has no consumer** | *New 2026-07-30.* The parser and its 262 lines of tests exist; no screen or route calls it. Fourth instance of build-and-forget. |
| **Two fee models in one app** | *New 2026-07-30.* `net-proceeds.ts` for selling, `FEES[g] + SHIP` in `grade-ev/route.ts` for grading. The "one code path" argument was the whole case for the money engine. |
| **No `added_by` on `card_market_sales`** | A poisoned or wash sale reaches every owner of the identity and can become permanently un-attributable once the contributing card is deleted. |
| Storage tier numbers do not exist | Every screen that would warn someone before they hit a quota is written around a number nobody has chosen. Blocked on Beau. |
| eBay integration is sell-side only | Nothing ingests purchases. Basis is born on the buy side. **Blocked on the cutover interlock.** |
| Import is hardcoded | Fixed headers, no mapping UI; `card_format_profiles` never read. |
| AI confidence captured, nothing consumes it | No review queue, no record of "AI said X, corrected to Y". Unrecoverable retroactively. |
| Flat running average on mixed lump-sum buys | IRS Pub 551 prescribes relative-FMV allocation. `CLAUDE.md`'s claim needs narrowing to *bulk*. |
| 1099-K reverted to $20,000 **and** 200 transactions | Retroactive for TY2025–26. Most serious sellers now get **no form at all** — their own records *are* the tax record, with nothing to check them against. |
| Consignment inflates the 1099-K | The marketplace reports the consignor's full sale price as your gross. Reconciling is a double-entry problem. |
| ~~PSA fee default of $25~~ | **CLOSED 2026-07-29.** Defaults are now PSA 50 / BGS 30 / SGC 25 / CGC 25 + $12 ship, and the screen renders the configured fee instead of a hardcoded caption. What remains is the *tier* picker — ranked #4. |

---

## Posture

These constrain every recommendation above and outrank any of them.

- **Never present a figure or an image as something it is not.** Grading
  evidence traces to what came off the sensor.
- **A licence term is code, not a comment.** *(New 2026-07-29.)* Every price
  source declares `rights` — persist / redisplay / pool — and the write path
  consults them. `mayPersist` **default-denies an unknown source id**: "we never
  checked" must not read the same as "permitted".
- **Never median across price bases.** *(New 2026-07-29.)* eBay quotes what the
  buyer paid; auction houses quote the HAMMER with a buyer's premium still to
  come. A venue whose premium cannot be cited is EXCLUDED and the exclusion is
  reported. `price_basis` is stored per row, never re-derived, because
  re-deriving reinterprets years of history the day a vendor changes convention.
- **A provisional price is never stored.** The accumulator upserts with
  `ignoreDuplicates`, so a fast-settle estimate written once can never be
  corrected.
- **Catalogue lookups never consume credits.** *(New 2026-07-29.)* Including
  after an allowance is exhausted. The moment "out of credits" hides a card's
  name, Scryfall's data is behind a paywall.
- **Tax classification is recorded, never determined.** The app stores Beau's
  call and his stated reason. Bookkeeping hygiene and flags to raise with a CPA
  — never filing, never advice.
- **Money-critical and outward-facing writes are gated on explicit human
  decision.** Nothing posts to real books from a cron.
- **Surface merges or deletions that would lose work** rather than doing them.
- **A break-even is the fee equation INVERTED**, never basis plus a percentage —
  fees are charged on the higher price too, and the naive version says an offer
  clears when it loses money. And no break-even renders at all where
  `basis_entered` is false: that card gets "no stated basis", never a floor of $0.

---

## Open questions

**Waiting on Beau, in the order they cost something:**

- **The $9 coverage test.** 50 cards whose value he knows; count the matched
  quotes. An hour, and the buy sheet and everything about comp quality waits
  behind it.
- **Whether to resolve the `CRON_SECRET` interlock.** It now has a price that it
  did not have when it was set: no accumulation means no history banked, and
  banking early is the entire reason the cheap tier works. **Manual triggering is
  the middle path** and needs no interlock decision. Master-Ops stopped
  scheduling the card crons on 2026-07-25, so the double-run justification is
  gone; the hardening gate is the remaining reason, and the charter forbids
  setting the secret unprompted.
- **One paid hour of counsel** on whether a user-uploaded Seller Hub export
  falls outside eBay's "eBay Content does not include information that you
  lawfully obtain independent of eBay". All pooling is downstream of it, and
  `pool` is false on every source until it is answered.
- **Storage tier numbers.** Blocked on Beau; every quota-warning screen is
  written around a number that does not exist.

**Still genuinely open:**

- Credits scoped per-org or per-user. Cheap to change now, expensive later.
- Whether the multi-frame glare compositor is worth building at all — gated on
  a light measurement that has not been taken. `exposure.ts` will say `fixed`
  if the light source is too broad to escape, in which case a sweep is wasted
  time and the honest answer is "use a smaller lamp".
- What "tags" should be called, given `TAG_FACETS` already owns the word.

**Closed since the last revision:** metered versus flat subscription (metered,
2026-07-28). Whether any tier below Enterprise can backfill (no, but accumulated
depth matters more, 2026-07-29). Whether inbound consignment is a
CardOps-as-product decision (it is a product, so the question dissolved).

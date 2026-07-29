# CardOps — Product Strategy

**Source of truth, and the to-do list.** The published page at
<https://claude.ai/code/artifact/73cd1984-c3e3-44b6-be27-b3ec2e4a6baf> is
rendered from this file. Edit here, never there.

Two kinds of thing live here and they are kept apart: **what to build ranked by
value** (the strategy), and **Beau's queue** - specific things he has asked for,
in the order he asked. The queue is not re-ranked; it is his list.

*Last substantive update: 2026-07-28 · main @ 006273b · 424 tests*
*(The build work it describes was done Mon 2026-07-27.)*

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

---

## The market, honestly

The winnable market is **small and rich**: dealers who have crossed into being
a business — an LLC, a CPA, and increasingly consignors whose money is mixed
with theirs.

The variety is the trap. The casual collector is served free by eBay and TCDB.
The flipper lane filled in 2025–26 at under $10/mo. The high-end investor needs
population and census data CardOps cannot source.

**Beau's own answer differs and may be better.** Claude-style metered pricing —
mostly free to a level of compute and storage, pay past it — reaches the same
place by a different route, and fits what is already built: the credit ledger,
per-run cost metering, per-photo byte accounting. Tension held, not resolved.

---

## The card-data question, for later

No card cron runs anywhere: `CRON_SECRET` is unset here (the six jobs 401 by
design) and Master-Ops stopped scheduling them on 2026-07-25.

This was first written up as urgent. It is not. Beau is replacing thecardapi's
free tier with real API subscriptions, and the lookup schedule is a design
conversation that has not happened yet -- turning on a cron to hoard data from
a source about to be replaced would optimise the wrong thing and spend the
hardening gate for nothing.

**One question to carry into that conversation:** whether any tier below
Enterprise can backfill. If none can, the gap between now and "proper APIs" is
history no subscription buys back, which is an input into *when* to subscribe.
Unverified -- check against vendor docs when comparing them.

---

## Beau's queue

Specific asks, newest first, kept in his order rather than re-ranked.

**Every item so far turned out to be partly built already**, so each is phrased
as *finish / wire / build the destination* rather than *create*. Checking first
has changed the scope of all three, and it is worth keeping that habit: this
codebase has more in it than either of us remembers.

### Q1 - FINISH the intake session card list  *(2026-07-28)*

**Not a new build - a wiring job.** The tables have existed since day one and
nothing has ever referenced them.

> "below 'photograph the card' on intake, a running list of the cards being
> added during this photo session. it will be interactive... a delete button,
> the card can be clicked which will bring up whatever information you have
> compiled for that card so far but someone may likely just be taking new
> photos so that can be done as well."
>
> "once we confirm to move on from the intake, this same menu of cards will be
> brought up where we will either just have the menu to move on or there will be
> some things that can be done such as grouping etc."

**What exists:** `card_intake_sessions` and `card_intake_items` are real tables
(`20260713 init`) - session with mode and item_count, items with photos,
`vision_raw`, `extracted`, `confidences`, `cert_lookup` and a status of
pending / needs_review / committed / discarded. **Nothing in `src/` references
either one.** The whole model was designed and then never wired up.

So this is not a new feature so much as connecting a table that has been sitting
there since the first day.

**Also relevant:** `SessionMenu.tsx` already does exactly this shape of UI for
PHOTOS within one card - a list you can reorder, delete from, and tap to
inspect. The card-level list is the same pattern one level up, and the
two-tap-to-discard rule should carry over: deleting a card that already has
photos throws work away.

**Open question:** the same list appears twice - during the session and again at
the confirm step. Is the second one the *same* component with more actions
enabled, or a distinct review screen? The first is less to build and less to
learn; the second gives room for grouping, bulk edits and a real "commit all"
gate. My read is same component, more actions - but say if you pictured a
separate screen.

### Q2 - WIRE "Add to Group" into the photograph step  *(2026-07-28)*

**Not a new build - the API is done.** Only the dropdown is missing.

> "a dropdown menu for 'Add to Group'. The dropdown menu will show all the
> current groups and then also have an add group button."

**This is mostly wiring.** `card_groups` and `card_group_items` exist, are RLS'd
per user, and `/api/cards/groups` already implements create, rename, delete,
add and remove. `CardBrowser` and the cards page already use it.

**ANSWERED 2026-07-28 - sticky, not session-scoped:**

> "when you set something, that setting will stay for that card and the
> following cards until you change it. let's also put an X to remove the data in
> a selection box to the right of each box."

Better than either option I offered. A session-wide setting cannot be changed
partway without either applying retroactively or silently not applying;
**sticky** means the value carries forward from the card where it was set,
every card keeps whatever was current when IT was captured, and changing it
mid-stack affects only what comes after. That is how a person actually works
through a box - the first thirty are from one purchase, then a different pile
starts.

And the X generalises: **every field in the photograph step gets a clear
control to its right**, not just the group. Sticky values need a way to say "not
this one" that is distinct from "I have not chosen yet" - without it, the only
way to clear an inherited value is to type over it, and there is no way at all
to say *none*.

So there are three states per field, and they need to be visually distinct:
inherited from the previous card, set explicitly on this card, and deliberately
cleared.

### Q3 - BUILD THE DESTINATION for Card Groups  *(2026-07-28)*

**Not a new build - groups already work underneath.** What is missing is a page
where a group is the thing you are looking at.

> "we also need to start a 'Card Groups' section anyways which will be what the
> add to group in the above paragraph works with."

**Already built, at least underneath.** Table, items table, RLS, full CRUD API,
and group filtering inside `CardBrowser`. What does not exist is a *destination*
- a page where groups are the primary object: rename, recolour, reorder, see
what is in one, act on all of it.

Worth deciding what a group IS before building the page, because the name is
doing a lot of work. A box you bought? A break? A consignor's cards? A
to-be-graded pile? Those want different fields. `card_lots` (sell-side bundles)
and `purchase_lots` (buy-side cost events) already exist and both overlap the
idea - the danger is three concepts that each half-answer the same question.

### Q4 - Nested groups, and a real tags system  *(2026-07-28)*

> "we will have groups that can have many levels of subgroups.... beyond that,
> we will have a tags system.. all of these options will be available during the
> photo process as well"

**Two findings that change this before it is designed.**

**1. "Tags" already exist, and they are not what you mean.** `TAG_FACETS` in
`lib/cards/types.ts` - RC, AUTO, PATCH, RPA, numbered, graded, PSA, BGS, SGC,
CGC - are **derived in code from card fields**, not authored by anyone. They are
filter facets. What you are describing is user-authored labels, which is a
different thing wearing the same word. Whatever gets built needs a name that
does not collide, or every conversation about "tags" from here is ambiguous.

**2. This reverses a recorded decision.** Migration `20260720020000` says, in
its own header: *"Tags themselves are DERIVED in code from card fields (no tag
table needed)."* That was a deliberate call. Reversing it is fine - the reason
was "we can compute these from what we already store", which simply does not
apply to a label someone invents - but per the standing rule it gets named
rather than quietly undone.

**What exists:** `card_groups` is FLAT - id, name, color, sort. No `parent_id`.
`card_group_items` is many-to-many (a card can be in several groups today).
Nesting needs a migration.

---

#### The question that decides the schema

**If a card can be in many groups, and groups nest, how is that different from
tags?**

That is not rhetorical. Hierarchical many-to-many membership *is* tags with
structure. If both are built without answering it, the same job gets done two
ways and neither is used consistently.

The version that stays coherent, and my recommendation:

- **A group is WHERE A CARD LIVES.** One parent, like a folder. "2024 buys >
  March > Cardboard box 3." Answers *where did this come from* and *where is it
  physically*. One card, one group.
- **A tag is WHAT A CARD IS.** Many per card, flat, user-invented. "to grade",
  "consignment - Dave", "eBay listed", "sentimental". Answers *what do I want to
  do with it*.

That split is worth having because the two get used at different moments: the
group is set once for a whole session at intake; tags accumulate over a card's
life.

**But it means changing `card_group_items` from many-to-many to one group per
card** - which is a real narrowing, and yours to accept or reject.

#### The other decisions, in the order they bite

1. **Does membership inherit?** A card in "2024 > March > Box 3" - is it in
   "2024"? Almost certainly yes for browsing, and it changes every count, every
   filter and every query in the app. This is the biggest one.
2. **How deep, really?** Unlimited nesting is trivial in the schema and
   punishing in the UI, especially one-handed mid-photo-session. Postgres
   `ltree` is purpose-built for exactly this and gives ancestor queries for
   free; an adjacency list plus a recursive CTE is the plainer alternative.
3. **Cycles must be impossible.** A group cannot be its own ancestor. Cheap to
   enforce in a trigger, expensive to discover later.
4. **The phone is the hard part, not the schema.** A tree picker on a phone
   while holding a card is bad. What probably works: the group is set ONCE at
   session start, shown as a breadcrumb, with recent and pinned groups surfaced
   first and search rather than tree navigation. Tags get a chip row with
   type-ahead.
5. **Deleting a parent.** Do children move up, or go with it? Deleting a group
   must never delete cards - `card_group_items` cascades on group delete today,
   which removes the *membership* only, and that is correct.

### Q5 - Three concepts, not one: facets, tags, and OWNERSHIP  *(2026-07-28)*

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
- **The 1099-K problem**, which the valuation research surfaced: the marketplace
  reports the consignor's full sale price as **your** gross. Reconciling to that
  form needs the sale booked as revenue and the payout booked as an expense, so
  the top line ties out. That is a double-entry problem, and it is precisely why
  competitors can ship "consignment tracking" and still not solve it.

**What exists:** `at_auction_house_on_consignment` is an asset state - that is
*your* card sitting at an auction house. **Outbound.** There is no concept
anywhere for *inbound* consignment - someone else's card in your hands.
`entity_id` covers which of *your* businesses owns a card, which is a different
axis again.

**So ownership belongs in the books layer, not the label layer.** A field on the
card, a party record for the consignor, terms (split, fees, due date), and it
flows through basis, valuation, sale and the ledger. The earlier research called
inbound consignment "months of work, and a CardOps-as-product decision rather
than a CardOps-for-Beau one" - that judgement stands.

**A cheap first step that is not the whole thing:** a nullable `owned_by`
pointing at a party, defaulting to you, that simply **excludes the card from
every total** when set. That is a day, it is honest, and it stops the worst
outcome - counting someone else's cards as your money - long before full
consignment accounting exists.

---

## What to build, ranked

### The one thing

**A forward money engine -- "what you keep."** Net proceeds, break-even ask, and
answer-this-offer, computed from basis that traces to a real row.

Everything money-shaped in CardOps today is written *after* the sale. The only
forward-looking number in the whole app is `suggestedListPrice()` in
`valuation.ts:285` -- `max(market, landed_cost x 1.15)`. A hardcoded 15% that
knows nothing about eBay's 13.25% final value fee, the per-order fee, promoted
listing rates, or which shipping service a card qualifies for.

- It is the question actually asked all day. Not *what is this worth* -- eBay
  answers that free now -- but *an offer came in at $340, do I take it.*
- It is the only feature that spends the moat **at the moment of decision**. A
  break-even that decomposes into "lot #7 draw $88 + grading $32 + shipping-in
  $4" is a sentence no competitor can produce, because none of them have a basis
  they could defend.
- It is a shared primitive, not a screen. The same fee-and-net function is the
  missing input in grade EV, the buy sheet, shipping-service choice, and the
  1099-K walk.
- The structural trick: the same pure function renders the forecast **and**
  feeds `cardSaleLines()`. After the sale it can show *"forecast net $412,
  actual $407, delta $5 -- fee tier changed."* That line requires the forecast
  and the booked journal entry to come out of one code path, and it is the
  clearest possible proof the numbers are real.
- No vendor, no API, no approval, no interlock. Fee schedules are public.

It must never pick the price or present a forecast as fact. It states which fee
schedule it used and that schedule's date, and it **refuses to render a
break-even at all** where `basis_entered` is false -- that card gets "no stated
basis", never a floor of $0.

**2-3 weeks.**

### The rest

| # | What | Effort |
|---|---|---|
| 1 | **Fix the grading fee reality.** Defaults are PSA 25 / BGS 22 / SGC 18 / CGC 18 + $8 ship; 2026 reality is PSA Economy $50, Regular $79.99, Value tiers paused since June. Worse, `GradeEV.tsx:125` captions it "~$20" while the engine uses 25 -- the screen misdescribes its own math. Add a tier picker so the answer is *which tier, or none*. | hours |
| 2 | **Price provenance on every displayed value.** A chip: which source, fetched when, how many sales it rests on. A cron-derived value and Beau's own 130point paste currently render with identical authority, and the paste is the honest one. The strongest single finding across six competitors: none of them show where the number came from. `MarketSaleRow` already carries `source` and `platform`. | 2-3 days |
| 3 | **The forward money engine** -- above. | 2-3 weeks |
| 4 | **Cert verification against PSA.** Intake already reads grader/grade/cert off the slab. `GetByCertNumber` is free and cert data never changes, so cache forever. Converts a vision guess into a checked fact, and catches the one fraud that costs resellers money. *Sources conflict on the free rate limit -- test with a live token before designing around volume. Population fields return null; do not plan on pop data.* | 2-3 days |
| 5 | **Year-end COGS close with a named exception list.** Beginning inventory + purchases - ending inventory, partitioned by SOURCE, read through `readAllSafe`. The differentiator is the header: *"debits = credits across 1,204 entries; 0 partial reads; 4 cards have no stated basis."* | ~1 week |
| 6 | **Close the grading loop.** (a) Replace the midpoint EV -- `grade-ev/route.ts:53` averages low and high, so the screen cannot say "expected +$61, but 30% of outcomes lose money". (b) `card_grading_submissions` **already exists and is dead** -- zero references in `src/`. Extend it to order level: grader, tier, order #, declared value, ship date. PSA Value Bulk is 140-160 *business* days, making a submission the longest-duration position in the business, and the app cannot see it at all. (c) Capture returned certs. *Migration -- never auto-merges.* | 2-4 weeks |
| 7 | **Free, complete, one-click export, stated as a promise.** `export.ts` exists; this is a page, a commitment, and a test that it is complete rather than capped at 1000 rows. CSV export is paywalled across the entire category. For a one-man product competing with funded incumbents this is the most credible trust signal available, and it costs almost nothing. | 2-3 days |
| 8 | **Bulk image ingest.** A folder or ZIP of flatbed images, fronts paired to backs, through the existing vision and identity trigger. A phone rig tops out at 80-120 cards/hour against 250/hour overhead. A 5,000-card collection buy currently never enters the system, or enters as an unpriced lump. **Hard constraint: identification-grade only, labelled as such -- it can never back a condition claim, because the geometry is not there.** | 2-3 weeks |
| 9 | **Review queue ranked by money at risk.** Not a better model -- triage. Surface the ambiguous /25 parallel first, auto-accept the base card, and when vision is torn between two identities name the discriminating attribute. Corrections write back to the shared catalog once, for everyone. The constraint is Beau's hours, not model accuracy. | 1-2 weeks |
| 10 | **Surface the capture record + a dispute pack.** Distance, angle, per-edge lock, sharpness and clipping are all measured and none of it is visible. Bundle a sold card's pre-ship set with timestamps and per-image sha256 (`evidence.ts` already hashes). *Audit first: `capture_meta` writes from two call sites only and `card_photos.width/height` are unpopulated, so this renders blanks for most of the library today.* | 1-2 weeks |
| 11 | **The buy sheet.** Scan a stack and get a defensible offer: matched identities at a chosen haircut, bulk residual stated separately, days-to-sell, and an explicit band for how much rests on weak matches. Depends on the money engine. Every other tool tells you what a card you own is worth; this tells you what to pay before you own it. | ~3 weeks |

**Below the line, named so they are not forgotten:** card-show offline mode (the
offline write must queue as a *proposed* transaction, never an auto-post); eBay
own-sales ingest for real fees and payouts (**blocked on the RuName / cutover**);
inbound consignment (months, and a CardOps-as-product decision rather than a
CardOps-for-Beau one -- decide it, do not drift into it).

## What not to build

- **Scanning and price guides as the headline.** eBay's own price guide is
  free, in-app, scans to the exact parallel, and added portfolios in June 2026.
  The venue where cards sell is giving away the layer others charge $10/mo for.
  Scanning must be good enough not to lose the deal; it can never be why you win.
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
  dead commercial category -- Collectable wound down Nov 2024, Dibbs Mar 2023,
  Mythic Markets 2021. Report what happened, never what will.
- **Grade estimates shown to a buyer.** Internal EV is the entire point. The
  moment "likely PSA 9" appears on a showcase or in listing copy it is a
  representation to a buyer about a third party's future act, using PSA marks.
  Every card that returns lower is a dispute. Keep it private.
- **A tax package that computes tax.** No rate applied, no form line numbers as
  headers, no ordering by tax advantage, no short/long label -- raw day counts,
  and classification shown as *"as classified by you on <date>: <reason>."* A
  once-a-year artifact used under deadline by someone whose CPA disagrees
  generates urgent March tickets forever.
- **An AI-grading accuracy race.** Photo quality matters more than the model.
  The defensible thing is the capture STANDARD — edge detection, deskew,
  sharpness gating, templates, retained originals with crop geometry. Market
  the standard and the evidence trail; never claim a percentage you cannot
  source.

---

## Confirmed gaps

| Gap | Why it matters |
|---|---|
| eBay integration is sell-side only | Nothing ingests purchases. Basis is born on the buy side. |
| Import is hardcoded | Fixed headers, no mapping UI; `card_format_profiles` never read. |
| AI confidence captured, nothing consumes it | No review queue, no record of "AI said X, corrected to Y". Unrecoverable retroactively. |
| Flat running average on mixed lump-sum buys | IRS Pub 551 prescribes relative-FMV allocation. `CLAUDE.md`'s claim needs narrowing to *bulk*. |
| 1099-K reverted to $20,000 **and** 200 transactions | Retroactive for TY2025–26. Most serious sellers now get **no form at all** — their own records *are* the tax record, with nothing to check them against. |
| Consignment inflates the 1099-K | The marketplace reports the consignor's full sale price as your gross. Reconciling is a double-entry problem. |
| PSA fee default of $25 | Off by ~4×, and it biases every grading decision toward yes. |

---

## Posture

These constrain every recommendation above and outrank any of them.

- **Never present a figure or an image as something it is not.** Grading
  evidence traces to what came off the sensor.
- **Tax classification is recorded, never determined.** The app stores Beau's
  call and his stated reason. It is bookkeeping hygiene and flags to raise with
  a CPA — never filing, never advice.
- **Money-critical and outward-facing writes are gated on explicit human
  decision.** Nothing posts to real books from a cron.
- **Surface merges or deletions that would lose work** rather than doing them.

---

## Open questions

- Metered pricing versus flat subscription — Beau's instinct against the
  research's recommendation. Not resolved, and does not need to be yet.
- Credits scoped per-org or per-user. Cheap to change now.
- Whether the multi-frame glare compositor is worth building at all — gated on
  a light measurement that has not been taken.

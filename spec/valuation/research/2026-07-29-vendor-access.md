# Vendor access — what automated sold comps actually cost

**Read 2026-07-29, against live pages.** Beau's ask: *"find out what options
there are regardless of what is necessary to get access."*

> [!info] Why this pass exists
> The previous pass concluded there was "no reachable, permitted API that sells
> third-party sold comps" and that pasting was therefore permanent. Beau's
> reaction was that the project looked pointless — *"if we can't get good sales
> data and determine accurate prices of scanned in cards and show where that data
> came from then i don't know what good we are."*
>
> **The premise was wrong.** That pass asked what was available for free and
> reported it as the map of what exists.

---

## The correction, in one line

**The API was already in the repo.** `src/lib/cards/price-sources/thecardapi.ts`,
shipped 2026-07-21, on the free tier with a **3-day lookback** — which produces
almost nothing, which got read as "does not exist."

---

## VERIFIED against thecardapi.com, 2026-07-29

Read directly from their docs, pricing and terms pages. Marked separately from
judgement.

### Plans

| Plan | Price | Sales rows/day | Lookback | Local storage |
|---|---|---|---|---|
| Free | $0 | 5,000 | 3 days | **None. Non-commercial and evaluation only.** |
| Starter | $9 | 10,000 | 14 days | 500,000 records, single commercial application |
| Builder | $49 | 50,000 | 30 days | 5,000,000 |
| Pro | $199 | 200,000 | 90 days | 25,000,000 |
| Enterprise | custom | custom | unlimited | per Data License Agreement |

**Add-ons** (Pro-gated unless noted): Unlimited Lookback **$99**, Full Daily
Feed **$99**, Webhooks **$9** (all paid plans).

Corrections to earlier notes: the daily figure is **rows returned, not API
calls** — CSV export draws from the same pool. The lookback is a **clamp on
`date_from`**, not a filter on what they index. Max 1,000 rows per request on
every plan. Enterprise exists and was missed.

### §4a — the clause that answers Beau's question

> Building and operating commercial applications, **SaaS products**, and internal
> tools powered by API data.
> Caching and storing API responses locally in your own database **to serve your
> users**, subject to the storage limits of your plan.
> Creating derived analytics, fair value estimates, price indexes,
> premium/discount models, portfolio valuations — **these are your intellectual
> property**.
> **Displaying card prices, transaction history, and market data within your own
> product interface.**

Multi-tenant SaaS, stored, re-displayed, with derived analytics owned by us. That
is the entire feature, permitted in writing. **"A single commercial application"
on Starter reads as one APP, not one user** — §4a names SaaS products serving
"your users" in the same breath. Worth confirming in writing anyway; it is
load-bearing.

### §4 — what is forbidden

Reselling the records as a standalone dataset or competing data product; exposing
them through our own public API for bulk extraction; building a data product
"whose primary commercial function is to license trading card market data to
third parties"; licensing an ML model trained substantially on their data as a
substitute for it — **"use of trained models within your own product is
permitted."**

CardOps is squarely inside the permitted set. Storing sales against a shared
identity so every owner of that card sees them is the caching case §4a describes,
not the redistribution case §4 bars.

### §5 and §7 — the two obligations nobody had built for

- **"Upon cancellation or termination of your subscription, all locally stored
  records must be deleted within 30 days."** Only executable if stored rows carry
  their source. They now do, and `card_market_sales_source_idx` exists to find
  them.
- **"We make no representation that your receipt or use of this data complies
  with the terms of service of eBay, any auction house, or any other third-party
  marketplace."** This is the real risk in one sentence, and it applies to every
  cheap vendor equally. Nobody will warrant the upstream licence. An indemnity
  clause is worth more than a discount.

### Field-level facts that changed the code

| Field | What it says | What it fixed |
|---|---|---|
| `price` | *"For eBay: all-in buyer price. For Goldin: hammer price only — buyer also pays ~22% buyer's premium on top"* (~20% pre-2022) | We were medianing hammer against all-in. Now converted, with undocumented houses (Lelands, SCP, Hakes, REA) **excluded and counted** rather than assumed. |
| `price_confirmed` | *"false = fast-settle estimate, updated to true within minutes"* | We stored provisional prices. The accumulator upserts with `ignoreDuplicates`, so one would never be corrected. Now held back. |
| `grader` / `grade` | **~12% populated** | The distill inferred "raw" from a missing grader, so ~88% of graded sales counted as raw comps and inflated ungraded values. Now uses the server-side `graded` filter. |
| `platform` | eBay · Goldin · Lelands · SCP · Hakes · REA · TCGplayer | Only three have a documented basis. |
| `indexed_after` + `cursor` | incremental sync, no offset drift | The primitive for the accumulator. |
| `player` / `card_set` / `year` | **~0.3-0.4% populated** | Catalogue matching is unusable; `q` searches the listing TITLE, which is 100% populated. Our `saleQuery()` already does this. |

### The Full Daily Feed is not what I assumed

> **Full Daily Feed ($99/mo)** — unlimited pulls for `sale_date = yesterday`.
> Your normal daily cap still applies to all other date ranges.

So it is a **supply-side firehose for yesterday**, not a bulk history dump. That
still confirms the architecture — a daily job pulls every sale from yesterday,
warming cards nobody owns yet — but the shape matters for the job design.

**Webhooks ($9/mo, all paid plans)** are the bigger find: *"every new card sale
pushed to them within seconds of indexing"*, batches of 1,000, HMAC-signed,
cursor advances so nothing is missed or duplicated. Whether webhook deliveries
count against the daily row cap is **not stated** — and if they don't, the
economics change a lot. **Ask.**

---

## The other routes, ranked

Everything below was found by the same pass; the top two are what I would
actually buy.

| Route | Gives | Cost | Verdict |
|---|---|---|---|
| **The Card API paid tier** | realized sales, sports + TCG, full provenance fields | $9 → $298 | **Already integrated. Start here.** |
| **eBay Fulfillment API** | each user's OWN settled sales, ~2yr, incl. accepted offers, net of fees | **$0** | Certain. Blocked only on adding a CardOps redirect URI in eBay's portal. |
| **CardSight AI** | completed sales + BIN asks | $199.95/100K calls | **Display only — §3.b forbids storing "for the purposes of creating or populating a database"; §3.c permits a short-term purged cache.** Live cross-check, never a corpus. Excludes market data from indemnity, caps liability ~$900. |
| **Cardmarket API** | genuine sold averages (AVG1/7/30), TCG, Europe | free | Sanctioned door, overlooked because it is European. |
| **JustTCG** | current prices, 18+ TCGs, no sports, no history | $19 | Notable only because its redistribution terms are published and good — **use its wording as the template for what to demand of others.** |
| **Auction houses direct** | prices realized from venues eBay never sees | ~$0, paid in attribution | Complementary corpus; strongest exactly where eBay comps are worst (vintage). |
| **Card Hedge** | real eBay-sourced comps incl. accepted offers, ~$0.01-0.02/call | $49+ | **Refuted for production.** Published terms grant no storage or re-display. Their ToS "Effective Date" renders as `new Date()` — today's date on every load — so you can never prove which version you accepted. |
| **Card Ladder** | 100M+ sales, deepest corpus | unpublished | Low. And the premise was stale: **Collectors sold Goldin to eBay on 10 April 2024**, so they own none of Card Ladder's comp sources and have no better warranty position than the cheap vendors. |
| **eBay Marketplace Insights** | 90 days of third-party sold comps | — | **Structurally closed.** Runs through eBay Partner Network; the published requirement is affiliate tracking for revenue share. The Buy APIs are a buyer-acquisition channel and a private inventory tool has no funnel to offer. No budget changes this. 90 days couldn't answer "what did this card do last year" anyway. |
| Scraping intermediaries | cheap bulk completed sales | $0-79 | **Listed only to be ruled out.** eBay's terms ban automated access and named LLM-driven bots on 2026-02-20; hiQ lost to LinkedIn on breach of contract for $500K. |

### The gate behind every eBay route

eBay's standard API License Agreement, under RESTRICTED ACTIVITIES, verified
word-for-word:

> Use eBay Content, either alone or in combination with third-party content, to
> suggest or model prices for items listed on eBay Site

§8.5 is the only carve-out, and its consideration is a *"non-exclusive,
transferable, sublicensable, royalty-free, **irrevocable**, worldwide"* licence
to your tool and its outputs, granted to eBay, with eBay free to compete. **Not
a door worth walking through.**

### The consented pool — split verdict

**Forbidden** for data pulled from eBay's API, and the agreement anticipates the
consent argument by name: *"Notwithstanding Your Users' access to and use of
their own information..."*

**Its own carve-out is the other half:** *"eBay Content does not include
information that you lawfully obtain independent of eBay."* A Seller Hub Orders
export the user downloads and uploads is not something we obtained from eBay.

**Judgement, not advice:** that reads as permitting a pool built from
user-uploaded exports and forbidding one built from API pulls. Worth one paid
hour of counsel before any schema — the cheapest legal spend on this page.

**Scale, honestly:** eBay did **$2.32B in card singles in H1 2026**, on the order
of 400-500K transactions a day. A thousand contributing sellers at 500 sales/year
is 500K records/year against a corpus need in the tens of millions. **It will not
price the long tail this decade.** It will price the head, because sales
concentrate viciously. Sell it as **corroboration** — "3 network sales agree with
the vendor comp" — and it is honest and useful on day one. Sell it as the pricing
source and it is vapour.

The only precedent for this shape anywhere is **CompStak** in commercial real
estate: contribute your comps, earn credits, spend credits to see others'.
Nobody has built it in cards.

---

## Emails to send — DRAFTED, NOT SENT

### 1. The Card API — `hello@thecardapi.com` (the important one)

> Subject: Commercial licensing questions before upgrading
>
> Hi — I run CardOps, a trading-card inventory and cost-basis application. I'm on
> the free tier and planning to move up. Four questions before I do, because my
> product displays the provenance of every price it shows.
>
> 1. §5 gives Starter "up to 500,000 transaction records stored locally to power
>    a single commercial application." My application is **multi-tenant** — one
>    application, many paying end users. Does that wording cover it? §4a names
>    SaaS products and storing responses "to serve your users", which reads as
>    yes, but I'd like it confirmed.
> 2. **Do derived aggregates count against the storage cap?** I compact
>    individual sales into per-card statistical rollups — median, count, window —
>    and delete the underlying rows. §4a says derived analytics are my IP. Are
>    rollups outside the record count?
> 3. **Do Webhook deliveries draw on the daily sales-row budget?** The rate-limit
>    page says the only enforced limits are rows returned per day and lookback,
>    and doesn't mention webhooks either way.
> 4. **Full Daily Feed**: what volume should I expect per day, and is
>    `sale_date = yesterday` the full set of everything you index that day or a
>    subset?
>
> Two more, on risk. §7 says you make no representation that use of the data
> complies with eBay's or an auction house's terms. **Can you tell me the
> licensing basis on which you obtain and redistribute eBay-sourced sales**, and
> **will you offer an indemnity** covering third-party claims arising from my
> licensed use — at which tier and what price?
>
> Finally: what does Enterprise cost, and what does it add beyond removing caps?
>
> One data question: your field reference documents eBay as all-in and Goldin as
> hammer plus ~22%. **What is the basis for Lelands, SCP Auctions, Hakes and
> REA?** I currently exclude those sales from valuations because I can't cite a
> premium rate, which throws away good data.
>
> Happy to sign an NDA. Thanks.

### 2. Auction houses — REA, Memory Lane, Mile High, Huggins & Scott, Love of the Game

> Subject: Linking to your prices realized from a card inventory app
>
> Hi — I build CardOps, an inventory and valuation tool for card collectors and
> dealers. When we show a collector what their card is worth, we show exactly
> where each comparable sale came from, with a link back to the source.
>
> I'd like to include your prices realized. Would you provide your past auction
> results as a CSV or feed? In exchange every result we display carries your name
> and links back to your lot page — sending collectors to your archive and your
> consignment page.
>
> Happy to work to whatever attribution requirements you want. What would you
> need from me?
>
> One technical question: do your published prices realized include the buyer's
> premium, or is it hammer only? I normalize everything to what the buyer
> actually paid, and I exclude sources I can't convert.

### 3. Card Ladder — `contact@cardladder.com`. One email, expect no.

> Subject: Data licensing enquiry
>
> Hi — does Card Ladder offer any commercial or enterprise data licence? Three
> questions: (1) does one exist at all; (2) would it permit storage and
> re-display of individual sale records to third-party end users; (3) can you
> warrant sublicensing rights for the eBay-sourced portion?
>
> If the answer to (1) is no, just say so and I'll stop asking. Thanks.

---

## What to do first

**The $9 coverage test, and nothing before it.** Upgrade to Starter, run
`fetchCardApiSales()` against 50 cards whose true value you know — graded and
raw, sports and Pokémon, modern and vintage — and **count how many return a
matched quote.** That number decides whether you are negotiating for coverage or
for depth, and those are different conversations. It also lifts the free-tier
storage problem as a side effect.

**Also free:** add a CardOps redirect URI in eBay's developer portal
(unblocks Fulfillment — users' own sales, zero legal risk, and it does not touch
the cutover interlock; `CRON_SECRET` stays unset). Register a Cardmarket app.
Get a PSA API token.

---

## What this changed in the code, same day

- `ObservedSale` as the internal sale shape, so no vendor's wire format is the
  app's type. `fetchSales?` on the adapter contract — a paste parser or CSV
  import satisfies it identically.
- `rights` on every source: persist / redisplay / pool / attribution /
  deleteOnTerminationDays, consulted by the write path, **default-deny**.
- `price-basis`: hammer → all-in at cited rates; undocumented venues excluded and
  reported.
- Provisional prices no longer stored; the `graded` filter asked server-side.
- Provenance chips: source, count, window, freshness, and the sales themselves.
- Migration `20260750`: `provenance`, `added_by`, `price_basis`, `fetched_at`,
  `is_graded`, plus `card_market_rollups` as the cold tier. **Unapplied.**

## Still unknown

- Webhook deliveries vs the daily cap. **Highest-value question on the page.**
- Whether rollups count against the storage cap.
- The basis for Lelands / SCP / Hakes / REA.
- Whether "a single commercial application" survives a multi-tenant reading in
  writing rather than by inference.
- CardSight's sales-history depth — measure on the free tier, don't ask.

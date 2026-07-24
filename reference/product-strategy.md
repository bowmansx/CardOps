# CardOps Product Strategy

*Prepared for Beau · 2026-07-19 · Reference document*

This is a build-and-buy plan grounded in what's actually possible as of mid-2026. Where a source you asked for has no legitimate path, I say so plainly rather than promise a scrape that will break and put money-critical pricing at risk. Verified facts are marked; anything I couldn't confirm is flagged **[unverified]**.

The single most important honest finding up front, because it reshapes two of your asks:

> **There is no Card Ladder API, and your Card Ladder Pro subscription grants zero programmatic access.** A "Card Ladder enterprise API" is rumored on third-party marketing blogs but is **not confirmed to exist** on Card Ladder's own site or GitHub. **Cardbase has no API at all.** Both of your named "pull from X" sources are, today, view-only. This document routes around that reality instead of pretending otherwise.

---

## 1. Your requested features — how we build them & what we need

### 1a. AI-generated descriptions

**What it is:** Auto-write listing copy from the card's identity + condition + the vision tags you already extract, in a consistent house voice, with an optional condition disclaimer.

**Build plan:**
- New `generateDescription(card, opts)` service that feeds the already-captured fields (year, set, player, parallel, #'d, RC/AUTO/PATCH chips, grade/cert, condition notes) into a model call. You already run vision + Card Intel, so this is a third prompt template, not new infrastructure.
- Settings (see §6): tone (professional / enthusiast / minimal), target length + skeleton, auto-append "see photos for condition" disclaimer, and a **house-rules prompt addendum** so your grading/pricing philosophy is baked into every description.
- Cache the generated text on the listing; regenerate only on explicit tap or field change (cost control).
- Wire it into the eBay Hub list/relist flow and the Whatnot CSV export so the same copy flows everywhere.

**Prerequisites from you:** Nothing external. This runs on your existing AI spend. Decide a default tone and whether descriptions auto-generate at intake (spend) or on-demand (cheaper — recommended default: **on-demand**).

### 1b. The −99% / +500% price slider with discount-in-description

**What it is:** On any listing, a slider that sets price as a percentage of the computed comp value — from 99% below to 500% above — and, when you price *below* comp, automatically states the discount in the description ("Priced 15% under recent market comps").

**Build plan:**
- Store two numbers on every listing: the **anchor** (the pricing-engine comp value at the moment you set it) and a **slider multiplier**. List price = `anchor × (1 + sliderPct)`. Keep the anchor frozen so the displayed discount stays truthful even as comps drift; add a "re-anchor" button to refresh it.
- When `sliderPct < 0`, inject a templated discount line into the AI description. Make the phrasing a setting (percentage vs. dollar vs. "priced to move").
- Show live margin math beside the slider: landed cost, this price, gross margin %, and a **red flag if the price drops below your cost-basis floor** (you already have a list-price floor multiple setting — enforce it here).

**Honest caveat / prerequisite:** Putting "X% below comp" in your own free-text description is fine. **Do not** wire this into eBay's official strikethrough "Sale"/markdown reference-price feature — that has genuine-reference-price rules and can trigger policy strikes if the "was" price isn't a real prior price. Keep the discount claim in description copy, not in eBay's structured markdown field. No external signup needed.

### 1c. Multi-card grouped / lot sales

**What it is:** Bundle N inventory cards into one sellable unit (a "lot"), price and list it as one item, and on sale mark every child card sold with correct cost-basis and tax splits.

**Build plan:**
- New **Lot** entity: a container referencing child inventory IDs, with its own SKU, photos, status, and listing link. Children flip to a `in-lot` status so they can't be double-listed.
- **Lot pricing:** sum of child comp values × a lot-discount factor (lots sell under sum-of-singles), then run it through the same slider. Show both "sum of singles" and "lot ask" so you see the discount you're giving.
- **Lot cost basis:** sum of the children's pooled/individual basis. On sale, allocate proceeds across children *pro-rata by their individual comp value* so per-card realized P&L, the tax reports, and sale-reversal all stay correct. This is the piece that must not be sloppy — it feeds your year-end reports.
- **Reversal:** a lot sale reversal must re-open all children and unwind the proportional allocation atomically.
- Bulk-select in inventory → "Create lot" is the intake path.

**Prerequisites from you:** A decision on default lot-discount factor (suggest 0.85× sum-of-singles as the seed) and whether lots are allowed to mix entities/consignors (recommend: no mixing across owners — it corrupts cost-basis).

### 1d. Cardbase / Card Ladder integration

This is where I have to be straight with you.

**Card Ladder (you subscribe to Pro, $20/mo — VERIFIED):**
- Pro is a **consumer web subscription. It includes no API.** Verified against Card Ladder's own GitHub org (one empty marketing repo — no SDK, no endpoints, no docs).
- A "business/enterprise API" is asserted only by a third-party blog; **its existence is unverified** and Card Ladder advertises no API product at any tier. The "SGC daily pop feed" people cite is data flowing *into* Card Ladder, not out.
- **Legitimate paths:** (a) Email Card Ladder business development and ask, in writing, whether any data-licensing arrangement exists and at what cost — treat a real quote as the only proof it exists. (b) Until then, Card Ladder data is **view-only in your Pro account**. Do **not** scrape the logged-in app into a money-critical pricing engine — it's a ToS violation, it's unstable, and it's your business's valuation backbone.
- **The pragmatic move:** replicate *what you actually want from Card Ladder* — multi-marketplace sold comps including Goldin/Heritage/Fanatics, which eBay alone misses — from sources that *do* have sanctioned feeds (see §2). You keep Card Ladder Pro open on a second monitor as your human sanity-check benchmark.

**Cardbase:**
- **No public or developer API exists** (VERIFIED — nothing documented anywhere as of mid-2026). Their only disclosed integration is an eBay affiliate relationship. ~13.5M-card database, but it's a consumer app, not a data vendor.
- **Likely conflation:** Cardbase and Card Ladder are separate, competing companies with no data relationship. If what you pictured was "one big price database," Card Ladder (sales) or SportsCardsPro (values) is the closer fit.
- **Path:** email Cardbase to ask about a partner/API program; otherwise treat as manual reference only. Do not build scraping into CardOps.

**Bottom line for §1d:** Budget these as *outbound emails to send*, not features to build this quarter. The value you associate with them gets delivered by the sources in §2 that actually have keys.

---

## 2. Data sources — integration matrix

Costs and tiers are VERIFIED from vendor pricing pages except where marked **[unverified]**. "Integrate now" = sanctioned, self-serve, high value. PSA kept intentionally light (separate research task).

| Source | API status | Data it gives | Cost (verified unless noted) | Recommendation |
|---|---|---|---|---|
| **eBay Browse API** | Official, GA | Active/live listings only (title, price, condition, seller, URL). **No sold data.** | Free; ~5,000 calls/day default cap; standard OAuth | **Integrate now** (you likely already use it) — powers "deals" scanner + live-supply depth |
| **eBay Marketplace Insights** | Official, **gated** | Real sold/completed comps (price, date, condition) — the canonical eBay solds feed | Free API but **production access routinely denied to small devs** (VERIFIED). Apply via your existing eBay app | **Apply now, plan for denial.** If approved it's your best sold feed; if not, fall back to a sold-comps vendor |
| **The Card API** (thecardapi.com) | Official 3rd-party, self-serve | eBay SOLD comps (price, date, title), card-specialized | Free 5k records/day (3-day lookback); Starter $9; Builder $49; Pro $199/mo | **Integrate now** as the eBay-solds fallback — no approval, instant key |
| **SoldComps** (sold-comps.com) | Official 3rd-party, self-serve | eBay completed sales, up to 240/call, full fields incl. Best-Offer | Free 100/mo; Starter $9; Growth $29; Scale $79/mo | **Integrate now / alt.** Cheapest general eBay-solds; billed per search |
| **SportsCardsPro** (PriceCharting's sports sister) | Official, self-serve | **Current** raw + graded (PSA/BGS) values for sports; CSV bulk | Paid sub, 40-char token; CSV gated to top "Legendary" tier; exact $ **[unverified]** | **Integrate now** — best sanctioned graded-*sports* current-value baseline. Same backend as PriceCharting |
| **PriceCharting** | Official, self-serve | Current values across grades for TCG + games + some sports; CSV. **No sales history via API** (VERIFIED) | Paid sub, token auth, integer-penny JSON; $ **[unverified]** (403 on pricing page) | **Integrate now** as a cross-category "guide value" source; pair with a solds feed for history |
| **CardHedger AI** | Official, self-serve | Aggregated pricing + historical sales + analytics (eBay, Fanatics, Heritage), card DB | From $49/mo, 7-day trial; X-API-Key; pay-per-call ~$0.01 option | **Consider (later)** — one-vendor alternative to stitching many feeds; evaluate quality vs. Card Ladder |
| **JustTCG** | Official 3rd-party, self-serve | Live TCG prices (MTG/Pokémon/YGO/Lorcana/One Piece…) | Free 1,000/mo; Starter $19; Pro $49; Enterprise $149/mo | **Integrate now** for TCG pricing (TCGplayer is closed) |
| **tcgapi.dev** | Official 3rd-party, self-serve | TCG catalog + prices + sales velocity/history (Pro tier) | Free 100/day; Hobby $9.99; Starter $19.99; Pro $49.99; Business $99.99/mo | **Integrate now / alt** to JustTCG — vet coverage vs. your TCG inventory |
| **TCGplayer API** (official) | Official but **closed** | Full TCG catalog + market/low/mid/high | Free — but **"no longer granting new API access"** (VERIFIED official notice) | **Skip** unless you already hold a legacy key |
| **TCGdex** | Official, free | TCG **catalog/metadata only — NO prices** (VERIFIED) | Free, no key | **Integrate (light)** as a free catalog/image backbone; not a price source |
| **Scryfall** (MTG) | Official, free | Full MTG catalog, variants, images, per-card prices; daily bulk | Free, no key; descriptive User-Agent, cache 24h, <10 req/s | **Integrate now** for any MTG identity/pricing baseline |
| **Pokémon TCG API** (pokemontcg.io) | Official, free/keyed | Pokémon card + set data, images; price *pointers* only | Free (low limits); free key for higher limits | **Integrate now** for Pokémon identity; join to JustTCG/PriceCharting for live price |
| **130point** | Scrape only | eBay + auction-house solds incl. Best-Offer-accepted prices | Free web + iOS/Android app; **no API** (VERIFIED) | **Skip automation** — human lookup only; replicate its value via eBay Insights + a solds vendor |
| **Fanatics Collect + Goldin** | Scrape only | High-end auction results (final price, buyer's premium, grade-normalized) | No official API; Apify actors, pay-per-event; ToS/stability risk (VERIFIED) | **Later, cautiously** — the high-end comps eBay misses. Prefer sourcing via a real feed; flag legal/stability risk before wiring to money |
| **COMC Suggested Prices** | Scrape/on-site only | Retail / optimal-list / quick-sell suggestions | ~$99/yr subscription; **no documented API** (VERIFIED) | **Skip** for automation; manual reference at best |
| **GemRate** (pop) | Official **Partner API** (docs at gemrate.stoplight.io) | Unified pop across PSA/BGS/SGC/CGC in one call; cross-grader "universal IDs"; gem-rate % | Partnership-gated; pricing not public **[unverified]** | **Pursue (later)** — single best cross-grader pop source; universal IDs normalize comps across graders |
| **PSA public API** | Official, narrow | **Cert verification by cert# ONLY** — no pop, no grading history via API (VERIFIED correction); pop is scrape-only | Free token now throttled to ~1 call/day; paid plan required | **Light** — see separate PSA task |
| **CGC cards pop** | Scrape only | CGC census (strong for TCG/Pokémon) | No official API; the commonly-cited Apify actor is **comics, not cards** (VERIFIED correction) — needs custom scrape | **Later, via GemRate** rather than a bespoke scrape |
| **Beckett/BGS pop** | Scrape only | BGS sub-grades (centering/corners/edges/surface) + counts | No API; Apify ~$0.10/run + ~$0.0015/record, or GemRate | **Later, via GemRate** — sub-grades feed your grade estimator |
| **SGC pop** | Scrape only | SGC cert + pop | No API; cheapest via GemRate | **Later, via GemRate** |
| **TCDB** | Scrape/wrapper | Broadest sports + TCG checklists/parallels | No official API; Parse.bot wrapper **[unverified]** | **Later** — fills vintage/insert checklist gaps; validates vision self-tags |
| **Riftbound sources** | Mixed | LoL TCG checklists/prices (Origins etc.) | Piltover Archive API terms **[unverified]**; TCDB checklists | **Later** — emerging-set coverage before mainstream APIs catch up |
| **balldontlie** (stats) | Official, freemium | NBA/NFL/MLB/NHL/WNBA/EPL+ player/team stats | Free tier + paid; API-key | **Integrate now (cheap)** — powers Card Intel "player broke out" signals |
| **MySportsFeeds** | Official | Scores, injuries, lineups | Free non-commercial; **paid for commercial** | **Alt** to balldontlie; injuries move prospect prices |
| **SportsDataIO / API-Sports** | Official, commercial | Deep stats + **prospect/minor-league** + projections | Tiered paid, free trial | **Later** — prospect data drives baseball speculation buys |
| **Whatnot Seller API** | Official but **closed** | Product mgmt + sold webhooks | Developer Preview, **not accepting applicants** (VERIFIED) | **Watch** — you already do CSV export; real two-way sync when it opens. Apify for demand signals meanwhile |
| **Card Ladder** | **No API** (VERIFIED) | 100M+ multi-marketplace solds, indexes, value estimates | Pro $20/mo = view-only; enterprise API existence **unverified** | **Email BD; do not scrape.** Replicate via other feeds |
| **Cardbase** | **No API** (VERIFIED) | ~13.5M-card DB, 30+ marketplace aggregation | Consumer app only | **Email; manual reference only** |
| **Alt / Altan Insights** | **[unverified]** | High-end valuations/index | No documented API | **Skip** — lowest confidence; Card Ladder covers the ground |
| **Beckett OPG / Market Data** | No API | Book values + sales report | Consumer sub only | **Skip automation** — manual if you want book values shown |

---

## 3. Competitive gaps worth closing

Features rivals (Card Ladder, Market Movers, Cardbase, CollX, Mantel, Arena Club, Whatnot) ship that CardOps should adopt, roughly in priority order:

1. **Portfolio value-over-time dashboard (index graph).** The #1 "why I open the app daily" feature in the category and the primary retention hook for Card Ladder. You have cost-basis + a pricing engine already; this is a nightly snapshot job + a chart. **Highest-priority gap.**
2. **Price alerts + watchlist.** Target price on any card (owned or wanted) → notify on drop/spike. Sits on the existing engine + a cron. Cheap, high daily use, direct buy/sell triggers.
3. **Underpriced-listing / "deals" finder.** Continuously diff live eBay Browse prices against your own comp; surface anything ≥X% under. You uniquely have self-tagging + comp engine + eBay access — few competitors combine all three.
4. **Market-movers / trend leaderboard.** Biggest %± gainers/losers over 7/30/90d by sport/set/player. Requires storing historical comps (start now so history accrues).
5. **Sell-through / seller analytics.** Days-to-sell, margin by category/price band, aged-inventory flags — a reporting layer over the transaction history you already keep for taxes.
6. **Slab cert / barcode scan auto-import.** Scan the label → pull exact card + grade + cert. Small add to your vision pipeline; error-free graded intake.
7. **Release calendar.** Upcoming product dates + reminders. Cheap, drives buy/pre-order planning.
8. **Shareable public storefront.** A branded gallery link to drop on socials/Whatnot; take offers off-marketplace to dodge fees. Public read view over inventory.
9. **Multi-source comp aggregation.** Add Goldin/Heritage/Fanatics solds beyond eBay (via §2 feeds) — matters most on expensive cards where eBay understates.
10. **Sealed wax as a tracked asset class.** Boxes/cases with their own comp + trend. Extends the schema; many resellers hold sealed.
11. **Broader cross-listing + auto-delist-on-sale.** More channels (MySlabs has *no* final-value fee for slabs) = faster sell-through; auto-delist prevents oversells — the piece rivals handle worst.
12. **AI pre-grade condition heatmap.** Overlay corner/edge/centering/surface flaws with a confidence range — the trust layer on your existing grade estimate.

---

## 4. Novel features & blind spots — ranked by value-to-effort

**Tier 1 — build these (high value, moderate effort, defensible):**

1. **Grade-or-Flip EV Engine** *(effort L, never-done).* For any raw card, combine your grade estimator's **probability distribution** (not a point guess) × live graded comps − each grader's real fee/turnaround/shipping → expected profit for PSA vs. SGC vs. BGS vs. CGC vs. "stay raw," with the break-even grade. This is the decision you make dozens of times a week, nobody does it net-of-everything with a grade *distribution*, and it fuses two things you already own. **The single strongest moat in this list.**
2. **Liquidity / Velocity Score** *(effort M, competitive).* Every card gets an expected-days-to-sell + sell-through score from comp cadence, shown next to price; pricing UI lets you pick "sell in 7 days" vs. "max price." Reframes inventory around **margin-per-day-of-capital** — the metric resellers ignore. Sticky and opinionated.
3. **Cash-Conversion / Capital-at-Work dashboard** *(effort M, novel).* Shows dollars stuck in unlisted intake, listed inventory, **grading limbo (90 days out)**, and unpaid payouts, with aging buckets and a dead-stock heatmap + suggested liquidation list. Makes the invisible "my money's in a PSA drawer" visible. **Blind spot Beau almost certainly hasn't built.**
4. **Insurance-Ready Valuation Export** *(effort S, novel).* One-click timestamped itemized inventory valuation at current comp, formatted for a collectibles rider or loss claim. Tiny build, outsized peace-of-mind, easy upsell. High-value inventory is usually uninsured because valuing it is a nightmare — you already have the values.
5. **Pop-Report Drop Early-Warning** *(effort M, novel).* Watch pop reports on cards you hold; alert when a pop spikes (grading wave / bulk sub) = supply about to flood = "consider selling now." Turns pop data into a *forward* sell signal. (Cross-grader supply signal — keeps PSA light.)

**Tier 2 — strong, heavier or needs validation:**

6. **Portfolio Mark-to-Market NAV + Exposure dashboard** *(L).* Robinhood-style NAV chart + concentration flags ("61% of your capital is in 2024 rookies; 38% is one player"). Daily-open habit + genuine risk blind spot (people get wiped when one player craters).
7. **Comp-to-Ask Sniper / sourcing agent** *(L).* Standing saved-searches that alert the instant an ask drops below X% of *your* model, filtered by margin target and available cash; optional auto-draft Best Offer. Always-on deal firehose that learns your buy box.
8. **Sourcing-Channel ROI Attribution** *(M).* Tag every acquisition's source (this show, that break, LCS, eBay) → realized ROI + days-to-flip by channel. Tells you whether your Tuesday break habit actually makes money. Compounds as history builds.
9. **Best-Offer Auto-Negotiation Bot** *(M).* Floor + curve → auto-accept/decline/counter with aging-aware floors; escalate edge cases only. Reclaims hours, captures margin impatient sellers leave behind.
10. **Consignor Portal & Payout Ledger** *(L, novel).* Take in others' cards with split % and per-consignor live statements. Converts solo reseller → consignment business and makes CardOps the system of record others depend on — **huge switching-cost moat**, natural per-seat/% upsell.
11. **Anonymous Peer Benchmark Network** *(L, never-done).* Opt-in pooled anonymized margins/sell-through/exposure vs. peer median ("your Prizm basketball margin is 12% below network"). **Data-network-effect moat** — only exists because you have many users, can't be cloned.

**Tier 3 — big bets, gate on demand:**

12. **Shipping Decision + Dispute Evidence Pack** *(M).* PWE/BMWE/tracked recommendation + timestamped packing-photo/weight bundle stored on the order for INR/SNAD/chargeback defense. Boring-but-beloved.
13. **Buyer & Chargeback Risk Scoring** *(L).* Score offers for dispute likelihood (feedback, account age, order value, network-wide bad-actor signal). Sharpens with the peer network.
14. **1099-K & Multi-Platform Cost-Basis Reconciler** *(L).* Reconcile eBay/Whatnot sales to each 1099-K, apply FIFO/specific-ID from your pool, output Schedule-C-ready P&L. **January renewal anchor** — extends your existing reports into real accounting.
15. **Pre-Purchase Fake/Trim/Alteration Detector** *(XL, never-done).* AI flags counterfeit/reprint/trimmed cards at *buy* time. Catching one $400 mistake pays a year of subscription — but XL and hard.
16. **Live-Break EV Scanner** *(XL, never-done).* Point the app at a live break; parse checklist + per-spot hit odds vs. ask. Signature, share-worthy, pulls the Whatnot crowd — but only if your users actually break.
17. **Voice + Bulk-Photo Intake** *(L).* Dictate while sorting; lay out a shoebox for one bulk-photo pass that values the lot with confidence bands and marks keepers vs. bulk. Kills the #1 workflow bottleneck → data lock-in.

**Blind spots Beau likely hasn't considered (the theme across the above):** capital velocity over headline price; concentration/exposure risk; grading-limbo cash drag; uninsured high-value inventory; pop-report supply shocks; and which *sourcing channels* actually make money vs. just feel productive.

---

## 5. The subscription thesis — what makes this worth a monthly bill

CardOps should not sell "a place to log cards" — that's a spreadsheet. The recurring bill is justified by **decisions that make or save more money each month than the subscription costs**, plus **data and workflow lock-in a competitor can't replicate**. The moat has four layers:

1. **The fused-data moat (hardest to copy).** You are the only tool that already owns *all* of: AI vision self-tagging, a configurable comp engine, per-company grade estimation, and eBay execution. The **Grade-or-Flip EV Engine** (§4.1) exists *because* you have both a grade distribution and a graded-vs-raw comp engine — Card Ladder can't build it (no grade estimator), CardGrader can't (no comp engine + execution). That's a genuine, defensible product no competitor can ship by adding one feature.

2. **The daily-habit moat (retention).** The Portfolio NAV chart (§3.1, §4.6), price alerts, and the deals sniper give a reason to open the app on days you're neither buying nor selling. Daily opens are what keep Card Ladder's $20/mo alive; you match it and add execution they don't have.

3. **The money-in-your-pocket moat (willingness to pay).** Every Tier-1 feature is denominated in dollars: EV engine tells you when grading pays, velocity score frees dead capital, deals sniper finds arbitrage, cash-conversion dashboard unsticks money, pop-drop warning saves you from a crater. A tool that makes a reseller an extra few hundred a month is a trivial $20–50/mo decision.

4. **The switching-cost + network moat (long-term).** The Consignor Portal makes *other people* depend on CardOps as system-of-record. The Peer Benchmark Network and Buyer-Risk scoring get better as you add users and literally cannot be cloned by a solo competitor. Bulk/voice intake creates data lock-in that powers everything else.

**The one-sentence pitch:** *CardOps is the only app that watches your whole book like a portfolio, tells you the profit-maximizing move on every card (grade it, flip it, hold it, or dump it) net of every fee, and executes the listing — so it pays for itself in a week and gets smarter the longer you use it.* Tax season (the 1099-K reconciler) gives you a January renewal spike on top.

---

## 6. Ultimate customization — the settings surface

Organized by module, each with a sensible default. This is a competitive weapon: no rival exposes this depth, and it lets a pro fit CardOps to their exact market.

### Pricing engine
- **Default pricing strategy for new cards** — *Standard (trimmed-mean of raw comps)*
- **Enabled comp sources** (manual / Card Ladder-manual / eBay / PriceCharting / SportsCardsPro / auction) — *all enabled*
- **Per-source trust weight** — *equal*
- **Default look-back window (days)** — *90*
- **All-time fallback when window empty** — *on*
- **Last-N survivors cap** — *null (all in window)*
- **Top-N highest ("avg of N best")** — *null*
- **Minimum comps for "actual" badge** — *3*
- **Default aggregation function** (mean/median/trimmed_mean/wavg_recency/last_sale/min/max) — *median*
- **Trimmed-mean trim %** — *0.10*
- **Recency half-life (days)** — *30*
- **IQR outlier fence multiplier (k)** — *1.5*
- **Drop top / bottom %** — *0 / 0*
- **Absolute price floor/ceiling guards** — *off*
- **Charm (.99) rounding** (only when ≥ $1) — *off*
- **Final multiplier (0.85–1.2)** — *1.0*
- **Comp scope** (raw / own-grade / cross-grade) — *raw*
- **Grade delta (±)** — *0 (exact)*
- **Cross-grader borrow set** (PSA/BGS/SGC/CGC) — *any graded*
- **Era boundary year (modern vs. vintage)** — *1986*
- **List-price floor multiple (× landed cost)** — *1.15*
- **Grade-up cost hurdle** — *$25*
- **Editable grade-multiplier table** (grader × grade × era × category) — *seeded ladder (PSA10 modern 4.0×, etc.)*
- **Multiplier source preference** (seed vs. fitted) — *fitted when available, else seed*
- **Comp de-duplication** — *on*
- **Foreign-comp currency / FX handling** — *convert at daily FX*
- **Stale-comp expiry** — *none*
- **Comp price normalization (ship/tax)** — *use price as-recorded*
- **Per-category strategy overrides** (vintage / modern / TCG) — *global for all*
- **Nightly reprice daemon on/off + time** — *on, overnight*
- **Price-history log threshold** — *any change*

### Intake
- **SKU prefix codes per category** — *built-in registry (FB, BK, PK…)*
- **SKU sequence start & zero-padding** — *1, 6 digits*
- **Default acquisition method** — *purchased*
- **Default zone & storage location** — *last-used (or prompt)*
- **Default status on book** — *booked*
- **Require back photo** — *off*
- **Photos required per card** — *1 (front)*
- **Auto-crop / rotate / deskew** — *on*
- **Image compression & max resolution** — *~85%, 2048px*
- **Duplicate detection mode** (cert / SKU / fuzzy) — *cert+SKU exact, fuzzy warn*
- **Fuzzy-match threshold** — *moderate*
- **Auto-derive tags** (RC/AUTO/PATCH/#'d/grade) — *on*
- **Default TCG language** — *EN*
- **Cost-basis mode** (pool / individual) — *pool*
- **Default entity assignment** — *CARD entity*
- **Cert-number auto-lookup** — *on when AI/API enabled*
- **Batch session size cap** — *none*

### AI / cost control
- **Master AI kill switch** — *off (must opt in)*
- **Vision/intel model selection** (Opus/Sonnet/Haiku per task) — *Opus*
- **Monthly spend cap & alert** — *none set (alert at 80%)*
- **Per-scan / per-request cost ceiling** — *off*
- **Confidence threshold for auto-accept** — *needs-review below ~0.7*
- **Auto-scan on intake** — *manual*
- **Intel default tier** (light/medium/deep) — *medium*
- **Intel default horizon** (flip/season/longterm) — *season*
- **Intel web-search max uses per tier** — *3 / 6*
- **Intel cache staleness/debounce** — *light 24h, medium/deep 30m*
- **Intel auto-run (light) on card open** — *on*
- **Description tone** — *professional*
- **Description length & template** — *1–2 sentences + condition line*
- **Description condition disclaimer** — *on*
- **Discount-line phrasing** (percent / dollar / "priced to move") — *percent*
- **House-rules / custom prompt addenda** — *none*
- **Grade-estimate auto-run** — *manual*

### Listing / pricing UI
- **Slider range** — *−99% to +500%*
- **Slider default position** — *0% (at comp)*
- **Re-anchor on comp refresh** — *manual*
- **Below-cost warning** — *on (hard block below floor multiple)*

### Lots / bundles
- **Default lot-discount factor** — *0.85× sum-of-singles*
- **Allow cross-entity / cross-consignor lots** — *off*
- **Proceeds allocation method** — *pro-rata by child comp value*

### Portfolio & alerts
- **NAV snapshot frequency** — *daily overnight*
- **Concentration alert threshold** (per player/set/year) — *35% of capital*
- **Default price-alert band** — *±15%*
- **Velocity target default** — *max price (vs. sell-in-N-days)*
- **Aged-inventory flag threshold** — *90 days listed*

### Selling / ops
- **Best-offer auto-accept floor & curve** — *off*
- **Aging-aware floor softening** — *off*
- **Default shipping method by value band** — *PWE < $20, BMWE $20–100, tracked > $100*
- **Cross-list channels enabled** — *eBay only*
- **Auto-delist-on-sale** — *on (once cross-listing exists)*

---

## 7. Recommended build order

**Phase 0 — Emails & applications (this week, near-zero effort):**
- Apply for eBay **Marketplace Insights** production access via your existing app (plan for denial).
- Email **Card Ladder** BD (does any data license exist? at what cost?) and **Cardbase** (partner/API program?).
- Sign up for **The Card API** or **SoldComps** free tier (instant eBay-solds key — your Insights fallback) and **SportsCardsPro** (graded-sports baseline).

**Phase 1 — Your four asks + the retention hook (highest ROI, mostly internal):**
1. AI descriptions (§1a) — reuses existing AI.
2. Price slider with discount-in-description (§1b) — pure internal.
3. Multi-card lots (§1c) — schema + reconciliation.
4. **Portfolio value-over-time dashboard** (§3.1) — start the nightly comp snapshot *now* so history accrues while you build everything else.
5. Price alerts + watchlist (§3.2).

**Phase 2 — The money-making moat:**
6. **Grade-or-Flip EV Engine** (§4.1) — your signature, uncopyable feature.
7. **Deals / underpriced finder** using eBay Browse + your comps (§3.3).
8. **Liquidity/Velocity score** (§4.2).
9. Wire in a sold-comps vendor (The Card API/SoldComps) + SportsCardsPro so comps span more than live eBay.

**Phase 3 — Capital & analytics intelligence:**
10. Cash-Conversion / Capital-at-Work dashboard (§4.3).
11. Sell-through / seller analytics (§3.5) + Sourcing-Channel ROI attribution (§4.8).
12. Pop-Report Drop early-warning (§4.5) — pursue **GemRate** partnership for unified cross-grader pop.
13. Insurance-ready valuation export (§4.4) — quick win, slot in anywhere.
14. Market-movers leaderboard (§3.4) — now that snapshot history exists.

**Phase 4 — Execution & channel expansion:**
15. Slab cert/barcode scan intake (§3.6); TCG catalog backbone (Scryfall + Pokémon TCG API + JustTCG/tcgapi.dev).
16. Best-offer auto-negotiation (§4.9); shipping decision + dispute evidence pack (§4.12).
17. Cross-listing + auto-delist-on-sale (§3.11), starting with MySlabs (no FVF on slabs).

**Phase 5 — Moat-deepening bets (gate on demand):**
18. Consignor Portal & payout ledger (§4.10) — biggest revenue unlock, switching-cost moat.
19. 1099-K reconciler (§4.14) — ship before January.
20. Peer Benchmark Network + Buyer-Risk scoring (§4.11, §4.13) — network effects once you have a userbase.
21. Bulk/voice intake (§4.17). Then, only if your users actually break: Live-Break EV Scanner and the fake/trim detector (both XL).

**Guiding principle:** Phase 1 delivers everything you personally asked for plus the daily-habit hook; Phase 2 delivers the uncopyable reason to pay. Start the nightly comp snapshot in Phase 1 no matter what — every trend, NAV, velocity, and market-mover feature downstream depends on history you can only accumulate by starting the clock now.

---

*Honest limitations recap: Card Ladder and Cardbase cannot be integrated programmatically today (no API — verified); eBay sold-comps and TCGplayer official access are gated/closed; PSA's official API is cert-lookup only with pop data scrape-only; all auction-house and pop-report data below GemRate requires scraping with ToS/stability risk. Every "integrate now" in §2 is sanctioned and self-serve. Dollar figures are verified except those marked **[unverified]**.*
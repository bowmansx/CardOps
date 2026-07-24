# CardOps — Master Request Log, Answers & Roadmap

*Beau's running list of everything asked for, its status, answers to open questions, and the blind spots to cover. Companion to [product-strategy.md](product-strategy.md) (deep strategy) and [psa-integration.md](psa-integration.md) (PSA detail). Updated 2026-07-19.*

---

## 1. Everything you've asked for — by status

### ✅ Shipped (in production)
**Pricing & valuation**
- Pricing-format builder (avg/highest of last-N or all-time, outlier guards, low-pop, cross-grader ±) with AI + dice generator and lock-and-reroll
- Per-company AI grade estimator from a deep rubric
- Multi-case price panel + blend + timelines; card-page price block with 30d/1y deltas
- Card Ladder **paste** importer (manual — see §2 for why not API)
- Card Intel (light/medium/deep tiers; auto light on open)

**Intake & inventory**
- Scanner + batch/speed intake; front-only option; retake/re-read UX; lightbox zoom
- Category system incl. LoL TCG (Riftbound); self-tagging (RC/AUTO/PATCH/#'d/grade)
- Inventory browser (filters, tags, grouping); storage locations
- Bulk actions page (multi-select → status/storage/strategy or export-selected)
- Show mode (flex screen, hide-prices toggle)
- **Portfolio banner** (cost basis · market value · return%) + denser rows + color-coded status dot ← just shipped

**Selling & books**
- Sell flow v2 (auto fees, shipping helper, if-graded panel)
- Cost-basis pool; sale reversal (card_unsell — money-correct); status control
- Tax/year-end reports + CPA CSV; Whatnot CSV export
- Weekly card-world study cron

**eBay (full Seller-Hub parity)**
- OAuth connect; account-deletion endpoint; business-policy auto-fetch + opt-in guidance
- Listing engine: fixed price, **auctions** (Trading API), Buy-It-Now, **Best Offer** (auto-accept/decline)
- eBay Hub: Active / Ship / Offers / Sold / Ended / **Reviews** / **Inbox** tabs
- Actions: reprice, send-offer-to-watchers, end, relist, mark-shipped, **cancel order**, sync-and-settle, leave/reply feedback, reply to buyer messages
- graded_out listing guard ← just shipped

### 🔜 Requested — not yet built (your active queue)
**Group A — your "4 features" batch**
1. **AI sale descriptions** — what the card is, its significance, TCG role / scene meaning, and *how the price was determined*. Internal build, no signup. (Design in strategy §1a)
2. **−99%/+500% price slider** with the discount written into the description. Internal. (§1b — keep discount in copy, NOT eBay's structured markdown field)
3. **Multi-card grouped / lot sales** — pool photos + data into one sale; sell individually or as a lot. (§1c — the money-exact part is pro-rata proceeds allocation)
4. **Cardbase / Card Ladder pull** — ⛔ blocked: neither has an API (see §2). Reroute to licensed feeds.

**Group B — inventory UX (this message)**
5. **Multi-select on the Cards home** — hold-to-select, highlight more as you go, a bottom action menu. (Distinct from the existing Bulk page — this is inline on the home list.)
6. **Custom folders / groups** — user-made card groupings; menu actions: move to group, copy to group, list on eBay (then choose sell individually vs. as a group), etc.
7. **List-as-group** from the multi-select menu (ties to lots, #3).
8. **graded_out policy setting** (warn / block / allow) — block shipped as default; the toggle is queued.
9. **Status color-coding** — partial (dot added); full word-free color system queued.

**Group C — data & PSA**
10. **PSA cert-scan hydrator** — OCR the cert from a photo → auto-fill card + grade + at-grade pop + images. (Highest-ROI PSA feature — see psa-integration.md)
11. **PSA grading-prep + arbitrage worklist** — flag/batch cards, "is it worth grading?" EV, packing list. (No submission API — internal build)
12. **MasterOps widgets** — configurable dashboard (see §3).

**Group D — strategy features you greenlit interest in** (see product-strategy.md §4)
- Grade-or-Flip EV engine · portfolio NAV chart · price alerts · deals finder · velocity score · cash-at-work dashboard · concentration risk · pop-drop warning · consignor portal · 1099-K reconciler · and more.

---

## 2. Your PSA questions — answered

**What do PSA's APIs do / not do?**
- **Do:** one official read-only API. `GetByCertNumber` → card identity + grade + *at-grade* population (pop at that grade, pop higher, total for the spec). `GetImagesByCertNumber` → official slab scans (cards graded ~Oct 2021+ only).
- **Don't:** no full grade-by-grade histogram, no prices/APR/Price-Guide, no grading submission, no order-status polling.

**"Can we build our own API to get the full histogram / prices from their website?"**
Technically yes — that's a *scraper* of psacard.com. I'd advise against it, especially for a commercial product:
- It **violates PSA's Terms / End-User Agreement** (grounds for a cease-and-desist).
- It's **fragile** — breaks the moment they change their HTML, and it would sit under your *money-critical* pricing.
- Redistributing scraped data **commercially** raises real legal exposure.
- **Sanctioned alternatives that already have keys:** full/cross-grader population → **GemRate** or **TCGAPIs**; prices → **eBay solds** (you have it) + **PriceCharting**. Use these instead of scraping.

**"The 100 calls/day — what pulls a credit?"**
Each **API request = 1 call** against the daily cap (a cert lookup is 1; fetching that cert's images is another call). Reads only. **Key mitigation:** cert data never changes, so we **cache every response permanently** — each cert costs 1 call *once, ever*. That alone likely keeps you under 100/day for a long time. (Confirm exact metering in their Swagger once you have a token.)

**Auth caveat worth repeating:** PSA uses OAuth2 *password grant* — your actual PSA **login**, not a scoped key. CardOps would hold those credentials server-side (sealed like your eBay tokens, entered by you, never in client code). It's your login, so treat it carefully.

---

## 3. MasterOps widgets — what we need

Right now the MasterOps home is a fixed layout (to-dos + calendar). "Widgets you can add" needs a small **dashboard framework**:
1. **Widget registry** — each widget = a component + a data source + a size (1×1, 1×2, 2×2). E.g. the CardOps cost-basis banner I just built is exactly one such widget.
2. **User layout prefs** — which widgets, in what order/size, stored per user (we already have `user_settings.prefs`).
3. **A dashboard grid** on the home page that renders the chosen widgets, with an "add widget" picker and drag-to-reorder.

Two ways to get there:
- **Fast:** ship specific high-value fixed widgets now (cash position, upcoming deadlines, today's calendar, CardOps portfolio, open deals) — no framework, immediate value.
- **Full:** build the configurable framework so you add/remove/arrange any widget yourself.

Recommendation: ship 2–3 fixed widgets first to prove the value, then generalize into the framework. (If "widgets we discussed" meant a specific earlier spec, point me to it and I'll match it.)

---

## 4. "What am I getting into" — going commercial

Turning this from *your* tool into a product other people pay for is a real jump. The big rocks:
- **Multi-tenancy.** Today it's you + one helper, gated by your role via RLS. A SaaS needs real signup, per-tenant data isolation, and **each user connecting their OWN eBay/PSA accounts** — you can't share your keys (eBay OAuth and PSA login are per-user).
- **Billing.** Stripe subscriptions + tiers; metering AI spend per user (or it eats your margin).
- **Data licensing — the #1 legal watch-item.** eBay, PSA, PriceCharting, etc. restrict how their data may be displayed/redistributed. Showing a user *their own* account's data is generally fine; **aggregating and reselling data across users** often needs commercial agreements. Don't build the business on scraped data.
- **eBay app compliance.** Distributing via eBay's network means an approval/compliance process (you already did the account-deletion endpoint — that's part of it) and production rate limits.
- **Legal/liability.** Money-critical pricing + tax features → clear disclaimers ("not investment/tax advice"), a real ToS/Privacy Policy, and keep it under an LLC. GDPR/CCPA once you have users.
- **Ops.** Uptime, support, abuse/fraud, and per-user AI cost caps at scale.

None of this is a blocker — it's a checklist. The product moat (strategy §5) is strong; the commercialization is mostly plumbing + paperwork. Worth a proper plan before you take payments; happy to draft that roadmap when you're ready.

---

## 5. Blind spots & value you may be missing

Full detail in product-strategy.md §4. The headlines:
- **Capital velocity > headline price.** Optimize margin *per day of capital tied up*, not just price. (Velocity score + "sell in 7 days vs. max price.")
- **Grade-or-Flip EV engine** — your single strongest, *uncopyable* feature: grade *distribution* × graded comps − every fee → the profit-max move (which grader, or stay raw) with the break-even grade. Nobody has it because nobody else owns both a grade estimator and a comp engine + execution.
- **Grading-limbo cash drag** — dollars stuck in the PSA drawer for 90 days are invisible today; a cash-at-work dashboard surfaces them.
- **Concentration risk** — "61% of your capital is in 2024 rookies, 38% is one player." One crater wipes you.
- **Pop-report drops as a *forward* sell signal** — a pop spike = supply flood coming = sell now.
- **Sourcing-channel ROI** — does the Tuesday break actually make money, or just feel productive?
- **Uninsured high-value inventory** — one-click timestamped valuation export for a collectibles rider.
- **The subscription thesis:** sell *profit-maximizing decisions net of every fee*, not "a place to log cards."

---

## 6. Recommended next build order

1. **Group A** (your 4 features): AI descriptions → price slider → lots. (Cardbase/Card Ladder = emails, not code.)
2. **Group B** inventory UX: multi-select home + custom groups + list-as-group (pairs with lots) → graded_out setting → full status color system.
3. **Start the nightly comp snapshot NOW** (portfolio history only accrues if the clock starts) → portfolio NAV chart + price alerts.
4. **PSA cert-scan hydrator** (Group C #10) — high ROI, reuses vision.
5. **Grade-or-Flip EV engine** — the moat.
6. MasterOps widgets (fixed first, framework later).
7. Commercialization plan when you decide to take payments.

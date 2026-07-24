# The Full Pricing-Factors Map — what CardOps' AI considers (and will consider) when determining a card's price

The master list behind "AI, price this card." Factors marked ✅ are wired into the app today; 🔜 = planned next; 🔌 = needs a connector; 🧠 = the AI weighs it live (web search / reasoning).

## 1. Direct sales evidence (the anchor — nothing outranks real sales)
- ✅ The card's own comps: price, date, grader+grade, source (manual + paste-importer)
- ✅ Recency-weighting, windows, outlier guards, min-sample abstention (pricing formats)
- ✅ Cross-grade & cross-company borrowed evidence (± grade delta, company filter)
- ✅ The card's own value trajectory (30d / 1y points, price history log)
- 🔌 Automated comp feeds (eBay orders API, PriceCharting API) — replaces pasting

## 2. The card's intrinsic profile
- ✅ Identity: player/character, set, year, brand, number, parallel/finish, rarity, language
- ✅ Attributes: RC / AUTO / PATCH / RPA, serial numbering (/99 scarcity)
- ✅ Condition: raw estimate or grader+grade; AI per-company grade estimate (rubric-driven)
- 🧠 Grade-arb: the gap between raw value and estimated-grade value (grade-up math ✅)

## 3. Population & scarcity
- 🔌 Pop reports per grader+grade (PSA has a real API; CGC/SGC via paste) — price-vs-pop curves
- 🧠 Print-run context (1st edition vs unlimited, short prints, era production volume)

## 4. The human/story layer (why prices actually move) — Card Intel 🧠✅
- Player: performance runs, injuries, awards, trades, retirement, HOF ballots, scandals
- Set/product: anniversaries, reprints, rotation, sealed-product hype cycles
- Game (TCG): bans/restrictions, meta shifts, new-set power creep
- Calendar seasonality: sport season arcs (buy offseason, sell during runs), holidays, release windows
- Cultural moments: movies/documentaries, viral moments, chase-card mania

## 5. Market structure
- 🧠 Segment indices & drift (Card Ladder indices via paste; adjusts stale comps)
- 🧠 Liquidity: how often this card trades (sales-per-month → how aggressive to price)
- 🔌 Active-listing ceiling: lowest live BIN bounds the ask; stale listings = overpriced signal
- 🧠 Grading-company trust drift (rubric + weekly study cron feed this)

## 6. The seller's own position (personal factors — most tools ignore these)
- ✅ Landed cost / pool basis → floor (never list below cost × 1.15)
- ✅ Horizon preference: flip / season / long-hold (Card Intel setting)
- 🔜 Inventory concentration (overweight one player/set → trim bias)
- 🔜 Cash-need mode ("liquidate faster" global bias setting)

## The verdict synthesis (Card Intel)
Current value + trajectory (30d/1y) + comp depth + grade-arb + live news + seasonality + horizon
→ **strong_buy / buy / hold / sell / strong_sell** + a specific sell-timing strategy + watch-for triggers.
Discipline rules: no invented news; abstain-over-guess on thin evidence; verdicts are horizon-relative;
always decision support, never a guarantee.

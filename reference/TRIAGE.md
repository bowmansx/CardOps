# TRIAGE — core foundation review (2026-07-25)

Decision-oriented triage of the 170-agent review. Applies the completeness
critic's severity reconciliation, collapses the 71 raw confirmations to distinct
defects, and buckets each by WHEN to fix. This is the worklist; the verbatim
per-agent output is in `audit-findings-raw.md`, the narrative in
`foundation-review-2026-07-25.md`.

**Counts:** 170 agents (10 finders → 71 raw confirmations → deduped to 36
distinct defects; 8 candidate findings refuted and dropped). Money findings
required 2-of-3 independent skeptics to survive.

**Two framing rules from the critic, applied throughout:**
- **[live-via-MO]** = the code can't execute on the CardOps deployment today
  (CRON_SECRET/EBAY_* interlock) but the SAME code runs daily from the
  Master-Ops deployment against the shared DB. Live defect, executing elsewhere.
  Fix lands here; urgent ones need backporting to Master-Ops before cutover.
- Severity is the reconciled single value (the raw run rated the same defect up
  to 5 times at divergent levels — those are collapsed here).

---

## GO / NO-GO for today's Zoho connect (AF/HOP)

**Connecting a business + mapping accounts: GO.** No finding touches the
connect or account-mapping paths (the mapping-key-discovery finding was
**refuted**). Map away.

**Pressing Post to Zoho: GO, with eyes open** — the posting is money-correct at
the ledger level (claim-first, refuses rather than half-writes), but the STATUS
REPORTING around it is broken three ways. Before you rely on the result:
- **T1 / T2 / T3 below** make today's push honest — ~1 hour, contained, no
  schema change. Worth doing first.
- If not doing them first: keep the batch **≤10 entries** (dodges the timeout
  strand), **ignore the red failure triangle** (it fires on success — T1), and
  **manually confirm in Zoho** that the entry count matches, since "uncertain"
  entries won't show.

---

## FIX TODAY — make the push honest (small, contained, no migration)

| # | Sev | Defect | File |
|---|-----|--------|------|
| T1 | low→**do-first** | PushToBooks reads `d.failed` which the API never returns → every push renders as failure; refused/uncertain counts never shown | `src/components/cards/PushToBooks.tsx:29-31` |
| T2 | high | Push-preview builds "already posted" WITHOUT reading status → a stranded `pending`/`uncertain` claim shows a green "posted" chip forever | `push-preview/page.tsx:43-74` + `push/route.ts:104-134` |
| T3 | high | `pushEntry` returns `attempted:true` on a token-refresh throw (nothing sent) → transient Zoho outage quarantines the whole batch as "uncertain", never retried | `zoho.ts:62-71` + `zoho/client.ts:51` |

---

## FIX THIS WEEK — P0 correctness (two need a decision from you)

| # | Sev | Defect | Decision needed |
|---|-----|--------|-----------------|
| A | **CRITICAL** | `updateCard`/`createCard`/`importCards` accept any status → edit un-sells a sold card with no reversal (double-sell); cards born `sold` with no sale. Bulk route already blocks exactly this. | Whitelist + reject `sold` outside sell flow. No product decision, just do it. |
| B | **CRITICAL** (critic upgraded from high) | Default `use_pool_basis=true` but only Speed Book funds the pool → every intake/import/form card draws basis it never funded; COGS corrupted, pooled cards eventually sell at $0 basis | **You decide:** default individual-basis outside Speed Book, OR require cost at intake/import. |
| C | high | No reconciliation between push claims and ledger → reversed/edited sale leaves phantom/stale money in Zoho forever | **You decide:** fingerprint+flag only, or also auto-push a reversing journal. |
| D | high→ (critic: this is C's concrete trigger) | Unsell after a Zoho push never reverses/flags the posted journal | folds into C |
| E | medium | Ledger rebuild non-transactional + unserialized → concurrent rebuilds duplicate rows; mid-write crash truncates | one Postgres fn / advisory lock |
| F | medium | Journal export + push-preview pagination lack a unique tiebreaker → intercompany advance rows tie exactly, CSV can double/drop a line | `.order("id")` on both reads |
| G | medium | `entry_date` = UTC day → Dec-31-evening Central sales book into the wrong tax year | **You decide:** books timezone (America/Chicago assumed) |
| H | medium | Receipt DELETE ignores both delete errors → orphaned balanced ledger lines that still push to Zoho | check errors, receipt-first, 500 on fail |

---

## FIX IN A MECHANICAL WAVE — capped-read / swallowed-error / tiebreaker family

One sitting, ~15 files, same fix shape everywhere (readAllSafe + unique
tiebreaker + the existing "records couldn't be read" banner). All are the class
the 2026-07-24 audit standardized `readAll` for, in code it didn't reach.

- **[high]** Sales & P&L headline totals sum a `limit(1000)` read — `sales/page.tsx:17-30`
- **[med]** Reports page: private `pageAll` swallows page errors + non-unique sold_at paging — `reports/page.tsx:33-80`
- **[med]** CPA year CSV pages on sold_at, no tiebreaker (tax doc can drop/dupe rows) — `api/cards/reports/route.ts:31-42`
- **[med]** Books page interco + pool reads bypass the partial-read banner (zero-as-fact) — `books/page.tsx:64,130`
- **[med]** Portfolio page + cards-index banner: read error treated as end-of-data → $0 / −100% as fact; portfolio overwrites today's chart point with 0 — `portfolio/page.tsx:46-66`, `cards/page.tsx:116-130`
- **[low]** Portfolio history keeps OLDEST 400 snapshots (ascending+limit) — `portfolio/page.tsx:19-20`
- **[low]** eBay hub 30-day stats from unordered limit(1000); group filter membership from unordered capped read — `api/ebay/hub/route.ts:74-85`, `cards/page.tsx:51`
- **[med]** addComp swallows insert error + accepts negative price (poisons market_value → NAV/exports) — `[id]/value/actions.ts:81-89`
- **[low]** Card create/edit/import accept negative money — `actions.ts:53-57,99,207-208`
- **[low]** Comps import: model date regex-only, impossible date 500s the batch (coerceDate exists, unused) — `api/cards/comps/import/route.ts:103`
- **[low]** Receipts POST accepts sub-cent amount → stored $0.00, no ledger entry — `receipts/route.ts:53`
- **[low]** Connector mapping-clear ignores delete error, reports "cleared" — `connectors/route.ts:112`

---

## FIX BEFORE CUTOVER — eBay sync + crons [live-via-MO]

Weakest area of the codebase. Runs from Master-Ops today; becomes CardOps' job
at cutover. **audit_log actor fix ships with a paste-ready migration (below).**

**eBay sync/list layer:**
- **[high]** Cancelled-order guard read unpaged/unordered — only defense against re-settling a refunded order caps at 1000 rows → double pool draw + phantom revenue — `sync/route.ts:50`
- **[high]** Cancellation/refund AFTER settlement never reversed (only pre-settle handled) — `sync/route.ts:81-85`
- **[high]** list/list-lot: DB write after live publish unchecked → card live on eBay with empty listing_refs, excluded from sync, PAID order never settles; auction double-list — `list/route.ts:171-173,262-264`, `list-lot/route.ts:131`
- **[high]** Lot sell accepts negative fees/shipping (hole the single-card path closed) — `api/cards/lots/route.ts:131-133`
- **[med]** Lot cancel strands lot in `sold` (card_lot_unsell then always throws) — `cancel-order/route.ts:51-62`
- **[med]** Match-set reads discard page errors (settle against empty set, reports ok); created_at paging w/o tiebreaker; lots set unpaged — `sync/route.ts:35-46,64-66`
- **[med]** getOrders hard 300-order cap, no truncation signal — `lib/ebay/orders.ts:110`
- **[low]** Combined-order fee allocation: no remainder handling (cent drift) + $0.30 per-ORDER fee applied per LINE — `sync/route.ts:98-107`

**Crons:**
- **[med]** card-alerts stamps `notified_at` even when 0 pushes delivered → crossing lost on a push-service blip — `card-alerts/route.ts:122-182`
- **[med]** card-estimates: overlap double-debits credits; insert-error still debits + re-selects daily (also in interactive `api/cards/estimate/route.ts:81-90`); one user's read error aborts all later users; 80 AI calls can't fit 300s — `cron/card-estimates/route.ts:43-131`
- **[med]** daemon reprice cursor never advances for unchanged cards → inventory tail never repriced — `daemon/route.ts:143-151`
- **[med]** Paid-spend crons ignore the role roster → demoted member's cards keep spending owner's budget/credits nightly — `price-refresh/route.ts:62-72`, `card-estimates/route.ts:43-46`
- **[med]** No timeout on ANY vendor fetch (thecardapi/scryfall/pricecharting/ebay/zoho) → one stall eats the whole maxDuration — add `AbortSignal.timeout` in src/lib vendors
- **[low]** card-alerts readAll calls have NO `.order()` — violates the primitive's own contract — `card-alerts/route.ts:108-156`

**Paste-ready migration for the audit_log actor CHECK** (sync writes 'ebay-sync',
account-deletion writes 'ebay'; both silently rejected today, so there is NO
eBay settlement audit trail and the account-deletion compliance log silently
fails). Alternative: change the code to actor `'cron'` and skip the migration.

```sql
-- Widen audit_log.actor to admit the eBay writers (currently silently rejected).
alter table public.audit_log drop constraint audit_log_actor_check;
alter table public.audit_log add constraint audit_log_actor_check
  check (actor in ('web','mcp','cron','assistant','ebay-sync','ebay'));
```

---

## TEST DEBT — the plpgsql money core has zero coverage

The 16 vitest files cover pure TS math well; **nothing executes the SQL RPCs.**
Highest-value tests, in order (needs a `supabase start` + SUPABASE_DB_URL-gated
integration harness, or pgTAP under supabase/tests):

1. `card_sell` / `card_unsell` reversal symmetry — the single riskiest untested path
2. `card_lot_sell` pro-rata + last-child remainder (cent-exact)
3. eBay `parseOrder` golden fixtures (tax-inclusive `total` fallback books phantom revenue; field rename → silent $0 sales)
4. Order-level fee/shipping allocation (extract to a pure helper first)
5. `pushEntry` attempted-flag contract (guards the double-post protocol)
6. `readAll`/`readAllSafe` window arithmetic (off-by-one = boundary dup/skip everywhere)
7. Showcase owner-scoping regression (extract filter to a pure fn; highest blast radius, ships green today)

---

## REFUTED — do NOT re-chase these (8, dropped after adversarial verification)

| Claim | Why it's not real |
|-------|-------------------|
| Overlapping runs double-push card-news / double-spend price-refresh budget | No manual-Run path exists (grep: only vercel.json + shells); daily cron, maxDuration 60 → runs 24h apart, cannot overlap |
| Relist allows a double-sale that books as benign "skipped" | Relist button is fed only by eBay's live UnsoldList (server-side "ended without sale"); a sold item can't appear there |
| card_lot_sell never checks lot ownership (asymmetric w/ unsell) | Mechanically true but gated by has_card_access + service_role; the lot_id gap needs an out-of-band UUID no screen exposes — same class the prior audit deliberately left |
| Connector mapping-key discovery pages journal_entries on non-unique account | `.order("account")` + collecting only the account VALUES into a Set is tie-stable at the value level; a skipped physical row can't drop a distinct key |
| Standalone-Supabase debt (tables/columns/bucket no migration creates) | Every item is a fresh-standalone-DB hypothetical; the shared DB is documented deliberate design (CLAUDE.md) — not a today failure |
| Auto-estimate same-day re-run re-bills every card | Freshness map keys `card_id::mode` consistently and skips estimates <14 days old; requires a hypothetical future regression |
| Journal builders might emit non-contiguous/unpushable entries | Line numbering happens AFTER zero-amount lines are dropped → contiguous 0..n-1 by construction |
| eBay token crypto crashes on a malformed key | Both sealToken calls are inside the callback's try/catch → malformed key degrades to an error redirect, not a crash |

---

## Blind spots (reviewed lightly or not at all)

- `src/lib/books/funding.ts` (260 lines of pool math) — no lens read its internals; give it a dedicated pass when wiring decision B.
- eBay aux routes ship/end/offers/messages/feedback/location — spot-check showed the same gate+validation shape, but unread.
- Showcase/group WRITE APIs (token mint/revoke) — only the missing-test note.

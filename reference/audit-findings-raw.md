# Raw review output — every agent, verbatim — 2026-07-25

Unfiltered dump of the core-foundation-review workflow (run wf_060f5264-7a9,
170 agents: 10 finders, 159 verifiers, 1 completeness critic). Each block is
the agent's COMPLETE return value exactly as it came back — no dedup, no
ranking, no editing. Order is launch order. The deduped, prioritized view
lives in foundation-review-2026-07-25.md; the triage map in TRIAGE.md.

---

## 1. find:ledger-books  (phase: Find, agent a769e141145164b8a, 133103 tokens, 572s)

```json
{
  "findings": [
    {
      "title": "Claimed-but-never-sent push entries are permanently stuck and reported everywhere as 'posted'",
      "file": "src/app/api/cards/connectors/push/route.ts",
      "line": 104,
      "severity": "high",
      "category": "idempotency-protocol",
      "detail": "The claim-before-post protocol has three crash points that all strand an entry in status='pending', and every surface then reports that entry as already posted. (a) Claim inserted (push/route.ts:104-107), then the process dies before conn.pushEntry (line 114) runs. This is not hypothetical: BATCH=40 (line 29) sequential Zoho POSTs inside maxDuration=60 (line 26), where zohoFetch retries 429s with 1s+2s+4s backoff (src/lib/zoho/client.ts:56-58) — one throttled entry can burn 7+ seconds, so 40 entries under throttling is ~minutes and Vercel kills the function mid-batch. (b) Zoho succeeded but the status update to 'posted' (lines 118-120) fails — its error is never checked, so the row stays 'pending' and the external_id is lost. (c) The refusal-path claim release (lines 125-126) fails — error also unchecked, claim stays 'pending'. In all three cases every subsequent run hits the unique index (23505, line 109) and counts the entry as skipped_already_posted; the push-preview page builds its 'already posted' set from card_push_log selecting ONLY business_id and reference — status is never read (src/app/cards/books/push-preview/page.tsx:43-46, 73-74) — so the entry gets the green 'posted' chip (line 178) and is excluded from 'ready' forever. No route or page anywhere surfaces status='pending' or 'uncertain' (grep: only these two files touch card_push_log). Concrete failure: push a 40-entry batch, Zoho is slow, function is killed at 60s around entry 30 after the claim insert but before the send — that journal never reaches Zoho, yet the UI and API permanently assert it was posted. Silent missing money in real books, unrecoverable without hand-written SQL.",
      "fix": "Track claim age: on a new push run, list rows with status='pending' older than a few minutes and status='uncertain' and return/display them as needs-review instead of counting them in skipped_already_posted; check the errors of the post-send status update and claim delete and report them; surface card_push_log status on the preview page (pending/uncertain badges, not 'posted'); reduce BATCH or check elapsed time each iteration and stop cleanly well before maxDuration."
    },
    {
      "title": "No reconciliation between push claims and ledger content — a reversed or edited sale leaves phantom/stale money in Zoho forever",
      "file": "src/app/api/cards/connectors/push/route.ts",
      "line": 101,
      "severity": "high",
      "category": "sync-drift",
      "detail": "The idempotency key is reference = CARDOPS-{source}-{source_ref} only (src/lib/cards/connectors/ledger.ts:95); no content hash, and nothing ever compares a claim against the current ledger. Two concrete failure paths. Path 1 (phantom revenue): sell a card -> 'Sync sales to ledger' -> card_unsell. card_unsell deletes only the card_sales row (supabase/migrations/20260720120000_card_unsell.sql:63-66); the journal_entries rows for that sale persist until the next manual rebuild, so the push-preview still shows the entry as ready and the owner can Push it — Zoho books revenue for a sale that was reversed. The next rebuild (src/app/api/cards/books/post/route.ts:82) removes the internal rows, but the card_push_log claim stays 'posted' and the Zoho journal stays, with no signal anywhere: internal books show nothing, Zoho shows a sale that never happened. Path 2 (stale amounts): push a sale, then fix a typo in its price and re-run the rebuild — the regenerated rows carry the same source_ref, hence the same reference; the push route skips it via the claim (line 109, reported as 'already there'), so Zoho keeps the wrong amount permanently while CardOps' internal ledger shows the corrected one. In both paths the divergence is silent and permanent — exactly the wrong-number-in-real-books outcome the pipeline exists to prevent.",
      "fix": "Store a content fingerprint (e.g. sorted lines hash + total) on the claim row; on each push run, compare claims marked 'posted' against the current built entries: reference present with a different hash => flag 'diverged (edited after post)'; claim exists but the entry no longer exists in the ledger => flag 'posted but since reversed'. Surface both on the preview page. Optionally have card_unsell delete the sale's journal_entries rows in the same transaction so a reversed sale can never sit pushable."
    },
    {
      "title": "Journal CSV export pagination has no unique tiebreaker — advance-receipt rows tie exactly and can duplicate/vanish across page boundaries",
      "file": "src/app/api/cards/books/journal/route.ts",
      "line": 39,
      "severity": "medium",
      "category": "pagination-determinism",
      "detail": "The export pages journal_entries ordered by (entry_date, source_ref, line) — entity_id is not in the order and there is no unique key. An intercompany advance writes FOUR rows for one receipt with lines numbered per entity (src/app/api/cards/receipts/route.ts:92-95): payer gets (date, ref, 0),(date, ref, 1) and payee gets the identical (date, ref, 0),(date, ref, 1). Those pairs are exact ties under the export's ORDER BY. With a ledger over 1000 rows (readAllSafe pages at 1000), a page boundary landing between two tied rows plus Postgres's unstable ordering of ties across separate queries (no covering index exists — journal_entries has only (source, source_ref) and (entity_id, entry_date) indexes, so this is an in-memory quicksort over inputs that synchronized seq scans can reorder) can return the payer's line twice and the payee's line never: the exported CSV then contains a doubled intercompany_advance debit and a missing asset debit — an unbalanced financial document delivered as HTTP 200 with no signal, handed to a CPA or imported into Zoho. The same non-unique (source_ref, line) ordering is used by the push-preview's global read (src/app/cards/books/push-preview/page.tsx:40-41), where a flipped tie mis-groups the advance's halves and corrupts the ready counts shown in the confirm dialog. (The push route itself is safe: its read is scoped .eq(entity_id) so (source_ref, line) is unique within it.) This is a new instance of the house-rule class 'pagination needs a deterministic .order() with a unique tiebreaker' — the 2026-07-24 fix added paging here but not a unique order.",
      "fix": "Add .order(\"entity_id\") (or .order(\"id\")) as a final tiebreaker to the journal export read and the push-preview ledger read so the page ordering is total."
    },
    {
      "title": "Sale entry_date is the UTC calendar day — evening sales on Dec 31 book into the wrong tax year",
      "file": "src/app/api/cards/books/post/route.ts",
      "line": 71,
      "severity": "medium",
      "category": "period-boundary",
      "detail": "card_sales.sold_at is timestamptz default now() (supabase/migrations/20260713150000_cardops_init.sql:270). The ledger rebuild derives the journal entry_date with String(s.sold_at).slice(0, 10) — PostgREST returns the timestamp in UTC, so this is the UTC calendar day. The owner operates in US Central time: any sale settled between 6:00 PM and midnight CT on Dec 31 gets sold_at like 2027-01-01T01:30:00+00:00 and books to entry_date 2027-01-01. Consequences: the year-filtered journal CSV export (journal/route.ts:42, gte/lt on entry_date) excludes it from the year it legally belongs to; the Business Books year buckets (src/app/cards/books/page.tsx:76-77, .gte/.lt on sold_at compared against a bare date string, evaluated at UTC) shift the same sales; and the pushed Zoho journal carries the wrong journal_date, so real books report the revenue in the wrong tax year. The hunt target 'period/timezone boundary bugs' — this is the one place the pipeline converts a timestamp to a books period, and it uses the wrong zone. eBay-sourced sales with real order timestamps hit the same conversion.",
      "fix": "Convert sold_at to the books timezone before slicing (e.g. Intl.DateTimeFormat with timeZone: 'America/Chicago', or store a books_timezone setting), and use the same zone for the Business Books year filters so all period bucketing agrees."
    },
    {
      "title": "Receipt DELETE ignores both delete errors — a failed journal delete still deletes the receipt, orphaning balanced-looking ledger lines",
      "file": "src/app/api/cards/receipts/route.ts",
      "line": 121,
      "severity": "medium",
      "category": "silent-data-loss",
      "detail": "DELETE runs two destructive statements with no error checks: `await supabase.from(\"journal_entries\").delete().eq(\"source\",\"receipt\").eq(\"source_ref\", id)` (line 121) then `await supabase.from(\"card_receipts\").delete().eq(\"id\", id)` (line 122), and returns { ok: true } unconditionally (line 123). Failure scenario A: the journal delete fails transiently (supabase-js returns an error object, it does not throw) — the receipt row is then deleted anyway, leaving the receipt's journal lines (for an advance, four lines across two entities: cash credit, intercompany advance/payable, asset debit) permanently orphaned with no source record, no UI that can ever remove them (the receipts list no longer shows the receipt), while the user saw success. Those orphans keep flowing into the journal CSV export, the push-preview (still pushable to Zoho), and the Business Books intercompany balances (books/page.tsx:130-140) — money for a purchase the user believes was deleted. Failure scenario B: the journal delete succeeds and the receipt delete fails — the receipt survives with posted=true but zero ledger lines, silently understating the books. The receipt POST handler shows the codebase already treats this pairing as atomic-or-rollback (lines 98-104); DELETE has no such care.",
      "fix": "Check both delete errors; delete the receipt first and only then its journal lines is still two steps — better, do it in one RPC/transaction, or at minimum: if the journal delete errors, return 500 without touching the receipt; if the receipt delete then errors, report it so the user re-runs."
    },
    {
      "title": "Ledger rebuild is non-transactional and unserialized — concurrent rebuilds duplicate journal rows; a mid-write crash truncates the ledger silently",
      "file": "src/app/api/cards/books/post/route.ts",
      "line": 82,
      "severity": "medium",
      "category": "destructive-rebuild",
      "detail": "The rebuild is delete-everything then insert-in-chunks (lines 82-88) with no transaction and no concurrency guard; the PostToLedger busy flag only debounces one tab. Failure scenario 1 (duplication): the owner clicks 'Sync sales to ledger' in two tabs. Interleaving: A deletes, A inserts chunk 1; B deletes (removes A's chunk 1); A inserts chunk 2; B inserts everything — the sales in A's chunk 2 now exist TWICE in journal_entries. Both requests return ok. The journal CSV export (no dedup) shows doubled debits/credits for those sales, and the books-page entry count doubles; buildPushEntries marks the affected groups complete=false (duplicate line numbers fail the 0..n-1 check) so Zoho is protected, but the exported financial document is silently wrong until someone happens to rebuild again. Failure scenario 2 (truncation): the delete succeeds, then the function crashes or hits maxDuration=60 mid-insert-loop (line 85; at the allowed 100k-sale scale that is ~600k rows = ~1200 sequential inserts, far over 60s) — the ledger is left missing an arbitrary tail with no marker; a sale's six lines can also be split across a chunk boundary, leaving a fragment that the CSV export happily includes (the export has no completeness guard). The route's own comments show partial-READ hazards were engineered away, but the write side has no equivalent protection.",
      "fix": "Move the delete+insert into a single Postgres function (one transaction), or take an advisory lock / claim row keyed on 'card_sale_rebuild' so runs serialize, and chunk-size the work to fit the time budget (or refuse above a row count that fits)."
    },
    {
      "title": "PushToBooks reads a response field the push API never returns — successful posts render as failures and refused/uncertain counts are never shown",
      "file": "src/components/cards/PushToBooks.tsx",
      "line": 29,
      "severity": "low",
      "category": "client-contract",
      "detail": "The push API responds with { pushed, skipped_already_posted, refused, uncertain, not_ready, remaining, errors } (push/route.ts:137-148) — there is no `failed` field. The client computes `setRes({ ok: d.failed === 0, ... })` (PushToBooks.tsx:31): `undefined === 0` is false, so even a perfect push renders with the red AlertTriangle failure styling; and `if (d.failed) bits.push(...)` (line 30) never fires, so the count of refused entries and — more importantly — of 'uncertain' entries (sent to Zoho, outcome unknown, per the protocol the one state the operator MUST manually verify in real books) is never displayed; only errors[0] text leaks through. tsc cannot see this because the response is untyped JSON. Concrete: a push returns pushed:38, uncertain:2 — the operator sees a red icon on every result (trained to ignore it) and no '2 uncertain' figure, so the two journals that may or may not exist in Zoho go unverified.",
      "fix": "Use the fields the API actually returns: ok = refused === 0 && uncertain === 0; display refused and uncertain counts explicitly (uncertain with a strong 'verify in your books before retrying' warning)."
    }
  ]
}
```

---

## 2. find:sales-money  (phase: Find, agent a358a49d960d69b12, 201288 tokens, 693s)

```json
{
  "findings": [
    {
      "title": "Every non-Speed-Book card defaults to pool basis but never funds the pool — pool draws misattribute COGS and eventually sell real pooled cards at $0 basis",
      "file": "src/app/cards/intake/actions.ts",
      "line": 91,
      "severity": "high",
      "category": "cost-basis",
      "detail": "cards.use_pool_basis defaults to TRUE (supabase/migrations/20260713150000_cardops_init.sql:171), but only speed_book_commit ever adds cost/count to card_pool (20260724000000_multi_tenant_cards.sql:188-191, guarded by the comment 'a lot cost is REQUIRED so the pool average never gets deflated by $0-basis cards'). Full Intake (commitIntakeCard, src/app/cards/intake/actions.ts:91-133) has NO cost field at all in IntakeInput and inserts with the default; CSV import (src/app/cards/actions.ts:196-215) likewise never sets use_pool_basis/individual_basis; the manual create form defaults the checkbox checked (src/components/cards/CardForm.tsx:134). card_sell (20260733000000_card_sales_tenancy.sql:77-85) draws round(total_cost/card_count) for ANY use_pool_basis card and decrements card_count. Concrete failure: Speed Book a lot of 100 cards for $500 (pool: $500/100). Full-intake 50 singles bought for $20 each (cost recorded nowhere). Sell the 50 singles: each draws ~$5 from the pool and decrements count — $250 of the lot's basis is booked against cards it never funded, the singles' real $1,000 cost never enters COGS anywhere (P/L overstated by $1,000), and after enough parasitic draws card_count hits 0 while genuinely pooled cards remain — those then sell with basis $0 (card_sell's 'card_count > 0' branch skips the draw), stranding the residual total_cost forever. Wrong realized P/L per card and per year in card_sales, the CPA CSV, the books ledger, and the tax buckets — silently. The receipts route's 'card-basis wiring is a later step' note covers receipts→pool only; nothing documents intake/import cards being pool parasites today.",
      "fix": "Until cost wiring exists, default use_pool_basis to false outside speed_book_commit (intake/import/create), or require a cost that writes a pool 'add' adjustment when a card is flagged pooled; optionally have card_sell refuse to draw for a card with no matching 'add'/lot lineage."
    },
    {
      "title": "Sales & P&L screen sums only the 1000 most recent sales — lifetime Net/Basis/P&L totals silently wrong past 1000 sales",
      "file": "src/app/cards/sales/page.tsx",
      "line": 21,
      "severity": "high",
      "category": "capped-read",
      "detail": "The page reads card_sales with .order('sold_at', desc).limit(1000) (lines 17-21) and reduces net_proceeds/basis_drawn/profit_loss over that slice (lines 23-30), rendering them as the headline 'Sales · N', 'Basis drawn', 'Profit / loss' stat tiles (lines 43-47). Once lifetime sales exceed 1000 (a stated volume path: lots, Whatnot, eBay sync), the totals silently exclude everything older — a wrong money number presented as the total, and it disagrees with /cards/reports and the CPA CSV, which page fully. This is exactly the 'sum fed by a capped read' class the 2026-07-24 audit mandated readAll for; this page was missed (the list itself may stay recent-N, but the sums may not).",
      "fix": "Compute the totals from a readAll/readAllSafe paged read (or a server-side aggregate), keep .limit(1000) only for the displayed list, and label the list as 'most recent'."
    },
    {
      "title": "Unsell never reverses (or even flags) a sale already pushed to Zoho — real books keep phantom revenue, and a re-sell posts a second journal",
      "file": "src/app/api/cards/connectors/push/route.ts",
      "line": 101,
      "severity": "medium",
      "category": "unsell-reversal",
      "detail": "card_unsell deletes the card_sales row and the internal ledger self-heals via delete-and-rebuild (src/app/api/cards/books/post/route.ts:82). But the Zoho push (this route) writes a Manual Journal keyed CARDOPS-card_sale-<sale_id> and records it in card_push_log; after an unsell the rebuilt ledger simply omits the entry, the push-preview (src/app/cards/books/push-preview/page.tsx) only renders entries that still exist so the stale posted journal disappears from every screen, and the 'posted' claim row remains. Concrete failure: settle an eBay sale → Post to ledger → Push to Zoho → buyer cancels, cancel-order reverses via card_unsell → Zoho permanently shows the revenue/COGS of a refunded order with no flag anywhere. Worse, sell the card again: card_sell creates a NEW sale id → new reference → the next push posts a second journal, so the real books now carry BOTH the reversed sale and the real one (duplicate revenue). Nothing in reference/ documents this as accepted; the push route's own invariants ('a duplicate in real books is worse than a visible gap') are defeated by the unsell path.",
      "fix": "On rebuild/push, diff card_push_log 'posted' references against current ledger entries; surface orphaned posted references ('posted to Zoho but since reversed — void journal <external_id>') on the push-preview, and ideally push a reversing journal (or Zoho delete by external_id) when a posted sale's source row is gone."
    },
    {
      "title": "Lot sell API accepts negative fees/shipping — inflates net proceeds and P/L (the exact hole the single-card sell path explicitly closed)",
      "file": "src/app/api/cards/lots/route.ts",
      "line": 131,
      "severity": "medium",
      "category": "input-validation",
      "detail": "op:'sell' passes p_fees: Number(body?.fees) || 0, p_ship_income, p_ship_cost straight through (lines 131-133); card_lot_sell validates only p_sale_price >= 0 (20260720140000_card_lots.sql:81) and card_sell likewise. The single-card server action validates every money input 0..10M with the comment 'the RPC only checks sale_price; a negative fee would inflate net proceeds and corrupt P/L' (src/app/cards/[id]/sell/actions.ts:28-39) — the lot route reintroduces it. Concrete failure: POST /api/cards/lots { op:'sell', lotId, salePrice:100, fees:-50 } (a stray minus from any card-access user) → children settle with negative allocated fees → net_proceeds = 100 - (-50) = 150, profit_loss overstated by $50, propagated into card_sales, the reports page, the CPA CSV, and the books ledger (where cardSaleLines flips the negative fee to the credit side and the entry still balances, so nothing catches it).",
      "fix": "Apply the same Number.isFinite && >= 0 && <= 10M validation to fees/shipIncome/shipCost in the lots route (and ideally inside card_lot_sell/card_sell)."
    },
    {
      "title": "Cancelling a settled LOT order strands the lot in status 'sold' — unreversible, unrelistable, and card_lot_unsell aborts on partially-reversed children",
      "file": "src/app/api/ebay/cancel-order/route.ts",
      "line": 58,
      "severity": "medium",
      "category": "unsell-reversal",
      "detail": "cancel-order reverses each matched card_sales row via card_unsell (lines 51-62) — which correctly matches lot-child refs ('orderId...:lot:<uuid>') — but never touches card_lots: the lot stays status='sold' with listing_refs.ebay stuck 'sold'. After that: card_lot_unsell refuses ('lot is not sold' guard passes but its first child card_unsell raises 'card is not sold', rolling back the whole call — 20260720140000_card_lots.sql:146-153); card_lot_sell refuses ('not sellable (status sold)'); /api/ebay/list-lot refuses ('Lot is sold.', src/app/api/ebay/list-lot/route.ts:34); and the nightly sync will forever skip this lot's listing (lot.status==='sold' → skipped, src/app/api/ebay/sync/route.ts:112), so if the eBay listing is relisted outside the app and sells, the revenue never books — silently counted as 'skipped'. The children's money is reversed correctly; the container is bricked with only archive-and-recreate as an escape. Same root cause: card_lot_unsell tolerates zero already-reversed children, so ANY partial manual unsell of one lot child (allowed via CardStatusControl) also permanently blocks op:'reverse' for that lot.",
      "fix": "In cancel-order, after reversing child sales, reset any lot whose order_ref matches (status → 'draft'/'listed', listing_refs.ebay.status → 'ended'); make card_lot_unsell skip children that are already not-sold instead of raising."
    },
    {
      "title": "CPA CSV pages card_sales on non-unique sold_at — lot sales guarantee tied timestamps, so page boundaries can duplicate or drop sale rows",
      "file": "src/app/api/cards/reports/route.ts",
      "line": 37,
      "severity": "medium",
      "category": "pagination-tiebreaker",
      "detail": "The year CSV pages 1000 rows at a time ordered ONLY by sold_at (lines 31-42). card_sales.sold_at defaults now() (20260713150000_cardops_init.sql:270), and card_lot_sell settles every child in one transaction, so a 30-card lot produces 30 rows with the identical sold_at; Postgres row order within equal keys is unspecified and can differ between the per-page queries. Concrete failure: a year with >1000 sales where a tie group straddles a 1000-row boundary → the CPA document (the artifact handed to the accountant) silently repeats some sales and omits others; its per-row sum then disagrees with the reports screen. This violates the audit's own rule that pagination needs a unique tiebreaker — the export route right next to it orders by id.",
      "fix": "Add .order('id', { ascending: true }) as a tiebreaker after sold_at."
    },
    {
      "title": "Reports page pages all card_sales on non-unique sold_at desc — same tie-at-boundary duplication/skip risk feeding every yearly/monthly/category sum",
      "file": "src/app/cards/reports/page.tsx",
      "line": 80,
      "severity": "medium",
      "category": "pagination-tiebreaker",
      "detail": "pageAll reads card_sales with .order('sold_at', { ascending: false }) and no tiebreaker (lines 77-80); those rows feed every realized figure on the page — yearly Sales/Fees/Net/Basis/P&L cards, the monthly and category P&L tables, and velocity. Same mechanism as the CSV route: lot settlements create many rows with identical sold_at, so once total sales exceed 1000, a tie group straddling a page boundary can double-count or drop sales, producing wrong on-screen money totals that differ run to run and disagree with the (differently-broken) CSV. The sibling reads on this very page ('open' cards) order by id — this one was missed.",
      "fix": "Add a unique tiebreaker (.order('id')) to the card_sales pageAll query."
    },
    {
      "title": "eBay sync's cancelled-order idempotency guard is a single unpaged read — truncates at 1000 rows and can re-settle a refunded order",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "medium",
      "category": "capped-read",
      "detail": "The durable guard that exists precisely to prevent 'double pool draw + phantom revenue on a refunded order' (20260720120000_card_unsell.sql:85-94) is read as db.from('ebay_cancelled_orders').select('order_ref') with no paging and no order (line 50-52). PostgREST caps it at 1000 rows and the returned subset is arbitrary. The table is append-only and never pruned, so once lifetime cancellations exceed 1000, a recently-cancelled order's ref can be absent from the Set while eBay's eventually-consistent feed (90-day window) still reports it PAID → the sync re-runs card_sell: a second pool draw and phantom revenue booked for an order whose buyer was refunded. Precondition is distant for a single seller today, but the read feeds an idempotency guard, the exact class the house rules require readAll for, and failure is silent money corruption.",
      "fix": "Use readAll with .order('order_ref') (or restrict the read to refs seen in the current order batch via .in())."
    },
    {
      "title": "eBay hub settled-state and 30-day sold stats fed by an unordered limit(1000) card_sales read — wrong 30d revenue/profit and false 'unsettled' flags past 1000 sales",
      "file": "src/app/api/ebay/hub/route.ts",
      "line": 78,
      "severity": "low",
      "category": "capped-read",
      "detail": "The hub reads card_sales platform='ebay' with .limit(1000) and no .order() (lines 74-78). That single read feeds (a) settledOrders, the membership Set that marks recent orders settled/unsettled (lines 81-83, 106, 120) and (b) sold30Count/sold30Total/profit30, displayed money stats (lines 110-118). Once lifetime eBay sales pass 1000, the 1000 rows returned are an arbitrary subset — recent sales can be the ones missing — so the 30-day revenue and profit tiles show wrong dollar figures and already-settled orders surface as unsettled (harmless to the books since re-settling is blocked by card_sell's already-sold guard and the unique order_ref index, but the operator is shown wrong numbers and a false to-do count).",
      "fix": "Order by sold_at desc (with id tiebreaker) so the 1000 kept rows are the newest — sufficient for both the 90-day order window and the 30-day stats — or page the read."
    }
  ]
}
```

---

## 3. find:crons  (phase: Find, agent aea7c055b1e46bc96, 148351 tokens, 699s)

```json
{
  "findings": [
    {
      "title": "Cancelled-order idempotency guard is read unpaged — silently capped at 1000 rows",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "high",
      "category": "unpaged-idempotency-guard",
      "detail": "runSync builds the re-settle guard with `db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` — no readAll, no .order(), no .range(). PostgREST silently caps this at 1000 rows, in arbitrary order. This Set is the ONLY thing preventing re-booking a refunded order: card_unsell (supabase/migrations/20260720120000_card_unsell.sql:62-73) DELETES the card_sales row and resets the card to status 'booked', so neither the unique (user_id, platform, order_ref) index nor the `c.status === \"sold\"` check at sync/route.ts:135 can block a re-settle, and the guard exists precisely because eBay's feed keeps reporting a seller-cancelled order as PAID/NONE_REQUESTED for a while (migration comment, lines 85-90). Failure scenario: ebay_cancelled_orders accumulates past 1000 rows (it is append-only, never pruned); a just-cancelled order lands outside the arbitrary first-1000 returned; the next cron run (or the owner's manual POST sync) sees the order still PAID, cancelState NONE_REQUESTED, not in the Set → card_sell re-books the refunded sale: phantom revenue, a second pool draw, and a card marked sold that was just un-sold. This is exactly the audit's 'membership set / idempotency guard must use readAll' class, new instance.",
      "fix": "Page the guard with readAll ordered by order_ref (the PK), and abort the run on truncation/error the same way cancelledErr already aborts. Cheaper alternative: query only the order_refs present in the current feed via .in(\"order_ref\", orderIds-chunked)."
    },
    {
      "title": "Alert notified_at is stamped even when zero pushes were delivered — crossing notification lost permanently",
      "file": "src/app/api/cron/card-alerts/route.ts",
      "line": 129,
      "severity": "medium",
      "category": "alert-dedup-fails-closed",
      "detail": "targetAlerts (lines 122-130) and pctAlerts (lines 174-182) call sendToAll and then unconditionally stamp card_alerts.notified_at. sendToAll (src/lib/push.ts:40-55) swallows every non-404/410 failure — 429s, 5xxs from the push service, network errors — returning { sent: 0, stale: [] } without throwing; its own comment says \"other failures: drop silently — next run retries\", but for these callers the next run does NOT retry, because notified_at is now set and the once-per-crossing dedup treats the alert as delivered. Failure scenario: FCM/APNs has a transient outage during the 11:10 run; every target/pct crossing that fired that day is marked notified with 0 notifications delivered; the user never hears about it unless the price un-crosses and re-crosses. moversDigest has the same shape (lines 248-254): movers_seen is written whether or not the digest push succeeded, so those movers are never re-announced while they remain in the window.",
      "fix": "Only stamp notified_at (and movers_seen) when r.sent > 0 or every device came back 404/410-stale; otherwise leave state untouched so the next run retries."
    },
    {
      "title": "Match-set reads discard errors and page on a non-unique key — PAID orders silently skipped, run reports ok",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 41,
      "severity": "medium",
      "category": "silent-partial-read",
      "detail": "The card match-set loop (lines 35-46) destructures only { data } — the error is discarded — and `if (!data || data.length < 1000) break` treats a failed page exactly like the final page. Failure scenario: a transient PostgREST error on page 1 yields an EMPTY match set; every PAID line then falls through `if (!card && !lot) continue` (line 96); the run returns ok with settled=0, and the GET path writes NO audit row at all because logging is gated on `out.settled.length || out.failures.length` (line 208) — so a persistent read failure means sales silently never book and nothing ever says so. Two adjacent instances of the same class: the pagination orders by created_at desc with no unique tiebreaker (line 42; bulk intake creates many cards with identical created_at, so page-boundary ties can drop a listed card from the set for that run), and the card_lots match set (lines 64-66) is entirely unpaged (1000-row cap) with its error also discarded.",
      "fix": "Check the page-read error and abort the run (like cancelledErr does); add .order(\"id\") as tiebreaker; page the lots read; log an audit row on clean-but-empty runs too."
    },
    {
      "title": "Overlapping card-estimates runs double-estimate and double-debit the credit ledger",
      "file": "src/app/api/cron/card-estimates/route.ts",
      "line": 123,
      "severity": "medium",
      "category": "overlap-non-idempotent",
      "detail": "The freshness guard is read-then-act with no claim, lock, or unique constraint: each run reads card_estimates (lines 79-84), computes candidates (95-107), then over minutes of sequential AI calls inserts card_estimates rows and credit_ledger debits per card (123-130). Failure scenario (explicit in the cutover model — Vercel's manual Run button can overlap the scheduled run inside the flexible window): run B reads estimates before run A's first insert, selects the same never-estimated/stalest candidates, and both runs insert an estimate AND a `-credits` credit_ledger row for the same card+mode on the same day — every card in the overlap is charged twice and the Anthropic/Card API spend doubles. card_estimates has no unique key (it is append-only history), so nothing rejects the duplicate.",
      "fix": "Take a per-run advisory lock (e.g. a claimed row in service_config or pg_try_advisory_lock via RPC) or re-check freshness immediately before each insert with a small conditional-insert RPC."
    },
    {
      "title": "Credits are debited even when the estimate insert fails; failure is also counted as success",
      "file": "src/app/api/cron/card-estimates/route.ts",
      "line": 126,
      "severity": "medium",
      "category": "unchecked-write-before-charge",
      "detail": "After runEstimate succeeds, the card_estimates insert's error is never checked (lines 123-127) and the credit_ledger debit (128-130) plus made++ run unconditionally. Failure scenario: a transient DB error on the insert → the estimate is lost (unlike the manual route, where the user at least receives the value in the response — src/app/api/cards/estimate/route.ts:81-90), the user's ledger is debited anyway, and because no estimate row exists the next nightly run re-estimates the same card and debits again — repeatable charge for zero stored work.",
      "fix": "Check the insert error; only debit (and count made++) when the estimate row actually persisted, otherwise record it in failed/errors."
    },
    {
      "title": "Daemon reprice rotation cursor never advances for unchanged cards — tail of a large inventory is never repriced",
      "file": "src/app/api/cards/daemon/route.ts",
      "line": 143,
      "severity": "medium",
      "category": "starvation",
      "detail": "repriceUser selects each user's `share` least-recently-priced cards (lines 122-129) but writes last_priced_at only inside `if (mv != null && mv !== prev)` (143-151). A scanned card whose value is unchanged — which includes EVERY card with no comps, since computeMarketValue falls back to the existing market_value (src/lib/cards/valuation.ts:279-281) — keeps its old last_priced_at, so the next night selects the identical head window; the note at line 131 ('the rest rotate in on the next run') is untrue. Contrast price-refresh, which advances the cursor for every touched card precisely to make rotation work (src/app/api/cron/price-refresh/route.ts:165-166). Failure scenario: a member holds more live cards than their share (REPRICE_BUDGET/users, e.g. 2000 at two users) and the head cards are comp-less or stable → tail cards are never scanned: their market_value never re-derives as comps age, and value_30d/value_365d are never populated. Members are hit hardest because the only external cursor-advancer, price-refresh, gives the owner first claim on all 100 daily slots (price-refresh/route.ts:52-61) — with an owner holding ≥100 live cards, a member's last_priced_at is never advanced by anything else.",
      "fix": "After the scan loop, bulk-update last_priced_at for every scanned card (as price-refresh does), or order the scan on a dedicated cursor column."
    },
    {
      "title": "card-estimates: one user's read error aborts all later users; 300s timeout plus unordered iteration starves the same users daily",
      "file": "src/app/api/cron/card-estimates/route.ts",
      "line": 68,
      "severity": "medium",
      "category": "partial-failure-blast-radius",
      "detail": "Two mechanisms cut off later users. (1) The per-user readAll calls (lines 68-73, 79-84) throw on any page error and are NOT wrapped per-user (unlike card-alerts and the daemon, which try/catch each user) — a transient PostgREST error on user #1's card_estimates read 500s the entire route and users 2..N get no estimates that day. (2) The run plans up to GLOBAL=80 sequential estimates (each = a Card API fetch + 3 DB reads + an Anthropic call, several seconds each; 'deep' users use the large model) against maxDuration=300 (line 18) — 80 × ~4-15s far exceeds 300s, so Vercel kills the function mid-loop. Because the prefs read has no .order() (lines 43-44), iteration order is unspecified but in practice stable, so the SAME trailing users sit past the cut every day; any earlier user with >280 live cards (20/day × 14-day staleness) perpetually regenerates ≥20 candidates and permanently consumes the head of the run. Per-card work already committed survives the cut, so the damage is pure starvation plus a lost response/metrics.",
      "fix": "Wrap each user's pass in try/catch (record in errors, continue); rotate fairness (e.g. order prefs by a last-run cursor); track elapsed time and stop cleanly before the deadline."
    },
    {
      "title": "card-alerts pagination has no .order() at all on the alert reads",
      "file": "src/app/api/cron/card-alerts/route.ts",
      "line": 109,
      "severity": "low",
      "category": "nondeterministic-pagination",
      "detail": "The readAll builders for card_alerts pass .range() with no .order() whatsoever (targetAlerts lines 108-115, pctAlerts lines 149-156) — a direct violation of the house pagination rule. Failure scenario: a user with >1000 alert rows gets nondeterministic pages; a row can vanish between pages (its crossing is never evaluated that run — missed/late notification) or repeat (the push fires twice within one run, since the send happens before the notified_at stamp). Secondary instance: the moversDigest history read (lines 228-235) orders on non-unique ts, and price-refresh's bulk history insert (price-refresh/route.ts:164) stamps up to 100 rows across different cards with an identical ts, so page-boundary ties there can drop a card's newest point from the digest computation once a user's 90-day history exceeds 1000 rows.",
      "fix": "Add .order(\"card_id\") to the alert reads and a unique tiebreaker (.order(\"id\")) to the history reads."
    },
    {
      "title": "Overlapping runs double-push card-news and double-spend the price-refresh Card API budget",
      "file": "src/app/api/cron/card-news/route.ts",
      "line": 129,
      "severity": "low",
      "category": "overlap-non-idempotent",
      "detail": "Only the row writes are overlap-safe. card-news: two concurrent runs (manual Run overlapping scheduled) both pass the `.in(\"url\", ...)` dedup check before either upserts (lines 89-92), so both score the same headlines with Haiku (double AI spend) and both send the owner the movers digest push (lines 129-142) — duplicate notifications for identical headlines; the upsert at line 120 dedups rows only. price-refresh: the rotation cursor advances only at end-of-run (price-refresh/route.ts:166), so an overlapping run selects the same oldest-100 slice — double billable Card API calls against the 5,000/day budget and duplicate same-day 'daily' rows in card_price_history for every card in the slice (line 164); the delete-then-insert on card_source_quotes (lines 134-139) can also interleave to leave duplicated quote rows until the next refresh.",
      "fix": "A cheap shared run-guard (claimed row keyed on job+date, or advisory lock) covers both; for price-refresh alone, advancing last_priced_at at selection time also closes it."
    },
    {
      "title": "getOrders caps at 300 orders with no truncation signal",
      "file": "src/lib/ebay/orders.ts",
      "line": 110,
      "severity": "low",
      "category": "silent-truncation",
      "detail": "The fetch loop runs offsets 0/100/200 (`for offset < 300`), so at most 300 orders from the 90-day window are ever examined, and nothing marks the result truncated — sync treats it as the complete feed. Failure scenario: a seller exceeds 300 orders in the rolling 90 days (≈3.3/day, plausible after a reconnection backlog or a hot streak); whichever orders fall past eBay's first 300 for this filter are never seen, so any still-unsettled PAID sale among them simply never books and no failure, note, or audit row says so. Which 300 survive depends on eBay's default sort, which the query does not pin.",
      "fix": "Loop until a short page (like the DB readAll), pin the sort explicitly, and surface a truncated flag to runSync if a hard cap is kept."
    }
  ]
}
```

---

## 4. find:ebay  (phase: Find, agent a09ff983ae95a6233, 142661 tokens, 628s)

```json
{
  "findings": [
    {
      "title": "Order cancelled/refunded on eBay's side after settlement is never reversed — phantom revenue and pool draw persist silently",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 84,
      "severity": "high",
      "category": "money-correctness",
      "detail": "The sync's cancellation handling only PREVENTS settling (line 81 skips non-PAID, line 84 skips any cancelState != NONE_REQUESTED, line 85 skips the local guard). There is no branch anywhere that detects 'this order was ALREADY settled and is now cancelled/refunded' and reverses it. The only reversal path is /api/ebay/cancel-order (src/app/api/ebay/cancel-order/route.ts:51-62), which fires solely when the owner cancels FROM CardOps. Concrete failure: day 1 an order settles — card_sell books the sale, draws pool basis, marks the card sold. Day 2 the buyer requests cancellation and the owner approves it in the eBay app (or eBay refunds via a return); eBay refunds the buyer. Next sync: order.cancelState = 'CANCELED' (or paymentStatus = 'FULLY_REFUNDED') → `continue` → the card_sales row, profit_loss, and the pool draw all stand forever; the card stays status 'sold' although it is physically back in inventory. Books permanently overstate revenue and understate pool count with zero warning — the run reports ok. Same hole for lot sales (card_lot_unsell is never invoked by sync). The route's header comment ('re-running is always safe') is true for double-booking but the reverse direction was never built, and it is not listed in reference/cardops-backlog.md as planned.",
      "fix": "In runSync, when an order is skipped for cancelState/refund reasons, check whether its order_ref (base id or 'id:%' children) exists in card_sales; if so, either auto-reverse via card_unsell/card_lot_unsell (mirroring cancel-order/route.ts) or at minimum report it in `failures` so the owner is told the books hold a refunded sale."
    },
    {
      "title": "Cancelling a lot order reverses the child sales but strands the lot in status 'sold', and the repair RPC then always throws",
      "file": "src/app/api/ebay/cancel-order/route.ts",
      "line": 58,
      "severity": "medium",
      "category": "state-wedge",
      "detail": "When a lot sells, sync calls card_lot_sell which books each child via card_sell with order_ref 'O:lot:<cardId>' and sets card_lots.status='sold' (supabase/migrations/20260720140000_card_lots.sql:116-121). cancel-order's reversal query (.or order_ref.eq.O / like O:%) matches those child rows and calls card_unsell per CHILD (lines 51-62) — children revert to 'booked', pool restored — but card_lot_unsell is never called, so the lot row stays status='sold' with listing_refs.ebay.status='sold'. From that state every recovery path is blocked: lots op 'reverse' calls card_lot_unsell, which passes its own status check (lot IS 'sold') then re-runs card_unsell on each already-reversed child → raises 'card is not sold' → the whole call aborts (migration 20260720140000:146-153); list-lot returns 400 'Lot is sold.' (src/app/api/ebay/list-lot/route.ts:34); lots 'sell' raises 'not sellable'; add/remove are blocked ('Can't change a sold lot'). The lot — its SKU, title, weights — is permanently wedged; only archiving it and rebuilding a new lot (or manual DB surgery) recovers. Money is correct after the reversal; the wedge is the defect.",
      "fix": "In cancel-order, detect lot-style order_refs (':lot:' suffix), resolve the lot_id, and call card_lot_unsell ONCE for the lot instead of card_unsell per child — it reverses the children and reopens the lot atomically. Also flip the lot's listing_refs.ebay.status off 'sold'."
    },
    {
      "title": "getOrders silently caps at 300 orders — sales beyond the cap never settle and nothing reports the truncation",
      "file": "src/lib/ebay/orders.ts",
      "line": 110,
      "severity": "medium",
      "category": "silent-data-loss",
      "detail": "The pagination loop is `for (let offset = 0; offset < 300; offset += 100)` — a hard 3-page ceiling with no truncation signal. Concrete failure: connect an eBay account with 350 PAID orders inside the 90-day window (first backfill, or the sync button unused for a stretch — the cron is currently 401-by-design so backfills via the button are the norm): getOrders returns exactly 300, runSync settles matches among them, and the remaining 50 orders are invisible — their cards stay 'listed', their revenue never books, and the response reports `checked: 300` with ok:true. Orders that then age past the 90-day filter are lost to the sync permanently. The hub route (src/app/api/ebay/hub/route.ts:35) shares the cap, so the 'unsettled' counter can't even flag them.",
      "fix": "Loop until a short page (like readAll) with a generous safety cap, and return a `truncated` flag that runSync surfaces in `failures`/the response instead of silently reporting a clean run."
    },
    {
      "title": "Sync match-set reads break the codebase's own paging rules: created_at paging with no unique tiebreaker, and the lot set not paged at all",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 42,
      "severity": "medium",
      "category": "unpaged-read",
      "detail": "Two new instances of the class the 2026-07-24 audit fixed (src/lib/supabase/page.ts documents both rules). (a) Lines 35-44 page the cards match set with `.order(\"created_at\", { ascending: false }).range(...)` — no unique tiebreaker. Bulk intake inserts stamp identical created_at on whole batches, so once >1000 ever-listed cards exist the slice boundaries are non-deterministic: a listed card can vanish between pages, drop out of byListingId/bySku, and its PAID order silently doesn't settle that run (falls into no bucket — not settled, not skipped, not failed). (b) Lines 64-66 read the card_lots match set with NO paging or order at all — PostgREST silently returns 1000 rows, so past 1000 lots-with-refs a sold lot's order silently never settles. (c) The card loop's 20000 hard cap has no truncated signal either. page.ts's own header calls this exact pattern out: 'rows can repeat/vanish between pages'.",
      "fix": "Use readAll/readAllSafe from src/lib/supabase/page.ts for both match sets with `.order(\"created_at\", ...).order(\"id\")` as tiebreaker, and surface `truncated` as a sync failure."
    },
    {
      "title": "ebay_cancelled_orders idempotency-guard read is unpaged — past 1000 rows a refunded order can be re-settled",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "low",
      "category": "unpaged-read",
      "detail": "`db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` is a single request with no .order() and no paging, feeding the guard Set that is the ONLY durable defense against re-settling a seller-cancelled order while eBay's feed still reports it PAID (the code aborts if the read ERRORS, but a silent 1000-row cap is not an error). Rows are never pruned, the table has no user_id (the service-role cron path reads every user's rows into the same 1000 budget), so once it exceeds 1000 rows, which 1000 come back is unspecified — a cancelled order missing from the Set during eBay's eventual-consistency window gets re-settled: double pool draw plus phantom revenue on a refunded order, the exact failure the guard exists to prevent (migration 20260720120000_card_unsell.sql:85-94). Distant today, but this is verbatim the 'idempotency guard' class the house rules mandate readAll for.",
      "fix": "Read the guard with readAll (ordered by order_ref) — and since sync already knows the order ids it fetched, an `.in(\"order_ref\", batchIds)` filtered read would also bound it correctly."
    },
    {
      "title": "Fee estimate applies eBay's $0.30 per-ORDER fixed fee once per LINE on combined orders",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 104,
      "severity": "low",
      "category": "fee-math",
      "detail": "When order.marketplaceFee is absent (common until payout data lands), each matched line books `estimateFee(salePrice + shipIncome)` where estimateFee = gross*13.25% + $0.30 (line 23, whose own comment says '$0.30 per order'). eBay charges the $0.30 once per order, but a combined checkout with n matched lines books it n times: a 3-card combined order overstates fees by $0.60, understating profit_loss on card_sales rows and the books rows built from them. The percentage part splits correctly; only the fixed part is duplicated.",
      "fix": "Compute the order-level estimate once (13.25% of order gross + $0.30) and allocate it by the same `share` used for actual fees, mirroring the marketplaceFee branch on line 102-103."
    },
    {
      "title": "Relist trusts only local sold status — a sold-but-unsynced auction can be relisted, enabling a double sale that then books as benign 'skipped'",
      "file": "src/app/api/ebay/relist\\route.ts",
      "line": 33,
      "severity": "low",
      "category": "state-transition",
      "detail": "relist guards exclusively on the LOCAL card status (line 33 pre-check, lines 64-69 the .neq('status','sold') write guard). Sync is manual/daily, so there is a window where an auction has sold on eBay but the card is still locally 'listed'. eBay's Trading RelistItem explicitly permits relisting SOLD items, so relist succeeds: listing_refs.ebay.listing_id is overwritten with the new item id and status set 'listed'. The next sync can't match the sale by the old listing id (overwritten) but DOES match via the bySku fallback (sync/route.ts:91-92) and settles it — leaving a LIVE eBay listing for a card whose only copy is sold and owed to buyer 1. When buyer 2 purchases the relist, card_sell raises 'card already sold', which the sync regex classifies as benign noise (`skipped++`, sync/route.ts:147) — buyer 2's revenue never books and no failure is surfaced; the owner learns of the double-sale from eBay, not CardOps.",
      "fix": "Before relisting an auction, check the old item's eBay-side selling status (Trading GetItem SellingStatus/ListingStatus or presence of the order in the fulfillment feed) and refuse when it sold; and stop counting 'already sold' as benign when the order_ref differs from the card's existing sale's order_ref."
    },
    {
      "title": "Hub money stats computed from an unordered 1000-row slice of card_sales",
      "file": "src/app/api/ebay/hub/route.ts",
      "line": 74,
      "severity": "low",
      "category": "unpaged-read",
      "detail": "Lines 74-78 read card_sales with `.limit(1000)` and NO .order(); lines 81-85 build the settledOrders membership Set and the 30-day sums from it, and lines 49-53 cap the cards match map the same way. Once eBay card_sales rows exceed 1000, which rows PostgREST returns is unspecified, so sold30Total/profit30 (dollar figures shown as fact), the per-order 'settled' badge, and the 'unsettled' counter are all computed from an arbitrary subset — an actually-settled order can show unsettled and vice versa. Display-only (no money writes), but it presents wrong dollar totals and wrong settle-state to the operator, and the audit's rule mandates complete reads for any Set/SUM. At minimum the sales read should be ordered sold_at desc so the recent-30-day stats stay correct as volume grows.",
      "fix": "Order the card_sales read by sold_at desc (with id tiebreaker) so the 1000 newest rows always cover the 30-day stats window, and derive settledOrders via readAll or a filtered read over the order ids actually on screen."
    }
  ]
}
```

---

## 5. find:auth-roles  (phase: Find, agent ac3df5bfd26c36b3f, 241673 tokens, 710s)

```json
{
  "findings": [
    {
      "title": "100-cards/day member cap is bypassable: client-settable created_at and a statement-concurrency race",
      "file": "supabase/migrations/20260724000000_multi_tenant_cards.sql",
      "line": 85,
      "severity": "medium",
      "category": "role-gate-bypass",
      "detail": "The member cap is enforced only by enforce_daily_card_cap(), an AFTER INSERT FOR EACH STATEMENT trigger that counts `cards where user_id = auth.uid() and created_at >= date_trunc('day', now())` (lines 81-93). Two concrete bypasses. (1) created_at is an ordinary client-writable column: the cards RLS policy (cards_own, lines 38-40) checks only has_card_access() and user_id = auth.uid(), so a card_ops member can POST directly to PostgREST with the public anon key + their own JWT and insert any number of rows with created_at backdated (e.g. '2020-01-01'); the trigger's today-count sees 0 and the statement passes — unlimited cards in one request, no app code involved. (2) Read-committed race: the trigger's count cannot see a concurrent uncommitted transaction, so N parallel requests of 100 rows each (e.g. concurrent importCards server-action calls from src/app/cards/actions.ts:169-219, which take no lock) each count only their own 100 and all commit — 100×N cards/day. speed_book_commit happens to serialize on the pool row lock, but /cards/new, full intake, and CSV import have no such lock. This is the documented isolation guarantee in reference/next-steps.md:89 ('capped at 100 new cards/day'). Fix: have the trigger take a per-user advisory lock (pg_advisory_xact_lock(hashtext(auth.uid()::text))) before counting, and count by a server-stamped column the client cannot set (or force created_at via a BEFORE trigger).",
      "fix": "In enforce_daily_card_cap(): take pg_advisory_xact_lock keyed on auth.uid() before the count, and add a BEFORE INSERT trigger that overwrites created_at with now() for non-service-role inserts so it cannot be backdated."
    },
    {
      "title": "Nightly paid-spend crons keep spending on revoked members — work is enumerated from data, not the role roster",
      "file": "src/app/api/cron/price-refresh/route.ts",
      "line": 63,
      "severity": "medium",
      "category": "role-revocation",
      "detail": "Demoting a member (update profiles set role = null/'member') locks them out of the app (proxy.ts, currentRole gates), but three service-role crons that spend real money never consult profiles.role: (1) price-refresh route.ts:62-72 fills the daily billable TheCardAPI budget from `cards ... not user_id is null ... neq user_id ownerId` — every non-owner user's cards qualify forever, so a revoked member's inventory keeps consuming the owner-paid CAP=100 rotation and billable Card API calls nightly (the comment at lines 42-46 says this budget is 'billable calls on Beau's key'); (2) card-estimates route.ts:43-46 iterates card_user_prefs rows `.neq('auto_estimate','off')` with no role filter — a revoked member's saved prefs row keeps triggering up to PER_USER=20 Anthropic estimates per night on the owner's key, metered as credits to a user who can no longer even log in; (3) card-news route.ts:56-60 fills the AI-scored subject cap from all non-owner cards regardless of role. Contrast: the daemon (src/app/api/cards/daemon/route.ts:63-64) and card-alerts (src/app/api/cron/card-alerts/route.ts:71-72) both correctly roster from `profiles.role in ('owner','card_ops')`. Failure scenario: owner revokes an invitee who had 500 cards and auto-estimates on; every night thereafter the owner's Anthropic and TheCardAPI keys are billed for that dead inventory, indefinitely, with no surface to notice it (the member can't see their own app anymore).",
      "fix": "In all three crons, load the `profiles.role in ('owner','card_ops')` roster first (as daemon/card-alerts do) and filter cards/prefs/subjects to those user_ids."
    },
    {
      "title": "card_lot_sell never checks lot ownership — asymmetric with the patched card_lot_unsell",
      "file": "supabase/migrations/20260720140000_card_lots.sql",
      "line": 71,
      "severity": "low",
      "category": "auth-gap",
      "detail": "20260733000000_card_sales_tenancy.sql §5 re-gated card_unsell to owns_card() and card_lot_unsell to `l.user_id = auth.uid()`, explicitly noting 'Those two functions ALSO never check that the card or lot belongs to the caller' — but the SELL twin was left alone: card_lot_sell (SECURITY DEFINER, current definition at 20260720140000_card_lots.sql:71-73) gates only on `has_card_access() or service_role` and then locks/settles whatever p_lot_id it is given, reading card_lot_items with RLS bypassed. The per-child card_sell owns_card() check saves the money path when the victim's own cards are in the lot (the whole transaction rolls back), but combined with the documented-unfixed card_lot_items lot_id gap a member can: add their OWN cards to another user's lot id (card_lot_items with-check is owns_card(card_id) only), then call card_lot_sell on that foreign lot — every child passes owns_card for the caller, and line 121 flips the OTHER user's card_lots row to status='sold' (wrong-user data mutation; the victim's lot is now un-editable per the lots route's assertEditable and shows as sold with none of their sales). The reverse direction is blocked (card_lot_unsell checks l.user_id). Reachable via POST /api/cards/lots {op:'sell'} (src/app/api/cards/lots/route.ts:124-137), which passes lotId straight through.",
      "fix": "Mirror the unsell gate: in card_lot_sell require `exists (select 1 from card_lots l where l.id = p_lot_id and l.user_id = auth.uid()) or auth.role() = 'service_role'`."
    },
    {
      "title": "CPA sales CSV pages on a non-unique order (sold_at only) — rows can duplicate or vanish at page boundaries",
      "file": "src/app/api/cards/reports/route.ts",
      "line": 37,
      "severity": "low",
      "category": "pagination-determinism",
      "detail": "The owner tax report pages card_sales 1000 at a time ordered only by `.order('sold_at', ascending)` (lines 31-42). sold_at is not unique — concurrent card_sell transactions and eBay-sync settlements can share a timestamp — and the house rule (reference/audit-2026-07-24.md; src/lib/supabase/page.ts:14-15) requires a unique tiebreaker precisely because Postgres gives no stable order among ties: with >1000 sales in a year and a tie straddling a page boundary, a sale can appear twice or be silently dropped from the CSV handed to the CPA (over/under-stated income in a filed return, HTTP 200, no signal). Same class, same file-family as the audit's fixed instances (books/post orders by id, movers added id tiebreaker) — this route missed the sweep. The journal CSV export has the same latent tie: src/app/api/cards/books/journal/route.ts:38-41 orders by (entry_date, source_ref, line), and an 'advance' receipt writes TWO entries sharing source_ref with identical line numbers 0..n (src/app/api/cards/receipts/route.ts:91-96), so (entry_date, source_ref, line) is not unique either.",
      "fix": "Append `.order('id', { ascending: true })` as the final tiebreaker in both reads (reports route line 37; books/journal route line 41)."
    },
    {
      "title": "eBay sync's cancelled-order idempotency guard is read unpaged — silently truncates at PostgREST's 1000-row cap",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "low",
      "category": "postgrest-cap",
      "detail": "runSync builds the durable never-re-settle guard from `db.from('ebay_cancelled_orders').select('order_ref')` with no .range()/.order() (lines 50-52) — PostgREST caps this at 1000 rows and returns success. The code correctly aborts on a read ERROR ('settling blind risks re-booking a refunded order'), but a truncated read is indistinguishable from a complete one, so once the table exceeds 1000 rows (it is append-only, never pruned, shared with Master-Ops which writes the same table, and cancel-order upserts one row per seller-cancel at src/app/api/ebay/cancel-order/route.ts:45-47) any cancelled order whose row falls outside the first 1000 loses its guard: eBay's eventually-consistent feed still reports the order PAID for a window after cancellation, the sync no longer sees it in cancelledOrders, and card_sell re-books the refunded sale — a duplicate sale row, a second pool-basis draw, and phantom revenue. This is exactly the house-rule class ('readAll required for anything feeding an idempotency guard'). Low because reaching 1000 lifetime seller-cancels is distant for a solo seller — but the failure is silent money corruption when it lands.",
      "fix": "Use readAll from src/lib/supabase/page.ts with `.order('order_ref')` (or page manually), and fail the sync if the guard read cannot be completed."
    }
  ]
}
```

---

## 6. find:validation-input  (phase: Find, agent a9acf8202bb936953, 213817 tokens, 696s)

```json
{
  "findings": [
    {
      "title": "updateCard accepts any status — flips sold cards back to live (double-sell) and lets the owner mark cards sold with no sale booked",
      "file": "src/app/cards/actions.ts",
      "line": 133,
      "severity": "critical",
      "category": "input-validation / money-correctness",
      "detail": "fields() passes `status: str(formData.get(\"status\")) ?? \"booked\"` (line 92) straight into the cards UPDATE with no whitelist and no transition rules, and the edit form (src/components/cards/CardForm.tsx:180-182) offers every CARD_STATUSES value including 'sold'. The DB trigger guard_card_sale (supabase/migrations/20260713170000_card_sell_rpc.sql:83-99) only fires on transitions TO 'sold' (and edits of basis_drawn/sold_at) and exempts the owner entirely; it was never redefined by any later migration. Two concrete failures: (1) ANY card user edits a sold card and picks any other status (e.g. 'booked', thinking it un-sells): the update passes — the trigger condition `new.status='sold'` is false and updateCard never touches basis_drawn/sold_at. The card_sales row and the pool draw remain, the card re-enters live inventory (NAV double-counts it against its still-booked P/L), and card_sell (20260733000000_card_sales_tenancy.sql:72 — only refuses when status='sold') will happily sell it AGAIN: second card_sales row (order_ref null escapes the unique index), second pool draw → duplicated revenue and double-drawn basis in /api/cards/books/post. The unsell route's own comment (src/app/api/cards/unsell/route.ts:12-15) claims \"the guard trigger blocks a manual status reset\" — it does not. (2) The OWNER picks 'sold' in the edit form: is_owner() passes the trigger, so the card is marked sold with NO card_sales row, no basis draw, no P/L — inventory silently vanishes from the books. The bulk route explicitly blocks exactly this (src/app/api/cards/bulk/route.ts:47-49 \"Use the sell flow\" and :91 `.neq(\"status\",\"sold\")`); the single-card edit path has neither guard. Same gap in createCard (line 121): an INSERT with status='sold' bypasses the BEFORE UPDATE trigger entirely.",
      "fix": "In updateCard: whitelist status against CARD_STATUSES, reject 'sold' (point at the sell flow, like bulk does), and refuse any status change when the current row's status is 'sold' (require card_unsell). In createCard: reject status 'sold' on insert. Consider extending guard_card_sale to also block leaving 'sold' outside cardops.in_sell."
    },
    {
      "title": "Lot sell accepts negative/unvalidated fees and shipping — corrupts P/L; the identical bug was fixed on the single-card path but missed here",
      "file": "src/app/api/cards/lots/route.ts",
      "line": 124,
      "severity": "high",
      "category": "input-validation / money-correctness",
      "detail": "op:\"sell\" passes `p_fees: Number(body?.fees) || 0`, `p_ship_income: Number(body?.shipIncome) || 0`, `p_ship_cost: Number(body?.shipCost) || 0` (lines 131-133) with no sign, finiteness, or magnitude checks. card_lot_sell validates ONLY p_sale_price (supabase/migrations/20260720140000_card_lots.sql:81) and folds the raw values into each child's allocated card_sales rows and P/L (lines 101-110). Concrete failure: fees typed as -50 (stray minus) → net proceeds inflated by $100 relative to truth, profit_loss wrong on every child sale, and /api/cards/books/post then writes the wrong cash/fees lines into journal_entries and onward to the Zoho push. The single-card sell action fixed exactly this class after day-review — src/app/cards/[id]/sell/actions.ts:28-39 comments \"the RPC only checks sale_price; a negative fee would inflate net proceeds and corrupt P/L\" and clamps every money input to [0, 10M] finite — but the lot route was left unguarded. Also: `salePrice` from JSON `1e999` parses to Infinity and passes `salePrice > 0` (line 126); supabase-js serializes it to null so the RPC rejects it — noisy but safe; the negative-fee path is the silent one.",
      "fix": "Apply the same validation as sellCard: every money field must be Number.isFinite, >= 0, and <= 10_000_000 before calling card_lot_sell (and ideally add the checks inside the RPC too)."
    },
    {
      "title": "eBay sync cancelled-order idempotency guard read is unpaged, unordered, and unfiltered — silent truncation re-settles refunded orders",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "high",
      "category": "pagination / idempotency-guard (house-rule class)",
      "detail": "`db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` has no .range()/.order() and, on the cron path (GET, service client, line 193-200), no user filter — PostgREST silently caps it at 1000 rows, and without an order the returned subset is nondeterministic. This read feeds the cancelledOrders Set (line 52) that is the DURABLE guard against re-settling a seller-cancelled order that eBay's eventually-consistent feed still reports PAID (comment lines 47-49, and cancel-order writes the marker for exactly this race — src/app/api/ebay/cancel-order/route.ts:41-47). Concrete failure: once the shared table exceeds 1000 rows (it is shared across users and never pruned), a cancelled order's ref can fall outside the returned page → the guard misses it → the loop re-books the refunded sale through card_sell/card_lot_sell with a fresh order_ref check pass — duplicated revenue and a second pool draw for a sale that was reversed. This is precisely the audit's \"readAll required for anything feeding an idempotency guard\" class (src/lib/supabase/page.ts:10-15), reintroduced in the one place that guards against double-booking money.",
      "fix": "Use readAll/readAllSafe with `.order(\"order_ref\")` (fail closed on error, which the code already does for the error case), and on the cron path filter by the connected seller's user_id if the table has one."
    },
    {
      "title": "eBay sync lot match-set read capped at 1000 — lot sales beyond the cap silently never book",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 64,
      "severity": "medium",
      "category": "pagination / silent-data-loss (house-rule class)",
      "detail": "The cards match-set directly above is explicitly paged with the comment \"a fixed .limit could silently drop listed cards\" (lines 34-45), but the card_lots read (`db.from(\"card_lots\").select(...).not(\"listing_refs\",\"eq\",\"{}\")`, lines 64-66) has no paging and no order — PostgREST caps it at 1000 rows. Concrete failure: with >1000 lots carrying listing_refs, a listed lot can be absent from lotByListingId/lotBySku; when its PAID order arrives, `if (!card && !lot) continue;` (line 96) silently skips the line — the sale is never settled through card_lot_sell, no card_sales rows are written, the lot stays 'listed', and nothing surfaces in `failures`. The revenue is simply missing from the books until someone notices manually. Same membership-set class the audit fixed for cards in this very function.",
      "fix": "Page the card_lots read exactly like the cards read above it (stable .order + .range loop, or readAll)."
    },
    {
      "title": "Receipt DELETE ignores both delete errors — can leave orphaned double-entry lines in the ledger while reporting success",
      "file": "src/app/api/cards/receipts/route.ts",
      "line": 121,
      "severity": "medium",
      "category": "error-handling / money-correctness",
      "detail": "DELETE runs `await supabase.from(\"journal_entries\").delete()...` (line 121) and `await supabase.from(\"card_receipts\").delete()...` (line 122) discarding BOTH results, then unconditionally returns `{ ok: true }`. Concrete failure: a transient error on the journal_entries delete (network blip, statement timeout) followed by a successful receipt delete leaves the receipt's balanced Dr/Cr lines in journal_entries forever — the owner-facing journal CSV export and the Zoho connector push (which reads journal_entries by entity, src/app/api/cards/connectors/push/route.ts:72-84) will carry an expense whose source receipt no longer exists, and nothing rebuilds the receipt slice (books/post only rebuilds source='card_sale'). The POST handler in the same file goes to great lengths for the mirror invariant (\"never claim success without the double-entry actually landing\", lines 100-103); DELETE has no equivalent. The storage-object removal failure (line 119) is deliberately best-effort, but the two row deletes are not distinguishable from it as written.",
      "fix": "Check both delete errors; delete the receipt first only after the journal delete succeeds (or verify remaining rows), and return 500 with a re-run instruction on any failure."
    },
    {
      "title": "addComp: insert errors swallowed and negative prices / arbitrary date strings accepted — silent comp loss and poisoned market_value",
      "file": "src/app/cards/[id]/value/actions.ts",
      "line": 81,
      "severity": "medium",
      "category": "input-validation / error-handling",
      "detail": "addComp inserts into card_comps without checking the result: `await supabase.from(\"card_comps\").insert({...})` (lines 81-89) — a failed insert (e.g. sale_date \"abc\" rejected by the date column, or any constraint error) is invisible; recompute() then runs and the page revalidates, so the user believes the comp was recorded (silent data loss in the pricing evidence trail). Separately, sale_price only has to be a finite number (num(), line 17-21): a negative price (typo \"-120\") is inserted and flows into computeMarketValue — with 'min' or 'last_sale' aggregates the card's market_value goes negative, which then drives the NAV snapshot sum (daemon snapshotUser), the insurance/export CSVs (_market), and the eBay list price default. sale_date is also passed as a raw string with no shape check at all (line 88) — contrast comps/import which at least regex-checks, and coerceDate which exists for this purpose.",
      "fix": "Check the insert error and surface it; require sale_price > 0 (and a sane ceiling); validate sale_date with coerceDate or reject."
    },
    {
      "title": "Comps importer trusts model-emitted dates after a shape-only regex — an impossible date 500s the whole import batch",
      "file": "src/app/api/cards/comps/import/route.ts",
      "line": 103,
      "severity": "low",
      "category": "untrusted-model-output validation",
      "detail": "Model output sale_date is checked only with `/^\\d{4}-\\d{2}-\\d{2}$/` (line 103) before being inserted into the card_comps `sale_date` date column. src/lib/books/date.ts:2-5 documents this exact trap: \"Vision/model output ... can produce shape-valid-but-impossible dates (e.g. '2026-13-45') that pass a regex but make Postgres' date column throw on insert\" — and coerceDate exists to fix it, but this route doesn't use it. Concrete failure: the model normalizes a relative date badly and emits \"2026-06-31\" (or \"2026-13-05\") for one sale → the single batched insert (line 119) fails with a Postgres date error → the entire paste import returns 500 and zero comps land, with an opaque error. Model-emitted `grade` (z.number) is also unbounded — negative or 100 grades create comps that only match garbage buckets, silently diluting dedupe keys. sale_price is properly bounded (line 101).",
      "fix": "Round-trip each date through coerceDate (or drop the row's date), and clamp grade to [0, 10] with halves."
    },
    {
      "title": "Receipts POST: sub-cent amounts pass `> 0`, get stored as $0.00, and never post a ledger entry — violating the route's own no-orphan invariant",
      "file": "src/app/api/cards/receipts/route.ts",
      "line": 53,
      "severity": "low",
      "category": "input-validation / money-correctness",
      "detail": "Validation is `if (!(amount > 0))` (line 53), so amount 0.004 passes. numeric(12,2) (supabase/migrations/20260721010000_card_receipts.sql:11) rounds it to 0.00 in card_receipts, while receiptEntries round2s it to 0 and returns [] (src/lib/books/journal.ts:129-130). With jrows empty, the journal insert AND the rollback branch are both skipped (lines 97-106) and the route returns ok with posted:false — a saved receipt with no double-entry and, per the route's own comment (line 100-102), \"no separate re-post path\". The receipt list and the ledger permanently disagree. The POST's whole rollback design exists to prevent exactly this state.",
      "fix": "Require amount >= 0.01 (and finite, with a sane ceiling) before insert, i.e. validate round2(amount) > 0 — the same value receiptEntries will use."
    },
    {
      "title": "CPA sales CSV pages on non-unique sold_at with no tiebreaker — rows can be skipped or duplicated across page boundaries",
      "file": "src/app/api/cards/reports/route.ts",
      "line": 37,
      "severity": "low",
      "category": "pagination-determinism (house-rule class)",
      "detail": "The year export pages with `.order(\"sold_at\", { ascending: true }).range(from, from + PAGE - 1)` (lines 31-42) — sold_at is not unique (bulk eBay sync settlements land within the same timestamp resolution, and imported/backfilled sales can share identical values). The house rule and page.ts contract (src/lib/supabase/page.ts:14-15) require a unique tiebreaker precisely because ties spanning a page boundary make rows repeat or vanish between pages. Concrete failure: a year with >1000 sales where a run of equal sold_at values crosses the 1000-row boundary → the CSV handed to the CPA silently drops (or double-counts) sales — a wrong tax document with no error signal. The journal export in the same feature got this right (entry_date, source_ref, line); this route did not.",
      "fix": "Add `.order(\"order_ref\")` or better `.order(\"id\", { ascending: true })` as a second sort key."
    },
    {
      "title": "card-alerts cron pages card_alerts/cards/history without any .order() — violates readAll's determinism contract",
      "file": "src/app/api/cron/card-alerts/route.ts",
      "line": 108,
      "severity": "low",
      "category": "pagination-determinism (house-rule class)",
      "detail": "targetAlerts (lines 108-115), pctAlerts (149-155) and the moversDigest cards read (219-223) all call readAll with `.range()` but NO `.order()`, despite readAll's documented contract (src/lib/supabase/page.ts:14-15, 24-26: \"build must return ... a deterministic .order()\"). With >1000 alert rows (or live cards) for one user, Postgres is free to return pages that overlap or omit rows. Concrete failure: an armed target alert falls between pages → the crossing is never seen and never notified (or a re-arm update is applied to a row that was double-visited, re-firing a notification). Not money, but silent misbehavior of the exact primitive the audit standardized, in service-role code.",
      "fix": "Add `.order(\"card_id\")` (unique per alert) to both alert reads and `.order(\"id\")` to the moversDigest cards read."
    },
    {
      "title": "Card create/edit accepts negative money fields — a negative individual_basis inflates P/L on sale",
      "file": "src/app/cards/actions.ts",
      "line": 99,
      "severity": "low",
      "category": "input-validation",
      "detail": "num() (lines 53-57) only checks Number.isFinite — no sign or magnitude bound — for market_value, manual_price, and individual_basis in both createCard and updateCard, and importCards (lines 207-208) likewise. Concrete money path: individual_basis typed as \"-450\" (stray minus) on a use_pool_basis=false card → card_sell uses `coalesce(v_card.individual_basis, 0)` as v_basis (supabase/migrations/20260733000000_card_sales_tenancy.sql:88) → v_pl = v_net - (-450), overstating profit by $900 in card_sales, the CPA CSV, and the journal rebuild. Negative manual_price/market_value similarly flow into NAV snapshots (daemon sums them raw), export CSVs, and the eBay list-price default. The sell action clamps its inputs to >= 0; the card forms that feed the basis do not.",
      "fix": "Reject negative values (and add a sane ceiling) for market_value, manual_price, individual_basis, grade, and year in fields() and importCards."
    }
  ]
}
```

---

## 7. find:render-cache  (phase: Find, agent a67fc3d28ef676dac, 155922 tokens, 515s)

```json
{
  "findings": [
    {
      "title": "Sales & P&L headline totals sum a 1000-row-capped read",
      "file": "src/app/cards/sales/page.tsx",
      "line": 21,
      "severity": "high",
      "category": "silent-partial-sum",
      "detail": "The page reads card_sales with .order(\"sold_at\", desc).limit(1000) (lines 17-21) and then reduces net_proceeds / basis_drawn / profit_loss over exactly those rows (lines 23-30) into the three headline stats (\"Sales\", \"Basis drawn\", \"Profit / loss\", lines 43-47). Failure scenario: once the account crosses 1,000 settled sales (the eBay sync route auto-creates card_sales rows, so this is a matter of time), every sale older than the newest 1,000 silently drops out of the lifetime P/L headline — the numbers render as complete fact with no banner, and the label just reads \"Sales · 1000\". This is a direct new instance of the audited class (house rule: any read feeding a sum must use readAll/readAllSafe from src/lib/supabase/page.ts; a plain .limit() is only allowed for most-recent-N lists, and here the same rows also feed sums). Secondary defect at line 17: the query error is destructured away, so a transient PostgREST failure renders \"$0.00 / $0.00 / $0.00\" and \"No sales yet.\" as fact with no signal.",
      "fix": "Fetch totals with readAllSafe (deterministic .order(\"id\") tiebreaker), render the books-page-style \"records couldn't be read\" banner on error, and keep the plain limit(1000) only for the visible list — or compute the three totals with a SQL aggregate."
    },
    {
      "title": "Reports page pageAll silently returns partial money sums on a mid-pagination read error",
      "file": "src/app/cards/reports/page.tsx",
      "line": 36,
      "severity": "medium",
      "category": "error-swallowed-money",
      "detail": "Reports has its own local pageAll (lines 33-41) instead of the mandated readAll/readAllSafe. Line 36 destructures only { data } — the error is discarded — and `if (!data ...) break` treats an errored page exactly like the natural end of the table. Failure scenario: with >1000 settled sales, page 1 succeeds and page 2 hits a transient PostgREST/network error → the loop exits and every figure on the owner-only Reports screen (yearly Sales/Net proceeds/Basis drawn/Profit-loss cards, Monthly and By-category P/L, Velocity, Inventory value at lines 124-292) is computed from a fraction of the rows and rendered as fact with no banner; an error on the first page renders \"$0\" inventory value and \"No settled sales yet\". The audit fixed exactly this presentation on /cards/books with readAllSafe + a totalsPartial banner (src/app/cards/books/page.tsx:84,173-178); Reports never got the same treatment.",
      "fix": "Replace pageAll with readAllSafe from @/lib/supabase/page, and render the same \"Some records couldn't be read — totals incomplete\" banner when .error is set."
    },
    {
      "title": "Reports sales pagination orders by non-unique sold_at with no tiebreaker",
      "file": "src/app/cards/reports/page.tsx",
      "line": 80,
      "severity": "medium",
      "category": "pagination-determinism",
      "detail": "The paged card_sales read orders by .order(\"sold_at\", { ascending: false }) only. sold_at is timestamptz default now() (supabase/migrations/20260713150000_cardops_init.sql:270) and is not unique. Failure scenario with >1000 settled sales: (a) equal sold_at values straddling a 1000-row page boundary (lot sales settle as rapid back-to-back card_sell calls) make PostgREST's row order within the tie undefined between requests, so a sale can appear on both pages (double-counted profit) or on neither (dropped); (b) because this is offset pagination on a DESC key, any new sale inserted between page fetches (eBay sync runs concurrently) shifts every offset by one and duplicates the boundary row into the next page. Either way a settled sale is counted twice or zero times in the yearly P/L cards. House rule: pagination requires a deterministic .order() with a unique tiebreaker — the movers route does this correctly (src/app/api/cards/movers/route.ts:48-49); this read does not.",
      "fix": "Add .order(\"id\", { ascending: true }) as a secondary sort (and prefer ascending sold_at so concurrent inserts land after the cursor)."
    },
    {
      "title": "CPA CSV export pages card_sales on non-unique sold_at with no tiebreaker",
      "file": "src/app/api/cards/reports/route.ts",
      "line": 37,
      "severity": "medium",
      "category": "pagination-determinism",
      "detail": "The year-end CSV handed to the CPA pages card_sales with .order(\"sold_at\", { ascending: true }) only (lines 31-42). sold_at is timestamptz, not unique — lot settlements produce clusters of near-identical/identical timestamps. Failure scenario: a year with >1000 sales where tied sold_at values straddle the 1000-row page boundary → PostgREST returns the tie group in undefined order per request, so a sale row can be emitted twice or omitted entirely from the CSV. Unlike the on-screen reports page this document is downloaded, filed, and handed to a tax preparer; the file itself carries no indication anything is wrong (HTTP 200, attachment, well-formed CSV). The sibling journal export was already hardened with a fully deterministic order chain (src/app/api/cards/books/journal/route.ts:38-40); this route was not.",
      "fix": "Append .order(\"id\", { ascending: true }) as the tiebreaker."
    },
    {
      "title": "Books page intercompany and pool reads bypass the partial-read banner — balances silently render as zero",
      "file": "src/app/cards/books/page.tsx",
      "line": 130,
      "severity": "medium",
      "category": "error-swallowed-money",
      "detail": "The audit gave /cards/books a totalsPartial banner, but it only covers cardsPage/salesPage (line 84). Two other money reads on the same screen fail open: (1) the intercompany journal read at lines 130-134 discards readAllSafe's error and truncated fields — readAllSafe returns rows: [] on failure, so on a transient error every entity's intercoAdvance/intercoPayable computes to 0, the \"Intercompany\" strip (lines 269-275) disappears entirely, entities whose only activity is intercompany drop out of the rows filter (line 144), and no banner fires — the owner reads \"no intercompany receivables/payables\" as fact; (2) the card_pool read at line 64 ({ data: pools }) discards its error, so on failure invBasisPooled is 0 for every entity and the consolidated \"Inventory · at cost\" (line 192) plus each entity's balance-sheet asset line silently understate by the entire pooled basis, again without tripping the banner.",
      "fix": "Fold the interco read's error/truncated and the pools read's error into totalsPartial so the existing \"Some records couldn't be read\" banner covers every figure on the page."
    },
    {
      "title": "Portfolio page live-total loop swallows read errors — chart and headline collapse to $0 as fact",
      "file": "src/app/cards/portfolio/page.tsx",
      "line": 47,
      "severity": "medium",
      "category": "error-swallowed-money",
      "detail": "The \"today's live total\" pager (lines 46-55) destructures only { data: v }; an error makes v null, which the loop treats as end-of-data (line 54 break). Failure scenario: the first page read fails transiently → marketValue = 0 and individualBasis = 0, and lines 62-66 then push/overwrite TODAY'S chart point with value 0 (cost = pool total only). The rendered page states Market value $0, Return −100% in red, and the value-over-time chart plunges to zero on its newest point — all presented as fact with no error indication. An error on a later page yields a partial (understated) total instead. The same screen's movers read correctly uses readAllSafe two lines up (line 25), so the page already imports the safe primitive and simply doesn't use it for the money total.",
      "fix": "Use readAllSafe for the live-total scan and suppress or flag the today point (banner, not $0) when the read errors."
    },
    {
      "title": "Cards index portfolio banner loop swallows read errors — $0 market value / −100% return rendered silently",
      "file": "src/app/cards/page.tsx",
      "line": 119,
      "severity": "medium",
      "category": "error-swallowed-money",
      "detail": "Same defect class as the portfolio page, on the app's landing screen: the banner pager (lines 116-130) destructures only { data: vrows } and breaks on null, so a transient error on the first page renders the always-visible portfolio banner (lines 191-206) as Market value $0 and Return −100% (costBasis stays at pool total), and an error on a later page renders a partial sum — in both cases as unflagged fact. The adjacent pool read (line 105) also discards its error, which zeroes costBasis the same way. This is the first thing every user sees on /cards; a member or the owner acting on a \"collapsed\" portfolio number has no signal the read failed.",
      "fix": "Use readAllSafe and render a dash/⚠ state for the banner when the scan is incomplete instead of computed-from-partial numbers."
    },
    {
      "title": "Portfolio history reads the OLDEST 400 snapshots — newest year silently vanishes once history exceeds 400 days",
      "file": "src/app/cards/portfolio/page.tsx",
      "line": 20,
      "severity": "low",
      "category": "stale-truncation",
      "detail": "card_portfolio_snapshots is read with .order(\"snapshot_date\", { ascending: true }).limit(400) — ascending + limit keeps the FIRST 400 rows, i.e. the oldest. Failure scenario: on nightly-snapshot day 401 (~13 months in), yesterday's and every subsequent snapshot is silently excluded; the chart draws days 1-400 then jumps straight to the live today point appended at lines 62-66, hiding the most recent — most decision-relevant — stretch of the value curve, and the \"over N days\" caption (chgDays = points.length, line 72) reports 401 while the actual span keeps growing. The truncation is invisible: no gap marker, no banner, and it gets worse by one day forever.",
      "fix": "Order descending with limit(400) and reverse in memory (keep the NEWEST 400), or page the read."
    },
    {
      "title": "Group filter resolves membership from an unordered 1000-row-capped read",
      "file": "src/app/cards/page.tsx",
      "line": 51,
      "severity": "low",
      "category": "silent-partial-membership",
      "detail": "The group/folder filter builds its membership set from card_group_items with .limit(1000) and no .order(). Failure scenario: a group with more than 1,000 members → PostgREST returns an arbitrary 1,000 rows, so an arbitrary subset of the group's cards is permanently invisible under that group's filter (they exist, belong to the group, but never match the .in(\"id\", groupIds) at line 58) — and WHICH cards are missing can change between requests since the read is unordered. Silent display data loss; the house rule classifies membership sets as requiring readAll. Low severity because the browse itself caps at 500 rows and no money aggregates run over the filtered set.",
      "fix": "Read card_group_items via readAllSafe with .order(\"card_id\") — or push the group filter into the cards query with an inner join instead of materializing the id set."
    }
  ]
}
```

---

## 8. find:schema-drift  (phase: Find, agent a51ae2838f812fa34, 263316 tokens, 844s)

```json
{
  "findings": [
    {
      "title": "audit_log inserts use actor values the CHECK constraint rejects ('ebay-sync', 'ebay') — rows silently never written",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 162,
      "severity": "medium",
      "category": "schema-drift/check-constraint",
      "detail": "supabase/migrations/20260716040000_todos_calendar.sql:85-88 defines the only actor constraint in this repo: `check (actor in ('web','mcp','cron','assistant'))`. Two routes insert values outside that set: (1) src/app/api/ebay/sync/route.ts:161-165 inserts actor: \"ebay-sync\" for every per-order settlement audit record, with the error swallowed by `.then(() => {}, () => {})`; (2) src/app/api/ebay/account-deletion/route.ts:39-46 inserts actor: \"ebay\" inside `try {} catch {}`. Failure scenario: every eBay order the sync settles produces a 23514 CHECK violation that is silently discarded, so the ONLY per-order settlement audit trail (orderId, sale, fees, net) never lands; and every eBay Marketplace Account Deletion notice — whose log the route's own comment calls the proof of receipt (\"the log proves receipt\") — is never recorded, which is a compliance record eBay requires. Both failures are invisible precisely because the writes are fire-and-forget. Every other insert uses 'web' or 'cron', which pass. Caveat: audit_log itself is CREATEd only in Master-Ops; if a Master-Ops-only migration later widened the check this is moot — but no migration in this repo does, and this repo's migrations are the stated source of truth.",
      "fix": "Either use an allowed actor ('cron' for the sync path, 'web'/'cron' for account-deletion) or paste a migration widening the check to include 'ebay-sync' and 'ebay'. Also consider logging (not swallowing) the insert error so a constraint regression is visible."
    },
    {
      "title": "eBay sync's cancelled-order idempotency guard reads at most 1000 rows — a missed row re-settles a refunded order (double pool draw + phantom revenue)",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "medium",
      "category": "postgrest-1000-row-cap",
      "detail": "src/app/api/ebay/sync/route.ts:50-52 builds the cancelled-order guard Set from `db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` — a single unpaged, unordered request, silently capped at 1000 rows by PostgREST. ebay_cancelled_orders (supabase/migrations/20260720120000_card_unsell.sql) is never pruned, so it grows monotonically. Failure scenario: once lifetime cancels exceed 1000, the returned subset is arbitrary (no .order), so a recently-cancelled order — exactly the one inside eBay's eventual-consistency window that this marker table exists to cover — can be absent from the Set. card_unsell DELETEd the card_sales row (`delete from public.card_sales where id = v_sale.id`) and reset the card to 'booked', so neither the (user_id, platform, order_ref) unique index nor card_sell's already-sold check blocks the re-settle: the sync re-books the refunded order — pool basis drawn a second time, phantom revenue in card_sales and the ledger rebuild. This is precisely the 'membership set / idempotency guard must use readAll' rule from CLAUDE.md, and the route even fails closed when the read ERRORS (line 51) — but a capped read looks like success.",
      "fix": "Read ebay_cancelled_orders with readAll/readAllSafe (deterministic .order(\"order_ref\")), or filter server-side per order (`.in(\"order_ref\", [...])` over the batch's order ids)."
    },
    {
      "title": "CPA sales CSV pages on non-unique sold_at with no tiebreaker — lot settlements share identical timestamps, so >1000 sales/year can skip or duplicate rows in the tax document",
      "file": "src/app/api/cards/reports/route.ts",
      "line": 37,
      "severity": "medium",
      "category": "pagination-determinism",
      "detail": "src/app/api/cards/reports/route.ts:31-42 pages card_sales with `.order(\"sold_at\", { ascending: true }).range(from, from+999)` — no unique tiebreaker. sold_at is not unique: card_sell's insert takes the `sold_at` default now(), and Postgres freezes now() per transaction, so card_lot_sell (supabase/migrations/20260720140000_card_lots.sql) stamps EVERY child of a lot with the same timestamp; combined-order settlements do the same. Postgres OFFSET paging over a non-unique order is unstable across requests, so when a page boundary falls inside a tie run, rows can be repeated or omitted between pages. Failure scenario: a year with >1000 settled sales (routine once lots are used — one 30-card lot is 30 rows) exports a CSV handed to the CPA with silently missing or double-counted sales; totals are wrong with HTTP 200 and no signal. This violates the audit's explicit standing rule ('Pagination needs a deterministic .order() with a unique tiebreaker'), which sibling paths (books/post orders by id; books/journal orders by entry_date, source_ref, line) already follow.",
      "fix": "Add `.order(\"id\", { ascending: true })` as a second order key."
    },
    {
      "title": "eBay sync match-set paging orders by non-unique created_at with no tiebreaker — Speed Book batches share identical created_at, so a listed card can be skipped and its PAID order silently not settled",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 42,
      "severity": "low",
      "category": "pagination-determinism",
      "detail": "src/app/api/ebay/sync/route.ts:35-44 pages the card match set with `.order(\"created_at\", { ascending: false }).range(from, from+999)`. cards.created_at defaults to now(), and speed_book_commit inserts a whole lot in ONE transaction, so batches of cards share the exact same created_at — non-unique order, unstable OFFSET paging. Failure scenario: with >1000 cards having listing_refs, a listed card can fall between page boundaries and be absent from byListingId/bySku; its PAID order line then hits `if (!card && !lot) continue;` (line 96) — no settle, no failure surfaced, no audit row. The sale books only if a later run's tie-ordering happens to include the card, so revenue is delayed or missing while the card still shows 'listed'.",
      "fix": "Add `.order(\"id\", { ascending: true })` as a tiebreaker (same fix as the daemon's reprice scan already applies at src/app/api/cards/daemon/route.ts:125-126)."
    },
    {
      "title": "Connector mapping-key discovery pages journal_entries on non-unique account — a single-use account key can be missed, making its entries permanently unpostable",
      "file": "src/app/api/cards/connectors/route.ts",
      "line": 56,
      "severity": "low",
      "category": "pagination-determinism",
      "detail": "src/app/api/cards/connectors/route.ts:53-60 builds usedKeys by paging `.select(\"account\").order(\"account\", { ascending: true }).range(...)` — account is highly non-unique, and there is no unique tiebreaker. With >1000 ledger rows for a business, tie-order instability at a page boundary can omit a row entirely; if an account key occurs on only a few rows (e.g. owner_equity or intercompany_payable from a single receipt), the key can vanish from usedKeys. The route's own comment states the consequence: 'a key missing here gets no field, can never be mapped, and its entries are then refused by the push forever' (src/app/api/cards/connectors/push/route.ts:92-95 filters out entries with any unmapped line). The audit fixed the .limit here but left the non-deterministic order.",
      "fix": "Add `.order(\"id\", { ascending: true })` after the account order, or select distinct accounts via an aggregate."
    },
    {
      "title": "Standalone-Supabase debt: tables, columns, and a storage bucket the code relies on that no migration in this repo creates",
      "file": "CLAUDE.md",
      "line": 30,
      "severity": "low",
      "category": "info/schema-debt",
      "detail": "Works today because the DB is shared with Master-Ops (known arrangement); this is the inventory of what a future standalone Supabase must create. (1) `profiles` table — only ALTERed here (role, display_name); read by src/lib/cards/roles.ts:13 and every cron's roster query. (2) `audit_log` table — only the actor CHECK and approved_by are touched here; code writes actor/action/target/payload/result across ~18 routes. (3) `push_subscriptions` table — user_id column added here (20260719100000_members.sql) but the table and its endpoint/keys columns exist only in Master-Ops; read by src/app/api/cron/card-alerts/route.ts:82 and card-news:133. (4) `user_settings.prefs` jsonb column — this repo CREATEs user_settings (20260716040000) WITHOUT prefs; the column was added only in Master-Ops, yet it is load-bearing here: src/app/api/cards/settings/route.ts:12,37, src/app/api/cron/card-alerts/route.ts:206,254, src/lib/ebay/listing.ts:126-135, describe/grade-ev routes, settings page. (5) storage bucket \"receipts\" and its storage.objects RLS policies — used by src/app/api/cards/receipts/scan/route.ts:79 and receipts/route.ts:119; only 'card-photos' is created here (20260713150000:455). (6) `entities` (and critical_dates/snapshots/sent_alerts) — referenced by migrations (cardops_init §3 policies; card_businesses seed in 20260725000000). (7) The hardcoded CARD business id 'bfa6ad79-0d3a-412b-a682-603aa9d23f1d' (src/app/cards/actions.ts:9, src/app/cards/intake/actions.ts:10, speed_book_commit) exists in card_businesses only via the seed-from-entities; on a fresh DB that seed is a no-op and the cards_business_fk FK would reject every owner card insert.",
      "fix": "Keep this list with reference/next-steps.md; a standalone cutover needs CREATEs for profiles, audit_log, push_subscriptions, user_settings.prefs, the receipts bucket + policies, and a card_businesses seed replacing the entities copy."
    }
  ]
}
```

---

## 9. find:resilience  (phase: Find, agent a5eed53de4b3cf59f, 232429 tokens, 596s)

```json
{
  "findings": [
    {
      "title": "Zoho push failures are permanently stranded AND displayed as 'posted' — real-books entries silently missing forever",
      "file": "src/app/cards/books/push-preview/page.tsx",
      "line": 73,
      "severity": "high",
      "category": "failure-handling / stranded-state",
      "detail": "The push route (src/app/api/cards/connectors/push/route.ts:104-134) claims each entry in card_push_log with status 'pending' before sending, then marks 'posted', deletes the claim (refused), or marks 'uncertain'. Two states are unresolvable and mislabeled: (1) zoho.ts pushEntry (src/lib/cards/connectors/zoho.ts:62-71) returns {ok:false, attempted:true} on ANY throw — including an accessToken() refresh failure inside zohoFetch, where NOTHING was ever sent to the journals endpoint. A transient Zoho outage during token refresh therefore quarantines every entry in the batch (up to 40) as 'uncertain', claims kept, never auto-retried. (2) A crash/timeout between the claim insert and the outcome write leaves status 'pending' forever. In BOTH cases every future push run hits the unique index (23505) and counts the entry as skipped_already_posted (route:108-111), and the preview page reads card_push_log selecting ONLY business_id+reference (push-preview/page.tsx:43-46) — status is never read — so pending/uncertain claims are added to alreadyPosted (line 73), excluded from 'ready' (76-78), and rendered with a green 'posted' badge (line 178). Failure scenario: Zoho returns a 502 HTML page mid-request (res.json() throws in zohoFetch, zoho/client.ts:66) → journal never lands in Zoho Books → CardOps forever shows the entry as posted, excludes it from every future push, and there is no code path anywhere that deletes or re-opens the claim. The owner's real books are permanently missing an entry while the app asserts it is synced. The 'uncertain — check the books before retrying' message in the one-shot response errors array is the only signal, and there is no way to retry after checking.",
      "fix": "In pushEntry, distinguish never-sent throws (token refresh, connection refused before request body sent) as attempted:false. In push-preview, select status from card_push_log and render pending/uncertain rows distinctly (amber, not 'posted'), excluded from alreadyPosted's green badge. Add an owner action to resolve an uncertain/pending claim (mark posted with external id, or delete the claim to re-enable push) after manually checking Zoho."
    },
    {
      "title": "eBay list/list-lot: DB persist after live publish is unchecked — ok:true while the card has no listing ref, so the paid order can never auto-settle and auctions can be double-listed",
      "file": "src/app/api/ebay/list/route.ts",
      "line": 262,
      "severity": "high",
      "category": "unchecked-write-after-external-side-effect",
      "detail": "After the eBay listing is successfully published (an irreversible external side effect), the write that records it — `await supabase.from('cards').update({ listing_refs, status:'listed', ... })` at list/route.ts:262-264 (auction path: 171-173) and `card_lots.update(...)` at list-lot/route.ts:131 — discards the supabase {error} and the route returns ok:true regardless. Failure scenario: transient DB error on that one write → the card is live on eBay but CardOps still shows it unlisted with listing_refs = {}/null. Consequences: (a) the sync match set (sync/route.ts:37-39) filters `.not('listing_refs','eq','{}')`, which excludes both {} and NULL — the card never enters byListingId/bySku, so when the item sells, the PAID order is skipped at sync/route.ts:96 with no failure recorded; the hub's 'unsettled' stat only counts MATCHED orders (hub/route.ts:120), so the missed revenue is invisible everywhere. (b) The 'Already listed' guard (list/route.ts:59-62) sees nothing, and the UI (re-read from DB) shows the card unlisted, inviting a retry — the auction path calls Trading AddItem which mints a brand-new ItemID every call, producing two live auctions for one physical card; both can sell. Contrast: relist/route.ts:64-69 checks the same write and returns a loud 409-style warning — list and list-lot skipped that guard.",
      "fix": "Check the update error (and use .select('id') to confirm a row was written, as relist does). On failure return a warning payload ('listed on eBay as <listingId> but CardOps could not record it — do NOT relist; retry saving') instead of a clean ok:true."
    },
    {
      "title": "Receipt DELETE swallows both delete errors and always returns ok — a failed journal delete leaves orphaned double-entry lines that still push to real books",
      "file": "src/app/api/cards/receipts/route.ts",
      "line": 121,
      "severity": "medium",
      "category": "swallowed-error-on-money-write",
      "detail": "DELETE (receipts/route.ts:111-124) runs `await supabase.from('journal_entries').delete().eq('source','receipt').eq('source_ref', id)` then `card_receipts.delete()`, ignoring the {error} on both, and unconditionally returns {ok:true}. Failure scenario: the journal delete fails (transient/RLS) while the receipt delete succeeds → the receipt disappears from the UI but its balanced double-entry (Dr inventory / Cr cash — two entries for an advance) remains in journal_entries permanently. Nothing ever reconciles it: the books/post rebuild only rebuilds source='card_sale' (books/post/route.ts:82), never source='receipt'. The orphan entry is balanced, complete, and mapped, so the Zoho push route treats it as eligible (push/route.ts:92-94) and posts a deleted purchase into the owner's real bookkeeping; the internal Books page assets stay inflated by the receipt amount. The inverse order (receipt delete fails, journal delete succeeded) leaves a receipt displayed as 'booked' with no ledger backing. Note the same route's POST was hardened for exactly this class (rollback at lines 99-104), but DELETE was not.",
      "fix": "Check both delete errors; delete the receipt FIRST and the journal entries second (an orphaned receipt is self-healing via retry; orphaned journal entries are not), and return a 500 with a retry instruction when either fails."
    },
    {
      "title": "eBay sync: cancelled-order guard reads the whole table unpaginated and unordered — past 1000 rows a refunded order can be re-booked as a sale; card match-set page reads discard errors",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 50,
      "severity": "medium",
      "category": "1000-row-cap / idempotency-guard",
      "detail": "Two defects in runSync. (1) Line 50: `db.from('ebay_cancelled_orders').select('order_ref')` — no .range(), no .order(). This set is the durable guard that prevents re-settling an order the owner cancelled while eBay's feed still reports it PAID (the route's own comment, lines 48-49 and 82-85). PostgREST caps the response at 1000 rows in unspecified order; nothing prunes the table (cancel-order/route.ts:45-46 only upserts). Failure scenario: once total cancelled orders exceed 1000, a just-cancelled order can be absent from the returned rows; during eBay's eventual-consistency window (order still PAID / NONE_REQUESTED) the sync re-runs card_sell on a card that card_unsell just reversed — the refunded order is re-booked as revenue and basis is re-drawn, permanently wrong books until manually noticed. This is a new instance of the exact class the house rules flag (membership set / idempotency guard fed by a capped read, no deterministic order). (2) Lines 41-44 and 66: the paged cards read and the lots read destructure {data} and discard {error}; an error mid-pagination breaks the loop with a silently truncated match set, and the run returns ok — PAID orders for the dropped cards are skipped with no failure recorded (same silent-miss surface as finding 2).",
      "fix": "Read ebay_cancelled_orders via readAll with .order('order_ref') and fail the run on error (matching the fail-closed treatment its own error branch already gets); check the {error} on every match-set page and abort the sync (or record a failure) instead of settling against a partial set."
    },
    {
      "title": "Auto-estimate cron debits the credit ledger without checking whether the estimate row actually persisted — a persistently failing insert charges the user daily and delivers nothing",
      "file": "src/app/api/cron/card-estimates/route.ts",
      "line": 123,
      "severity": "medium",
      "category": "unchecked-write / wrong-charge",
      "detail": "Lines 123-131: `await svc.from('card_estimates').insert({...})` — {error} ignored — followed unconditionally by `svc.from('credit_ledger').insert({ delta: -credits, ... })` (also unchecked) and made++. Failure scenario: the card_estimates insert fails persistently (e.g. an AI-returned value overflowing the numeric column, or a constraint/RLS change) → no estimate is stored, but the user's credit ledger is debited 4-15 credits and the run reports the card as done. Because lastAt (lines 86-91) is built from stored card_estimates rows, the same card is re-selected as never-estimated on EVERY subsequent daily run — an unbounded charge loop with zero delivery, invisible in the run summary (failed only counts thrown exceptions and res.ok=false, not insert errors). The inverse also holds: a failed credit_ledger insert silently gives free estimates. The manual path has the same shape (src/app/api/cards/estimate/route.ts:81-90: both inserts unchecked), though there the user at least sees the estimate in the response.",
      "fix": "Check the card_estimates insert error; only debit credit_ledger after the row lands, count insert failures in `failed`/errors, and check the credit insert too (log loudly on mismatch so metering and delivery cannot silently diverge)."
    },
    {
      "title": "No timeout/AbortSignal on any vendor fetch used inside bounded crons — one stalled call kills the run tail (rotation cursor, daily history, or a push claim) with zero signal",
      "file": "src/app/api/cron/price-refresh/route.ts",
      "line": 160,
      "severity": "medium",
      "category": "missing-timeout-in-cron",
      "detail": "Every external fetch except card-news lacks a timeout: thecardapi (src/lib/cards/price-sources/thecardapi.ts:120,148), scryfall (scryfall.ts:22), pricecharting (pricecharting.ts:39), ebayApi (src/lib/ebay/listing.ts:14), tradingCall (trading.ts:26), cancelOrder (orders.ts:182), and zohoFetch (src/lib/zoho/client.ts:34,52). Node's default undici headers timeout (~300s) exceeds every route's maxDuration. Failure scenarios: (a) price-refresh cron (maxDuration 60, up to ~100 cards, CONCURRENCY 5 at line 160-162): one vendor connection that stalls without RST blocks its Promise.all batch until Vercel kills the function — the daily card_price_history insert (line 164, itself unchecked yet reported as history_written) and the rotation-cursor update (line 166) never run, so no history points are banked that day AND the hung card remains oldest-priced and wedges the rotation on the same card every subsequent day. (b) eBay sync cron GET (sync/route.ts, maxDuration 60): a hung getOrders page kills the whole settle run — paid orders silently unbooked that day. (c) Zoho push (push/route.ts, maxDuration 60): a hang inside conn.pushEntry AFTER the claim insert kills the function between claim and outcome, creating the permanent 'pending' stranding of finding 1. The codebase already knows the correct pattern — card-news uses AbortSignal.timeout(8000) with a per-subject catch (src/app/api/cron/card-news/route.ts:80-82) — these paths just never got it.",
      "fix": "Add AbortSignal.timeout (~8-10s for price sources, ~15s for eBay/Zoho) to every fetch in thecardapi/scryfall/pricecharting/ebayApi/tradingCall/cancelOrder/zohoFetch; in price-refresh, also check the history insert error before reporting history_written."
    },
    {
      "title": "eBay hub 30-day sold/profit stats and 'settled' flags are computed from the first 1000 card_sales rows in unspecified order",
      "file": "src/app/api/ebay/hub/route.ts",
      "line": 74,
      "severity": "low",
      "category": "1000-row-cap / wrong-number",
      "detail": "Lines 74-85: `card_sales.select('order_ref, sale_price, profit_loss, sold_at').eq('platform','ebay').limit(1000)` — no .order(), no pagination — feeds (a) the settledOrders membership Set that drives each order's `settled` flag and the 'unsettled' count, and (b) sold30Count / sold30Total / profit30 (lines 110-118), dollar figures the hub displays as fact. Failure scenario: once lifetime eBay-platform sales exceed 1000 rows, PostgREST returns an arbitrary 1000-row subset — recent sales can be missing, so the 30-day sold total and profit understate by whatever fell outside the subset, and settled orders show as unsettled (the re-settle click is then absorbed by card_sell's already-sold guard, so no double-book, but the money numbers on screen are simply wrong). New instance of the audited sums/membership-set class: a read feeding a Set and two sums must be complete per src/lib/supabase/page.ts's own rule. The companion cards read at lines 49-53 (limit 1000) truncates the match display the same way.",
      "fix": "For the stats, query only the 30-day window with .order('sold_at', desc) plus an id tiebreaker (readAll if it can exceed 1000); for settledOrders, filter by the order ids actually on screen (`.in('order_ref', ...)`) instead of reading the whole table."
    },
    {
      "title": "Connector account-map PUT ignores the error when clearing mappings — an 'unmapped' account silently keeps posting to the old external account",
      "file": "src/app/api/cards/connectors/route.ts",
      "line": 112,
      "severity": "low",
      "category": "swallowed-error-on-money-write",
      "detail": "PUT lines 111-113: `await supabase.from('card_account_map').delete()...in('account_key', clearKeys)` — {error} discarded — then the route returns {ok:true, cleared: clearKeys.length}. Clearing a mapping is how the owner stops an internal account from being posted to a given Zoho account (an unmapped key makes its entries 'refused' by the push route, push/route.ts:92-94). Failure scenario: the owner clears a wrong mapping (say platform_fees was mapped to the wrong Zoho expense account), the delete fails transiently, the UI confirms 'cleared 1' — the stale mapping survives, and the next confirmed push posts real journal lines to the account the owner explicitly unmapped. The upsert branch directly below (lines 114-117) checks its error; the delete branch does not.",
      "fix": "Check the delete {error} and return a 500 (nothing about the response should claim `cleared` on a failed delete), mirroring the upsert branch."
    }
  ]
}
```

---

## 10. find:test-adequacy  (phase: Find, agent af541cc2fefeab957, 152061 tokens, 454s)

```json
{
  "findings": [
    {
      "title": "card_sell / card_unsell reversal symmetry has zero automated coverage",
      "file": "supabase/migrations/20260720120000_card_unsell.sql",
      "line": 16,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "The single riskiest money path in the app — the pool draw in card_sell (latest body: supabase/migrations/20260733000000_card_sales_tenancy.sql:60-99) and its inverse card_unsell (20260720120000_card_unsell.sql:16-80) — is pure plpgsql and is exercised by nothing: all 16 vitest files test TS only, and there is no pgTAP/local-Postgres harness. The reversal's correctness rests on subtle claims made only in comments: it keys off the latest 'draw' adjustment not yet followed by a 'correction' (lines 40-45), restores a $0 draw's COUNT even though basis_drawn is 0, and survives use_pool_basis being toggled after the sale. A regression in any of these (e.g. someone 'simplifying' the correction-detection to key off basis_drawn) silently corrupts the pool: total_cost/card_count drift, and every subsequent pooled sale draws a wrong average basis — wrong P/L on every card sold thereafter, compounding and invisible.",
      "fix": "Add an integration suite (vitest + node-postgres against `supabase start`, gated behind a SUPABASE_DB_URL env, or pgTAP under supabase/tests). Setup: user with pool (name 'main', total_cost 100.00, card_count 4) and a pooled card. Actions/assertions: (1) card_sell(price 50, fees 5) → draw adjustment of -25.00 exists, pool becomes (75.00, 3), card_sales row has basis_drawn 25, profit_loss 20; (2) card_unsell → pool exactly (100.00, 4) again, a 'correction' of +25.00 exists, the sale row is deleted, card status 'booked' with sold_at/basis_drawn null; (3) $0-cost pool (total 0, count 2): sell then unsell → count round-trips 2→1→2 (the migration's own comment claims this; nothing proves it); (4) second card_unsell → raises 'card is not sold' and pool unchanged; (5) sell→unsell→sell→unsell → pool back to baseline (exercises the ts > v_draw.ts correction-detection across repeated cycles); (6) individual-basis card: sell/unsell never touches the pool."
    },
    {
      "title": "card_lot_sell pro-rata split and last-child remainder logic untested",
      "file": "supabase/migrations/20260720140000_card_lots.sql",
      "line": 98,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "The lot settlement loop (20260720140000_card_lots.sql:98-119) allocates sale price, fees, and shipping across children by comp-value weight, giving the rounding remainder to the last child so totals reconcile exactly, and falls back to an equal 1/n split when total weight is 0. Every one of those properties is untested — no vitest file touches it and there is no SQL harness. A regression (e.g. reordering the running-sum updates at line 112, or breaking the v_i < v_n branch) makes the children's card_sales sum diverge from what eBay actually paid, and the ledger rebuild in src/app/api/cards/books/post/route.ts then books that wrong total as revenue. The eBay sync settles real lot orders through this exact RPC (src/app/api/ebay/sync/route.ts:113-116).",
      "fix": "In the same Postgres harness as the sell/unsell suite: (1) lot of 3 cards with comp_value_at_add 50/30/20, card_lot_sell(price 100.01, fees 10.01, ship_income 3.33) → assert SUM(card_sales.sale_price) = 100.01, SUM(fees) = 10.01, SUM(shipping_income) = 3.33 exactly (cent-exact, remainder on the last child); (2) all comp values 0 → equal split, sums still exact; (3) one zero-weight child among weighted ones → that child settles at $0 but IS drawn from the pool (count decrements); (4) second card_lot_sell → raises 'lot is not sellable'; (5) card_lot_unsell → every child unsold, pool count restored by exactly N, lot back to 'draft'."
    },
    {
      "title": "eBay combined-order fee/shipping allocation has no remainder handling and no test",
      "file": "src/app/api/ebay/sync/route.ts",
      "line": 98,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "runSync (src/app/api/ebay/sync/route.ts:88-107) splits order-level deliveryCost and marketplaceFee across line items with `share = li.itemCost / orderItems`, rounding each line independently — unlike card_lot_sell, there is no last-line-absorbs-remainder step, so the booked totals do not reconcile with the order. Concrete: 3 lines at itemCost $10 each, deliveryCost $5.00, marketplaceFee $4.00 → each line books shipIncome round(5/3)=1.67 (total $5.01, one phantom cent of revenue) and fees round(4/3)=1.33 (total $3.99, a cent of fees lost). Separately, when marketplaceFee is null the fallback estimateFee (line 23) adds the $0.30 per-ORDER fixed fee once PER LINE — a 3-line combined order books $0.90 of fixed fee instead of $0.30. Cash in the internal ledger then never matches the actual eBay payout, and the drift accumulates across every combined checkout. None of this is testable today because runSync is unexported I/O code; zero tests cover it.",
      "fix": "Extract the per-order allocation into a pure helper (e.g. `allocateOrder(order): {lineItemId, salePrice, fees, shipIncome, orderRef}[]` in src/lib/ebay/orders.ts) and have runSync consume it. Tests: (1) 3-line order (10/10/10, delivery 5.00, fee 4.00) → assert Σ shipIncome === 5.00 and Σ fees === 4.00 exactly (forces adding remainder correction); (2) single-line order → passthrough, orderRef = orderId; multi-line → orderRef = `${orderId}:${lineItemId}`; (3) marketplaceFee null, 3 lines → total estimated fee applies the $0.30 fixed component once, not three times; (4) zero-cost order (all itemCost 0) → no NaN/Infinity shares (the `|| 1` guard) and $0 allocations."
    },
    {
      "title": "parseOrder — the money inlet from eBay — has no fixture test",
      "file": "src/lib/ebay/orders.ts",
      "line": 68,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "Every dollar the eBay sync settles originates in parseOrder (src/lib/ebay/orders.ts:68-102), and no test touches it. The riskiest behaviors: (1) itemCost prefers lineItemCost but falls back to `Math.max(0, total - lineShip)` (line 91) where lineItem.total INCLUDES sales tax — on a taxed order missing lineItemCost, salePrice is overstated by tax eBay remits itself, booking phantom revenue into card_sales and the ledger; (2) `num()` maps any missing pricingSummary field to 0 — if eBay renames a field (their APIs version-migrate regularly), every order silently parses with salePrice 0 and cards get marked sold with $0 revenue and negative P/L, with no error anywhere (tsc cannot see JSON shape drift; this is exactly what a compiler cannot catch); (3) cancelState defaults to NONE_REQUESTED when cancelStatus is absent, which is what allows settlement to proceed (sync route line 84).",
      "fix": "Add test/ebay-orders.test.ts with golden RawOrder JSON fixtures captured from the Fulfillment API. Assertions: (1) full fixture → exact orderId/paymentStatus/deliveryCost/marketplaceFee/lineItems money fields; (2) line with lineItemCost 20.00, total 21.62 (tax), shippingCost 0 → itemCost 20.00; same line WITHOUT lineItemCost → currently 21.62: assert the intended value and fix the fallback to also subtract tax or refuse; (3) totalMarketplaceFee absent → null (triggers estimate path), present-as-\"0\" → 0 (must NOT trigger estimate path); (4) empty/missing pricingSummary → parses without NaN; (5) missing cancelStatus → 'NONE_REQUESTED'."
    },
    {
      "title": "Zoho pushEntry 'sent but unconfirmed' (attempted:true) quarantine path untested",
      "file": "src/lib/cards/connectors/zoho.ts",
      "line": 68,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "cards-connectors.test.ts:153-162 proves the three PRE-flight refusals return attempted:false, but the other half of the protocol — zohoFetch throwing after the request was sent must return { ok:false, attempted:true } (zoho.ts:68-71) — has no test, and it is the half that prevents double-posting to real books. The push route branches on exactly this flag (src/app/api/cards/connectors/push/route.ts:121-134): attempted:false → the card_push_log claim is DELETED and the entry is retryable; attempted:true → the claim is kept as 'uncertain' and never auto-retried. If a refactor ever makes the catch return attempted:false (a one-word change tsc accepts happily), a network timeout whose POST actually landed in Zoho gets its claim released, and the next push posts the same manual journal a second time into a real company's books — the precise disaster the claim-first design exists to prevent.",
      "fix": "In cards-connectors.test.ts, `vi.mock(\"@/lib/zoho/client\")`: (1) zohoFetch rejects (timeout) → await zoho.pushEntry(fullyMappedEntry, {orgId}) resolves to { ok:false, attempted:true } with the error message; (2) zohoFetch resolves { journal: { journal_id: \"J1\" } } → { ok:true, attempted:true, externalId: \"J1\" }; (3) zohoFetch resolves {} (2xx but no journal id) → ok:true with externalId null, never attempted:false. Name the test after the invariant: 'a send whose outcome is unknown must report attempted:true so the caller quarantines instead of un-claiming'."
    },
    {
      "title": "readAll / readAllSafe — the primitive every sum and rebuild trusts — is untested",
      "file": "src/lib/supabase/page.ts",
      "line": 31,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "page.ts is the house-rule answer to the PostgREST 1000-row cap and is now load-bearing under the card-estimates cron's candidate/freshness sets (src/app/api/cron/card-estimates/route.ts:68-83) and other sum/membership reads, yet it has zero tests. Its contract is all edge cases: exact (from,to) window arithmetic, termination on a short page, a mid-stream error must THROW rather than return the partial rows already accumulated (page.ts:38), and the cap must return truncated:true rather than silently stopping. An off-by-one in the range math (e.g. `from + PAGE` instead of `from + PAGE - 1`) duplicates or skips a row on every page boundary — feeding wrong membership sets to the estimate cron (double credit spend) and wrong row sets to anything else migrated onto it — and no existing test would notice.",
      "fix": "Add test/page.test.ts with a fake `build` closure recording its arguments. Assert: (1) 2500-row source → calls with (0,999),(1000,1999),(2000,2999), returns 2500 rows, truncated:false; (2) source exactly 1000 rows → two calls (second returns 0 rows), no duplication; (3) second page returns {error} → readAll THROWS and exposes no partial rows; readAllSafe returns { rows: [], truncated:false, error: msg } — never the partial 1000; (4) cap 1500 with full pages → truncated:true and the caller-visible row count matches what was actually read; (5) build returning null data → treated as empty page, terminates."
    },
    {
      "title": "Auto-estimate cron candidate selection (same-day re-run credit protection) is untestable and untested",
      "file": "src/app/api/cron/card-estimates/route.ts",
      "line": 86,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "The only thing preventing the nightly estimates cron from re-billing every card on a same-day re-run is the freshness map keyed `${card.id}::${mode}` with the STALE_DAYS cutoff (route lines 86-103), plus never-estimated-first ordering and the per-user/global caps. It is inlined in the route, so nothing tests it, and this exact logic was already rewritten once for a starvation bug (the comment at lines 61-67 documents the previous silent failure). A regression in the freshness key or cutoff comparison (e.g. `>` vs `>=`, or mode drifting out of the key) makes every run re-estimate all cards: at 4-22 credits per estimate x 80 per run, a re-deployed or manually re-triggered cron drains the owner's credit ledger and floods card_estimates — silently, since the route still returns ok:true.",
      "fix": "Extract a pure `pickEstimateCandidates(allCards, latestEstimates, modes, cutoffMs, perUser)` into src/lib/cards/ and have the route call it. Tests: (1) card estimated 1 hour ago in mode A, cutoff 14 days → zero candidates for A (re-run bills nothing), still a candidate for mode B if prefs say 'both'; (2) never-estimated cards sort before stale ones regardless of created_at; (3) freshness is per (card, mode): a fresh 'standard_plus' must not suppress a stale 'all_sales_plus'; (4) perUser cap slices after sorting, and the deduped hydration id set counts a both-modes card once; (5) estimate exactly at the cutoff boundary is treated as stale (pin the >= semantics)."
    },
    {
      "title": "No round-trip test that journal builders always produce contiguous, pushable entries",
      "file": "src/app/api/cards/books/post/route.ts",
      "line": 72,
      "severity": "medium",
      "category": "test-coverage",
      "detail": "The connector layer refuses any entry whose line numbers are not contiguous 0..n-1 (ledger.ts:101-104 — the fragment guard), and the producers satisfy that only by construction: books/post numbers lines with forEach index after cardSaleLines drops zero-amount lines (post/route.ts:72-77), and the receipts route restarts numbering per entity entry (receipts/route.ts:92-95). No test pins this cross-module invariant. The failure mode is quiet, not loud: if a future edit filters or reorders lines AFTER numbering (or cardSaleLines starts emitting a zero-amount placeholder), every produced sale entry becomes complete:false — permanently unpushable to Zoho ('not_ready' forever) — or, inverted, a genuinely truncated fragment starts passing the guard and posts revenue with no COGS to real books. Both current tests attack the guard with hand-built rows, never with what the producers actually emit.",
      "fix": "Add a round-trip test: for every treatment x {fees:0, shipping:0, basis:0, loss-sale, negative-fee} combination, run cardSaleLines → number lines with forEach index (exactly as post/route.ts does) → feed the rows to buildPushEntries with a full account map → assert every entry is balanced, complete, and counted postable, and toZohoJournal(entry) is non-null. Do the same for receiptEntries('advance') producing two entity entries each numbered 0..1. This locks the producer-consumer contract so a change on either side fails a test instead of silently freezing or corrupting the Zoho push."
    },
    {
      "title": "eBay token crypto has no round-trip test and an uncaught-throw path on a malformed key",
      "file": "src/lib/ebay/crypto.ts",
      "line": 18,
      "severity": "low",
      "category": "test-coverage",
      "detail": "sealToken/openToken (src/lib/ebay/crypto.ts) protect the 18-month eBay refresh token and are pure and trivially testable, yet untested. Two concrete risks: (1) key() only checks hex.length === 64 — a 64-char string containing a non-hex character passes, Buffer.from(hex,'hex') silently truncates at the first invalid character, and createCipheriv then THROWS 'Invalid key length' inside sealToken, which unlike openToken has no try/catch (line 18-25) — a misconfigured EBAY_TOKEN_KEY crashes the OAuth callback route instead of degrading to null; (2) any format regression in the iv.tag.ciphertext join (line 24) strands every stored token: openToken returns null, getEbayConnection returns null (connection.ts:32-37), and the nightly settlement sync silently stops booking sales until someone notices 'Reconnect'.",
      "fix": "Add test/ebay-crypto.test.ts stubbing process.env.EBAY_TOKEN_KEY: (1) seal→open round-trips an arbitrary token string; (2) tampering with any of the three base64 segments (flip one char in iv, tag, or ciphertext) → openToken returns null, does not throw; (3) open under a DIFFERENT valid key → null; (4) EBAY_TOKEN_KEY unset or wrong length → sealToken null, openToken null; (5) 64 chars of non-hex ('z'.repeat(64)) → sealToken must not throw (this test fails today — fix by validating the decoded buffer is 32 bytes in key()); (6) malformed sealed inputs ('', 'a.b', 'not-base64..x') → null."
    },
    {
      "title": "Public showcase owner-scoping fix has no regression test",
      "file": "src/app/showcase/[token]/page.tsx",
      "line": 45,
      "severity": "low",
      "category": "test-coverage",
      "detail": "The showcase page is unauthenticated and reads with the service role, so RLS protects nothing; the only thing keeping one user's showcase from publishing another user's inventory is the eq(\"user_id\", ownerId) filter applied to BOTH branches (empty card_ids = 'all live cards', and hand-picked card_ids that could name any UUID) plus the ownerless-showcase refusal (page.tsx:42-53). The 158-agent audit fixed exactly this leak, but the fix lives inline in a server component where no test can see it — the highest-blast-radius regression in the app (every card, price, and photo of every user exposed to anyone with a link) currently has zero coverage and would ship green.",
      "fix": "Extract the card-selection into a pure query-shaping function, e.g. `showcaseCardFilter(showcase): { ownerId, ids } | null` returning null for ownerless/private showcases, and a builder that always applies .eq('user_id', ownerId) before branching on ids; unit-test: (1) is_public false → null; (2) user_id null → null (refuse, never fall through to unscoped); (3) empty card_ids → filter is ownerId + live-status, never unscoped; (4) card_ids naming foreign UUIDs → the returned filter still pins ownerId so foreign ids can only ever resolve to nothing. Alternatively cover it in the Postgres integration harness: seed two users' cards, publish user A's all-live showcase, assert the served card set never contains user B's ids."
    }
  ]
}
```

---

## 11. verify:card_sell / card_unsell reversal symme  (phase: Verify, agent afb0e46ec0ef061ce, 61767 tokens, 119s)

```json
{
  "isReal": true,
  "reason": "Verified: the only test entry point is \"test\": \"vitest run\" (package.json) over 16 TS files in test/, none of which mention card_sell/card_unsell; no supabase/tests/, no pgTAP/pg_prove outside node_modules, no CI workflows. The cited plpgsql is real: card_sell's pool draw at 20260733000000_card_sales_tenancy.sql:77-88, card_unsell at 20260720120000_card_unsell.sql:16-80, and the 20260733 rewrite (lines 105-131) only replaces the auth-gate string, leaving the reversal body untouched. Each comment-only invariant traces: correction detection keys off latest 'draw' with no later 'correction' (lines 40-45); a $0 draw (pool total_cost=0 → v_basis=round(0/n,2)=0) still inserts a draw row and decrements card_count in card_sell, and card_unsell restores the count from the row's existence not its amount (lines 43-58) — a rewrite keyed off basis_drawn would permanently lose a pool slot; card_unsell never reads use_pool_basis. Drift compounds because every later pooled sale prices basis as round(total_cost/card_count,2) and nothing rebuilds the pool from adjustments. Backlog lists card_unsell as shipped and no SQL harness as planned, so no do-not-report carve-out applies. Caveat: this is a coverage finding — the failure requires a future regression, not a live bug today."
}
```

---

## 12. verify:card_lot_sell pro-rata split and last-  (phase: Verify, agent a119c136995fec209, 54386 tokens, 85s)

```json
{
  "isReal": true,
  "reason": "Verified by reading the code: the pro-rata/last-child-remainder/equal-split logic exists exactly as claimed at supabase/migrations/20260720140000_card_lots.sql:98-119 (weight at line 99, rounding at 101-104, remainder branch at 105-110, order-dependent running sums at 112). Coverage is genuinely zero: package.json's only test script is \"vitest run\", a case-insensitive grep for \"lot\" across all 16 files in test/ returns no matches, and no SQL test harness exists under supabase/. The RPC is a live money path — src/app/api/ebay/sync/route.ts:113-116 calls db.rpc(\"card_lot_sell\", ...) with real PAID eBay order amounts — and src/app/api/cards/books/post/route.ts:44 rebuilds ledger entries from the card_sales rows it produces, so a regression in the split would book wrong revenue with no test to catch it. The current implementation looks correct, so this is a test-coverage finding (an accepted category), not a present miscalculation; every factual assertion traces and nothing refutes it."
}
```

---

## 13. verify:eBay combined-order fee/shipping alloc  (phase: Verify, agent a3ad1be121a66e267, 57601 tokens, 71s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/sync/route.ts:98-104: share = li.itemCost/orderItems, then shipIncome = Math.round(order.deliveryCost*share*100)/100 and fees = Math.round(order.marketplaceFee*share*100)/100 are rounded independently per line with no remainder step — 3 lines at $10 with deliveryCost $5.00 books 3×$1.67=$5.01 and with marketplaceFee $4.00 books 3×$1.33=$3.99, so booked totals diverge from the order by a cent each. deliveryCost/marketplaceFee are order-level (src/lib/ebay/orders.ts:79-80). The codebase treats this exact pattern as a bug elsewhere: card_lot_sell (supabase/migrations/20260720140000_card_lots.sql:44,106-111) explicitly has the last child absorb the rounding remainder \"so totals reconcile exactly\". Separately, estimateFee (route.ts:23, comment: \"$0.30 per order\") is invoked per line at route.ts:104, so a 3-line order with marketplaceFee null books $0.90 fixed fee instead of $0.30; the null path is real since orders.ts:80 yields null whenever totalMarketplaceFee is absent. runSync is unexported and grep of test/ for estimateFee|deliveryCost|marketplaceFee|runSync finds nothing — zero coverage. Combined checkouts are an acknowledged supported case (route.ts:86-87 comment), and no downstream reconciliation corrects the drift."
}
```

---

## 14. verify:parseOrder — the money inlet from eBay  (phase: Verify, agent a0c0b5f810a6326a2, 59973 tokens, 107s)

```json
{
  "isReal": true,
  "reason": "Confirmed. (a) parseOrder (src/lib/ebay/orders.ts:68, unexported) is untested: grep shows it exists only in orders.ts, and no test/ file imports @/lib/ebay — the only \"ebay\" strings in tests are platform labels in comps fixtures (estimate.test.ts:73, market-sales.test.ts:5, thecardapi.test.ts:11). (b) All settled money flows from it: sync route (src/app/api/ebay/sync/route.ts) line 101 salePrice = li.itemCost, line 99 shipIncome from order.deliveryCost, lines 102-104 fees from order.marketplaceFee, all fed to card_sell/card_lot_sell. (c) Risk 1 real as coded: orders.ts:13-14 comment states lineItem.total \"INCLUDES delivery cost (and tax)\" yet the line 91 fallback subtracts only shipping, so a taxed order missing lineItemCost books tax as revenue. (d) Risk 2 traces fully: num() (line 66) zeroes missing values, and the current card_sell (supabase/migrations/20260733000000_card_sales_tenancy.sql:73) rejects only \"p_sale_price is null or p_sale_price < 0\" — $0 is accepted, so shape drift silently marks cards sold at $0 with negative P/L and an \"ok\" audit row. (One imprecision: salePrice derives from lineItems[].lineItemCost/total, not pricingSummary, but the mechanism/outcome are as claimed.) (e) Risk 3 confirmed: orders.ts:75 defaults absent cancelStatus to NONE_REQUESTED, exactly the value that passes the settlement guard at sync route line 84. Refutation attempts (test exists elsewhere; DB rejects $0; fallback unreachable) all failed."
}
```

---

## 15. verify:Zoho pushEntry 'sent but unconfirmed'  (phase: Verify, agent ac8e70db3c0a11361, 55946 tokens, 66s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all three files. zoho.ts:68-71 catch returns { ok:false, attempted:true } (\"Sent, outcome unknown — the caller must quarantine\"); push/route.ts:121-134 branches on exactly this flag — !res.attempted deletes the card_push_log claim (retryable), attempted:true keeps it as 'uncertain' (never auto-retried). Grep over the whole test/ tree: the only `attempted` assertions are the three attempted:false pre-flight refusals at cards-connectors.test.ts:153-162 (all return before zohoFetch is called, hence no mock needed); there is no vi.mock, no mock of @/lib/zoho/client, no push-route test, and no assertion of attempted:true or 'uncertain' anywhere — the catch branch is never executed by any test. PushOutcome types attempted as plain boolean (types.ts:57), so flipping line 70 to attempted:false type-checks and all 198 tests stay green, after which a timed-out POST that actually landed in Zoho gets its claim deleted and the next run re-claims and double-posts the same manual journal. The untested half is precisely the half that prevents double-posting."
}
```

---

## 16. verify:readAll / readAllSafe — the primitive  (phase: Verify, agent a490e79a96c9730c2, 51597 tokens, 78s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/lib/supabase/page.ts:31-57 implements the exact contract claimed (window math at :37, throw-not-partial at :38, short-page termination at :41, cap->truncated:true at :42), and it has zero test coverage: vitest.config.ts includes only test/**/*.test.ts, and grep for readAll|readAllSafe|supabase/page across all 16 test files returns no matches; no src-colocated tests exist. It is load-bearing for money: src/app/api/cron/card-estimates/route.ts builds the candidate set (readAll at :68-73) and the freshness membership set (readAll at :79-85) that gate per-card estimates, each of which debits credit_ledger (:128-130). A page-boundary off-by-one regression would duplicate/skip rows in those sets, causing redundant estimates and duplicate credit debits, and no existing test would detect it."
}
```

---

## 17. verify:Auto-estimate cron candidate selection  (phase: Verify, agent a6a7d7aff732932de, 53304 tokens, 75s)

```json
{
  "isReal": false,
  "reason": "The claimed failure (same-day re-run re-bills every card) does not occur in the real code — it requires a hypothetical future regression. src/app/api/cron/card-estimates/route.ts line 88 keys the freshness map as `${e.card_id}::${e.mode}` and line 98 looks up `${card.id}::${mode}` (consistent, mode included); line 99 `if (at !== undefined && at >= cutoffMs) { skipped++; continue; }` skips any estimate newer than 14 days (cutoff, line 48), so a same-day re-run skips everything just estimated, and both the card_estimates insert (line 123) and credit_ledger debit (lines 128-129) are behind that guard. The 'untested' premise is true (no test in test/ covers the route), but 'correct code might regress someday' is not a concrete failure scenario traceable through the code — and even a broken freshness check is capped at GLOBAL=80 estimates per run (lines 20-21, 53, 114), contradicting 'every run re-estimates all cards'."
}
```

---

## 18. verify:No round-trip test that journal builde  (phase: Verify, agent aa2e16f9344c02a75, 64976 tokens, 106s)

```json
{
  "isReal": false,
  "reason": "Refuted as a defect: the invariant holds for every possible input in the current code, so no concrete failure traces. src/app/api/cards/books/post/route.ts:72 numbers lines with `lines.forEach((l, i) => rows.push({ ... line: i ... }))` AFTER cardSaleLines has finished — and cardSaleLines (src/lib/books/journal.ts:50-57) drops zero-amount lines inside its dr/cr helpers before numbering exists, so a forEach index is contiguous 0..n-1 by construction for any input. The receipts route (src/app/api/cards/receipts/route.ts:93-94) restarts numbering per entity entry, which exactly matches the guard's grouping key `${entity_id}::${source}::${source_ref}` (src/lib/cards/connectors/ledger.ts:55); an advance's two entries always have distinct entity_ids (route.ts:61 rejects same-entity advances). A grep confirms these are the only two journal_entries producers. The claim's own text concedes producers satisfy the guard 'by construction' and locates the failure in a hypothetical future edit ('if a future edit filters or reorders lines AFTER numbering') — that is a missing-regression-test wish ('consider adding'), not a specific-inputs-to-wrong-money scenario traceable through the real code, and the review bar explicitly excludes it. The test-coverage observation is accurate but does not clear the bar."
}
```

---

## 19. verify:eBay token crypto has no round-trip te  (phase: Verify, agent ad282afe866c5acc5, 46676 tokens, 58s)

```json
{
  "isReal": false,
  "reason": "The claimed crash does not exist: both sealToken calls in the OAuth callback (src/app/api/ebay/callback/route.ts:31-32) are inside the try block at lines 29-51 whose catch returns fail(e.message) — a redirect to /cards/services?ebay=error — so a malformed EBAY_TOKEN_KEY (64 chars with a non-hex char, truncated by Buffer.from and throwing 'Invalid key length' in createCipheriv) degrades to an error redirect with no tokens stored, not a crash. The only other call site (src/lib/ebay/connection.ts:40) is also inside a try/catch (lines 38-54) returning null, and openToken is fully wrapped (crypto.ts:29-38). The second risk ('any format regression in the join strands tokens') is a hypothetical about future edits, not a defect in the code as written — the format round-trips correctly today. What remains is only a missing-test observation with no concrete failure scenario, which does not clear the stated bar."
}
```

---

## 20. verify:Public showcase owner-scoping fix has  (phase: Verify, agent a26f30f730588d3bd, 51219 tokens, 68s)

```json
{
  "isReal": true,
  "reason": "Verified all predicates: page.tsx:26 uses createServiceClient() (service.ts:9-13, SUPABASE_SERVICE_ROLE_KEY, RLS bypass) with no auth check anywhere in the file; .eq(\"user_id\", ownerId) at page.tsx:49 is the sole owner scoping and is inherited by both branches (picked ids line 52, all-live line 53), with the ownerless refusal at lines 42-43; the comment at lines 36-41 documents the prior leak this filter fixed. Coverage gap confirmed: vitest runs only test/*.test.ts (16 files), grep for \"showcase\" in test/ returns zero matches, no e2e framework in package.json, and the logic is inline in the server component so no test imports it — removing line 49 would ship with all 198 tests green while exposing every user's live cards, prices, and service-role-signed photo URLs to anyone with a showcase link."
}
```

---

## 21. verify(corr):Claimed-but-never-sent push en  (phase: Verify, agent a1b3f79e542cae079, 61014 tokens, 131s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by reading route.ts, zoho client, connector, migrations, and PushToBooks.tsx. The claim insert (route.ts:104-107, status:'pending') is committed before conn.pushEntry (line 114); a Vercel kill at maxDuration=60 (line 26) in that window — most concretely during a zohoFetch 429 backoff sleep (client.ts:56-58), where Zoho has definitively rejected the request — strands the row as 'pending' with the journal provably absent from the books. Timing is plausible: 40 sequential entries (line 29) with up to 7s of backoff each. Every later run hits the unique index card_push_log_uniq → code 23505 → counted as skipped_already_posted (route.ts:109, 142), which PushToBooks.tsx:27 renders as 'N already there'. The preview page selects only business_id and reference from card_push_log (push-preview/page.tsx:43-46), so status is never read: the stranded entry gets the green 'posted' chip (line 178) and is excluded from ready/postable (lines 76-78, 87). Grep confirms only these two source files touch card_push_log — no repair path exists; the only claim release (route.ts:125-126) runs in the same request. Minor calibration: leg (b) (unchecked update at 118-120) loses only external_id — Zoho did accept that journal, so no missing money there; leg (c) (unchecked delete at 125-126) is real code but nearly unreachable since the eligible filter (92-93) pre-enforces the same predicates pushEntry refuses on (connectors/zoho.ts:54-61). Leg (a) alone sustains the finding: silent missing money permanently reported as posted, unrecoverable without hand SQL."
}
```

---

## 22. verify(impa):Claimed-but-never-sent push en  (phase: Verify, agent a2b5e4533cb9d645a, 63855 tokens, 144s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. The claim insert (push/route.ts:104-107, status 'pending') is guarded by a NON-partial unique index (migrations/20260727000000_card_push_log.sql:15-16 — no WHERE clause, unchanged by the status migration), so a stranded pending row 23505s every future claim and is counted as skipped_already_posted (route.ts:108-109,142), which PushToBooks.tsx:27 renders as 'already there'. Grep confirms only the push route and push-preview page touch card_push_log; the preview selects only business_id+reference (page.tsx:44), never status, so a pending row gets the green 'posted' chip (page.tsx:178) and is excluded from ready (lines 76-77,87) — no cleanup job or repair surface exists anywhere. The stranding window is real: 40 sequential Zoho POSTs + 80 DB roundtrips inside maxDuration=60, with zohoFetch sleeping 1s+2s+4s per 429-throttled entry (zoho/client.ts:56-58) — a kill mid-batch leaves the claimed entry pending with the journal absent from Zoho, and the killed run returns no response so even the errors array is lost. The settle-path errors are indeed unchecked (route.ts:118-120 and 125-126), so a failed claim-release also strands a never-sent entry. Result: journal missing from real books while every surface asserts it posted; recoverable only by hand SQL. One caveat: sub-point (b) is overstated — if the 'posted' update fails, Zoho already has the journal, so only external_id/status metadata is lost, not money; the money-loss scenarios are (a) death between claim and Zoho commit, and (c) failed claim release."
}
```

---

## 23. verify(repr):Claimed-but-never-sent push en  (phase: Verify, agent ae606b91149f13967, 59124 tokens, 104s)

```json
{
  "isReal": true,
  "reason": "Confirmed by direct trace. push/route.ts:104-107 commits a status='pending' claim to card_push_log before the send at line 114; with maxDuration=60 (line 26) and BATCH=40 sequential Zoho POSTs (line 29) where zohoFetch sleeps 1s+2s+4s on 429s (src/lib/zoho/client.ts:56-58), Vercel realistically kills the function between claim and send, stranding the row. No recovery exists: every later run's insert hits card_push_log_uniq (20260727000000_card_push_log.sql:15-16) and line 109 counts it as skipped_already_posted without ever reading status; the preview selects only business_id, reference from card_push_log (push-preview/page.tsx:43-46), builds its alreadyPosted set from those (lines 73-74), excludes the entry from ready (77, 87) and renders the green 'posted' chip (178). Grep confirms card_push_log appears only in these two source files plus two migrations — nothing surfaces status='pending'. Legs (b) and (c) also verified: the .update() at 118-120 and .delete() at 125-126 discard their error results, so a failed settle/release likewise strands the claim ((c) is missing money, (b) only lost external_id/status). Net: a claimed-but-never-sent journal is permanently absent from real books while API and UI both assert it was posted."
}
```

---

## 24. verify(corr):No reconciliation between push  (phase: Verify, agent a427fc0580bb82f4f, 68348 tokens, 130s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all cited code. The push route (src/app/api/cards/connectors/push/route.ts:71-96) builds entries solely from journal_entries and idempotency is reference-only — `CARDOPS-{source}-{source_ref}` (src/lib/cards/connectors/ledger.ts:95) with no content hash in card_push_log (migration 20260727000000: business_id/provider/reference + status). Path 1 traces end-to-end in-app: card_unsell deletes only the card_sales row (supabase/migrations/20260720120000_card_unsell.sql:63-67 — touches card_pool, card_sales, cards; never journal_entries/card_push_log/Zoho), so the sale's journal rows persist until the next rebuild; push-preview counts them as ready (push-preview/page.tsx:73-78) and the route posts them to Zoho. The rebuild (src/app/api/cards/books/post/route.ts:82) then deletes the internal rows but nothing reverses or flags the Zoho journal — grep shows card_push_log referenced in only 4 files and zero delete/reverse/reconcile code in src/lib/cards/connectors. Path 2's skip mechanism is real (23505 -> skipped at push/route.ts:109, so a regenerated entry with a changed amount is never re-sent), with one caveat: no app surface edits a sale's price in place (only card_sales write is the synced_to_books flag at books/post/route.ts:92; bulk route excludes sold cards at bulk/route.ts:91), so the literal same-ref/new-amount case needs a direct DB edit — but the in-app fix (unsell + re-sell) leaves the old wrong journal in Zoho plus a new one, duplicated money via Path 1's mechanism. Silent, permanent divergence between internal books and Zoho is real."
}
```

---

## 25. verify(impa):No reconciliation between push  (phase: Verify, agent a32da0413fd0556fa, 82773 tokens, 185s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by reading the code. Path 1 traces fully: card_unsell deletes only the card_sales row (supabase/migrations/20260720120000_card_unsell.sql:62-67) and never touches journal_entries, card_push_log, or Zoho; the push route builds entries straight from journal_entries (src/app/api/cards/connectors/push/route.ts:73-84) with eligibility = org/balanced/complete/mapped only (92-94), so a reversed sale's stale rows remain pushable — and the preview (src/app/cards/books/push-preview/page.tsx:37-41) shows them as ready — until the owner manually runs the rebuild (src/app/api/cards/books/post/route.ts:82). The shipped eBay cancel-order route auto-unsells on a real buyer refund without rebuilding or reconciling (src/app/api/ebay/cancel-order/route.ts:58-62). The Zoho connector can only CREATE journals (src/lib/cards/connectors/zoho.ts:63-67); card_push_log appears nowhere except the push route, the preview, and two migrations — no reversal or reconciliation code exists, and the backlog lists no such planned feature. Result: push-after-unsell posts phantom revenue to real books; push-before-unsell leaves refunded revenue there; the next rebuild erases the internal trace while the 'posted' claim and Zoho journal persist silently. One correction to Path 2: no in-app path mutates an existing card_sales row's amounts (only app-side update is the synced_to_books flag at books/post/route.ts:92; card_sell always inserts a new row and raises 'card already sold' — 20260733000000_card_sales_tenancy.sql:72,93-95), so the literal same-reference skip-with-stale-amount needs a direct DB edit; the reachable in-app fix (unsell → re-sell) mints a new source_ref and instead DOUBLE-posts — old wrong journal orphaned in Zoho plus the corrected one — same defect class (reference-only idempotency at route.ts:109, no content check), equal or worse money impact."
}
```

---

## 26. verify(repr):No reconciliation between push  (phase: Verify, agent a60c65d15351ecfe5, 74420 tokens, 170s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. Path 1 traces exactly: card_unsell (20260720120000_card_unsell.sql:63-67) deletes only the card_sales row and never touches journal_entries or card_push_log; neither caller (api/cards/unsell, api/ebay/cancel-order) rebuilds the ledger, so the reversed sale's journal rows persist; the push route (connectors/push/route.ts:73-94) reads journal_entries with no cross-check against card_sales, so the entry passes eligibility and posts to Zoho; the next rebuild (books/post/route.ts:82) deletes the internal rows while the card_push_log row stays 'posted' (only the never-sent branch at push/route.ts:125 ever deletes a claim) and the connector interface (connectors/types.ts) has only pushEntry — no void/delete — so the phantom Zoho journal is permanent and no code anywhere (verified: card_push_log appears only in push route, preview, and 2 migrations) compares claims to ledger content. Path 2's mechanism is real — reference is content-free (ledger.ts:95), claim skip at push/route.ts:109 keeps stale Zoho amounts — though the literal 'edit price' trigger has no in-app path (only card_sales update anywhere is synced_to_books); the in-app equivalents are editing a sold card's tax_treatment/entity_id (allowed: cards/[id]/page.tsx:293, api/cards/bulk/route.ts:68-73; guard trigger blocks only status/sold_at/basis_drawn) which regenerates different lines under the same reference and is skipped, or unsell→re-sell which posts a second journal while the orphaned first stays — doubled revenue. Both outcomes are silent wrong money in real books."
}
```

---

## 27. verify(corr):Journal CSV export pagination  (phase: Verify, agent aa9532cd6ad68b408, 72284 tokens, 182s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED for the CSV export. (1) Ties exist by construction: receipts/route.ts:92-95 numbers lines per entity (`e.lines.forEach((l, i)`) and books/journal.ts:135-151 returns two 2-line entries for an advance, so one advance writes 4 rows sharing (entry_date, source_ref=receipt.id) with line {0,1} duplicated across payer and payee — exact ties under the export's ORDER BY. (2) journal/route.ts:38-40 orders only (entry_date, source_ref, line) — entity_id is selected but not ordered — while readAllSafe (page.ts:17,36-43) pages at 1000 via separate LIMIT/OFFSET queries; page.ts:14-15's own contract (\"order on something unique... or rows can repeat/vanish between pages\") is violated. (3) Migration 20260720290000_journal.sql:20-21 confirms only (source, source_ref) and (entity_id, entry_date) indexes, no unique constraint, so each page is an independent in-memory sort with no tie-order guarantee (page 1's LIMIT-1000 top-N heapsort vs deeper pages' larger sorts can legitimately order ties differently). (4) The >1000-row precondition is documented as already true in production by the route's own comment (lines 29-33: the old .limit(50000) \"handed back the first 1000 lines\"). (5) Lines 50-58 stream rows to CSV with no dedupe or balance check and return HTTP 200 attachment — a boundary-straddling flipped tie yields a doubled intercompany_advance debit and a missing payee asset debit in the exported ledger. Verified card_sale rows can't tie (one entity per sale, post/route.ts:72-77), so the fix (add .order(\"entity_id\") or .order(\"id\")) is a one-liner. One correction: the push-preview secondary mechanism is overstated — connectors/ledger.ts:53-56 groups by Map key entity_id::source::source_ref and re-sorts lines (line 72), so a flipped tie cannot \"mis-group the advance's halves\"; the boundary duplicate/vanish can still hit that page's read (push-preview/page.tsx:37-41) but the balanced/complete guards (ledger.ts:98-104) fail closed, only skewing the ready counts. The push route is entity-scoped (connectors/push/route.ts:77) and safe, as the claim itself noted."
}
```

---

## 28. verify(impa):Journal CSV export pagination  (phase: Verify, agent a9f15d9ea0ac14407, 69904 tokens, 140s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED for the CSV export. journal/route.ts:38-40 orders only (entry_date, source_ref, line) with no unique tiebreaker, and exact ties really exist: an intercompany advance writes 4 rows — receipts/route.ts:93-94 numbers lines with the per-entity forEach index over the two EntityEntry objects from receiptEntries (journal.ts:135-151), so payer and payee each get (receipt_date, receipt_id, 0) and (receipt_date, receipt_id, 1). The schema (20260720290000_journal.sql:8,20-21) has PK(id) plus only non-unique indexes (source,source_ref) and (entity_id,entry_date) — no unique constraint blocks the duplicate keys and no index covers the sort. readAll (page.ts:36-43) re-executes OFFSET/LIMIT per 1000-row page, and page.ts:14-15 itself documents that a non-unique order makes rows 'repeat/vanish between pages' — the export violates its own module contract. The >1000-row precondition is proven live by the route's own comment (lines 29-33: the prior version actually truncated at 1000). Result: a boundary inside a tie group can emit the payer's line twice and drop the payee's asset debit, in a CSV built with zero balance/completeness checks (lines 52-58), delivered HTTP 200 as an attachment expressly intended for CPA/Zoho import — wrong money, silent. One correction: the push-preview sub-claim's mechanism is wrong — buildPushEntries groups via a Map keyed entity_id::source::source_ref and re-sorts by line (ledger.ts:55,72), so flipped ties cannot mis-group; worst case there is a transient off-by-one in the displayed 'ready' count (a dup/missing row fails the complete check, ledger.ts:101-104, failing toward refusal), and the push route re-reads .eq(entity_id) (push/route.ts:77-78) where (source_ref,line) is unique. The export defect stands on its own at medium severity."
}
```

---

## 29. verify(repr):Journal CSV export pagination  (phase: Verify, agent a35e80909e9208f14, 76569 tokens, 180s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. Every load-bearing fact checks out in source: (1) src/app/api/cards/receipts/route.ts:92-95 numbers journal lines per entity (`e.lines.forEach((l, i) => ... line: i)`) with shared entry_date=receipt_date and source_ref=receipt id, and receiptEntries (src/lib/books/journal.ts:135-151) returns two 2-line entity entries for an advance — so one advance produces two exact-tie pairs under the export's ORDER BY: payer and payee both get (date, ref, 0) and (date, ref, 1). (2) The export (src/app/api/cards/books/journal/route.ts:38-41) orders only (entry_date, source_ref, line) — no entity_id, no id PK — while paging at 1000 via readAllSafe/.range() (LIMIT/OFFSET, one independent query per page). (3) Migration 20260720290000_journal.sql:20-21 confirms only (source, source_ref) and (entity_id, entry_date) indexes — neither covers the ORDER BY, so each page re-sorts scan output and Postgres guarantees no stable tie order across queries. (4) A boundary landing inside a tie pair plus a flipped tie returns one row twice and its twin never; readAll concatenates blindly (src/lib/supabase/page.ts:36-43) and the CSV is emitted verbatim with no balance check as HTTP 200 attachment (journal/route.ts:52-66) — a doubled intercompany_advance debit and a missing asset debit in a financial export. This violates page.ts's own documented contract (lines 14-15) that this same audit wrote, and sibling reads (src/app/cards/books/page.tsx:78,134) order by id — a genuinely missed instance, not re-litigation. One correction to the claim's secondary remark: buildPushEntries (src/lib/cards/connectors/ledger.ts:55) groups by Map key `${entity_id}::${source}::${source_ref}`, which is order-independent — a flipped tie does NOT \"mis-group the advance's halves\"; the push-preview (push-preview/page.tsx:40-41) is still exposed to the same duplicate/vanish row loss, which can only undercount \"ready\" (dropped row → unbalanced; doubled row → complete=false at ledger.ts:101-104), and the actual push route is safe as the claim itself notes (push/route.ts:77 scopes .eq entity_id). The primary finding — unbalanced journal CSV export with no signal — traces end-to-end. Fix: add .order(\"id\") as final tiebreaker in both readers."
}
```

---

## 30. verify(corr):Sale entry_date is the UTC cal  (phase: Verify, agent a20cc6a369920fcfe, 64989 tokens, 119s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. sold_at is always a settlement instant: migration 20260713150000_cardops_init.sql:270 declares `sold_at timestamptz not null default now()`, and the sole writer — the card_sell RPC (20260713170000_card_sell_rpc.sql:62-67) — inserts card_sales without a sold_at column, so now() always applies; no route or UI sets/edits it, and the eBay sync (src/app/api/ebay/sync/route.ts:136-144) calls card_sell with no date param. No migration alters the DB TimeZone, so PostgREST returns UTC strings; src/app/api/cards/books/post/route.ts:71 `String(s.sold_at ?? \"\").slice(0, 10)` therefore yields the UTC calendar day — a sale settled 6PM–midnight CST Dec 31 books entry_date in the next year. Downstream verified: journal CSV year filter on entry_date (journal/route.ts:42), Business Books year buckets comparing timestamptz sold_at to bare date literals at UTC (src/app/cards/books/page.tsx:76-77; same in api/cards/reports/route.ts:35-36), and the Zoho push carries it as journal_date (src/lib/cards/connectors/ledger.ts:94 → zoho.ts:33). Nothing in CLAUDE.md/reference marks UTC-day accounting deliberate. One claim detail is off in the finding's favor: eBay sales don't use the real order timestamp at all — card_sell stamps now() at sync time, so a Dec 30 order synced Jan 1 misbooks the year regardless of timezone."
}
```

---

## 31. verify(impa):Sale entry_date is the UTC cal  (phase: Verify, agent aee5a97087f500012, 68607 tokens, 125s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. sold_at can only be a UTC settlement instant: card_sell (20260733000000_card_sales_tenancy.sql:93-95) inserts card_sales without sold_at, so it takes the column default now() (20260713150000_cardops_init.sql:270, timestamptz), and the RPC has no date parameter — the eBay cron uses the same RPC. post/route.ts:71 derives entry_date via String(s.sold_at).slice(0,10), which is the UTC calendar day since Supabase serializes timestamptz in UTC; a sale settled 7:30 PM CST Dec 31 2026 gets entry_date 2027-01-01. Downstream all verified: journal/route.ts:42 gte/lt-filters the year CSV on entry_date (2026 export drops the sale); books/page.tsx:76-77 buckets on sold_at against bare date strings evaluated at UTC midnight; connectors/ledger.ts:94 sets date=entry_date and zoho.ts:33 maps it to journal_date, so the pushed Zoho journal reports the revenue in the wrong tax year. Grep for America/Chicago|timeZone|getTimezoneOffset across src returns nothing — no timezone handling exists, so the UTC day is accidental, not a convention. Concrete wrong-money-on-tax-books impact; medium severity fits the once-a-year 6-hour boundary window."
}
```

---

## 32. verify(repr):Sale entry_date is the UTC cal  (phase: Verify, agent ac2e1b831b3a7ba9a, 69481 tokens, 142s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. sold_at is always the settlement instant: card_sell inserts card_sales without sold_at (20260733000000_card_sales_tenancy.sql:93-95), so the column default now() applies (20260713150000_cardops_init.sql:270 'sold_at timestamptz not null default now()'); the manual sell form (src/app/cards/[id]/sell/actions.ts:41-49) and eBay sync (src/app/api/ebay/sync/route.ts:136-144) offer no date parameter. No migration overrides Supabase's UTC TimeZone, so PostgREST returns e.g. 2027-01-01T01:30:00+00:00 for a 7:30 PM CST Dec 31 sale. post/route.ts:71 'String(s.sold_at ?? \"\").slice(0, 10)' yields the UTC day 2027-01-01, written to journal_entries.entry_date (a date column, 20260720290000_journal.sql:10). Downstream: journal/route.ts:42 year filter (gte/lt on entry_date) excludes it from the 2026 CSV; books/page.tsx:76-77 gte/lt on sold_at vs bare date strings (parsed at UTC midnight) shifts the same sale into the 2027 buckets; ledger.ts:94 (date: first.entry_date) → zoho.ts:33 (journal_date) pushes the wrong year to Zoho. One peripheral inaccuracy: eBay sales do not carry real order timestamps into sold_at — card_sell stamps the sync-run time — but that worsens rather than refutes the date drift; the core defect at line 71 stands."
}
```

---

## 33. verify(corr):Receipt DELETE ignores both de  (phase: Verify, agent a9c57f1a2c344ab95, 58023 tokens, 114s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/cards/receipts/route.ts:121-123: both deletes discard their results ('await supabase.from(\"journal_entries\").delete().eq(\"source\",\"receipt\").eq(\"source_ref\", id);' then 'await supabase.from(\"card_receipts\").delete().eq(\"id\", id);' then unconditional 'return NextResponse.json({ ok: true });'). The installed @supabase/postgrest-js defaults shouldThrowOnError=false (PostgrestBuilder.ts:80) and even wraps fetch rejections into resolved { error } results (PostgrestBuilder.ts:390-391), so a failed delete never throws — execution proceeds and the second delete runs. No self-heal exists: journal_entries.source_ref is plain text with no FK to card_receipts (migrations/20260720290000_journal.sql:12), and the ledger rebuild (api/cards/books/post/route.ts:82) only deletes/rebuilds source='card_sale', never source='receipt'; this DELETE route is the only deleter of receipt journal lines and it is keyed by a receipt id the UI can no longer surface (GET lists card_receipts, route.ts:32-37). Orphans demonstrably flow into the CSV export (api/cards/books/journal/route.ts:34-57 reads all journal_entries, no join) and the intercompany balances (cards/books/page.tsx:130-140 sums intercompany_advance/intercompany_payable straight from journal_entries). Scenario B (journal delete succeeds, receipt delete errors) leaves a posted=true receipt with zero ledger lines. The POST handler's explicit rollback (route.ts:98-104, 'Ledger post failed — receipt not saved') proves the pairing is meant to be atomic; DELETE lacks any of that. Claim CONFIRMED."
}
```

---

## 34. verify(impa):Receipt DELETE ignores both de  (phase: Verify, agent a7f4ec3c9db4e5288, 57505 tokens, 107s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. route.ts:121-123 runs both deletes with results discarded (`await supabase.from(\"journal_entries\").delete().eq(\"source\",\"receipt\").eq(\"source_ref\", id);` then the card_receipts delete) and returns { ok: true } unconditionally — supabase-js returns error objects, not throws, so a failed journal delete cannot stop the receipt delete. No safety net: journal_entries.source_ref is plain text with no FK (20260720290000_journal.sql:12), the only receipt-journal delete path in src/ is this line, and books/post/route.ts:82 rebuilds only source='card_sale'. Orphaned lines demonstrably feed real numbers: books/page.tsx:130-140 sums intercompany balances straight from journal_entries; the CSV export reads all rows; ledger.ts:101-112 marks the orphan balanced+complete and postable to Zoho. The same file's POST (lines 98-104) rolls back the receipt when the journal insert fails 'so we NEVER claim success without the double-entry actually landing' — DELETE violates that exact invariant. Scenario A (journal delete fails, receipt deleted anyway) yields permanently orphaned, UI-unreachable ledger money reported as success; scenario B leaves a posted=true receipt with zero lines, understating the books."
}
```

---

## 35. verify(repr):Receipt DELETE ignores both de  (phase: Verify, agent ab1dcdc8c0e76a57d, 57703 tokens, 103s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/cards/receipts/route.ts:121-123: both deletes discard supabase-js `{ error }` results (v2 never throws by default — DB errors and network failures alike resolve to error objects) and the handler returns `{ ok: true }` unconditionally. No safety net exists: journal_entries.source_ref is plain text with no FK/cascade to card_receipts (20260720290000_journal.sql:12; the 20260725000000 migration only repoints entity_id), the rebuild at books/post/route.ts:82 deletes only source=\"card_sale\" so receipt orphans survive rebuilds, and this route is the sole deleter of source=\"receipt\" lines — once the receipt row is gone (scenario A) the orphans are unreachable from any UI while still flowing into the CSV export (books/journal/route.ts:34-44, no source filter), push-preview (push-preview/page.tsx:38), and intercompany balances (books/page.tsx:130-140). Verified receiptEntries (src/lib/books/journal.ts:132-151) emits exactly four lines across two entities for an advance. The client (ReceiptsManager.tsx:80-84) optimistically removes the row and swallows fetch errors, compounding the silence. Scenario B (receipt survives posted=true with zero lines, ok:true returned) also traces. POST in the same file (lines 98-104) explicitly rolls back to never claim success without the double-entry landing — DELETE breaks that stated invariant."
}
```

---

## 36. verify(corr):Ledger rebuild is non-transact  (phase: Verify, agent a97bf695297ce0a15, 62934 tokens, 109s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. route.ts:82-88 does delete-then-chunked-insert as separate PostgREST calls with no transaction; journal migration 20260720290000_journal.sql:20 has only a NON-unique index (source, source_ref) — no unique constraint anywhere blocks duplicate (source, source_ref, line) rows; PostToLedger.tsx:11's busy flag is per-tab React state and no server-side lock exists (grep for advisory/lock/in_progress found none). The concurrent-rebuild interleave (even the simplest: A-del, B-del, A-insert-all, B-insert-all) doubles every sale's journal rows with both requests returning ok. The CSV export (journal/route.ts:34-57) has no dedup or line-contiguity guard so the doubled/fragmented ledger exports silently; Zoho push alone is protected (ledger.ts:101-104 complete check, push/route.ts:93). Truncation also traces: maxDuration=60 (route.ts:12) vs up to MAX_SALES=100_000 (route.ts:35) → ~600k rows → ~1200 sequential 500-row inserts; a mid-loop kill after the :82 delete leaves a silent prefix, and 500 % 6 ≠ 0 (dealer sale = 6 lines, journal.ts:79-85) can strand a self-balancing fragment of one sale."
}
```

---

## 37. verify(impa):Ledger rebuild is non-transact  (phase: Verify, agent a7f2e4a0be3af2fe9, 66275 tokens, 141s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/api/cards/books/post/route.ts:82-88 is delete-then-chunked-insert via separate PostgREST calls with no transaction and no lock; migration 20260720290000_journal.sql:20 creates only a NON-unique index on (source, source_ref) and no migration adds a unique constraint, so duplicate journal rows coexist; PostToLedger.tsx:11 shows the busy flag is per-tab useState with no server-side guard; the insert is plain .insert (no onConflict). The duplication interleaving traces fully: two concurrent POSTs (both deletes before either finishes inserting) leave card_sale rows doubled and BOTH return {ok:true} at route.ts:95 — silent. Downstream: the CSV export (books/journal/route.ts:34-57) has no dedup or completeness guard so the exported financial document shows doubled debits/credits, and the books-page count (books/page.tsx:80) doubles; the claim's own concession is also correct — buildPushEntries (src/lib/cards/connectors/ledger.ts:101-112) fails duplicated line numbers via the contiguous 0..n-1 check, so Zoho is protected. One caveat: scenario 2 (truncation) is real state corruption (delete commits, inserts can die at maxDuration=60, route.ts:12, ~1200 inserts at the 100k cap) but is NOT silent — insert failure returns 500 'Post failed (re-sync to finish)' (route.ts:87) and a timeout surfaces as a failed request, so it persists only if the owner ignores the error. The claim stands on the silent duplication scenario."
}
```

---

## 38. verify(repr):Ledger rebuild is non-transact  (phase: Verify, agent a48f8769c56346856, 64758 tokens, 156s)

```json
{
  "isReal": true,
  "reason": "Confirmed from source. src/app/api/cards/books/post/route.ts:82 deletes all source='card_sale' rows and :85-88 re-inserts in 500-row chunks — separate auto-committed PostgREST calls, no transaction, no server-side lock (grepped all migrations: no advisory locks), and the only guard is a per-mount useState busy flag in src/components/cards/PostToLedger.tsx:11 that a second tab bypasses. journal_entries has NO unique constraint (uuid PK, non-unique journal_entries_source_idx at supabase/migrations/20260720290000_journal.sql:20; no later migration adds one), so the two-tab interleaving (A delete, A chunk1, B delete, A chunk2, B insert-all) commits A's chunk-2 rows twice and both requests return ok:true at route.ts:95. The CSV export (journal/route.ts:34-58) has no dedup and the books-page count (books/page.tsx:80) is exact-count, so both show doubled figures; buildPushEntries (connectors/ledger.ts:101-112) does mark duplicated groups complete=false via the 0..n-1 check, protecting Zoho as claimed. Truncation also traces: delete commits first, MAX_SALES allows 99,999 sales × up to 6 dealer lines (books/journal.ts:79-84) ≈ 600k rows = ~1,200 sequential inserts + 100 paged reads against maxDuration=60 (route.ts:12), and any crash/timeout mid-loop leaves a markerless partial ledger with sale lines splittable at the 500-row slice boundary; the CSV export has no completeness guard. Only nit: a timeout surfaces a 504 to the clicking user, so truncation is not fully silent client-side — but the ledger/CSV carry no incompleteness marker and stale synced_to_books flags persist."
}
```

---

## 39. verify(corr):PushToBooks reads a response f  (phase: Verify, agent a7828b4deb7e8abfe, 47132 tokens, 43s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. The route's response literal (src/app/api/cards/connectors/push/route.ts:137-148) contains no `failed` key — only pushed/skipped_already_posted/refused/uncertain/not_ready/remaining/errors — while the client computes `ok: d.failed === 0` (PushToBooks.tsx:30), which is `undefined === 0` = false on every response, so even a fully successful push renders the red AlertTriangle/text-danger branch (lines 40-41; the CheckCircle2 success branch is unreachable). `if (d.failed)` (line 28) never fires, and the client never reads d.refused/d.uncertain/d.not_ready, so the uncertain count — the one state route.ts:128-133 says must be manually verified in real books — is never displayed; only errors[0] leaks the first uncertain entry's text, and any further uncertain references are invisible. Traced scenario pushed:38/uncertain:2 behaves exactly as claimed."
}
```

---

## 40. verify(impa):PushToBooks reads a response f  (phase: Verify, agent a2459024c33b1c347, 57864 tokens, 76s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading both sides. The route's response (src/app/api/cards/connectors/push/route.ts:137-148) is { ok, business, provider, pushed, skipped_already_posted, refused, uncertain, not_ready, remaining, errors } — no `failed` field exists anywhere in the file, and app/api/cards/connectors/push/route.ts is a pure re-export. In PushToBooks.tsx line 30, `setRes({ ok: d.failed === 0, ... })` evaluates `undefined === 0` = false, so every push — including a fully successful one — renders with the red AlertTriangle failure styling (lines 40-41); the CheckCircle2 success branch is unreachable. Line 28 `if (d.failed)` never fires, so refused/uncertain/not_ready counts are never displayed and only errors[0] leaks through. Impact is worse than claimed: `uncertain` status is written to card_push_log (route.ts:132) but never read anywhere in the UI — the push-preview page (src/app/cards/books/push-preview/page.tsx:44) selects only business_id and reference, so uncertain entries render with the green \"posted\" chip (line 178). Since uncertain claims are never auto-retried by design (route.ts:128), a send that actually failed becomes a journal that silently never exists in real Zoho books while every screen says it posted; the one transient message that could flag it drops the count and all references past the first."
}
```

---

## 41. verify(repr):PushToBooks reads a response f  (phase: Verify, agent ab62a193a43a1eee0, 48457 tokens, 54s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading both sides. src/app/api/cards/connectors/push/route.ts:137-148 returns { ok, business, provider, pushed, skipped_already_posted, refused, uncertain, not_ready, remaining, errors } — no `failed` field (grep confirms \"failed\" appears only in a comment); the app/ shell is a pure re-export so the client hits this handler. src/components/cards/PushToBooks.tsx:28 `if (d.failed) bits.push(...)` never fires (d.failed is undefined) and nothing else reads `refused`/`uncertain`, so those counts are never shown; line 30 `ok: d.failed === 0` evaluates `undefined === 0` = false, so every 2xx result — including a flawless push — renders via lines 40-41 with the red text-danger AlertTriangle. Traced the concrete scenario (pushed:38, uncertain:2): HTTP 200 so no throw, bits=[\"38 posted\"], no uncertain count anywhere, only errors[0] appended, rendered red. Severity [low] is right: display-only, but it inverts the success signal on the one real-books control and hides the uncertain count the protocol requires manual verification of."
}
```

---

## 42. verify(corr):Every non-Speed-Book card defa  (phase: Verify, agent a3d8ed894c6a74c20, 78588 tokens, 177s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by reading every cited file. cards.use_pool_basis defaults TRUE (20260713150000_cardops_init.sql:171) and the ONLY pool-funding writes in all 34 migrations are speed_book_commit's 'add' (20260724000000:188-191, 20260732000000:99-102, both requiring p_lot_cost > 0) plus card_unsell's restore. Full Intake (src/app/cards/intake/actions.ts:68-133 — IntakeInput has no cost field, insert row never sets use_pool_basis/individual_basis), CSV import (src/app/cards/actions.ts:196-215), and the manual form (CardForm.tsx:134 defaultChecked true) all create pool-basis cards that never fund the pool; FullIntake.tsx collects no cost input and no trigger funds on insert. The live card_sell (20260733000000:77-85) gates solely on v_card.use_pool_basis — no card↔pool membership exists — so unfunded cards draw round(total_cost/card_count) and decrement card_count; once count hits 0 the 'card_count > 0' branch skips the draw and genuinely funded cards sell at v_basis=0, exactly as claimed. The misattributed basis_drawn/profit_loss propagates to books/page.tsx:75,114, reports/page.tsx:79, the CPA CSV (api/cards/reports/route.ts:58), and the ledger post (api/cards/books/post/route.ts:45). Not excluded: the receipts deferral note (api/cards/receipts/route.ts:4) covers receipts→basis only, and cardops-backlog.md line 27 lists the cost-basis pool as SHIPPED, with no 'intake cost capture' backlog item. Only trivial inaccuracies: the guardrail comment lives in intake/actions.ts:224-226 not the migration, and 'stranding residual total_cost forever' overstates the tail (final count=1 draw takes the whole remainder; only rounding residue strands) — the COGS misattribution and $0-basis sales stand."
}
```

---

## 43. verify(impa):Every non-Speed-Book card defa  (phase: Verify, agent a2e330ba2e6bdd529, 72553 tokens, 128s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end in code. cards.use_pool_basis defaults true (20260713150000_cardops_init.sql:171) and the ONLY pool-funding write in the entire repo is speed_book_commit (20260724000000_multi_tenant_cards.sql:188-191); the receipts route defers basis wiring explicitly (src/app/api/cards/receipts/route.ts:4, receipts-only). Full Intake's IntakeInput (src/app/cards/intake/actions.ts:68-78) has no cost field and the insert (lines 91-118) sets neither use_pool_basis nor individual_basis; CSV import (src/app/cards/actions.ts:196-215) likewise; CardForm defaults the pool checkbox checked (src/components/cards/CardForm.tsx:134). The live card_sell (20260733000000_card_sales_tenancy.sql:77-88) draws round(total_cost/card_count) and decrements card_count for ANY use_pool_basis card while card_count > 0, and silently books v_basis = 0 (declared 0 at line 66) once the count is exhausted — no error path. Lot sales (card_lot_sell) and the eBay settlement sync (src/app/api/ebay/sync/route.ts:136) settle through the same RPC. The wrong basis persists to card_sales.basis_drawn/profit_loss and is booked as COGS in the double-entry ledger (src/lib/books/journal.ts:83 dr(\"cogs\", basis)) and the hobby/dealer tax split (journal.ts:74). The claimed arithmetic traces exactly: unfunded intake cards parasitically drain a Speed-Book-funded pool's cost and count, real purchase cost of intake/import cards never enters COGS anywhere, and genuinely pooled cards eventually sell at $0 basis with residual total_cost stranded. Not covered by any DO-NOT-REPORT item and not in the backlog as a planned feature; the speed_book guardrail comment (\"lot cost REQUIRED so the pool average never gets deflated by $0-basis cards\") proves funded-pool integrity was the design intent these paths break. Real-money impact: silently wrong realized P/L and COGS per sale in card_sales, the books ledger, reports, and tax buckets."
}
```

---

## 44. verify(repr):Every non-Speed-Book card defa  (phase: Verify, agent acaa685170b0de540, 71910 tokens, 149s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by full trace. (1) cards.use_pool_basis defaults TRUE: 20260713150000_cardops_init.sql:171 'use_pool_basis boolean not null default true'. (2) The ONLY pool funding in the codebase is speed_book_commit (20260732000000_per_user_sku.sql:99-102 / 20260724000000:188-191, 'update public.card_pool set total_cost = total_cost + p_lot_cost, card_count = card_count + v_n') plus card_unsell's reversal restore; grep of src/ shows every other card_pool reference is a SELECT. (3) commitIntakeCard (src/app/cards/intake/actions.ts:91-118) inserts with no use_pool_basis/individual_basis and IntakeInput (68-78) has no cost field at all; CSV import (src/app/cards/actions.ts:196-212) same; CardForm.tsx:134 defaults the checkbox checked. (4) card_sell (20260733000000_card_sales_tenancy.sql:77-85) draws round(total_cost/card_count,2) and decrements count for ANY use_pool_basis card with no funded-check, and when card_count=0 the 'if found and v_pool.card_count > 0' branch is skipped leaving v_basis=0 — funded cards then sell at $0 basis. (5) The wrong basis_drawn feeds books COGS directly (src/lib/books/journal.ts:45,83-84), card_sales.profit_loss, reports, and tax buckets. (6) Not documented as deliberate: receipts route note (src/app/api/cards/receipts/route.ts:4) defers only receipts→basis wiring, and reference/cardops-backlog.md:27 lists the cost-basis pool as shipped. Scenario arithmetic verified: pool 500/100, each parasitic single draws exactly $5; 50 parasite sales misattribute $250 of lot basis, the singles' real cost is captured nowhere, and the last 50 funded cards sell at $0 COGS. Only nit: in the clean example the pool drains to ~$0 rather than stranding residual total_cost (stranding needs rounding drift); core defect stands."
}
```

---

## 45. verify(corr):Sales & P&L screen sums only t  (phase: Verify, agent a70f286297c2f14dc, 51120 tokens, 85s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/app/cards/sales/page.tsx:17-21 reads card_sales with .order(\"sold_at\", desc).limit(1000) and lines 23-30 reduce net_proceeds/basis_drawn/profit_loss over that slice; lines 43-47 render the sums as unqualified headline tiles (\"Sales · N\", \"Basis drawn\", \"Profit / loss\"). Past 1000 lifetime sales, older rows are silently excluded from all three money totals and the count pins at 1000. The same table is paged fully elsewhere — src/app/cards/reports/page.tsx:78-80 via its pageAll (lines 33-40, up to 100k rows) and the CPA CSV route src/app/api/cards/reports/route.ts:31-37 (up to 200k rows) — so the tiles disagree with /cards/reports and the CPA export exactly as claimed. src/lib/supabase/page.ts:10-12 codifies that sum-feeding reads must use readAll while only recent-N lists may keep .limit(); this page's sums violate that rule. Nothing in reference/audit-2026-07-24.md (zero mentions of \"sales\"), cardops-backlog.md, or the do-not-report list documents this as deliberate."
}
```

---

## 46. verify(impa):Sales & P&L screen sums only t  (phase: Verify, agent a3cb98fb34cb6fbd7, 54413 tokens, 66s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/cards/sales/page.tsx:17-21 queries card_sales with .order(\"sold_at\", desc).limit(1000); lines 23-30 reduce net_proceeds/basis_drawn/profit_loss over only that slice; lines 43-47 render the sums as unqualified \"Sales · N\" / \"Basis drawn\" / \"Profit / loss\" headline tiles with no truncation indicator. The comparison screens really do page fully: src/app/cards/reports/page.tsx:33-41,77-80 (pageAll over card_sales) and src/app/api/cards/reports/route.ts:30-36 (CSV, pages to 200k rows), so past 1000 lifetime sales the two money screens disagree and /cards/sales silently under-reports lifetime totals. Volume path is real: src/app/api/ebay/sync/route.ts settles every matched paid eBay order into card_sales via daily cron (one row per card). reference/audit-2026-07-24.md contains no mention of this page or cap, so it is a new, unexempted instance of the capped-read-feeding-a-sum class the audit mandated readAll for. Concrete failure: at sale #1001, the oldest sale falls out of the window and the Net/Basis/P&L tiles drop its amounts — a wrong money number presented as the total."
}
```

---

## 47. verify(repr):Sales & P&L screen sums only t  (phase: Verify, agent aa36aef2cc55fe393, 48430 tokens, 56s)

```json
{
  "isReal": true,
  "reason": "Confirmed by direct read. src/app/cards/sales/page.tsx:17-21 queries card_sales with .order(\"sold_at\", {ascending:false}).limit(1000); lines 23-30 reduce net_proceeds/basis_drawn/profit_loss over only that slice; lines 43-47 render the sums as unqualified \"Sales · N\" / \"Basis drawn\" / \"Profit / loss\" stat tiles on the \"Sales & P&L\" page. Once lifetime sales exceed 1000, older rows silently drop out of the money totals. The claimed disagreement is real: src/app/cards/reports/page.tsx:77-80 sums the same table via pageAll (full pagination) and src/app/api/cards/reports/route.ts:31-42 pages the CPA CSV up to 200k rows, so /cards/sales would show smaller totals than /cards/reports and the CPA export. The audit doc (reference/audit-2026-07-24.md) never mentions this page — it is a missed instance of the mandated readAll-for-sums class, not a documented exemption."
}
```

---

## 48. verify(corr):Unsell never reverses (or even  (phase: Verify, agent ae3289198a2bda9a2, 70414 tokens, 128s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. card_unsell deletes the card_sales row (supabase/migrations/20260720120000_card_unsell.sql:66) and touches neither card_push_log nor Zoho; the internal rebuild (src/app/api/cards/books/post/route.ts:82) deletes all card_sale journal entries and rebuilds only from surviving sales, so the reversed sale's entries vanish locally. The Zoho journal was posted under reference CARDOPS-card_sale-<sale_id> (src/lib/cards/connectors/ledger.ts:95, source_ref = sale id per post/route.ts:74); the only Zoho journal API call in the codebase is the POST in src/lib/cards/connectors/zoho.ts:63-66 — no delete/void/reconcile exists anywhere (grep for /books/v3/journals and card_push_log across src). The posted card_push_log row survives (push/route.ts deletes claims only on pre-flight refusal, lines 125-126), and push-preview (src/app/cards/books/push-preview/page.tsx:68-74) builds display entries only from current journal_entries, so the stale posted journal renders nowhere (it survives only as an anonymous +1 in the alreadyPosted count tile — no flag, no identification). Re-sell: card_sales.id defaults gen_random_uuid (20260713150000_cardops_init.sql:264) and card_sell inserts without an id, so a second sale gets a new reference not present in card_push_log and the next push posts a second journal while the phantom one remains — Zoho keeps the refunded order's revenue/COGS plus the new sale's. Not documented as accepted: cardops-backlog.md has zero zoho/push/connector mentions; next-steps.md only defers per-user Zoho OAuth; not on the DO-NOT-REPORT list."
}
```

---

## 49. verify(impa):Unsell never reverses (or even  (phase: Verify, agent adff61fac9c3e5954, 65445 tokens, 113s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. card_unsell (supabase/migrations/20260720120000_card_unsell.sql:66) deletes the card_sales row and never touches card_push_log or Zoho; card_push_log (20260727000000) has no FK to card_sales. The push route records the Zoho journal under reference CARDOPS-card_sale-<sale_id> (src/lib/cards/connectors/ledger.ts:95, push/route.ts:104-120) and stores external_id but no code path ever reverses/voids a Zoho journal. books/post/route.ts:82 rebuilds the internal ledger without the deleted sale, and push-preview/page.tsx:68-91 renders only entries built from journal_entries, so the stale 'posted' claim row becomes an anonymous +1 in the 'already posted' count with no visible identity — Zoho permanently keeps revenue/COGS of the refunded order with no flag. Re-sell is a genuine double-post: card_sell (20260713170000_card_sell_rpc.sql:62-67) inserts card_sales without an id, so a new uuid → new reference → passes the (business_id, provider, reference) unique index → second Zoho journal, leaving both the refunded and the real sale in real books. Nothing in reference/ (backlog, next-steps, audit) documents this as accepted; the cancel-order route (src/app/api/ebay/cancel-order/route.ts:59) makes the trigger path routine, and next-steps.md shows the push flow is live."
}
```

---

## 50. verify(repr):Unsell never reverses (or even  (phase: Verify, agent a6b710231e4a9897a, 74648 tokens, 138s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the full path. (1) card_unsell deletes the card_sales row (supabase/migrations/20260720120000_card_unsell.sql:66) and touches neither card_push_log nor Zoho; the eBay cancel-order route (src/app/api/ebay/cancel-order/route.ts:59) and the unsell route call only this RPC. (2) books/post self-heals the internal ledger by delete-and-rebuild from current card_sales (src/app/api/cards/books/post/route.ts:82), so the pushed entry vanishes from journal_entries. (3) The Zoho connector has no reversal capability — src/lib/cards/connectors/zoho.ts exposes only listAccounts and pushEntry (POST /books/v3/journals); grep shows card_push_log is written only by the push route itself, so the orphaned status='posted' claim (reference CARDOPS-card_sale-<sale_id>, built at src/lib/cards/connectors/ledger.ts:95) is never detected: push-preview (src/app/cards/books/push-preview/page.tsx:68-74) renders only entries built from journal_entries and uses the push log purely as a membership set, so the stale posted journal shows on no screen (it only silently inflates the 'already posted' count at line 124). (4) Re-sell double-post confirmed: card_sell inserts card_sales without an id, defaulting to gen_random_uuid() (20260713150000_cardops_init.sql:264; insert at 20260713170000_card_sell_rpc.sql:62-67), so a new sale yields a new reference that the card_push_log unique index (business_id, provider, reference) cannot catch — Zoho permanently keeps the refunded order's revenue/COGS journal plus the new one. (5) Not documented as accepted: reference/cardops-backlog.md:27 lists card_unsell as done, reference/next-steps.md:26-37 treats the Zoho push as a live cutover step with Zoho env vars carried over, and reference/audit-2026-07-24.md never mentions the push-log/unsell interplay; it is not on the DO-NOT-REPORT list."
}
```

---

## 51. verify(corr):Lot sell API accepts negative  (phase: Verify, agent a188c1ceb217ba7f8, 65859 tokens, 116s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. src/app/api/cards/lots/route.ts:126 validates only salePrice>0; line 131 passes p_fees: Number(body?.fees) || 0 (Number(-50) = -50, truthy) straight to the RPC, gated only by hasCardAccess (line 37). card_lot_sell (20260720140000_card_lots.sql:81) checks only p_sale_price and pro-rata allocates the negative fee to children (lines 100-116); it is never redefined with validation. The live card_sell (20260733000000_card_sales_tenancy.sql:73-75) also checks only p_sale_price and computes v_net := sale_price - fees + ship_income - ship_cost, so fees=-50 on a $100 sale writes net_proceeds=150 and profit_loss overstated by $50 into card_sales, which has no CHECK constraints (20260713150000_cardops_init.sql:263-272); guard_card_sale gates actor, not values. The single-card action (src/app/cards/[id]/sell/actions.ts:28-39) validates 0..10M with the exact comment 'a negative fee would inflate net proceeds and corrupt P/L' — the lot route reintroduces the hole that fix closed. The books layer swallows it: cardSaleLines (src/lib/books/journal.ts:50-52, 79-85) flips the negative fee to a 50 credit on platform_fees, cash debit 150 = credits 150, so linesBalance passes and nothing catches the corruption."
}
```

---

## 52. verify(impa):Lot sell API accepts negative  (phase: Verify, agent abe6ea528d8ff6fca, 68002 tokens, 130s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading every hop. Route: src/app/api/cards/lots/route.ts:124-135 checks only salePrice>0 and forwards p_fees: Number(body?.fees) || 0 (line 131) plus shipIncome/shipCost unvalidated; line 11 documents these as accepted API params. RPC card_lot_sell (20260720140000_card_lots.sql:81) validates only p_sale_price and allocates the negative fee pro-rata to children (lines 102, 108). The current card_sell (20260733000000_card_sales_tenancy.sql:73-75) also validates only sale_price and computes v_net = price - fees + shipIn - shipCost, so fees:-50 on a $100 sale yields net_proceeds=150 and profit_loss overstated by $50, inserted into card_sales (lines 93-95) which has no CHECK constraints on money columns (20260713150000_cardops_init.sql:263-272). Books: src/lib/books/journal.ts:50-52 flips a negative fee to the credit side so the entry balances silently — exactly as claimed. The single-card path (src/app/cards/[id]/sell/actions.ts:28-39) validates 0..10M with a comment naming this precise failure, making the lot route a new instance of a deliberately-closed class. Caveat that tempers but does not refute: the shipped LotsManager UI (src/components/cards/LotsManager.tsx:140) sends only salePrice and the eBay sync derives fees from eBay marketplaceFee, so today the trigger is a direct authenticated POST (or any future/scripted client using the documented params), not a UI typo — but the consequence is silently wrong P/L propagating to card_sales, reports, the CPA CSV, and a balanced-but-wrong ledger entry with no error raised anywhere."
}
```

---

## 53. verify(repr):Lot sell API accepts negative  (phase: Verify, agent a7353b674d6a0ea1b, 58448 tokens, 94s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. route.ts:131-133 passes `p_fees: Number(body?.fees) || 0` — Number(-50) is -50 (truthy), so `|| 0` only stops NaN; the route's sole money check is `!(salePrice > 0)` at line 126. card_lot_sell (20260720140000_card_lots.sql:81) validates only `p_sale_price < 0` and allocates fees pro-rata unvalidated (lines 101-110); the current card_sell (20260733000000_card_sales_tenancy.sql:73,75) also checks only sale_price, then computes `v_net := sale_price - fees + ship_income - ship_cost`, so fees=-50 on a $100 sale yields net=150 and profit_loss overstated by $50, written to card_sales (no CHECK constraints on the table, cardops_init.sql:263-272). The single-card action (actions.ts:28-39) validates all four money inputs 0..10M with the exact quoted comment — the lot route bypasses it. Books: journal.ts:80 `dr(\"platform_fees\", fees)` flips negative fees to a credit via line 52, and the entry balances (dr cash 150 = cr revenue 100 + cr platform_fees 50), so nothing downstream catches it. Only nit: post-tenancy card_sell requires owns_card(), so the caller must own the lot's cards — the fat-finger-by-owner scenario, which is what the claim describes."
}
```

---

## 54. verify(corr):Cancelling a settled LOT order  (phase: Verify, agent a9f2a15dd1d32abef, 73143 tokens, 139s)

```json
{
  "isReal": true,
  "reason": "Every step traces through the real code. cancel-order (src/app/api/ebay/cancel-order/route.ts:51-62) matches lot-child refs via `order_ref.like.<orderId>:%` (children are written as `p_order_ref||':lot:'||card_id`, card_lots.sql:117) and reverses each via card_unsell, but the route never reads or writes card_lots — the lot stays status='sold'. card_lot_unsell (20260720140000_card_lots.sql:144-155) passes its 'lot is not sold' guard, then its first child card_unsell raises 'card is not sold' (20260720120000_card_unsell.sql:36 — child is now 'booked'), and the plpgsql exception rolls back the whole call, so op:'reverse' (src/app/api/cards/lots/route.ts:141) 400s forever; the later 20260733000000 migration only rewrites the gate line, not the loop body. card_lot_sell refuses ('lot is not sellable (status sold)', card_lots.sql:78-79); list-lot refuses (route.ts:34); the sync forever skips the lot (sync/route.ts:112) and matches by SKU as well as listing_id (sync/route.ts:94), so a relist-outside-app that keeps the custom label silently books nothing (counted as skipped). The lots API offers no status reset — op:'update' touches only title/description/ask_price (:82-85); op:'archive' (:118, no status guard) is the sole escape. The corollary also holds: CardStatusControl.tsx:48 lets the owner card_unsell a single sold lot child (unsell/route.ts:28 has no lot-membership check), permanently blocking op:'reverse' for that lot. Only mitigation: children's money remains recoverable per-card — which the claim itself already concedes."
}
```

---

## 55. verify(impa):Cancelling a settled LOT order  (phase: Verify, agent a62e60385fe7a9e01, 70098 tokens, 149s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. cancel-order (src/app/api/ebay/cancel-order/route.ts:51-62) reverses only card_sales children via card_unsell — the .or() filter's `order_ref.like.<orderId>:%` matches the ':lot:<uuid>' refs card_lot_sell wrote (20260720140000_card_lots.sql:117) — and the route never touches card_lots, so the lot stays status='sold' with listing_refs.ebay stuck 'sold', and the route returns a clean success (problems empty, route:78). Every claimed dead-end is real in the code: card_lot_unsell's 'lot is not sold' guard passes (migration:146) but its first child card_unsell raises 'card is not sold' (20260720120000_card_unsell.sql:36) since children are back to 'booked', aborting and rolling back the whole plpgsql call (migration:148-153; the 20260733000000 tenancy migration only string-replaced the permission gate, not the loop); card_lot_sell refuses status 'sold' (migration:78-80); list-lot refuses (src/app/api/ebay/list-lot/route.ts:34); the lots CRUD route's op:'update' whitelists only title/description/ask_price (src/app/api/cards/lots/route.ts:81-90) leaving archive-and-recreate as the only in-app escape; and the sync matches the lot by persistent eBay SKU and silently counts lot.status==='sold' as skipped (src/app/api/ebay/sync/route.ts:73,94,112), so an external relist that sells never books. Secondary claim also verified: /api/cards/unsell (route:28) lets a user unsell one lot child, after which card_lot_unsell permanently aborts for that lot. Impact is real, not theoretical: deterministic on every cancel of a settled lot order, masked by a clean success, with a silent revenue-never-books follow-on; children's money is reversed correctly, so medium (bricked container + silent booking loss, not direct fund loss) is the right severity."
}
```

---

## 56. verify(repr):Cancelling a settled LOT order  (phase: Verify, agent a4af5f4336fd04328, 69370 tokens, 142s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the full path. cancel-order (src/app/api/ebay/cancel-order/route.ts:51-62) matches lot-child sales via `order_ref.like.${orderId}:%` (children are written as `orderRef:lot:<uuid>` by card_lot_sell, 20260720140000_card_lots.sql:116-117) and reverses each via card_unsell, but the route contains no reference to card_lots — the lot stays status='sold' with listing_refs.ebay stuck 'sold' (set by sync/route.ts:125-130). Recovery then fails on every path: card_lot_unsell's 'lot is not sold' guard passes but its child loop (card_lots.sql:148-153) hits card_unsell's `if v_card.status <> 'sold' then raise exception 'card is not sold'` (20260720120000_card_unsell.sql:36) on the now-'booked' children, rolling back the whole call; card_lot_sell raises 'lot is not sellable (status sold)' (card_lots.sql:78-79); list-lot refuses at src/app/api/ebay/list-lot/route.ts:34; op:'update' patches only title/description/ask_price (cards/lots/route.ts:81-90), leaving op:'archive' (lines 118-122, works on sold lots) as the sole escape — exactly the archive-and-recreate the claim concedes. The silent-revenue tail traces too: the lot's listing_refs still carries the eBay listing_id, so a resale of the relisted listing under a NEW orderId matches lotByListingId but hits `if (lot.status === \"sold\") { skipped++; continue; }` (sync/route.ts:112) — the ebay_cancelled_orders guard (line 85) only covers the old orderId, so the new sale never books and is silently counted skipped. Secondary claim also holds: /api/cards/unsell (route.ts:28) unsells any single sold card with no lot-membership check, putting card_lot_unsell into the same all-or-nothing abort (rolling back the still-sold siblings' reversals). The later tenancy migration (20260733000000:133-158) only textually replaces card_lot_unsell's access gate, leaving the guard and child loop intact. Two minor caveats, neither refuting: 'permanently blocks' is slightly strong (an expert could re-card_sell the child then reverse, or archive-and-recreate), and the trigger requires eBay to be connected, which on CardOps is deliberately deferred to cutover."
}
```

---

## 57. verify(corr):CPA CSV pages card_sales on no  (phase: Verify, agent a702cd568ed261f05, 50980 tokens, 84s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code: reports/route.ts:37 orders the per-page card_sales reads by sold_at alone with .range() and no tiebreaker, and pushes rows raw into the CSV with no dedup. Ties are structurally guaranteed — card_sales.sold_at defaults now() (20260713150000_cardops_init.sql:270), every card_sell variant inserts without sold_at, and card_lot_sell (20260720140000_card_lots.sql:43, \"Atomic (one transaction)\") settles all children in one transaction, so now() = transaction_timestamp gives an N-card lot N identical sold_at values. With >1000 sales in a year and a tie group straddling a 1000-row page boundary, intra-tie order is unspecified between the two separate PostgREST statements, so the CPA CSV can duplicate some sales and drop others, producing wrong money totals. The codebase's own rule (src/lib/supabase/page.ts:14-15) requires a unique tiebreaker for paging, and the adjacent export route (src/app/api/cards/export/route.ts:46) orders by id — this route hand-rolls paging and violates that contract."
}
```

---

## 58. verify(impa):CPA CSV pages card_sales on no  (phase: Verify, agent abad2c54875df76bd, 53614 tokens, 89s)

```json
{
  "isReal": true,
  "reason": "Confirmed at every link. src/app/api/cards/reports/route.ts:31-42 pages card_sales in 1000-row .range() requests ordered only by .order(\"sold_at\") — no unique tiebreaker — and the loop only spans multiple pages when the year has >1000 sales, the exact case the route's comment (lines 26-27) says it must handle for the CPA document. Ties are guaranteed, not hypothetical: card_sales.sold_at is timestamptz default now() (20260713150000_cardops_init.sql:270), card_sell inserts without explicit sold_at (20260733000000_card_sales_tenancy.sql:93-95), and card_lot_sell settles every child via card_sell inside one transaction (20260720140000_card_lots.sql:98-119) where now() = transaction_timestamp(), so an N-card lot yields N rows with identical sold_at. Postgres order among equal keys is unspecified and the per-page queries share no snapshot, so a tie group straddling a page boundary can repeat one row and drop another — the codebase's own helper documents this exact failure (\"rows can repeat/vanish between pages... Always apply .order() on something unique\", src/lib/supabase/page.ts:14-15) after real prior incidents, and the adjacent export route complies by ordering on unique id (src/app/api/cards/export/route.ts:46). Consequence is owner-facing wrong money: the year-end tax CSV silently duplicates/omits sales and disagrees with the reports screen. New instance of the audit's documented pagination-tiebreaker defect class."
}
```

---

## 59. verify(repr):CPA CSV pages card_sales on no  (phase: Verify, agent ae545897819d66403, 53027 tokens, 109s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing source. src/app/api/cards/reports/route.ts:31-42 pages card_sales 1000 rows at a time with only .order(\"sold_at\", { ascending: true }).range(from, from+999) — no unique tiebreaker — and concatenates pages via rows.push. Ties are guaranteed: card_sales.sold_at is `timestamptz not null default now()` (20260713150000_cardops_init.sql:270), card_sell inserts without sold_at (20260713170000_card_sell_rpc.sql:62-67) so the default (transaction-start now(), constant per transaction) applies, and card_lot_sell (20260720140000_card_lots.sql) settles every child via card_sell inside one transaction — an N-card lot yields N rows with identical sold_at. No index exists on sold_at (only card_sales_user_idx on user_id), so each page is an independent ORDER BY sold_at LIMIT/OFFSET sort with a different top-N bound; order within a tie group is unspecified and can differ between the per-page queries, so a tie group straddling the 1000-row boundary can duplicate some sales and drop others in the CPA CSV, silently. The neighboring export route (src/app/api/cards/export/route.ts:46) orders by id, confirming the violated house pattern. Minor correction to the claim: the reports screen (src/app/cards/reports/page.tsx:78-80) pages card_sales the same tiebreaker-less way, so it is a second instance of the defect rather than a correct baseline — but that does not affect the core finding."
}
```

---

## 60. verify(corr):Reports page pages all card_sa  (phase: Verify, agent a21d7708189a03241, 60847 tokens, 70s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/cards/reports/page.tsx:78-80: pageAll pages card_sales with .order(\"sold_at\", { ascending: false }).range(from, to) and no unique tiebreaker, while the sibling open-cards read at line 83 orders by id. The tie-group premise is real: card_sales.sold_at defaults to now() (20260713150000_cardops_init.sql:270), all card_sell variants insert without sold_at, and card_lot_sell (20260720140000_card_lots.sql:98-119, documented \"Atomic (one transaction)\" at line 43) settles every lot child via card_sell in one transaction — Postgres now() is transaction-start time, so all N rows get byte-identical sold_at. With >1000 total sales, offset pagination over the non-unique key can duplicate/drop rows in a tie group straddling a page boundary, corrupting every realized sum on the page (yearly cards lines 143-172, monthly/category GroupTable lines 178-220, velocity lines 224-232). Violates the codebase's own rule in src/lib/supabase/page.ts:14-15, and the page's local pageAll additionally swallows errors (lines 33-41), silently truncating on a failed page."
}
```

---

## 61. verify(impa):Reports page pages all card_sa  (phase: Verify, agent a65ac97f2a3da15a5, 63991 tokens, 117s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/app/cards/reports/page.tsx:78-80 pages card_sales via a local pageAll (lines 33-41, 1000-row ranges across separate requests) with .order(\"sold_at\", { ascending: false }) and no unique tiebreaker, while the sibling cards read on line 83 correctly orders by id. The tie premise traces: card_sales.sold_at is timestamptz default now() (migrations/20260713150000_cardops_init.sql:270), and card_lot_sell (migrations/20260720140000_card_lots.sql:45-123) is one atomic plpgsql transaction calling card_sell per child (line 116), so every child row of a lot settlement gets an identical sold_at (now() = transaction-start time). A tie group straddling the 1000-row boundary can be re-ordered between the two separate query executions, duplicating or dropping rows; independently, any sale settled between page requests prepends under desc order and duplicates the boundary row. >1000 sales is designed-for scale — the CSV route's own comment (src/app/api/cards/reports/route.ts:26-27) says it pages \"so a big year is never truncated\", and that route shares the same missing tiebreaker (sold_at asc, lines 37-38), so page and CSV can disagree as claimed. The affected rows feed every realized sum on the owner money view: yearly sale_price/fees/net_proceeds/basis_drawn/profit_loss (lines 149-155), monthly and category P&L (lines 178-220), and velocity (line 224) — wrong dollars, varying run to run. This is a missed instance of the audited pagination-tiebreaker class, not on the do-not-report list."
}
```

---

## 62. verify(repr):Reports page pages all card_sa  (phase: Verify, agent a9919b3662521dc05, 62224 tokens, 96s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/cards/reports/page.tsx:78-80: pageAll pages card_sales with .order(\"sold_at\", { ascending: false }).range(from, to) and no unique tiebreaker, while the sibling cards read (lines 81-83) orders by id. pageAll (lines 33-41) is pure offset pagination in 1000-row pages. Ties are guaranteed: card_lot_sell (supabase/migrations/20260720140000_card_lots.sql:98-119) settles every child via card_sell in one transaction, and card_sell (20260733000000_card_sales_tenancy.sql:93-95) inserts into card_sales without sold_at, so the column default now() — the transaction-start timestamp — stamps identical sold_at on every child of a lot (card_sales.sold_at is \"timestamptz not null default now()\", init migration line 270; an unused uuid id PK exists at line 264). Once total sales exceed 1000, a tie group straddling a page boundary can be duplicated or dropped between the two separate SQL statements (Postgres guarantees no stable intra-tie order across statements), and the resulting sales array feeds every realized money figure: yearly Sales/Fees/Net/Basis/P&L sums (page.tsx:143-155), platform breakdowns (158-167), Monthly/ByCategory sums (178-219), and Velocity (224-232). This violates the repo's own rule that pagination needs a deterministic order with a unique tiebreaker; the CSV route cross-reference also checks out (src/app/api/cards/reports/route.ts:37-38, sold_at ascending, no tiebreaker)."
}
```

---

## 63. verify(corr):eBay sync's cancelled-order id  (phase: Verify, agent acdfe205c75221113, 54781 tokens, 87s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. sync/route.ts:50 reads ebay_cancelled_orders with no .range()/.order()/readAll, so PostgREST silently caps it at 1000 rows (truncation returns no error, so the line-51 abort never fires); the table is append-only (only writer is cancel-order/route.ts:45-46 upsert, no deletes anywhere). Critically, no redundant guard survives a cancellation: card_unsell (20260720120000_card_unsell.sql:62-73) deletes the card_sales row — removing the unique (platform, order_ref) protection — and resets the card to status='booked', which card_sell accepts (its only guard is `if v_card.status = 'sold' then raise exception 'card already sold'`, 20260733000000_card_sales_tenancy.sql:72). During eBay's eventual-consistency window the feed still reports the order PAID with cancelState NONE_REQUESTED (route lines 81-84 pass; the migration's own comment at lines 86-90 documents this window), and the card still matches since cancel-order never clears listing_refs. So the Set built from the truncated read (line 52, checked at line 85) is the sole barrier; once lifetime cancellations exceed 1000, a recently-cancelled ref can be absent (unordered reads skew toward oldest rows) and the sync re-runs card_sell: second pool draw + phantom revenue on a refunded order, silently reported as settled. New instance of the audit's readAll-for-idempotency-guard class; medium is the right severity given the distant >1000-cancellation precondition."
}
```

---

## 64. verify(impa):eBay sync's cancelled-order id  (phase: Verify, agent a52f985f0cdfe39aa, 54831 tokens, 95s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. sync/route.ts:50 reads ebay_cancelled_orders with a bare .select(\"order_ref\") — no .range(), no .order() — into the Set checked at line 85, while the cards read immediately above (lines 35-46) is properly paged, and page.ts:10-11 mandates readAll for exactly this \"membership Set / idempotency guard\" class. After a cancel, this Set is the ONLY defense: card_unsell.sql:66 deletes the card_sales row (killing the unique (platform,order_ref) block) and :72 resets the card to 'booked' (killing card_sell's already-sold refusal), and cancel-order/route.ts never clears listing_refs, so the card remains matchable. During eBay's consistency window the feed still shows PAID/NONE_REQUESTED (lines 81/84 pass). Grep confirms the table is append-only with no pruning (only 3 refs repo-wide). Past 1000 lifetime cancellations, PostgREST truncates the guard — and with no ORDER BY, heap order tends to keep the oldest rows, dropping precisely the recent cancellations the guard exists for — so the next sync (owner POST button or cron) re-runs card_sell: net double pool draw, a phantom card_sales revenue row for a refunded order, and the card silently flipped back to 'sold', all reported as a successful settle. Line 51 aborts on a read ERROR but truncation is not an error. The >1000 precondition is distant for one seller (claim discloses this), but it is a cleanly cited new instance of the audit's unpaged-idempotency-guard class with silent money corruption as the consequence."
}
```

---

## 65. verify(repr):eBay sync's cancelled-order id  (phase: Verify, agent a1b7fc51f8a5ee7d8, 61100 tokens, 107s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the full chain. route.ts:50 reads ebay_cancelled_orders with no .range(), no .order(), no readAll — PostgREST caps it at 1000 arbitrary rows — while the same file pages its cards read at lines 35-46. The table is append-only: its only writes are the upsert in cancel-order/route.ts:45-46; no prune/delete exists anywhere. Both downstream guards the route's comment relies on are neutralized precisely in the cancelled-order case: card_unsell (20260720120000_card_unsell.sql:66) deletes the card_sales row (clearing the unique order_ref index) and line 72 resets status to 'booked' (clearing card_sell's 'already sold' check at 20260733000000 line 72); card_sell never consults ebay_cancelled_orders and listing_refs stay intact so the card still matches. During eBay's documented consistency lag (route.ts:82-84, migration lines 86-90: feed 'keeps reporting the order PAID / not-cancelled for a while'), a ref missing from the truncated Set flows straight to card_sell → second pool draw + new card_sales row on a refunded order, reported as a clean settle. Line 51 even aborts when this read errors, but truncation is silent. Precondition (>1000 lifetime cancellations with the ref inside the 90-day feed window) is distant, matching [medium]."
}
```

---

## 66. verify(corr):eBay hub settled-state and 30-  (phase: Verify, agent a4a6b56eb489a913e, 50601 tokens, 91s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/hub/route.ts:74-78: the card_sales read is `.select(\"order_ref, sale_price, profit_loss, sold_at\").eq(\"platform\", \"ebay\").limit(1000)` with no .order() and no date bound, and that single all-time read feeds both the settledOrders membership Set (lines 81-83, used at 106/120 for the settled flags and unsettled count) and the 30-day money tiles (lines 85, 116-118, filtered client-side after the cap). Past 1000 lifetime eBay sales the returned rows are an arbitrary subset — Postgres heap order typically drops the newest rows, exactly the 30-day window and recent order refs — so sold30Total/profit30 show wrong dollars and settled orders reappear as unsettled. The claim's mitigations hold: migration 20260733000000_card_sales_tenancy.sql has `if v_card.status = 'sold' then raise exception 'card already sold'` (line 72) and unique index card_sales_user_platform_order_uq(user_id, platform, order_ref) (lines 35-37), so no money is double-booked — display-only harm, consistent with [low]. Not covered by the audit (no mention of the hub route in reference/audit-2026-07-24.md, not on the deliberate-leftovers list), and the sibling reports route (src/app/api/cards/reports/route.ts:29-37) pages card_sales with .order(), showing this read is the outlier violating the readAll house rule for sums/counts/membership sets."
}
```

---

## 67. verify(impa):eBay hub settled-state and 30-  (phase: Verify, agent a773ead3687c7d0f3, 51002 tokens, 81s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/hub/route.ts:74-78: the card_sales read is `.eq(\"platform\",\"ebay\").limit(1000)` with no .order() and no date filter, pulling lifetime eBay sales. It feeds both the settledOrders membership Set (lines 81-83 → recentOrders[].settled line 106, stats.unsettled line 120) and the 30-day money sums (line 85 → sold30Count/sold30Total/profit30 lines 116-118), which EbayHub.tsx renders as a dollar tile (line 245) and a to-do badge (line 236). Past 1000 lifetime eBay sales, PostgREST returns an arbitrary (heap-order, effectively oldest-first) 1000 rows, so recent sales are the ones dropped: 30d revenue/profit understate real dollars and settled orders show as unsettled. The reviewer's damage cap is accurate — card_sell raises 'card already sold' (20260713170000_card_sell_rpc.sql:32) and the unique (user_id, platform, order_ref) index (20260733000000:35-37) blocks re-settling, so books are safe — but wrong displayed money and a false to-do count remain, a new instance of the audit's documented readAll class not covered by any DO NOT REPORT item. Severity [low] is right."
}
```

---

## 68. verify(repr):eBay hub settled-state and 30-  (phase: Verify, agent af08f9eee81d4b589, 44664 tokens, 43s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/hub/route.ts:74-78 — `.from(\"card_sales\").select(\"order_ref, sale_price, profit_loss, sold_at\").eq(\"platform\", \"ebay\").limit(1000)` with no .order() and no date filter fetches lifetime eBay sales as an unordered capped read. That single result feeds (a) the settledOrders membership Set (lines 81-83) used for per-order `settled` flags (line 106) and the `unsettled` count (line 120), and (b) the 30-day window filtered in JS at line 85 that produces sold30Count/sold30Total/profit30 (lines 116-118). Past 1000 lifetime eBay sales the returned rows are an arbitrary subset, so recent sales can be omitted: 30-day revenue/profit tiles under-report and already-settled orders show as unsettled. Books-side harm is indeed blocked (settle goes through sellCard's already-sold guard plus the unique order_ref index), so the impact is wrong displayed numbers and a false to-do count — matching the claimed [low] severity. This is a new instance of the audit's documented unordered-limit(1000)-feeding-sum/membership-set defect class and is not on the deliberate-leftovers list."
}
```

---

## 69. verify(corr):Cancelled-order idempotency gu  (phase: Verify, agent ae8b56bea06588e60, 53988 tokens, 71s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. sync/route.ts:50 reads the guard with a bare `db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` — no readAll/.order()/.range() — while the same function pages its cards read (lines 35-46) because of the 1000-row PostgREST cap that src/lib/supabase/page.ts documents as mandatory-readAll territory for idempotency guards. A capped response is a success, so the line-51 error abort never fires. Every alternate defense fails as claimed: card_unsell (20260720120000_card_unsell.sql:63-73) DELETES the card_sales row (so the unique (platform, order_ref) index has nothing to conflict with) and resets the card to status 'booked' (so the sold-skip at sync:135 and card_sell's already-sold refusal don't trigger); the cancelState skip at sync:84 is defeated during eBay's documented eventual-consistency window (migration lines 85-90 — the stated reason the guard table exists); cancel-order/route.ts never clears listing_refs so the card still matches byListingId/bySku. The table is append-only (only writer is the upsert at cancel-order/route.ts:45-46; no prune anywhere) with no user scoping, so >1000 rows is reachable, and with no ORDER BY nothing guarantees the just-cancelled order — the only one inside the misreporting window — is in the arbitrary 1000 returned. Once missed, card_sell re-books the refunded sale: duplicate card_sales row, second pool draw, card re-marked sold. Concrete, traceable, and a new instance of the audit's readAll-for-guards class."
}
```

---

## 70. verify(impa):Cancelled-order idempotency gu  (phase: Verify, agent a319e775507bd37fe, 56452 tokens, 106s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/sync/route.ts:50 — the guard is built from a bare `db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` with no readAll/.range()/.order(), so PostgREST silently returns at most 1000 rows (per the project's own src/lib/supabase/page.ts:3-11, which mandates readAll for idempotency guards); a capped read is HTTP 200, so the line-51 abort-on-error never fires. The Set (lines 52, 85) is provably the only barrier to re-settling a seller-cancelled order during eBay's stale-PAID window: card_unsell (supabase/migrations/20260720120000_card_unsell.sql:66,72) deletes the card_sales row (defeating the unique (user_id,platform,order_ref) index at 20260733000000_card_sales_tenancy.sql:36-37) and resets status to 'booked' (defeating both sync:135 and card_sell's only guard at 20260733000000:72), while cancel-order/route.ts never clears listing_refs so the card still matches at sync:90-92. The table is append-only with no pruning (only writers: create + upsert at cancel-order/route.ts:45-46), so >1000 lifetime cancellations is a reachable permanent state; the unordered read tends to drop the newest rows — exactly the cancellations still inside the 90-day order window where eBay reports PAID/NONE_REQUESTED. Result when triggered: card_sell re-books the refunded sale — phantom revenue, a second pool draw, card marked sold — logged as a clean \"ebay_settled\" success by the unattended daily cron. New instance of the audit's readAll-for-idempotency-guards class."
}
```

---

## 71. verify(repr):Cancelled-order idempotency gu  (phase: Verify, agent a9de076311b99b289, 58497 tokens, 103s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by full source trace. sync/route.ts:50 reads the cancelled-order guard with a bare `db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` — no readAll/.order()/.range() — while the same function pages its cards read (lines 35-46) because of the 1000-row PostgREST cap that src/lib/supabase/page.ts:10-11 documents as mandatory-readAll territory for \"a membership Set, an idempotency guard\". The error-abort at line 51 cannot catch silent truncation. The table is append-only and never pruned (sole writer: cancel-order/route.ts:45-46 upsert; no delete anywhere), and after card_unsell (migration 20260720120000 line 66 deletes the card_sales row; lines 70-73 reset status to 'booked') neither the unique (user_id, platform, order_ref) index nor the status===\"sold\" skip at sync line 135 can block a re-settle; card_sell (20260733000000 rewrite) has no cancelled-order check and re-draws pool basis. The card still re-matches because listing_refs.ebay.listing_id survives settle (line 159 spread) and unsell never touches listing_refs. During eBay's documented eventual-consistency window (migration lines 86-90: feed keeps reporting PAID/not-cancelled), the Set membership at line 85 is the only guard — so once the table exceeds 1000 rows and the just-cancelled order_ref falls outside the arbitrary first 1000, the next cron GET or owner POST re-books the refunded sale: phantom revenue, double pool draw, card re-marked sold. Only caveat: reaching >1000 seller-cancellations is a volume precondition, but the state is monotonic and the failure deterministic once reached — exactly the audit's readAll-for-idempotency-guard class, new instance."
}
```

---

## 72. verify(corr):Alert notified_at is stamped e  (phase: Verify, agent a27aa80dd039dd8f6, 51045 tokens, 53s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. push.ts:48-51 catches every per-subscription error inside the map callback (only 404/410 collected as stale; \"other failures: drop silently\"), so sendToAll resolves normally with sent:0 during a push-service outage — it cannot reject. route.ts:129 and :181 then stamp card_alerts.notified_at unconditionally (the result r is used only for r.stale at :128/:180; r.sent is never checked), and the only reset path is the re-arm branch at :131-133/:183-185 which requires the price to un-cross — so while it stays crossed, every future run sees crossed && notified_at and skips: the notification is permanently lost, contradicting push.ts's \"next run retries\" comment. moversDigest is the same shape: digest.ts:70 returns seenNext = all current mover ids, and route.ts:253-254 writes that into prefs.cardops.movers_seen regardless of push outcome, so digest.ts:61's fresh-filter suppresses those movers on all later runs while they remain in the window. Not in the DO-NOT-REPORT list; push_subscriptions is a shared-DB table this cron actively reads (route.ts:81-82), and CRON_SECRET is only a cutover interlock."
}
```

---

## 73. verify(impa):Alert notified_at is stamped e  (phase: Verify, agent ad3aab40b40988e6d, 53760 tokens, 81s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all cited code. push.ts:48-52 catches every send failure, collects only 404/410 endpoints, and resolves { sent: 0, stale: [] } without throwing — its own comment says \"other failures: drop silently — next run retries\". But route.ts:129 (targetAlerts) and :181 (pctAlerts) stamp card_alerts.notified_at unconditionally after sendToAll, and the guard at :122/:174 (`crossed && !a.notified_at`) means the next run does NOT retry; the only reset is the un-cross branch (:131-133, :183-184) and a repo-wide grep shows nothing else clears notified_at. Line 130 even increments hits, so audit_log records the failed delivery as a successful priceHit. moversDigest matches: route.ts:253-254 writes movers_seen = digest.seenNext regardless of delivery, and digest.ts:61/70 dedups against it, so those movers are never re-announced while in the window. r.sent is ignored by all three callers. Failure scenario traces exactly: transient FCM/APNs 429/5xx or network failure during the run → 0 pushes delivered → every crossing that fired is permanently marked notified (until price un-crosses and re-crosses) → user silently misses buy/sell-decision alerts while the audit log reports success."
}
```

---

## 74. verify(repr):Alert notified_at is stamped e  (phase: Verify, agent ac4b3836b4e6fd449, 52871 tokens, 72s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the code. push.ts:41-53 wraps each webpush.sendNotification in a per-subscription try/catch that only records 404/410 into `stale`; 429/5xx/network errors are swallowed, Promise.all never rejects, and sendToAll resolves { sent: 0, stale: [] }. All three cron callers discard `sent`: targetAlerts stamps `notified_at` unconditionally at route.ts:129 (and counts hits++, so the audit log reports the crossing as delivered), pctAlerts identically at :181, and moversDigest writes `movers_seen: digest.seenNext` at :253-254 where seenNext = moves.map(m=>m.id) (digest.ts:70) includes the never-delivered fresh movers, making fresh empty and push null on subsequent runs (digest.ts:61-62). Grep over src confirms the only notified_at re-arm is the un-cross branches (route.ts:131-133, 183-185) and no other code writes movers_seen — so during a transient push-service outage every crossing that fired is permanently marked notified with zero notifications delivered, exactly as claimed. Not covered by the deliberate-exclusion list (which covers the client subscribe stack, not server-side stamp-after-send ordering)."
}
```

---

## 75. verify(corr):Match-set reads discard errors  (phase: Verify, agent a9b06a9f50f5b69db, 51440 tokens, 88s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/ebay/sync/route.ts and src/lib/supabase/page.ts. Line 41 destructures only { data } (error discarded); line 45 `if (!data || data.length < 1000) break` treats a failed page as the final page, so a page-1 error yields an empty match set; every PAID card line then falls through `if (!card && !lot) continue` (line 96) with no counter incremented; runSync returns { settled: [], skipped: 0, failures: [] } and POST returns ok:true (line 185); the GET/cron audit write is gated on `out.settled.length || out.failures.length` (line 208), so nothing is logged — the failed run is indistinguishable from a clean no-op. The only refutation candidate — the ebay_cancelled_orders guard (lines 50-51) does check its error and abort — only rescues a total DB outage, not a transient per-request error or a timeout on the large cards scan while the small guard read succeeds, which is the claimed scenario. Adjacent instances also verified: line 42 pages on created_at desc with no unique tiebreaker while bulk CSV import (src/app/cards/actions.ts:215) inserts all rows in one statement giving identical created_at, so page-boundary ties can drop a listed card once inventory exceeds 1000; and the card_lots read (lines 64-66) is unpaged (1000-row PostgREST cap), unordered, with its error also discarded. This is a new instance of the audited readAll class in a service-role cron path (lines 199-200) — readAll in src/lib/supabase/page.ts exists precisely to throw on page errors so a partial result is never mistaken for a complete one."
}
```

---

## 76. verify(impa):Match-set reads discard errors  (phase: Verify, agent a881e90578f0cb347, 56227 tokens, 90s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/ebay/sync/route.ts. Line 41 destructures only { data } (supabase-js returns {data:null,error} rather than throwing), and line 45 `if (!data || data.length < 1000) break` treats a failed page as the final page — a page-1 error yields an empty match set. Every PAID line then hits `if (!card && !lot) continue` (line 96) without incrementing skipped or failures, so runSync returns {settled:[],skipped:0,failures:[]}; GET returns 200 and skips the audit insert because line 208 gates it on `out.settled.length || out.failures.length` — a read failure is indistinguishable from \"no sales\" and leaves no record. The self-heal argument fails for persistent errors: getOrders covers 90 days, but a persistent failure books nothing forever while sold cards stay status \"listed\" in inventory — wrong money plus silent loss. The contrast is damning: the cancelled-order guard at lines 50-51 checks its error and aborts, and readAll (src/lib/supabase/page.ts:38) throws on page errors — this hand-rolled pager is a new instance of the audited class. Both adjacent instances also verified: order(\"created_at\" desc) at line 42 has no unique tiebreaker while bulk import (src/app/cards/actions.ts:215) inserts batches in one statement giving identical created_at (Postgres now() is transaction-scoped), and the card_lots read (lines 64-66) is unpaged against the 1000-row cap with its error also discarded."
}
```

---

## 77. verify(repr):Match-set reads discard errors  (phase: Verify, agent a86c04810c8609805, 52443 tokens, 96s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing src/app/api/ebay/sync/route.ts. Line 41 destructures only { data } from the cards page read (supabase-js returns {data:null,error} without throwing); line 45 `if (!data || data.length < 1000) break` treats a failed page as the final page, yielding an empty match set with no error surfaced. Empty byListingId/bySku maps (lines 54-61) make every PAID card line hit `if (!card && !lot) continue` at line 96 with no counter or failure entry; runSync returns {settled:[],skipped:0,failures:[],checked:N} (line 169), indistinguishable from a legitimate no-sales run. GET path line 208 gates the audit insert on `out.settled.length || out.failures.length` — both zero — so no audit row is written and line 215 returns {ok:true} / HTTP 200 to the cron. The author's own standard is applied three lines away: the ebay_cancelled_orders guard read (lines 50-51) checks its error and aborts the run. Adjacent instances also verified: line 42 orders by created_at desc with no unique tiebreaker while src/app/cards/actions.ts:215 bulk-inserts CSV rows in one statement (identical created_at), so page-boundary ties can drop a listed card once >1000 cards are listed; and the card_lots read (lines 64-66) has no .range/.order (PostgREST 1000-row cap) and also discards its error. This is a membership set feeding money settlement hand-rolled instead of using readAll/readAllSafe (src/lib/supabase/page.ts:38 throws on page error for exactly this reason) — a new instance of the audited class. Minor overstatement only: lot-matched lines would still settle when just the cards read fails, but ordinary card lines — the common case — are all silently skipped."
}
```

---

## 78. verify(corr):Overlapping card-estimates run  (phase: Verify, agent aa8395d14a7950ceb, 53515 tokens, 87s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/api/cron/card-estimates/route.ts:79-91 snapshots card_estimates once per user, sorts candidates deterministically (95-103), then over minutes of sequential AI calls inserts an estimate row (123-127) and a credit_ledger debit (128-129) with no re-check, lock, or claim; grep finds no advisory-lock/run-lock mechanism anywhere in src. supabase/migrations/20260722000000_estimates_credits.sql:6-21 shows card_estimates has only a non-unique index (card_id, mode, created_at desc) — append-only, nothing rejects a duplicate — and credit_ledger (lines 33-41) has no uniqueness on (user_id, reason, ref) with balance computed as sum(delta) (credit_balance(), line 52-55), so a second -credits row is a real wrong balance. estimate-run.ts:4-5 explicitly does not persist or meter. Overlap is reachable: vercel.json schedules the route daily, maxDuration=300 with up to GLOBAL=80 sequential Anthropic calls means a run occupies minutes, and a manual Vercel Run-button trigger (or second curl with CRON_SECRET) during that window reads the pre-insert snapshot, computes the same sorted pick, and double-estimates + double-debits every card A has not yet committed. The CRON_SECRET-unset interlock is documented as temporary cutover state and does not neutralize the defect once crons go live."
}
```

---

## 79. verify(impa):Overlapping card-estimates run  (phase: Verify, agent ac20a5c23af3858c4, 62588 tokens, 136s)

```json
{
  "isReal": false,
  "reason": "Race mechanics are real (no lock, no unique key on card_estimates, read-then-act at src/app/api/cron/card-estimates/route.ts:79-130), but the impact does not survive: (1) the route 401s for all callers today (lines 32-34, CRON_SECRET unset by documented cutover design); (2) post-cutover, the daily schedule (vercel.json \"30 8 * * *\") with maxDuration=300 means scheduled runs can never self-overlap — the only collision path is the owner manually pressing Run inside a ≤5-minute window; (3) the claimed \"double-debit\" harms nothing: src/app/api/cards/estimate/route.ts:79-80 documents the ledger as \"soft for now — records spend; hard-enforcement flips on with billing\", no balance check gates any estimate, no grant/purchase path exists anywhere (only two negative-delta writes in the codebase), and two debits would accurately meter two runs that genuinely executed; (4) no user-visible number changes — readers take the latest estimate per (card, mode), so a duplicate row is invisible. Residual harm is a one-off doubling of up to 80 Haiku calls' API spend in a self-inflicted collision on a currently-disabled job — theoretical-only impact."
}
```

---

## 80. verify(repr):Overlapping card-estimates run  (phase: Verify, agent a6ee4d355981d17bc, 60031 tokens, 149s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the source. route.ts is read-then-act with zero concurrency protection: card_estimates freshness state is read at lines 79-91, candidates computed at 95-107, then over minutes of sequential AI calls (maxDuration=300, line 18) each card gets an estimate insert (123-127) and an unconditional ledger debit (128-129; cron configs always cost >=4 credits per estimateCost in src/lib/cards/credits.ts:44-54, so the credits>0 guard never skips). Migration 20260722000000_estimates_credits.sql defines card_estimates with only a non-unique index (line 21) and credit_ledger as an append-only identity-PK table whose balance is sum(delta) (lines 33-55); no unique constraint, trigger, or lock anywhere rejects duplicates (grep of src/ and migrations found no advisory-lock/run-lock/claim mechanism). Candidate selection is deterministic across runs — allCards ordered by id (line 71) plus a stable sort on age (line 103) — so an overlapping run B that snapshots card_estimates before run A's inserts picks the same first-20 slice minus only cards A already finished, and B never re-checks freshness mid-loop: every card A completes after B's snapshot is estimated twice, AI-billed twice, and debited twice in credit_ledger. Overlap is realistic post-cutover: Vercel does not serialize cron invocations, the dashboard manual Run sends the CRON_SECRET header, and the run window is up to 5 minutes; the CRON_SECRET interlock in reference/next-steps.md only mitigates the dual-deployment overlap, not manual-vs-scheduled on the same deployment. Only nuance: the double-charged set is the intersection (cards not yet completed at B's snapshot), not always all 80 — which matches the claim's own 'every card in the overlap' wording."
}
```

---

## 81. verify(corr):Credits are debited even when  (phase: Verify, agent a6daf2d64b201aef7, 49088 tokens, 47s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/cron/card-estimates/route.ts:123-131: `await svc.from(\"card_estimates\").insert({...})` discards the result (no error check), then the credit_ledger debit and made++ run unconditionally. The service client (src/lib/supabase/service.ts) is stock supabase-js with no throwOnError anywhere in src/, so a failed insert returns { error } without throwing — the catch at line 132 never fires, the user is debited, and the run reports the card in `made`. Next run's freshness map (lines 79-100) finds no card_estimates row, assigns age -Infinity, sorts the card first, and re-estimates/re-debits it — a repeatable charge with no stored estimate. The manual-route contrast (src/app/api/cards/estimate/route.ts:81-99 returns the value in the response despite the same unchecked insert) is also accurate."
}
```

---

## 82. verify(impa):Credits are debited even when  (phase: Verify, agent a636cef77a49df38e, 51679 tokens, 79s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/cron/card-estimates/route.ts:123-131 — the card_estimates insert result is never destructured or error-checked, and supabase-js returns failures as { error } values (no throwOnError used), so the try/catch at 120 cannot catch it; the credit_ledger debit (129) and made++ (131) then run unconditionally. Concrete trigger: card_estimates.card_id is a NOT NULL FK to cards (migrations/20260722000000_estimates_credits.sql:8) and the run takes minutes (maxDuration 300), so a card deleted mid-run — or any transient DB error — fails the insert silently while the debit posts (credit_ledger.ref has no FK) and the run reports it as made. On a transient failure the card keeps no estimate row, so lines 86-103 next night give it age -Infinity, sort it first, and re-estimate + re-debit — repeatable charge for zero stored work. Impact is user-visible money: credit_balance() = sum(delta) (migration :52-55) is returned to the UI by src/app/api/cards/estimate/route.ts:51,99, and the ledger is the record billing enforcement will use. Unlike the manual route, which at least returns the estimate value in the response despite its own unchecked insert (estimate/route.ts:81-100), the cron loses the work entirely while charging for it."
}
```

---

## 83. verify(repr):Credits are debited even when  (phase: Verify, agent a662ca20e661a8c91, 58670 tokens, 95s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing src/app/api/cron/card-estimates/route.ts:120-135 against the installed client. The insert at lines 123-127 discards its result; postgrest-js 2.110.8 defaults shouldThrowOnError=false (PostgrestBuilder constructor, dist/index.mjs:145) and even converts fetch rejections to a resolved { error } (index.mjs:326), and createServiceClient (src/lib/supabase/service.ts:11-13) sets no throw option — so a failed insert resolves silently and the catch at line 132 never fires. Lines 128-131 then debit credit_ledger (credits always ≥ 4: estimateCost in src/lib/cards/credits.ts:44-53, base_sales 1 + ai_light 3 minimum) and run made++ unconditionally. runEstimate persists nothing (estimate-run.ts:4-5 \"It does NOT persist or meter\"), so the estimate is lost entirely. On the next run, lastAt (lines 86-91) has no entry for that (card_id, mode), so line 100 assigns age=-Infinity and line 103 sorts it first — the same card is re-estimated and re-debited. The manual-route contrast holds too: src/app/api/cards/estimate/route.ts:81-100 also ignores the insert error but returns the value to the user in the response."
}
```

---

## 84. verify(corr):Daemon reprice rotation cursor  (phase: Verify, agent a1f3f2af4822c8bb4, 66712 tokens, 127s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the real code. daemon/route.ts:122-129 deterministically selects each user's `share` least-recently-priced cards (order last_priced_at asc nullsFirst, id asc, capped by readAll at budget), but the only last_priced_at write is at line 147 inside `if (mv != null && mv !== prev)` (143) — an unchanged card never advances, so the identical head window is re-selected every night and the line-131 note is untrue. Comp-less cards are permanent plugs: valuation.ts:64 returns null for empty comp pools and both fallback paths (valuation.ts:81 legacy, :279 pipeline) return `... ?? card.market_value ?? null`, making mv === prev (or null) forever; NULL-cursor comp-less cards sort first indefinitely via nullsFirst. Grep confirms only five last_priced_at writers: the daemon, two per-card user-initiated routes (cards/[id]/value/actions.ts:51, api/cards/price-sources/refresh/route.ts:110 — auth'd POST with cardId), and price-refresh/route.ts:166, which advances the cursor for every touched card ('even unchanged ones') but gives the owner first claim on all CAP=100 slots (lines 48-72, member query gated on `if (list.length < CAP)`) — so an owner with ≥100 live cards means nothing ever advances a member's cursors except a daemon value-change. Consequences hold: tail cards past the share are never scanned, market_value never re-derives as comps age, and value_30d/value_365d (written only by daemon:148-149 and the manual action) stay NULL, excluding those cards from the portfolio movers view (portfolio/page.tsx:28 filters .not(\"value_30d\",\"is\",null)). Only nit: a comp-less card with manual_price ≠ market_value advances once (mv falls back to manual_price) before plugging — this does not change the failure scenario."
}
```

---

## 85. verify(impa):Daemon reprice rotation cursor  (phase: Verify, agent aafe114c3722d7fad, 67318 tokens, 128s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the code. src/app/api/cards/daemon/route.ts:122-129 selects each user's `share` least-recently-priced cards (order last_priced_at ASC nullsFirst, id ASC, readAll cap=budget), but last_priced_at is written only inside `if (mv != null && mv !== prev)` (route.ts:143-151). Both valuation paths return the prior value for comp-less cards — src/lib/cards/valuation.ts:81 and :279 both end `?? card.manual_price ?? card.market_value ?? null` — so mv === prev exactly (PostgREST returns numeric as JSON number) or mv == null, and the cursor freezes; price-locked cards freeze too after their first write. Once >= share of a user's cards are permanently unchanged, the identical head window is selected every night and everything behind it (including comped cards whose values drift) is never scanned; the line-131 note 'the rest rotate in on the next run' is false. Grep shows only four last_priced_at writers: two per-card manual actions (src/app/cards/[id]/value/actions.ts:46-51, itself change-conditional; src/app/api/cards/price-sources/refresh/route.ts:110, single-card POST) and the price-refresh cron, which advances unconditionally (src/app/api/cron/price-refresh/route.ts:166 'even unchanged ones') but gives the owner first claim on all CAP=100 slots (lines 48-72) — with an owner holding >=100 live cards, list.length===CAP and the member query fetches zero rows, so no automatic process ever advances a member's cursor. The daemon is scheduled daily (vercel.json '/api/cards/daemon'). Impact is real money-number staleness: tail cards' market_value never re-derives as comps age and feeds the nightly NAV snapshot (daemon route.ts:190-201 sums stored market_value), and value_30d/value_365d stay unpopulated for both unscanned and scanned-but-stable cards. The premise (member inventory > REPRICE_BUDGET/users, i.e. >2000 cards at two users) is within the app's own design assumptions (REPRICE_BUDGET=4000 defense comment at route.ts:71-76, SNAPSHOT_MAX=50,000)."
}
```

---

## 86. verify(repr):Daemon reprice rotation cursor  (phase: Verify, agent a88f2f70a8f289469, 68567 tokens, 131s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the source. daemon/route.ts writes last_priced_at only inside `if (mv != null && mv !== prev)` (143-151); with zero comps computeMarketValue returns `v ?? card.manual_price ?? card.market_value ?? null` (valuation.ts:279 pipeline path; valuation.ts:81 legacy path via applyStrategy returning null on empty prices at :64), so comp-less and price-stable cards yield mv === prev and are never touched. The selection (122-129) orders last_priced_at ASC NULLS FIRST with id tiebreak capped at share, so stuck cards deterministically occupy the head every night; once stuck count >= share the identical window repeats and tail cards are never scanned — their market_value never re-derives and value_30d/value_365d (written only at 148-149 inside the update branch) stay null. The line-131 note is false in that state. Price-refresh proves the pattern was understood: it advances last_priced_at for every touched card 'even unchanged ones' (price-refresh/route.ts:166) — but its owner-first budget (48-72) fills all 100 slots from an owner with >=100 live cards (the member branch at :62 never executes, and owner cursors always advance so the owner rotation never exhausts), so member cursors are never advanced externally. The only other writers (cards/[id]/value/actions.ts:46-55 and api/cards/price-sources/refresh/route.ts:107-111) are per-card user-initiated and also change-gated; no DB trigger exists (last_priced_at appears in migrations only as a bare column, 20260713150000_cardops_init.sql:178). Only nuance: the stall accumulates rather than being instant — but in the claimed scenario (bulk comp-less head >= share) it is total from night one."
}
```

---

## 87. verify(corr):card-estimates: one user's rea  (phase: Verify, agent a66dab83ae7f6d81e, 57136 tokens, 110s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. (1) readAll throws on any page error (src/lib/supabase/page.ts:38) and the two per-user readAll calls in src/app/api/cron/card-estimates/route.ts:68-73 and 79-84 are outside the only try/catch (lines 120-135) with no top-level try in GET — one transient PostgREST error (the estimates read pages up to 100k rows = up to 100 requests) 500s the route and all later users in prefs get nothing; card-alerts (route.ts:107-137 per user) and the daemon (daemon/route.ts:80-84) both wrap per-user work, so this route is the odd one out. (2) GLOBAL=80 sequential estimates (each a Card API fetch + 3 DB reads + an anthropic.messages.parse call, estimate-run.ts:43-94; 'deep' users use the large MODEL) against maxDuration=300 (route.ts:18) with no deadline check — a full-backlog day (guaranteed on first deploy) cannot fit 80 multi-second AI calls in 300s, so Vercel kills mid-loop; committed per-card inserts survive, and the unordered prefs read (lines 43-44) makes iteration order stable in practice, so the same trailing users starve daily (a user with ≥280 live cards, or ≥140 on 'both', regenerates ≥20 candidates/day at STALE_DAYS=14 and permanently holds the head). The daemon's own comment at src/app/api/cards/daemon/route.ts:71 ('The budget is a per-user SHARE, not one global counter drained in table order') shows the codebase already treats this exact starvation pattern as a defect."
}
```

---

## 88. verify(impa):card-estimates: one user's rea  (phase: Verify, agent ad7b4d7ea699f23ec, 60856 tokens, 163s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. Mechanism 1 traces exactly: readAll throws on any page error (src/lib/supabase/page.ts:38 `if (error) throw new Error(error.message)`), and in src/app/api/cron/card-estimates/route.ts the per-user readAll calls (lines 68-73, 79-84) sit bare inside `for (const p of prefs)` — the only try/catch (120-135) wraps runEstimate per card, so a transient PostgREST error on user #1's read 500s the whole route and users 2..N get nothing that day. The daemon (src/app/api/cards/daemon/route.ts:80-86) and card-alerts (per-user try/catch at 107/147/198) both defend against exactly this; card-estimates is the outlier. Risk grows over time: lines 79-84 page the user's ENTIRE card_estimates history (cap 100k, inner join) and the table grows ~20 rows/user/day with no pruning. Mechanism 2 also holds: maxDuration=300 (line 18) vs up to GLOBAL=80 sequential estimates, each a Card API fetch + 3 DB reads + an Anthropic messages.parse + 2 awaited inserts (~4-10s; Opus for 'deep'), i.e. 320-800s > 300s; the prefs read (43-44) has no .order() so heap-stable iteration starves the same trailing users daily; per-card inserts (123-130) commit before the kill so the damage is pure persistent starvation plus a lost response. The claim's math is actually conservative: card_user_prefs defaults auto_estimate='both' (supabase/migrations/20260730000000_card_user_prefs.sql:7), doubling candidates per card, so >140 live cards (not >280) suffices to perpetually consume the head of the run. First post-cutover run is guaranteed full-backlog. Impact is a real crash plus silent, persistent, same-victim non-delivery of the route's stated purpose (\"a card is never sitting there blank\"); no credits are debited for estimates never made, so medium severity is right. CRON_SECRET being unset today is a documented temporary cutover interlock and does not refute defects in the cron logic itself."
}
```

---

## 89. verify(repr):card-estimates: one user's rea  (phase: Verify, agent a782bfacb21a3dc16, 67885 tokens, 136s)

```json
{
  "isReal": true,
  "reason": "Confirmed from source. (1) In src/app/api/cron/card-estimates/route.ts the per-user loop (line 52) calls readAll at lines 68-73 and 79-85 with no try/catch — the only try/catch (lines 120-135) covers runEstimate/inserts only — and readAll (src/lib/supabase/page.ts:38) throws on any page error (\"throw new Error(error.message)\"), so one transient PostgREST error on an early user 500s the whole GET and all later prefs users get zero estimates that day. The contrast holds: card-alerts wraps each per-user sub-task in try/catch (card-alerts/route.ts lines 107/135, 147/187, 198/256) and the daemon wraps repriceUser per user (daemon/route.ts lines 80-89). (2) maxDuration=300 (line 18) vs GLOBAL=80 strictly sequential estimates (await runEstimate line 121 + awaited inserts), each involving an external Card API fetch with no timeout (thecardapi.ts has no timeout/AbortSignal) plus an Anthropic call where \"deep\" = claude-opus-4-8 (src/lib/anthropic.ts:11) with SDK-default retries — 80 × ~4s+ exceeds 300s and a single deep user's 20 can approach it alone. No elapsed-time check, no per-user time share, and the prefs read (lines 43-44) has no .order(), unlike the daemon which explicitly added a per-user share to fix this exact crowding class (daemon lines 71-78). Inserts commit per-iteration so a mid-loop kill preserves the head users' work, and the 14-day staleness × PER_USER=20 math (lines 20-22) means a head user with >280 live cards perpetually regenerates ≥20 candidates and holds the head of every run — trailing users are starved daily. Both mechanisms trace; claim survives."
}
```

---

## 90. verify(corr):card-alerts pagination has no  (phase: Verify, agent a54a80833a1910a1a, 58267 tokens, 110s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/cron/card-alerts/route.ts: the targetAlerts readAll builder (lines 109-114) and pctAlerts builder (lines 150-155) chain only .select().eq().eq().range(from,to) with no .order() at all, while the local readAll (lines 47-60) issues multiple independent offset queries once a user has >1000 alert rows of one kind — the file's own canonical source (src/lib/supabase/page.ts lines 14-15) states rows \"can repeat/vanish between pages\" without a deterministic order. A duplicated row double-fires the push because the loop's second in-memory copy still has the stale notified_at:null snapshot (crossed && !a.notified_at at lines 122/174 passes again; the DB stamp at 129/181 is never re-read); a vanished row skips that run's crossing evaluation. The secondary instance also checks out: moversDigest (lines 228-235) orders on non-unique ts with no id tiebreaker despite card_price_history having a unique bigint id (migration 20260713150000 lines 240-245), and price-refresh/route.ts:164 inserts up to 100 rows in one statement with ts defaulting to now() (transaction timestamp), giving up to 100 cross-card rows an identical ts — so page-boundary ties past 1000 rows in the 90-day window can drop a card's point from the digest computation."
}
```

---

## 91. verify(impa):card-alerts pagination has no (retry 3)  (phase: Verify, agent aaf8757e7ada600c8, 194772 tokens, 31746s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/cron/card-alerts/route.ts: the targetAlerts builder (lines 109-114) and pctAlerts builder (lines 150-155) end with .eq(\"kind\",...).eq(\"cards.user_id\", uid).range(from, to) and contain no .order() whatsoever, while the local readAll (lines 47-60) pages by 1000-row offsets — unordered offset pagination lets rows vanish (crossing never evaluated; missed outright if the price un-crosses before the next run, since the re-arm branch at 131-133 also never sees it) or repeat (all pages are read before the loop, so a duplicated row still carries in-memory notified_at=null and the push at 123-127 fires twice before/despite the DB stamp at 129). This directly violates the documented rule in src/lib/supabase/page.ts:14-15 requiring a deterministic .order() with a unique tiebreaker, and the code paginates precisely because >1000 alert rows is the expected regime. Secondary instance also verified: moversDigest (lines 228-234) orders on non-unique ts only, and price-refresh/route.ts:164 inserts up to 100 history rows in one statement whose ts defaults to now() (statement-stable per migration 20260713150000_cardops_init.sql:244 \"ts timestamptz not null default now()\"), creating ~100-row tie groups so page boundaries can drop/duplicate a card's newest point once a user's 90-day history exceeds 1000 rows. Impact is real user-facing behavior: missed or duplicated price-target push notifications and skewed digest percentages."
}
```

---

## 92. verify(repr):card-alerts pagination has no (retry 3)  (phase: Verify, agent a569a09c11c543f47, 209819 tokens, 31719s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/cron/card-alerts/route.ts. The targetAlerts readAll builder (109-114) and pctAlerts builder (149-155) apply only .eq filters and .range(from,to) — no .order() at all — while the local readAll (47-60) fetches each 1000-row page as a separate request, so with >1000 alert rows per user Postgres gives no cross-request order guarantee: a row can repeat (rows array holds two copies with stale notified_at:null; the loop at 116-134 sends the push at 123 for the first copy, stamps notified_at at 129, then the second copy still passes `crossed && !a.notified_at` and pushes again — duplicate notification in one run) or vanish (crossing never evaluated that run — late notification). The secondary instance also checks out: moversDigest orders on non-unique ts only (232), card_price_history.ts defaults to now() (migrations/20260713150000_cardops_init.sql:244), and price-refresh/route.ts:164 inserts up to CAP=100 history rows in one statement so they share one transaction timestamp — ~100-row tie groups mean a page boundary past 1000 rows (~10 days at full rotation) can drop a rotation-gapped card's baseline point, tripping the 2x-window staleness guard (movers.ts:44) or producing a wrong-era pct. Minor imprecision only: digest.ts:53 appends the live price as `latest`, so the dropped row corrupts the baseline rather than the newest point — the mechanism and outcome stand. [low] is the right severity: needs >1000 rows of one alert kind plus actual cross-request ordering instability, but the code's own use of readAll shows that scale is expected, and sibling reads in the same file (167, 232) do carry .order(), marking this as an oversight and a genuine new instance of the audited pagination-determinism class."
}
```

---

## 93. verify(corr):Overlapping runs double-push c (retry 3)  (phase: Verify, agent ab86b6e00328fae91, 161672 tokens, 31669s)

```json
{
  "isReal": false,
  "reason": "The overlap precondition cannot occur: each route's only invoker is a once-daily Vercel cron (vercel.json: price-refresh at \"0 8 * * *\", card-news at \"0 13 * * *\") with `export const maxDuration = 60` (src/app/api/cron/card-news/route.ts:14, src/app/api/cron/price-refresh/route.ts:8), so a run lasts ≤60s and successive runs are 24h apart. The claimed \"manual Run\" trigger does not exist — repo-wide grep for `price-refresh|card-news` matches only vercel.json and the app/ re-export shells, greps for any run-now/cron-trigger UI return nothing, and CRON_SECRET is referenced only inside the cron routes themselves, so no in-app code path can fire these endpoints concurrently. Additionally, both routes 401 today (route.ts:34-36 `if (!secret || authorization !== Bearer secret) return 401`) because CRON_SECRET is deliberately unset. The reviewer's interleaving analysis is only reachable via a hypothetical operator hand-curling the secret-guarded endpoint inside the daily cron's 60-second window — not a failure scenario traceable through the code."
}
```

---

## 94. verify(impa):Overlapping runs double-push c (retry 3)  (phase: Verify, agent a61411a3ec788e5fb, 199693 tokens, 31664s)

```json
{
  "isReal": false,
  "reason": "The overlap premise does not trace: no manual \"Run\" path for these routes exists anywhere in the repo (grep for cron/card-news|cron/price-refresh hits only vercel.json and the app/ re-export shells; the only owner-button+cron hybrid is the unrelated /api/ebay/sync POST). Each route is invoked solely by Vercel Cron once per day (vercel.json: price-refresh 0 8 * * *, card-news 0 13 * * *) and both declare `export const maxDuration = 60` (src/app/api/cron/card-news/route.ts:14, src/app/api/cron/price-refresh/route.ts:8), so a run is killed after 60s and cannot overlap the next daily tick. Both routes also 401 unless the caller presents Bearer CRON_SECRET (lines 32-36 in each), which no in-app client possesses — and CRON_SECRET is unset today by documented design, so no runs occur at all. The claimed double-push/double-spend/duplicate-history requires two concurrent executions that no code path can produce; without overlap, the .in(\"url\") dedup + onConflict:url upsert and the end-of-run cursor advance are correct. Theoretical-only impact."
}
```

---

## 95. verify(repr):Overlapping runs double-push c (retry 3)  (phase: Verify, agent a7af4f7a0e16e6420, 203394 tokens, 31677s)

```json
{
  "isReal": false,
  "reason": "The race mechanics exist (card-news route.ts:89-91 check-then-act dedup, non-idempotent Haiku call at 94 and push at 129-142; price-refresh route.ts:166 end-of-run cursor advance), but the precondition — two concurrent runs — is unreachable from the code. The claimed \"manual Run\" trigger does not exist: grep of the whole repo shows the only callers of /api/cron/card-news and /api/cron/price-refresh are vercel.json (daily schedules \"0 13 * * *\" and \"0 8 * * *\") and the thin app/ re-export shells; src/app/cards/news/page.tsx, the only other file touching card_news, has no fetch/POST/action at all. Both routes export maxDuration = 60 (card-news/route.ts:14, price-refresh/route.ts:8), so a run is killed 60s after start and cannot overlap the next daily tick 24 hours later, and today CRON_SECRET is unset by documented design so route.ts:33-36 returns 401 to every caller. The only overlap path is an operator hand-curling the endpoint with the secret inside the cron's 60-second window — an out-of-band hypothetical, not a code-traceable scenario, failing the bar."
}
```

---

## 96. verify(corr):getOrders caps at 300 orders w (retry 3)  (phase: Verify, agent add6e217fc8eb2381, 186284 tokens, 31598s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/lib/ebay/orders.ts:110 — `for (let offset = 0; offset < 300; offset += 100)` with limit=100 hard-caps the fetch at 300 orders, and the return type `{ ok: true; orders: EbayOrder[] }` carries no truncation flag even though line 112 types eBay's `total?: number` in the response and then discards it. src/app/api/ebay/sync/route.ts:29,80 iterates only the returned array as the complete feed; the result's `checked` count (line 169) is never compared to eBay's total, and the cron audit rows (lines 208-214) fire only on settled/failures, so a truncated feed leaves zero trace. Scenario traces: >300 orders in the rolling 90-day window (e.g. a reconnection backlog of 400 PAID orders) means the oldest ones past the newest 300 are never examined by card_sell on any run, and daily syncs' windows only move forward until those orders age out of the filter — silent, permanent non-booking. Minor correction to the claim: eBay's Fulfillment getOrders has no sort parameter to pin, but its documented default is newest-first by creation date, so the dropped orders are deterministically the oldest, not arbitrary — which is exactly the unsettled-backlog case."
}
```

---

## 97. verify(impa):getOrders caps at 300 orders w (retry 3)  (phase: Verify, agent a3c2749fc2e0a09db, 201656 tokens, 31698s)

```json
{
  "isReal": false,
  "reason": "The 300-order cap exists (orders.ts:110 `for (let offset = 0; offset < 300; offset += 100)`) and `total` (typed line 112) is never read, but the claimed loss does not trace: sync/route.ts:29 re-fetches the full rolling 90-day window on every run and vercel.json line 21 schedules /api/ebay/sync daily. Under eBay's newest-first default, every new order enters at the top of the feed and is inside the first 300 on the next run unless >300 orders arrive in a single inter-sync gap (~300/day, 100x the claim's own 3.3/day premise); under an oldest-first sort, truncated orders age into the window and settle late (idempotent via the (platform, order_ref) unique index and card_sell's already-sold guard, sync/route.ts:145-149) — delayed, not lost. Merely exceeding 300 orders in the rolling 90 days — the claim's stated trigger — loses nothing under either ordering. The \"reconnection backlog\" leg fails too: the DB is shared with Master-Ops (the live eBay home today; EBAY_* absent here per house rules), whose identical daily sync has already settled the 90-day history in the shared card_sales, so a first CardOps run faces no unsettled 300+ backlog. Actual loss requires a compound scenario (post-cutover cron dead for weeks + owner never pressing the hub sync button + sustained high volume), and even then the missed sale leaves the card visibly stuck in \"listed\" status rather than silently vanishing. Theoretical-only impact for this deployment."
}
```

---

## 98. verify(repr):getOrders caps at 300 orders w (retry 3)  (phase: Verify, agent a99510c5da31ca3dc, 186545 tokens, 31590s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/lib/ebay/orders.ts:110 hard-caps the fetch at offsets 0/100/200 (`for (let offset = 0; offset < 300; offset += 100)`), line 118 only breaks on a short batch, and eBay's `total` — typed on line 112 as `{ orders?: RawOrder[]; total?: number }` — is never read, so the return `{ ok: true, orders }` (line 107/120) carries no truncation signal. The query (line 113) sends only filter/limit/offset, no sort pin. Consumer src/app/api/ebay/sync/route.ts:29 calls getOrders(access, 90), line 80 iterates the result as the complete settleable feed, and line 169 reports `checked: orders.length` with no truncation flag; audit rows (161-165, 208-214) cover only processed orders. With eBay's newest-first default, a >300-order 90-day window (reconnection backlog) permanently drops the oldest orders: an unsettled PAID sale there never books, its card stays status \"listed\", and no failure, note, or audit row records it. The only other caller (src/app/api/ebay/hub/route.ts:36) uses the same capped fetch, and no other code path fetches orders."
}
```

---

## 99. verify(corr):Order cancelled/refunded on eB  (phase: Verify, agent a1b1d8f3265e63aa0, 64897 tokens, 95s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the full sync route: runSync (src/app/api/ebay/sync/route.ts:80-85) only skips non-PAID / cancelState!=NONE_REQUESTED / locally-guarded orders (\"if (order.cancelState && order.cancelState !== \\\"NONE_REQUESTED\\\") continue;\") and contains no branch that detects an already-settled order now cancelled/refunded and reverses it — the skip doesn't even count as `skipped`, so the run reports ok. card_unsell is invoked only from /api/ebay/cancel-order (route.ts:59, fires solely on owner-initiated cancel from the CardOps hub, offered only on the awaiting-shipment tab) and the manual /api/cards/unsell; card_lot_unsell only from the manual lots route (src/app/api/cards/lots/route.ts:141). orders.ts:73-75 maps orderPaymentStatus (→FULLY_REFUNDED) and cancelStatus.cancelState (→CANCELED), so an eBay-side buyer-cancellation approval or return-refund flips the order into a permanent skip on every future sync while the card_sales row, P&L, and pool draw stand and the card stays status 'sold'. No webhook for order events exists (account-deletion is the GDPR endpoint), the hub renders no cancelState warning (hub/route.ts has zero cancelState handling), and neither cardops-backlog.md nor the DO-NOT-REPORT list covers external-cancellation reconciliation (ebay-connector-plan.md's Phase 3 \"Reconcile\" is a listing-state sweep, not sale reversal)."
}
```

---

## 100. verify(impa):Order cancelled/refunded on eB  (phase: Verify, agent af658319eea712131, 60232 tokens, 94s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the full sync route: src/app/api/ebay/sync/route.ts lines 81/84/85 only `continue` on non-PAID, cancelState != NONE_REQUESTED, or locally-guarded orders — no branch anywhere detects an already-settled order that eBay later cancelled/refunded, and the line-84 skip doesn't even count in `skipped`, so the run reports ok. Repo-wide grep shows card_unsell is invoked only from src/app/api/ebay/cancel-order/route.ts:59 (fires solely on CardOps-initiated cancellation, which is also the only writer of the ebay_cancelled_orders guard) and the manual /api/cards/unsell route; card_lot_unsell only from the manual lots route (src/app/api/cards/lots/route.ts:141), never from sync. cancelState is parsed (src/lib/ebay/orders.ts:75) but never rendered in the UI (EbayHub.tsx:25 is a dead type field), so an eBay-app-approved buyer cancellation or return/refund leaves the card_sales row, profit_loss, pool draw, and status 'sold' standing forever with zero surfaced warning — permanent overstated revenue on a physically-returned card. reference/cardops-backlog.md lists 'cancel order' as shipped and contains no planned eBay-side cancellation/return reversal; reference/next-steps.md has no mention, so this is not excluded territory."
}
```

---

## 101. verify(repr):Order cancelled/refunded on eB  (phase: Verify, agent a25f36a83da7ac2f7, 70793 tokens, 129s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing every reversal path. sync/route.ts:81-85 skips FULLY_REFUNDED/CANCELED orders via bare `continue` (before any counter) and runSync has no branch comparing settled card_sales rows against now-cancelled orders — the run returns ok. card_sell (20260733000000_card_sales_tenancy.sql:77-96) really does draw pool basis, insert card_sales with profit_loss, and set status='sold', so the phantom state is exactly as claimed. Grep shows card_unsell/card_lot_unsell called only from cancel-order/route.ts:59 (CardOps-initiated cancels only — the ebay_cancelled_orders guard at cancel-order/route.ts:45 is written nowhere else), cards/unsell/route.ts:28 and cards/lots/route.ts:141 (both manual). getOrders has exactly two consumers (sync, hub) and no webhook exists. The silence extends to the UI: hub/route.ts:101 filters recentOrders to paymentStatus==='PAID', so a refunded order vanishes from the Sold tab instead of flagging the settled-but-cancelled mismatch. reference/cardops-backlog.md (read in full) does not list refund/cancellation reconciliation as planned; only manual recovery endpoints exist, with nothing to prompt their use."
}
```

---

## 102. verify(corr):Cancelling a lot order reverse  (phase: Verify, agent ab637dadab4b93e3b, 66625 tokens, 119s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by reading all cited code. cancel-order (src/app/api/ebay/cancel-order/route.ts:51-62) matches lot children via order_ref.like.<orderId>:% (children get order_ref '<orderRef>:lot:<cardId>' per migration 20260720140000:116-117, orderRef set at sync/route.ts:107) and reverses each via card_unsell, which sets children back to 'booked' — but the route never references card_lots or card_lot_unsell, so the lot stays status='sold' (set at migration:121). From that state: op 'reverse' → card_lot_unsell passes its own status gate (migration:146) then calls card_unsell per child (migration:148-153), which raises 'card is not sold' (migration 20260720120000_card_unsell.sql:36) with no exception handler → whole RPC aborts, lot remains 'sold'; op 'sell' raises 'lot is not sellable' (migration:78-79); list-lot returns 400 'Lot is sold.' (list-lot/route.ts:34); add/remove blocked by assertEditable (lots/route.ts:94-99); op 'update' whitelists only title/description/ask_price. Refutation attempts failed: the later tenancy migration (20260733000000:101-158) does a textual gate-only replace — 'the reversal body is untouched' — and a repo-wide grep of card_lots writes shows no other path that can reset a sold lot's status. Only 'archive' (destroy-and-rebuild) escapes, exactly as claimed."
}
```

---

## 103. verify(impa):Cancelling a lot order reverse  (phase: Verify, agent ad24747530f197916, 65793 tokens, 103s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing all paths. cancel-order (src/app/api/ebay/cancel-order/route.ts:51-62) matches lot-child sales via order_ref.like.'O:%' (children get 'O:lot:<cardId>' from card_lot_sell, 20260720140000_card_lots.sql:117) and reverses each child via card_unsell, but never calls card_lot_unsell or updates card_lots — the lot stays status='sold', and since all child reversals succeed the route returns a clean success with no warning. Every in-app recovery then fails: card_lot_unsell passes its own status check (lot IS 'sold', line 146) but re-runs card_unsell on already-'booked' children, which raises 'card is not sold' (20260720120000_card_unsell.sql:36), aborting the whole transaction; op 'sell' raises 'not sellable' (line 78-79); add/remove blocked by assertEditable (\"Can't change a sold lot.\", lots/route.ts:97); list-lot returns 400 \"Lot is sold.\" (list-lot/route.ts:34); op 'update' cannot touch status. The tenancy migration (20260733000000) only rewrote access gates, not status checks. Only archive-and-rebuild (losing SKU/title/weight snapshots) or DB surgery recovers. Money stays correct, but a routine buyer-cancellation leaves a permanently wedged lot with a lying 'sold' status after a reported clean success — real operational impact the owner would hit."
}
```

---

## 104. verify(repr):Cancelling a lot order reverse  (phase: Verify, agent ac8e0a6b55cbb5658, 66515 tokens, 114s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing source. cancel-order/route.ts:51-62 matches lot-child sales via order_ref.like.<orderId>:% (children booked as '<orderRef>:lot:<cardId>' per migration 20260720140000:117) and calls card_unsell per child, but the 79-line route never references card_lots — the lot stays status='sold' with listing_refs.ebay.status='sold'. From that state card_lot_unsell (migration lines 144-155) passes its own 'sold' check then calls card_unsell on the first already-reversed child, which raises 'card is not sold' (20260720120000_card_unsell.sql:36), aborting the whole plpgsql transaction so status='draft' never runs — and migration 20260733000000 only rewrites the permission gates of both functions, not this logic. Every other path is blocked as claimed: list-lot/route.ts:34 returns 400 'Lot is sold.', card_lot_sell raises 'lot is not sellable (status sold)' (migration lines 78-80), add/remove hit \"Can't change a sold lot.\" (cards/lots/route.ts:94-116). A grep of all card_lots writers in src confirms the only escape is op 'archive' (lots route line 119) plus rebuilding a new lot, or manual DB surgery. Money is correct after reversal; the wedge is real."
}
```

---

## 105. verify(corr):getOrders silently caps at 300  (phase: Verify, agent a805a6d3f6185ecf5, 56791 tokens, 78s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/lib/ebay/orders.ts:110 is a hard 3-page cap: `for (let offset = 0; offset < 300; offset += 100)` with limit=100, and line 120 returns `{ ok: true, orders }` with no truncation signal — the eBay `total` field is even declared in the response type at line 112 but never read. runSync (src/app/api/ebay/sync/route.ts:29,80) iterates only the returned orders, so with 350 PAID orders in the 90-day window the last 50 never reach card_sell: cards stay 'listed', revenue never books, and lines 169/185 report `checked: 300` with ok:true and empty failures. The hub (src/app/api/ebay/hub/route.ts:36) uses the same capped getOrders, so its 'unsettled' counter cannot surface the missing orders. eBay returns orders newest-first, so the truncated tail is the oldest orders, which age past the creationdate filter (orders.ts:111) and become permanently unreachable; with the cron 401-by-design, manual-button backfill — the exact >300 scenario — is the current operating mode. No code path refutes any step."
}
```

---

## 106. verify(impa):getOrders silently caps at 300  (phase: Verify, agent ad00cf3c87ad82592, 56039 tokens, 85s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by reading the code. src/lib/ebay/orders.ts:110 is literally `for (let offset = 0; offset < 300; offset += 100)` — three pages of limit=100, a hard 300-order ceiling; the declared `total?: number` field in the API response (line 112) is never read, and line 120 returns `{ ok: true, orders }` with no truncation signal. runSync (src/app/api/ebay/sync/route.ts:29) settles only the returned orders and reports `checked: ordersRes.orders.length` (line 169) with ok:true, so with 350 PAID in-window orders, 50 never reach card_sell: their cards stay 'listed' and their revenue never books — silently. Permanence traces: eBay getOrders returns newest-first, so the dropped orders are the oldest in the 90-day window; orders newer than an unfetched order age out strictly after it, so it can never rise into the top 300 before the creationdate filter (line 111) excludes it forever. The hub route shares the same capped call (src/app/api/ebay/hub/route.ts:36) and its `unsettled` stat (line 120) is computed over the capped set sliced to 50 (line 103), so the UI cannot flag the loss either. The sync file's own comment (lines 32-33) condemns exactly this pattern for the card-side read, and the excluded 'group-showcase 300-card display cap' is a different, display-only cap — this is a new instance of the capped-read-feeding-settlement class the audit targeted. Concrete impact: unbooked sale revenue and sold cards left listed, masked by a success response."
}
```

---

## 107. verify(repr):getOrders silently caps at 300  (phase: Verify, agent afbfa9db2acb6d1e0, 58663 tokens, 85s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/lib/ebay/orders.ts:110 is `for (let offset = 0; offset < 300; offset += 100)` with limit=100 per page — a hard 300-order ceiling; with 350 orders every batch is exactly 100 so the `batch.length < 100` break (line 118) never fires and line 120 returns { ok: true, orders } (300 orders) with no truncation signal — the API's own `total` field is typed at line 112 but never read. runSync (src/app/api/ebay/sync/route.ts:29,80) iterates only those 300, so the other 50 PAID orders never reach card_sell: cards stay 'listed', revenue never books, and line 169 reports checked:300 inside an ok:true response. No alternate settlement path exists (all routes under src/app/api/ebay/ checked — settlement flows only through runSync←getOrders). The hub (src/app/api/ebay/hub/route.ts:36) uses the same capped getOrders and computes `unsettled` (line 120) only over the top-50 `recentOrders` slice, so the missing orders cannot surface in the UI. With the rolling creationdate:[since..] filter (orders.ts:108) and eBay's newest-first default sort, dropped oldest orders age out of the 90-day window and become permanently unreachable while volume stays above the cap. Only caveat: permanence requires sustained >300 orders/90 days; the silent truncation itself is unconditional at that state."
}
```

---

## 108. verify(corr):Sync match-set reads break the  (phase: Verify, agent a2cf1b397519b907f, 53404 tokens, 94s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. (a) src/app/api/ebay/sync/route.ts:41-43 pages the cards match set with .order(\"created_at\", {ascending:false}).range(...) and no unique tiebreaker; ties are guaranteed because bulk import (src/app/cards/actions.ts:215) inserts whole batches in one statement, giving identical transaction-stable created_at. The match set grows monotonically past 1000 — listing_refs is never reset to {} (sync sets status:\"sold\" at route.ts:159; end sets status:\"ended\" at src/app/api/ebay/end/route.ts:51-56) — and the loop's own 20000 bound shows the author expects that scale. A card dropped at a tie/shifted page boundary falls out of byListingId/bySku and its PAID line hits `if (!card && !lot) continue;` at route.ts:96 — not settled, not counted as skipped, not a failure. page.ts:14-15 documents this exact hazard. (b) route.ts:64-66 reads card_lots with no .order(), no .range(), no readAll — PostgREST silently caps at 1000 rows, so past 1000 ever-listed lots a sold lot vanishes from lotByListingId/lotBySku and its order silently never settles, every run (no recovery, unlike (a)). (c) route.ts:35's 20000 hard cap emits no truncated signal, violating readAll's documented contract (page.ts:28-29). Only mitigation found: daily idempotent re-runs over a 90-day window make (a) intermittent rather than permanent — consistent with medium severity, and irrelevant to (b)."
}
```

---

## 109. verify(impa):Sync match-set reads break the  (phase: Verify, agent ac32fbee03da17d88, 56184 tokens, 121s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. (a) src/app/api/ebay/sync/route.ts:41-43 pages the cards match set with .order(\"created_at\",{ascending:false}).range(from,from+999) and no unique tiebreaker; ties are real because src/app/cards/actions.ts:215 bulk-inserts CSV batches in one statement (shared now() default, cardops_init.sql:188), and the match set (.not(\"listing_refs\",\"eq\",\"{}\")) grows monotonically since sold cards keep refs.ebay={status:\"sold\"} (sync:158-160) and ended keep {status:\"ended\"} (end/route.ts:51-54). A card vanishing at a tie boundary drops out of byListingId/bySku (both built from the same truncated cardRows) and its PAID line hits `continue` at line 96 — not settled, not skipped, not failed, no audit row; with a 90-day order fetch window (line 29) a stable exclusion means the sale is never booked. (b) sync:64-66 reads card_lots with no .order/.range/readAll — PostgREST silently caps at 1000, so past 1000 ever-listed lots a sold lot's order silently never settles; grep confirms no readAll import anywhere in src/app/api/ebay. (c) The 20000 cap at line 35 discards readAll's truncated contract. page.ts:10-15 documents both violated rules; house rules make new instances of this class reportable. Silent unbooked revenue = real money impact."
}
```

---

## 110. verify(repr):Sync match-set reads break the  (phase: Verify, agent a81c6ce6933a0015f, 53437 tokens, 92s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing route.ts. (a) Lines 35-46 page cards with .order(\"created_at\",{ascending:false}).range() and no unique tiebreaker; ties are real because cards.created_at defaults to now() (20260713150000_cardops_init.sql:188) and the CSV bulk import inserts whole batches in one statement (src/app/cards/actions.ts:215 — supabase.from(\"cards\").insert(out)), stamping identical created_at across the batch; the >1000 precondition is reachable because sold cards keep non-empty listing_refs (route.ts:160), so .not(\"listing_refs\",\"eq\",\"{}\") matches every ever-listed card forever. A card vanishing between pages drops out of byListingId/bySku, and its PAID order hits the bare `continue` at line 96 — recorded in none of settled/skipped/failures, exactly the \"rows can repeat/vanish between pages\" failure page.ts:14-15 documents. (b) Lines 64-66 read card_lots with no .order/.range/.limit at all, so PostgREST silently truncates at 1000; a truncated-away lot's order silently never settles via the same line-96 continue. (c) The 20000 cap exits with no truncated signal (loop condition from<20000, full last page), violating readAll's documented contract; bonus: line 45 treats a query error (data null) as a clean short page. Mitigation considered: daily idempotent re-runs over a 90-day window usually settle the order later — but the claim only asserts the order doesn't settle that run, which is accurate, and past 90 days the sale is permanently lost. New instance of the audit-fixed class; hand-rolled paging instead of readAll."
}
```

---

## 111. verify(corr):ebay_cancelled_orders idempote  (phase: Verify, agent aadd2ef6428508c55, 58358 tokens, 121s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. sync/route.ts:50 reads ebay_cancelled_orders in one unordered, unpaged request (readAll from src/lib/supabase/page.ts exists but is unused here); line 51 only aborts on error, and PostgREST's silent 1000-row cap is a success. The Set at line 52 is genuinely the last defense during eBay's consistency window: card_unsell (20260720120000_card_unsell.sql:63-73) deletes the card_sales row — disarming the unique (platform, order_ref) index — and resets status to 'booked', disarming card_sell's only 'already sold' guard (20260733000000_card_sales_tenancy.sql); cancel-order/route.ts never clears cards.listing_refs so the card stays in the match set, and line 84's cancelState check is the eventually-consistent eBay state the migration comment (lines 85-90) documents as untrustworthy. Table has no user_id, no pruning anywhere in the repo, and the cron reads it via service client into one shared 1000-row budget; past 1000 rows a recently-cancelled order can drop from the Set and line 85 lets card_sell re-book it — double pool draw plus phantom revenue on a refunded order. reference/audit-2026-07-24.md has zero eBay coverage, so this is a new instance of the mandated readAll idempotency-guard class, not re-litigated territory. Low severity is fair (needs 1000+ lifetime seller-cancellations), but the mechanism is real."
}
```

---

## 112. verify(impa):ebay_cancelled_orders idempote  (phase: Verify, agent a7c888446b8ba30f1, 58227 tokens, 125s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. route.ts:50 is a single unordered, unpaged `db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` (no .order/.range/readAll, unlike the manually-paged cards read at lines 35-46 in the same function), and a silent 1000-row cap is not an error so the line-51 abort never fires. The Set is provably the ONLY durable defense: card_unsell (20260720120000_card_unsell.sql:66) DELETEs the card_sales row — disarming the unique (platform, order_ref) index — and line 72 resets the card to status='booked', which card_sell accepts (20260733000000_card_sales_tenancy.sql:72 rejects only 'sold'), while the card keeps listing_refs.ebay.listing_id so it stays in the match set; the feed-level skips at route lines 81/84 are exactly what the migration comment (lines 85-90) documents as unreliable during eBay's eventual-consistency window (\"Without a local marker the next sync would re-settle it — double pool draw + phantom revenue\"). The table is append-only (sole writer: cancel-order/route.ts:45-46 upsert), never pruned, no user_id/time filter, so the 1000 budget is lifetime-global — and with no ORDER BY, heap order on an append-only table tends to return oldest rows first, dropping precisely the fresh markers the consistency window needs. Consequence is wrong money (double pool draw + phantom revenue on a refunded order). The >1000-row threshold being distant supports the stated [low] severity, not refutation."
}
```

---

## 113. verify(repr):ebay_cancelled_orders idempote  (phase: Verify, agent a9edf5772401aa6b9, 57059 tokens, 109s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the full path. sync/route.ts:50 reads the guard with a single unordered, unpaged `select(\"order_ref\")`; PostgREST caps it at 1000 rows silently, and the line-51 abort only fires on an error, not truncation. The Set at line 85 is provably the ONLY durable defense after a seller-cancel: card_unsell (migration 20260720120000_card_unsell.sql:66,72) deletes the card_sales row — removing the unique (platform,order_ref) index protection — and resets the card to 'booked', disarming the status skip at route.ts:135; cancel-order never clears listing_refs so the card re-matches (route.ts:39,159); during eBay's EC window the feed still says PAID/NONE_REQUESTED (orders.ts:75 defaults to NONE_REQUESTED) so lines 81/84 pass. Rows are never pruned (grep: only the upsert in cancel-order/route.ts:45 and this read), so past 1000 lifetime cancellations the fresh marker — heap-tail, most likely dropped — can vanish from the Set and the order is re-settled via card_sell: double pool draw plus phantom revenue on a refunded order. The same function pages its cards read manually (route.ts:35-46), underscoring the omission. Only nit: the \"every user's rows\" framing overstates — inserts are owner-gated and eBay single-homed — but one seller's unpruned rows share the same 1000 budget, so the verdict stands. [low] severity is appropriate."
}
```

---

## 114. verify(corr):Fee estimate applies eBay's $0  (phase: Verify, agent a149032420a681e0b, 51093 tokens, 60s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. route.ts:89 loops per line; when order.marketplaceFee is null (real state — src/lib/ebay/orders.ts:80 yields null whenever eBay's totalMarketplaceFee is absent), route.ts:104 calls estimateFee(salePrice + shipIncome) per matched line, and estimateFee (route.ts:23, `gross * 0.1325 + 0.3`) adds the $0.30 fixed fee — documented at route.ts:22 as \"per order\" — on every call. A 3-card combined order books 3×$0.30=$0.90 of fixed fee vs the $0.30 eBay charges, overstating fees by $0.60; the percentage part splits correctly. The error persists: card_sell (20260713170000_card_sell_rpc.sql lines 35/56/64-67) folds p_fees into net_proceeds and profit_loss on card_sales, no reconciliation code exists anywhere in src/, and re-runs cannot correct it because sold status (route.ts:135) and the unique (platform, order_ref) index make the first booking final. Downstream books rows inherit the understated profit."
}
```

---

## 115. verify(impa):Fee estimate applies eBay's $0  (phase: Verify, agent a99c14be176a7ae92, 55339 tokens, 91s)

```json
{
  "isReal": true,
  "reason": "Confirmed. route.ts:89 loops per line item and lines 102-104 compute `estimateFee(salePrice + shipIncome)` inside that loop when `order.marketplaceFee == null`; estimateFee (line 23) adds a flat $0.30 per call while its own comment says \"$0.30 per order\". Multi-line combined orders are a designed-for case (line 87 comment, per-line order_ref at line 107), so n matched lines book n×$0.30 vs eBay's actual once-per-order $0.30 — a 3-card combined order overstates fees by $0.60. marketplaceFee is genuinely null until eBay reports totalMarketplaceFee (orders.ts:80), and the sync settles the instant paymentStatus=PAID, before fee data lands. The error is permanent: card_sell (20260733000000_card_sales_tenancy.sql:75,94-95) bakes fees into card_sales.net_proceeds/profit_loss, idempotency guards block re-settlement, and grep confirms no code ever updates card_sales.fees afterward. The books post route (src/app/api/cards/books/post/route.ts:45) reads card_sales.fees, propagating the overstatement into the double-entry books. Wrong money, deterministic, permanently persisted — real at [low] severity."
}
```

---

## 116. verify(repr):Fee estimate applies eBay's $0  (phase: Verify, agent a7a63de7bfe9cbfc0, 54168 tokens, 62s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/app/api/ebay/sync/route.ts:23 defines estimateFee = gross*0.1325 + $0.30 (comment on line 22: \"$0.30 per order\"), and line 104 applies it independently per matched line inside the per-line loop (lines 89–166) whenever order.marketplaceFee is null. The actual-fee branch (line 103) splits marketplaceFee proportionally by share, so only the fallback duplicates the fixed part: a 3-line combined order books 3 x $0.30 = $0.90 instead of $0.30, overstating fees by $0.60. marketplaceFee is genuinely nullable — src/lib/ebay/orders.ts:80 sets it null whenever totalMarketplaceFee is absent from the Fulfillment payload. The inflated p_fees flows into card_sales.fees, net_proceeds, and profit_loss via card_sell (supabase/migrations/20260733000000_card_sales_tenancy.sql lines 90–95: v_net = p_sale_price - p_fees + p_ship_income - p_ship_cost; v_pl = v_net - v_basis). The error is permanent: the sync's idempotency (route.ts:147 treats 'already sold|duplicate key' as benign skip) means a later run carrying the real marketplaceFee never rebooks the sale."
}
```

---

## 117. verify(corr):Relist trusts only local sold  (phase: Verify, agent aebdea14c416e06fd, 94363 tokens, 758s)

```json
{
  "isReal": true,
  "reason": "Every local link traces: relist guards only on local card status (relist/route.ts:33 pre-check, :64-66 .neq('status','sold') write guard) with no ref.status or live-eBay verification, and relistItem (src/lib/ebay/trading.ts:218) sends a bare RelistItem; the sync is the only path that flips a card to sold, so a sold-but-unsynced auction passes the guard. eBay's relist eligibility is 'ended + within 90 days' (the 'no sale' condition gates only the fee credit) and eBay's own Sold page offers Relist, so the call succeeds. relist/route.ts:57-61 overwrites listing_refs.ebay.listing_id (relisted_from is never read by sync — sync/route.ts:58 builds byListingId from listing_id only), so buyer 1's order matches via the bySku fallback (sync/route.ts:91-92; auctions carry SKU per trading.ts:83 and orders.ts:58,94) and settles, leaving the NEW listing live on eBay for a sold card (nothing in sync ends listings). Buyer 2's purchase then hits sync/route.ts:135 `if (c.status === \"sold\") { skipped++; continue; }` — silent — and even the card_sell path raises literally 'card already sold' (supabase/migrations/20260733000000_card_sales_tenancy.sql:72), matching the benign regex at sync/route.ts:147. Reachability keeps it [low]: the UI Relist button only renders for eBay's UnsoldList (hub/route.ts:45, EbayHub.tsx:330-335), which excludes the sold auction itself — but the hub's matchCard bySku fallback (hub/route.ts:70-71) maps a stale prior ended-unsold row (UnsoldList retains relisted items ~90 days; parseSellingItem ignores the Relisted flag) to the same cardId, whose Relist button relists the current sold listing — so the chain is UI-reachable, and the owner-only endpoint is itself the guard."
}
```

---

## 118. verify(impa):Relist trusts only local sold  (phase: Verify, agent a0e37a8c8de8029ea, 74895 tokens, 179s)

```json
{
  "isReal": false,
  "reason": "The route-level checks are local-only as claimed (src/app/api/ebay/relist/route.ts:33 and the .neq('status','sold') guard at :64-68), but the failure scenario never reaches them: the sole caller of POST /api/ebay/relist is the hub's \"ended\" tab (src/components/cards/EbayHub.tsx:330-335, `onRelist` at :334), whose rows are `hub.unsold` — filled from eBay's own GetMyeBaySelling UnsoldList fetched live at hub load (src/app/api/ebay/hub/route.ts:45 → src/lib/ebay/trading.ts:166-182). eBay's UnsoldList contains only listings that ended WITHOUT a winning buyer; a sold-but-unsynced auction sits in eBay's SoldList and never renders a Relist button, so the relist gate is eBay-authoritative, not \"exclusively the LOCAL card status.\" An ended-unsold row also cannot become sold between render and click (ended listings can't be purchased), and act() re-fetches the hub after every action (EbayHub.tsx:208). The only path to the claimed double sale is the owner hand-POSTing his own owner-gated API (relist/route.ts:20) with a sold card's id, deliberately bypassing the UI — self-inflicted misuse, not a defect a user would hit. Downstream mechanics (SKU present on auctions at trading.ts:83, bySku re-match at sync/route.ts:91-92, benign 'skipped' at :147) are accurately described but moot without a reachable trigger."
}
```

---

## 119. verify(repr):Relist trusts only local sold  (phase: Verify, agent addb0ad106cf7e85b, 87396 tokens, 286s)

```json
{
  "isReal": false,
  "reason": "The trigger is unreachable through the app: the only caller of /api/ebay/relist is the hub ended tab's Relist button (src/components/cards/EbayHub.tsx:330-335, button gated to kind===\"ended\" at 495-499), and that tab is populated exclusively from `hub.unsold` = getMyEbaySelling's UnsoldList (src/app/api/ebay/hub/route.ts:44-45 → src/lib/ebay/trading.ts:182 `lists(\"UnsoldList\", 2)`) — eBay's server-side list of listings that ended WITHOUT a sale. A sold-but-unsynced auction sits in eBay's SoldList/orders (shown on the Sold tab with a Sync button, hub/route.ts:100-108), never on the ended tab, so no Relist button ever exists for it; local card status plays no role in tab membership, and staleness can't help because a listing enters UnsoldList only after ending unsold and an ended listing cannot subsequently be bought. The route's local-only status check (relist/route.ts:33, 64-68) is real, but exploiting it requires the owner to hand-craft an authenticated POST with a cardId the UI never offers — not a scenario that traces through the code. The claim's other load-bearing premise (Trading RelistItem \"explicitly permits\" relisting a sold auction) is external and unverified; if eBay rejects, relist/route.ts:37-38 returns 502 with zero state change."
}
```

---

## 120. verify(corr):Hub money stats computed from  (phase: Verify, agent a31a759925d327541, 50660 tokens, 68s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/ebay/hub/route.ts: lines 74-78 read card_sales with .eq(\"platform\",\"ebay\").limit(1000) and no .order(); lines 81-85 build the settledOrders Set and sold30 array from that slice, feeding sold30Total/profit30 (lines 117-118), the per-order settled badge (line 106), and the unsettled counter (line 120); lines 49-53 cap the cards match map identically. Past 1000 eBay sales rows the returned subset is arbitrary, so the 30-day dollar totals undercount and settled orders can display as unsettled — exactly the sum/membership-Set class src/lib/supabase/page.ts:6-11 mandates readAll for, and not on the deliberate-exceptions list. Severity correctly [low]/display-only: the settle path (src/app/api/ebay/sync/route.ts:14-16,105-107,145-148) is idempotent via the unique (platform, order_ref) index and card_sell's already-sold guard, so no duplicate money write can result. One clause refuted: the \"and vice versa\" direction is impossible — Set membership only comes from real card_sales rows, so an unsettled order can never falsely show settled; the error is one-directional."
}
```

---

## 121. verify(impa):Hub money stats computed from  (phase: Verify, agent ac4d25340df4e661f, 51108 tokens, 79s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/hub/route.ts:74-78: `.from(\"card_sales\").select(...).eq(\"platform\",\"ebay\").limit(1000)` with no .order(), feeding the settledOrders Set (81-83), the sold30 window (85), and the sold30Total/profit30 sums (117-118). These are rendered as money-as-fact in EbayHub.tsx:245 (\"Sold 30d · P/L\" tile), the per-order settled badge (EbayHub.tsx:709-712), and the unsettled tab count (236). Past 1000 eBay card_sales rows (one row per order line per sync/route.ts:105-107) the slice is arbitrary — and since heap order correlates with insert order, the newest 30-day rows are the likeliest to be truncated, so the displayed 30d revenue/P&L undercounts and settled orders show \"not settled\". One correction: the claimed \"vice versa\" is impossible — the Set has only real rows, so it can produce false negatives but never a false \"settled ✓\". Money writes are protected independently (sync/route.ts:14-16 unique (platform, order_ref) index + card_sell already-sold guard), so impact is wrong displayed dollars/state only — [low] severity is correct, and it is a live instance of the audit's readAll-for-sums/Sets rule with no readAll import anywhere under src/app/api/ebay."
}
```

---

## 122. verify(repr):Hub money stats computed from  (phase: Verify, agent aaa869dc31e4f4653, 52661 tokens, 92s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/api/ebay/hub/route.ts:74-78 reads card_sales with .eq(\"platform\",\"ebay\").limit(1000) and no .order() or date filter — an all-time read; lines 81-83 build the settledOrders membership Set from that slice, line 85 the 30-day subset, lines 116-118 the sold30Count/sold30Total/profit30 sums, line 106 the per-order settled flag, line 120 the unsettled counter; lines 49-53 cap the cards match map identically. The values are displayed as dollar facts (src/components/cards/EbayHub.tsx:245 money tiles, :236 unsettled tab badge). With >1000 all-time eBay sale rows, LIMIT without ORDER BY returns an unspecified subset, so recent rows can be dropped: settled orders in the 90-day window show unsettled and the 30-day dollar sums are computed from a fraction of the truth — exactly the class src/lib/supabase/page.ts:10-12 mandates readAll for (SUM/COUNT/membership Set). Severity correctly [low]/display-only: re-settling is blocked by the unique (platform, order_ref) index and card_sell's already-sold guard (src/app/api/ebay/sync/route.ts:14-16, 145-147). Minor caveat: the suggested order-by-sold_at-desc fix would repair the 30-day sums but not fully the settledOrders Set; readAll is the house-rule fix."
}
```

---

## 123. verify(corr):100-cards/day member cap is by  (phase: Verify, agent a29a93f799e78fae7, 69847 tokens, 138s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED — both bypasses trace through real code. (1) Backdated created_at: cards.created_at is a plain client-writable column (20260724000000_multi_tenant_cards.sql:14, default now() but never force-stamped). The only cards RLS is cards_own (lines 38-40): with check (has_card_access() and user_id = auth.uid()) — it validates nothing about created_at. There is no BEFORE INSERT trigger on cards (only cards_sale_guard BEFORE UPDATE in 20260713170000 and trg_daily_card_cap AFTER INSERT) and no column-level REVOKE/GRANT on cards in any of the 33 migrations, so the default Supabase `authenticated` grant lets a card_ops member POST directly to PostgREST with created_at='2020-01-01'. The cap trigger (line 85) counts only `created_at >= date_trunc('day', now())`, so backdated rows are invisible to the count → passes deterministically, unlimited cards, no timing required. (2) Read-committed race: enforce_daily_card_cap is AFTER INSERT FOR EACH STATEMENT (lines 92-93) running in the inserting txn; in Postgres READ COMMITTED its count(*) sees its own uncommitted rows but not a concurrent uncommitted txn's, so N parallel 100-row inserts each count 100 (not >100) and all commit → 100xN. The trigger takes no lock. importCards (src/app/cards/actions.ts:215) issues one bare .insert(out) with no lock, and createCard/FullIntake likewise; only speed_book_commit serializes, via its card_pool ... for update row lock (lines 161-166). No later migration alters the cap trigger, stamps created_at, or adds a column grant. The bypassed guarantee is documented at reference/next-steps.md:88 ('capped at 100 new cards/day'). This is a NEW instance (the daily cap is introduced by this migration, not covered by the prior audit's fixed list). Severity medium is fair: the cap is an anti-abuse limit, not a money-correctness invariant, but both bypasses are concrete and bypass (1) is trivially deterministic."
}
```

---

## 124. verify(corr):Nightly paid-spend crons keep  (phase: Verify, agent ab982c90083431f91, 66107 tokens, 113s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all cited code. proxy.ts:62-76 bounces any role other than owner/card_ops (403 on /api, login redirect), so a demoted member is fully locked out while their data persists (no cleanup path exists in CardOps; membership lives in MasterOps). Yet three paid-spend crons enumerate work from data with no role filter: price-refresh route.ts:62-72 fills the CAP=100 billable TheCardAPI rotation from `cards .not(\"user_id\",\"is\",null).neq(\"user_id\", ownerId)` (its own comment at lines 42-46: \"a real budget — these are billable calls on Beau's key\"); card-estimates route.ts:43-46 iterates `card_user_prefs ... .neq(\"auto_estimate\",\"off\")` and runs up to PER_USER=20 owner-key Anthropic estimates per user per night (estimate-run.ts:9 uses the shared anthropic client; route line 129 debits credit_ledger for the locked-out user), also consuming the GLOBAL=80 cap; card-news route.ts:56-60 fills SUBJECT_CAP=12 Haiku-scored subjects from all non-owner cards. The contrast is real: daemon route.ts:63-64 and card-alerts route.ts:71-72 both roster from `profiles.role in ('owner','card_ops')` — same-day audit fixes proving role-rostering is the intended pattern. The failure scenario traces end to end: demote a member with live cards and auto-estimates on, and every nightly run spends owner-paid API/AI budget on inventory nobody can see while starving active users' budget share."
}
```

---

## 125. verify(corr):card_lot_sell never checks lot  (phase: Verify, agent aa0c26fb6f64baba8, 78111 tokens, 259s)

```json
{
  "isReal": false,
  "reason": "The mechanical defect is real: card_lot_sell (supabase/migrations/20260720140000_card_lots.sql:71) gates only on `has_card_access() or service_role`, reads card_lots (:74) and card_lot_items (:87-94) with RLS bypassed, and mutates card_lots.status='sold' at :121 with no lot-ownership check — asymmetric with card_lot_unsell, which was re-gated to `l.user_id=auth.uid()` (20260733000000:156). The card_lot_items lot_id gap (with-check = owns_card(card_id) only, 20260724000000:54) is also real and un-rescoped.\\n\\nBut the claimed failure scenario (a member flipping ANOTHER user's card_lots row to 'sold') does not trace, blocked twice:\\n\\n(1) No disclosure path for the target UUID. card_lot_sell acts on p_lot_id, which must be the victim's 122-bit random lot UUID. card_lots RLS is `user_id = auth.uid()` with no is_owner/public branch (20260724000000:73); the GET lots route uses the RLS-scoped client and returns only the caller's own lots (src/app/api/cards/lots/route.ts:24-29); list-lot is owner-only (list-lot/route.ts:22). No oracle, enumeration, or SKU→UUID lookup exists to hand a member a foreign lot's UUID. The exploit's premise 'add their OWN cards to another user's lot id' presupposes knowing that id, and nothing in the code supplies it.\\n\\n(2) Even given the UUID, :121 fires only if EVERY child is attacker-owned. Each child settles via card_sell, which enforces owns_card(p_card_id) (20260733000000:68) and rolls the whole transaction back on the first non-owned card (the reviewer concedes this). A victim's real lot holds the victim's cards (create requires >=2 cards, lots/route.ts:68; a member cannot DELETE another user's card_lot_items since DELETE RLS is owns_card(card_id)), so it always rolls back before :121. The only state reaching the mutation is a foreign draft/listed lot holding none of the victim's cards — not producible through the app.\\n\\nBoth preconditions unmet; the wrong-user mutation cannot be triggered. The missing check is a genuine instance of the flagged SECURITY-DEFINER anti-pattern, but the concrete, traceable failure the bar requires does not survive: its linchpin (a member obtaining a foreign lot UUID) has no supporting code path."
}
```

---

## 126. verify(corr):CPA sales CSV pages on a non-u  (phase: Verify, agent afc64ef05bf7dd7fd, 63932 tokens, 141s)

```json
{
  "isReal": true,
  "reason": "Confirmed at every link. src/app/api/cards/reports/route.ts:31-42 pages card_sales 1000/request ordered only by .order(\"sold_at\") with no unique tiebreaker (violating src/lib/supabase/page.ts:14-15). sold_at is timestamptz default now() with no uniqueness (20260713150000_cardops_init.sql:270), and ties are GUARANTEED, not hypothetical: card_lot_sell (20260720140000_card_lots.sql:41-119, \"Atomic (one transaction)\") calls card_sell per child card in one transaction, so every child's card_sales insert gets the identical transaction_timestamp — a multi-card lot sale always writes N rows with byte-equal sold_at. The route loops to 200,000 rows, so >1000 sales/year is its own design envelope; between page queries, books/post's update({synced_to_books:true}) (books/post/route.ts:92) rewrites card_sales tuples and the eBay cron inserts new rows, so tie order can differ across pages → a sale duplicated or dropped in the CPA CSV with HTTP 200. The audit-fixed sibling pages the same table by unique id (books/post/route.ts:47), confirming this route missed the sweep. Journal half also confirmed: journal/route.ts:38-41 orders by (entry_date, source_ref, line); an advance receipt writes two entries sharing source_ref with lines each numbered from 0 (receipts/route.ts:92-96; journal.ts:132-152 returns two EntityEntry objects), and 20260720290000_journal.sql:20 has only a non-unique index, so (entry_date, source_ref, line) collides pairwise — the export's sort key is not a total order. Low severity is apt (needs >1000 rows plus a boundary-straddling tie), but the failure is concrete and silent."
}
```

---

## 127. verify(corr):updateCard accepts any status  (phase: Verify, agent a3d89b07ec79336f2, 69241 tokens, 135s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all cited code. updateCard (src/app/cards/actions.ts:133-154) applies fields() status (line 92) to cards with no whitelist or transition rules, and the payload omits basis_drawn/sold_at. guard_card_sale (supabase/migrations/20260713170000_card_sell_rpc.sql:86-88) raises only when the NEW status is 'sold' or basis_drawn/sold_at change — a sold→booked flip trips none of the three arms, so any card user (RLS cards_own, 20260724000000:38-40, is FOR ALL on own rows) un-sells silently while the card_sales row and pool draw remain; grep confirms the trigger is never redefined by a later migration. The latest card_sell (20260733000000_card_sales_tenancy.sql:72) refuses only status='sold', so the flipped card sells AGAIN: second card_sales row (partial unique index lines 35-37 is `where order_ref is not null`, so a null order_ref escapes) plus a second pool draw — duplicated revenue and double-drawn basis. The unsell route comment (src/app/api/cards/unsell/route.ts:12) and 20260720120000_card_unsell.sql:5-7 both assert the trigger blocks manual status resets — it does not. Owner scenario also traces: is_owner() is exempted (line 89-91, comment says owner 'may still correct manually'), so the edit form's 'sold' option (CardForm.tsx:180-182, CARD_STATUSES includes 'sold') marks a card sold with no sale row, no basis draw, sold_at null — the exact operation the bulk route blocks (src/app/api/cards/bulk/route.ts:47-49, :91). createCard insert with status='sold' also bypasses the BEFORE UPDATE trigger; the CHECK constraint (20260713150000:181-182) allows it. The only softening: the owner exemption itself is documented as deliberate in the trigger comment, but the un-sell/double-sell path for any user is unambiguously a defect against the code's own stated invariant."
}
```

---

## 128. verify(impa):updateCard accepts any status  (phase: Verify, agent aef531c64f2994159, 70847 tokens, 135s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all cited code. updateCard (src/app/cards/actions.ts:92,136-139) passes form status into the cards UPDATE with no whitelist; CardForm.tsx:180-182 offers all CARD_STATUSES including 'sold' (types.ts:37) with no filter, unlike CardBrowser:286/BulkManager:177 which exclude it. guard_card_sale (20260713170000_card_sell_rpc.sql:86-91) fires only on transitions TO 'sold' or basis_drawn/sold_at changes and exempts is_owner(); it is BEFORE UPDATE only (line 98) and grep shows it was never redefined in any later migration. Cards RLS (20260724000000:38-40) lets any card user update their own rows. Trace 1: sold→booked flip via updateCard changes neither basis_drawn nor sold_at and new.status<>'sold', so the trigger passes for any role; card_sales row and pool draw remain; card_sell (20260733000000:72) refuses only status='sold', so it inserts a second card_sales row (line 93-95) and takes a second pool draw (79-84); manual sales pass nullable order_ref (sell/actions.ts:41-48) escaping the partial unique index (where order_ref is not null); /api/cards/books/post (route.ts:41-47) rebuilds the journal from all card_sales rows → duplicated revenue and double-drawn basis. The unsell route's comment (unsell/route.ts:12) wrongly claims the guard blocks a manual status reset. Trace 2: owner picking 'sold' in the edit form passes the trigger via the is_owner() exemption → card marked sold with no card_sales row, no pool draw, null sold_at — inventory silently leaves the books; the bulk route explicitly blocks exactly this (bulk/route.ts:47-49, :91), proving the invariant is real elsewhere. createCard/importCards INSERTs with status='sold' bypass the BEFORE UPDATE trigger entirely. Wrong-money impact (duplicate revenue, double basis draw, vanished inventory) is concrete and owner-relevant."
}
```

---

## 129. verify(repr):updateCard accepts any status  (phase: Verify, agent aa02508dc5fcd7bd2, 72117 tokens, 161s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing every link. (a) actions.ts:92/133-139: updateCard passes formData status into the cards UPDATE with no whitelist and never sets basis_drawn/sold_at, so a sold→booked edit makes all three guard_card_sale disjuncts false (20260713170000_card_sell_rpc.sql:86-88 fires only on transitions TO 'sold' or basis_drawn/sold_at changes) and passes for ANY card user under cards_own RLS (20260724000000:38-40); grep of all 34 migrations shows the trigger is never redefined and is BEFORE UPDATE only (:98), so createCard INSERTs with status='sold' bypass it too. The reset card re-enters NAV (portfolio/page.tsx:28,49 filter `.not(\"status\",\"in\",\"(archived,sold)\")`) while its card_sales row and pool draw survive, and card_sell (20260733000000:72) only refuses when status='sold', so it re-sells: second pool draw plus second card_sales row — manual sales pass order_ref null (sell/actions.ts:18,48) which escapes the partial unique index (20260733000000:35-37 `where order_ref is not null`). The unsell route's comment (unsell/route.ts:12-13) claiming the trigger blocks a manual status reset is wrong for FROM-sold transitions. (b) Owner picking 'sold' in CardForm (CardForm.tsx:180-182 renders CARD_STATUSES unfiltered, including 'sold' per types.ts:36-38; edit page loads sold cards with no gate) passes the trigger's `not public.is_owner()` exemption (20260713170000:89-90) — card marked sold with no card_sales row, no basis draw, sold_at null. The bulk route guards exactly this (bulk/route.ts:47-49, :91) while the single-card path does not; BulkManager.tsx:177 and CardBrowser.tsx:286 filter 'sold' from their dropdowns, confirming CardForm's unfiltered list is the anomaly."
}
```

---

## 130. verify(corr):Lot sell accepts negative/unva  (phase: Verify, agent aee7f0a3c97a74ee5, 56398 tokens, 88s)

```json
{
  "isReal": true,
  "reason": "Confirmed at every layer. src/app/api/cards/lots/route.ts:131-133 passes p_fees/p_ship_income/p_ship_cost as `Number(body?.fees) || 0` with no sign/finiteness/magnitude check (Number(-50)||0 === -50), and fees/shipIncome/shipCost are documented API params (line 11). card_lot_sell validates only p_sale_price (supabase/migrations/20260720140000_card_lots.sql:81) and pro-rates raw fees into each child (lines 100-110). The current card_sell (supabase/migrations/20260733000000_card_sales_tenancy.sql:73-75,95) also checks only p_sale_price and computes v_net = price - fees + ship_income - ship_cost, so fees=-50 silently inflates net_proceeds/profit_loss in every child card_sales row; books/post (src/app/api/cards/books/post/route.ts:44) rebuilds journal_entries from those rows and journal.ts:44-72 derives cash/fee lines from them, propagating the corruption to Zoho. The single-card path was fixed for exactly this class (src/app/cards/[id]/sell/actions.ts:28-39 clamps all four inputs to finite [0,10M], comment: \"a negative fee would inflate net proceeds and corrupt P/L\") while the lot route was left unguarded. One narrowing caveat: the current lots UI (src/components/cards/LotsManager.tsx:140) sends only salePrice — no fees field — so the negative must come via direct API call rather than a typo in a form; the API-level silent-corruption trace still holds for any authenticated card-access member. The Infinity/salePrice side note also verifies (serializes to null, RPC rejects — noisy but safe)."
}
```

---

## 131. verify(impa):Lot sell accepts negative/unva  (phase: Verify, agent aafba37edb102ea9d, 66724 tokens, 178s)

```json
{
  "isReal": true,
  "reason": "Confirmed at every layer by reading the code. Route: src/app/api/cards/lots/route.ts:131-133 passes `p_fees: Number(body?.fees) || 0` (and both ship fields) with no sign/finiteness/magnitude check — -50 flows through. RPC: supabase/migrations/20260720140000_card_lots.sql:81 validates only p_sale_price ('if p_sale_price is null or p_sale_price < 0 then raise exception'), then splits raw fees pro-rata into each child (lines 101-110) and calls card_sell; no later migration redefines card_lot_sell. Latest card_sell (20260733000000_card_sales_tenancy.sql:73-75) also checks only sale price and computes `v_net := coalesce(p_sale_price,0) - coalesce(p_fees,0) + ...` — a negative fee silently inflates net and profit_loss on every child card_sales row; the table has no CHECK (20260713150000_cardops_init.sql:267, `fees numeric(12,2)` bare). Downstream, src/app/api/cards/books/post/route.ts:44-78 rebuilds journal_entries from card_sales.fees, so the wrong number lands in the ledger and the Zoho push; its only guard is debit/credit balance, which a wrong-but-consistent fee still satisfies. The claimed precedent is real: src/app/cards/[id]/sell/actions.ts:28-39 contains the exact comment ('the RPC only checks sale_price; a negative fee would inflate net proceeds and corrupt P/L') and clamps all four money inputs to finite [0, 10M] — the lot route lacks the parallel guard. Caveat: the shipped lot UI (LotsManager.tsx:140) sends only salePrice, so the trigger today is a direct call to the authenticated endpoint using its own documented contract (route.ts:11 advertises fees/shipIncome/shipCost), not a UI typo; but the route is the same trust boundary the day-review fix guarded on the single-card path, and the corruption is silent end-to-end (route accepts, RPC accepts, table accepts, books post propagates). The Infinity side-note also verifies: supabase-js serializes Infinity to null, RPC raises 'sale price required' — noisy but safe."
}
```

---

## 132. verify(repr):Lot sell accepts negative/unva  (phase: Verify, agent ab36ebe0e9ce3acfb, 61742 tokens, 113s)

```json
{
  "isReal": true,
  "reason": "Confirmed by full trace. src/app/api/cards/lots/route.ts:131-133 passes p_fees/p_ship_income/p_ship_cost as `Number(body?.fees) || 0` with only `salePrice > 0` checked (line 126) — Number(-50)||0 = -50 passes. card_lot_sell (20260720140000_card_lots.sql:81) validates only p_sale_price and allocates raw fees pro-rata (lines 101-110); the live card_sell (20260733000000_card_sales_tenancy.sql:73-75, lexically last definition) also validates only sale price and computes v_net = price - fees + shipIn - shipCost, so fees=-50 on a $100 sale yields net 150 vs true 50 ($100 inflation), with wrong profit_loss persisted per child (lines 90-95). card_sales.fees has no check constraint (cardops_init.sql:267). Books rebuild (books/post/route.ts:42-51 + src/lib/books/journal.ts:44-46) folds the corrupt fees into journal_entries and onward to Zoho. The single-card guard exists verbatim at src/app/cards/[id]/sell/actions.ts:28-39 (finite [0,10M] clamp on all four money inputs); the lot route lacks it. One narrowing caveat: the shipped lot UI (LotsManager.tsx:140) sends only salePrice — no fees field — so the trigger is a direct authenticated API POST (the route's line-11 comment advertises fees?/shipIncome?/shipCost?), not a UI typo today. The Infinity side-note also verifies: JSON 1e999 → Infinity passes the >0 check, serializes to null, RPC raises 'sale price required' — noisy but safe."
}
```

---

## 133. verify(corr):eBay sync cancelled-order idem  (phase: Verify, agent a4764fbbf85ee9589, 58974 tokens, 136s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. sync/route.ts:50 reads the guard with no .range()/.order()/user filter — `const { data: cancelledRows, error: cancelledErr } = await db.from(\"ebay_cancelled_orders\").select(\"order_ref\")` — so PostgREST's 1000-row cap (documented in src/lib/supabase/page.ts:3-11, which mandates readAll for idempotency guards) silently truncates it, and with no ORDER BY the newest markers — the only ones inside eBay's consistency window — are the likeliest to be dropped. The failure traces end-to-end: card_unsell (20260720120000_card_unsell.sql:66,72) deletes the card_sales row and resets status to 'booked', removing both the unique (platform,order_ref) backstop and the status skip; card_sell (20260733000000_card_sales_tenancy.sql:72) only rejects status='sold', so the refunded order re-books with a fresh pool draw. The migration's own comment (lines 85-90) names the harm: \"double pool draw + phantom revenue on a refunded order.\" Nothing prunes the table (only 3 repo references: create, upsert, read) and it is shared with Master-Ops, so it grows monotonically past 1000. Minor wording correction only: since the original settlement was already reversed, the re-settle books phantom revenue once (a refunded order recorded as a real sale + pool draw), not a second concurrent entry."
}
```

---

## 134. verify(impa):eBay sync cancelled-order idem  (phase: Verify, agent a69efada1ea9703d9, 61081 tokens, 146s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. src/app/api/ebay/sync/route.ts:50 reads ebay_cancelled_orders with no .range()/.order()/readAll — PostgREST silently caps it at 1000 rows (a 200, so the line-51 error check never fires). This Set is the ONLY durable re-settle guard after a seller-cancel: card_unsell (20260720120000_card_unsell.sql:66,72) DELETES the card_sales row — so the unique (platform, order_ref) index has nothing to conflict with — and resets the card to status='booked', so both the sync's status skip (line 135) and card_sell's only guard (\"if v_card.status = 'sold'\", 20260733000000:72) pass; listing_refs are untouched so the card still matches (sync:91-92). eBay's cancelState check (sync:84) only protects after the feed catches up — the migration comment (20260720120000:85-90) documents the PAID-for-a-while window and names the exact outcome: \"double pool draw + phantom revenue on a refunded order.\" The table is append-only with no pruning path anywhere in the repo, and an unordered scan of an append-only heap returns oldest tuples first, so past 1000 rows the NEWEST markers — the only ones inside the race window — are exactly the rows truncated away; the next cron or owner-button sync re-books the refunded sale via card_sell (fresh revenue row + second pool draw). This is a new instance of the audit class page.ts:10-11 mandates readAll for (\"membership Set, idempotency guard\"), in the same function whose sibling cards read is carefully paged to 20k (sync:35-45). One correction: the \"no user filter on the cron path\" sub-claim is moot — the table has no user_id column (20260720120000:91-94), so filtering is impossible and there is no cross-user angle; the defect is solely the unpaged, unordered guard read."
}
```

---

## 135. verify(repr):eBay sync cancelled-order idem  (phase: Verify, agent ad62962e96dd0c496, 54614 tokens, 98s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the full path. sync/route.ts:50 reads ebay_cancelled_orders with no .range()/.order()/.limit() — PostgREST caps it at 1000 rows (the exact class page.ts:3-11 documents, explicitly naming idempotency guards as requiring readAll), and the adjacent cards read at lines 35-46 IS paged, showing the cap applies here. The table only ever grows: sole writes are the upsert at cancel-order/route.ts:45-46 plus the CREATE; no prune anywhere in the repo. Decisively, both DB-level fallback guards the sync header (route.ts:13-16) relies on are neutralized for a cancelled order: card_unsell (called by cancel-order:59) DELETEs the card_sales row (card_unsell.sql:66), so the unique (platform, order_ref) index has nothing to collide with, and resets the card to status='booked' with listing_refs intact (card_unsell.sql:71-73), so it re-enters the match set and passes the status!=='sold' check at route.ts:135. During eBay's documented consistency lag (card_unsell.sql:86-90) line 84's cancelState check also passes, so a truncated Set at line 85 lets card_sell at line 136 re-book the refunded sale — phantom revenue plus a second pool draw, the precise harm card_unsell.sql:88-89 says the table exists to prevent, with no error signal (line 51 catches read errors, not truncation). One minor correction: the \"no user filter on the cron path\" sub-claim is moot because the table has no user_id column (card_unsell.sql:91-94) — but that does not weaken the core defect. Reachability requires 1000+ accumulated cancellations, which unbounded growth with zero pruning eventually delivers."
}
```

---

## 136. verify(corr):eBay sync lot match-set read c  (phase: Verify, agent a27074e08c70c4e99, 53782 tokens, 71s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/api/ebay/sync/route.ts:64-66 issues `db.from(\"card_lots\").select(\"id, sku, status, listing_refs\").not(\"listing_refs\",\"eq\",\"{}\")` with no .range(), no .order(), and no paging loop, while the cards match-set in the same function (lines 35-46) is explicitly paged with the comment \"a fixed .limit could silently drop listed cards.\" src/lib/supabase/page.ts:3-11 documents the 1000-row PostgREST cap as fact for this deployment and mandates readAll for membership sets. The lot set grows without bound: on sale the sync writes refs.ebay.status=\"sold\" into listing_refs (lines 127-130) but never clears it, so every historically listed lot matches the filter forever, and with no .order() even a currently-listed lot can be among the dropped rows. No rescue via card maps: list-lot/route.ts:131 sets listing_refs only on card_lots, never on child cards, so a lot order line can only match the lot maps. When the lot is absent, line 96 `if (!card && !lot) continue;` drops the PAID line without incrementing skipped, without a failures entry, and the cron audit insert (lines 208-214) fires only when settled/failures are nonzero — the sale is never settled through card_lot_sell, no card_sales rows are written, the lot stays 'listed', and nothing surfaces. Exact new instance of the audited 1000-row membership-set class."
}
```

---

## 137. verify(corr):addComp: insert errors swallow  (phase: Verify, agent afac466696b8f0a34, 66493 tokens, 130s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. (1) Swallowed insert: src/app/cards/[id]/value/actions.ts:81-89 discards the supabase insert result (supabase-js returns {error}, never throws), then recompute() + revalidatePath run regardless — the action reports success. Reachable failures: grade numeric(4,1) overflow from the unbounded UI grade input (page.tsx:242; typing 1000 exceeds 999.9), malformed sale_date against the `date` column (schema: 20260713150000_cardops_init.sql:226; str() at actions.ts:88 does no shape check, vs the importer's regex at comps/import/route.ts:103), and RLS with-check owns_card — all silently drop the comp. (2) Negative price: num() (actions.ts:17-21) accepts negatives, form input has no min, column has no CHECK (card_sell RPC validates p_sale_price<0 but addComp doesn't). -120 inserts and computeMarketValue with pipeline min/last_sale (valuation.ts:225,228) or legacy conservative (min*1.05, valuation.ts:67) persists a negative market_value (actions.ts:55), which feeds the NAV snapshot sum (daemon/route.ts:192 `manual_price ?? market_value`) and the insurance CSV `_market` (export.ts:74-77). One caveat: the eBay list default is guarded — list/route.ts:76-77 rejects fixed-format prices ≤0 with a 400, so a negative value cannot become a live listing price; that sub-claim is overstated, but the silent-loss and poisoned-NAV/export failures fully trace."
}
```

---

## 138. verify(corr):Comps importer trusts model-em  (phase: Verify, agent aa183319ed4073a9e, 49693 tokens, 48s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code: route.ts:103 gates sale_date only with /^\\d{4}-\\d{2}-\\d{2}$/ (Zod schema line 26 is bare z.string(), so structured output enforces nothing beyond \"string\"), and card_comps.sale_date is a Postgres `date` column (supabase/migrations/20260713150000_cardops_init.sql:226), which rejects shape-valid-but-impossible dates like 2026-06-31 with a cast error. Lines 118-120 insert all rows in one atomic INSERT, so one bad date fails the entire batch and returns 500 with the raw Postgres message; recomputeCard never runs and zero comps land. The repo's own src/lib/books/date.ts:1-5 documents this exact trap as observed vision/model behavior, and coerceDate is used by the sibling receipt routes (receipts/scan/route.ts:85, receipts/route.ts:68) but not here — a missed instance of the codebase's own convention. Low severity is right: trigger requires the model to mis-resolve a date (prompt line 33 explicitly asks it to compute relative dates), but the failure is total import loss with an opaque error."
}
```

---

## 139. verify(corr):Receipts POST: sub-cent amount  (phase: Verify, agent ac8eb30c5510cd0b9, 55636 tokens, 96s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing every step. route.ts:53 `if (!(amount > 0))` passes 0.004; the insert succeeds because supabase/migrations/20260721010000_card_receipts.sql:11 declares `amount numeric(12,2) not null` with no positive CHECK, so Postgres rounds 0.004 to 0.00 instead of rejecting it. journal.ts:129-130 `round2(0.004)`=0 → `if (amt <= 0) return []`, so jrows is empty and route.ts:97 `if (jrows.length)` skips the journal insert, the rollback delete, and the posted:true update; line 108 returns `{ ok: true, posted: false }`. Grep confirms card_receipts is only written by this route — no re-post path exists (matching the comment at lines 100-102). Reachable from the real UI: ReceiptsManager.tsx:121 is a free-text input allowing \"0.004\" and line 52 sets amount straight from the OCR scan response, with the same `> 0` client gate. Result: a permanent posted=false receipt with no double-entry under a success response — the exact orphan the rollback exists to prevent. Minor overstatement only: the stored amount is $0.00, so ledger dollar totals don't actually diverge; the defect is the invariant-violating phantom receipt, consistent with the [low] severity."
}
```

---

## 140. verify(corr):CPA sales CSV pages on non-uni  (phase: Verify, agent a2b808442efb44853, 60044 tokens, 114s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/api/cards/reports/route.ts:31-42 hand-rolls a pagination loop (it does not use readAll) with `.order(\"sold_at\", { ascending: true }).range(from, from + PAGE - 1)` — sold_at is the sole sort key, no tiebreaker. sold_at is non-unique: supabase/migrations/20260713150000_cardops_init.sql:270 defines it as `sold_at timestamptz not null default now()` with no unique constraint. Ties are not hypothetical — they are guaranteed by the lot path: card_lot_sell (supabase/migrations/20260720140000_card_lots.sql:98-119) calls public.card_sell for every child card inside one plpgsql function, i.e. one transaction, and Postgres now() is transaction-fixed, so every card in a multi-card lot sale gets a byte-identical sold_at. Each .range() page is a separate PostgREST request, and Postgres gives no consistent ordering among equal keys across executions (page 1 uses top-N heapsort, later offsets sort more rows; card_sales tuples are also mutated between requests — books/post flips synced_to_books, card_unsell deletes sale rows — reordering the heap). So a tie run straddling the 1000-row boundary can emit a sale twice or drop it silently in the CPA CSV. The >1000-rows-per-year precondition is within the app's own expectations — the route's comment (lines 26-27) says it pages precisely because a big year exceeds 1000 rows. The contrast also holds: the journal export (src/app/api/cards/books/journal/route.ts:38-40) orders by entry_date, source_ref, line, and books/post (route.ts:47) pages on unique id — this route alone lacks the deterministic tiebreaker required by src/lib/supabase/page.ts:14-15. Severity [low] is fair (needs a tie exactly at a page boundary in a >1000-sale year), but the failure traces end to end. Fix is trivial: add .order(\"id\") (or order_ref) as a secondary key, or use readAll."
}
```

---

## 141. verify(corr):card-alerts cron pages card_al  (phase: Verify, agent a668c9ef58bb73259, 48704 tokens, 60s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/api/cron/card-alerts/route.ts: all three reads page via .range() with no .order() — targetAlerts (lines 109-114: .eq(\"kind\",\"target\").eq(\"cards.user_id\",uid).range(from,to)), pctAlerts (lines 150-155), and the moversDigest cards read (lines 220-222). The file uses a local clone of readAll (lines 47-60) that issues one independent SQL statement per 1000-row page and continues while batch.length === PAGE, so with >1000 rows Postgres's unspecified per-statement ordering (no ORDER BY is emitted by PostgREST without .order()) lets pages overlap or omit rows. Traced failure: an armed alert row omitted between pages is never evaluated — its crossing is silently never notified (or a double-visited row re-fires/re-arms via the updates at lines 129/132/181/184); for moversDigest, >1000 live cards (plausible for a card inventory) means an omitted card is silently dropped from the digest (filtered at line 240 when absent from the meta Map). This directly violates the documented contract in src/lib/supabase/page.ts:14-15 and 24-26. No refutation held: PostgREST adds no default order, and readAll fetches all pages before any updates run, so the nondeterminism is purely cross-statement but real."
}
```

---

## 142. verify(corr):Card create/edit accepts negat  (phase: Verify, agent a523f7fc8dcc77c7f, 63783 tokens, 86s)

```json
{
  "isReal": true,
  "reason": "Confirmed end-to-end. num() (src/app/cards/actions.ts:53-57) only checks Number.isFinite, so \"-450\" passes into individual_basis/market_value/manual_price on create (:121) and update (:138); importCards :208 likewise. CardForm.tsx:140 has type=\"number\" step=\"0.01\" with no min, and the DB column is bare numeric(12,2) with no CHECK or trigger (cardops_init.sql:172). With use_pool_basis=false, card_sell (20260733000000_card_sales_tenancy.sql:87-90) computes v_basis := coalesce(v_card.individual_basis, 0) = -450 and v_pl := v_net - v_basis = v_net + 450, persisting profit overstated by $900 into card_sales.profit_loss and cards.basis_drawn. The asymmetry is real: the sell action clamps its own inputs to [0, 10M] (src/app/cards/[id]/sell/actions.ts:30-39, comment: \"a negative fee would inflate net proceeds and corrupt P/L\") while the basis feeding the same equation is unvalidated. Daemon NAV snapshots also sum these fields raw (src/app/api/cards/daemon/route.ts:192-196). Severity [low] is fair (operator typo required; reversible via card_unsell if noticed)."
}
```

---

## 143. verify(corr):Sales & P&L headline totals su  (phase: Verify, agent aa1fbc68dab522c66, 47987 tokens, 59s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by reading the code. src/app/cards/sales/page.tsx:17-21 reads card_sales with a plain .order(\"sold_at\", desc).limit(1000) and discards the query error (`const { data }`); lines 23-30 reduce net_proceeds/basis_drawn/profit_loss over exactly those capped rows; lines 44-46 render them as unqualified lifetime \"Sales\"/\"Basis drawn\"/\"Profit / loss\" headline stats with no truncation signal. src/lib/supabase/page.ts:10-12 states the house rule verbatim (\"if a read feeds a SUM ... use readAll; a read that only fills a 'most recent N' list can keep a plain .limit()\") — here the same rows feed both the list and the sums, so the exemption doesn't apply. The sibling reports route (src/app/api/cards/reports/route.ts:29-37) pages card_sales completely before summing, proving this page is an outlier, not a design choice. Growth past 1000 rows is automatic: src/app/api/ebay/sync/route.ts:12-19 settles each paid eBay order into card_sales via owner button and daily cron. Not prior-audit territory: reference/audit-2026-07-24.md has zero mentions of card_sales or the sales page. Secondary defect also real: on a transient PostgREST error, data=null → sales=[] → page renders $0.00 totals and \"No sales yet.\" as fact."
}
```

---

## 144. verify(impa):Sales & P&L headline totals su  (phase: Verify, agent a629f50fd245f4e89, 49256 tokens, 80s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. src/app/cards/sales/page.tsx:17-21 reads card_sales with .order(\"sold_at\", desc).limit(1000) and destructures only { data }; lines 23-30 reduce net_proceeds/basis_drawn/profit_loss over exactly those rows; lines 44-46 render them as the \"Sales\", \"Basis drawn\", \"Profit / loss\" headline stats with no truncation signal. Growth past 1000 rows is by design: src/app/api/ebay/sync/route.ts (lines 12-19) auto-settles paid eBay orders into card_sales via owner button and daily cron. The codebase's own convention proves the defect: the sibling reports page (src/app/cards/reports/page.tsx:77-80) pages the SAME table for the SAME sums via pageAll/.range(), and src/lib/supabase/page.ts:10-12 states any read feeding a SUM must use readAll — plain .limit() is only for lists. Once the account crosses 1,000 sales, the oldest sales silently drop out of the lifetime P/L headline, which renders as complete fact (wrong money). Secondary defect also verified: line 17 drops the query error, so a transient failure renders $0.00 totals and \"No sales yet.\" (line 50) as fact. This is a new instance of the audited 1000-row-cap class that the house rules explicitly require reporting."
}
```

---

## 145. verify(repr):Sales & P&L headline totals su  (phase: Verify, agent a418828bc902db2bd, 48368 tokens, 70s)

```json
{
  "isReal": true,
  "reason": "Confirmed by direct read. src/app/cards/sales/page.tsx:17-21 fetches card_sales with .order(\"sold_at\", desc).limit(1000) and discards the error; lines 23-30 reduce net_proceeds/basis_drawn/profit_loss over exactly those rows; lines 43-47 render the sums as unqualified headline stats (\"Sales · N\", \"Basis drawn\", \"Profit / loss\"). Once the table exceeds 1000 rows — inevitable, since src/app/api/ebay/sync/route.ts:12-16 documents the daily cron settling each paid eBay order into card_sales — every older sale silently vanishes from all three dollar figures with no truncation signal. This violates the repo's own documented rule (src/lib/supabase/page.ts:10-12: reads feeding a SUM must use readAll; plain .limit() is for lists only), and the sibling reports page proves the correct pattern by reading the same table via pageAll with .range() (src/app/cards/reports/page.tsx:77-80). Secondary defect also confirmed: line 17 destructures only { data }, so a transient PostgREST error renders $0.00 totals and \"No sales yet.\" (line 50) as fact."
}
```

---

## 146. verify(corr):Reports page pageAll silently  (phase: Verify, agent a57a3c674aa238600, 52295 tokens, 44s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/cards/reports/page.tsx. Line 36 `const { data } = await make(from, from + PAGE - 1);` discards the Supabase `error` (no .throwOnError(), so failures resolve as { data: null, error }), and line 38 `if (!data || data.length < PAGE) break;` treats an errored page identically to end-of-table, returning partial rows. Those rows feed every sum on the owner-only money view — yearly Sales/Net proceeds/Basis drawn/P&L (lines 149-155), Monthly/ByCategory (188, 193-194), Velocity, and Inventory value (125, 137) — with zero error handling or banner anywhere in the file; a first-page sales error renders \"No settled sales yet\" (line 142) and a first-page open-cards error renders $0 inventory. The mandated readAllSafe helper (src/lib/supabase/page.ts:31-57) exists precisely to prevent this, and the cited books-page precedent is accurate: src/app/cards/books/page.tsx uses readAllSafe (lines 65, 72), computes totalsPartial (line 84), and shows an incomplete-totals banner (lines 173-176). Reports never received that treatment — a new instance of the audit's silent-truncation defect class."
}
```

---

## 147. verify(corr):Reports sales pagination order  (phase: Verify, agent a2555d5180a75697f, 64236 tokens, 100s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. src/app/cards/reports/page.tsx:78-80 pages card_sales via a local pageAll (lines 33-41, offset .range in 1000-row steps, one HTTP request per page) ordered only by .order(\"sold_at\", {ascending:false}) — no tiebreaker. sold_at is `timestamptz not null default now()` with no unique constraint (supabase/migrations/20260713150000_cardops_init.sql:270), and ties are GUARANTEED, not just probable: card_lot_sell (supabase/migrations/20260720140000_card_lots.sql:98-119) calls card_sell per child inside one transaction, and every card_sell variant inserts card_sales without sold_at (e.g. 20260733000000_card_sales_tenancy.sql:93-95), so all N children of a lot get the identical transaction-start now(). With >1000 settled sales and a lot's tie block straddling a page boundary, Postgres guarantees no stable order within equal sort keys across separate executions, so a sale row can appear on both pages (double-counted) or neither (dropped); the rows feed sum(profit_loss/sale_price/net_proceeds/basis_drawn) in the yearly P/L cards (page.tsx:146-155) and monthly/category tables. The same file orders its cards read by unique id (line 83), and movers (src/app/api/cards/movers/route.ts:48-49) adds the id tiebreaker with a comment explaining this exact hazard; src/lib/supabase/page.ts:14-15 states the rule this read violates. Minor caveat: the claim's part (b) (concurrent-insert offset shift) would not be fully fixed by a tiebreaker alone, but part (a) independently clears the bar."
}
```

---

## 148. verify(corr):CPA CSV export pages card_sale  (phase: Verify, agent a8a4782dc601e3a13, 61021 tokens, 100s)

```json
{
  "isReal": true,
  "reason": "Confirmed. src/app/api/cards/reports/route.ts:31-42 pages card_sales with only .order(\"sold_at\", {ascending:true}) + .range(from, from+999) — no unique tiebreaker. Ties are guaranteed, not hypothetical: card_sales.sold_at is `timestamptz not null default now()` (supabase/migrations/20260713150000_cardops_init.sql:270), the current card_sell insert omits sold_at so the default applies (20260733000000_card_sales_tenancy.sql:93-95), and card_lot_sell loops card_sell for every lot card inside one plpgsql function/transaction (20260720140000_card_lots.sql:98-119), so all children of a lot get byte-identical transaction-start now(). Each page is a separate HTTP request/query execution and Postgres guarantees no intra-tie order across executions, so a tie group straddling the 1000-row boundary can duplicate or drop a sale row — the exact class the codebase's own helper warns about (src/lib/supabase/page.ts:14-15: \"Pagination needs a DETERMINISTIC order or rows can repeat/vanish between pages\"). The route's own comment (lines 26-27) confirms >1000-sale years are the anticipated regime. The audit-hardened sibling journal export chains entry_date→source_ref→line (src/app/api/cards/books/journal/route.ts:38-40); this route was not given a tiebreaker. Output is a filed CPA document delivered as HTTP 200 well-formed CSV with no error signal — a duplicated/omitted row silently misstates taxable income."
}
```

---

## 149. verify(corr):Books page intercompany and po  (phase: Verify, agent aec66910a7ab6ddcf, 50620 tokens, 44s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/cards/books/page.tsx and src/lib/supabase/page.ts. Line 84 sets totalsPartial = !!(cardsPage.error || salesPage.error) only. Line 130 destructures only { rows: intercoRows } from readAllSafe, which on any read error returns { rows: [], error: msg } (page.ts:55) — so intercoAdvance/intercoPayable stay at blank()'s 0, the Intercompany strip (line 269 gate: Math.abs > 0.005) vanishes, entities with only intercompany activity are dropped by the line 144 filter, and no banner fires. Line 62-64's card_pool read discards its error ({ data: pools }); supabase-js resolves { data: null, error } without throwing, so pools ?? [] at line 95 iterates nothing and invBasisPooled is 0 everywhere, understating totalAssetBasis (line 147), the consolidated \"Inventory · at cost\" tile (line 192), and each entity's basis/unrealized (lines 232-233) — all rendered without the totalsPartial warning. Both failure paths trace through the real code with no other error handling in between."
}
```

---

## 150. verify(corr):Portfolio page live-total loop  (phase: Verify, agent afabd15dd5d963b51, 50499 tokens, 70s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/cards/portfolio/page.tsx. Line 47 destructures only { data: v } from the supabase query (no error, no .throwOnError(); server.ts creates a plain createServerClient, and the codebase's own PageResult type in src/lib/supabase/page.ts:19 confirms errors arrive as { data: null, error } without throwing). Line 54 `if (!v || v.length < 1000) break;` treats error-null as end-of-data, so a first-page failure exits with marketValue=0/individualBasis=0 and a later-page failure exits with a silent partial sum. Lines 62-66 then push/overwrite today's chart point with value 0, line 106 renders \"Market value $0.00\", line 70+108 render Return −100% in red whenever pool cost > 0, and lines 128-135 draw the chart plunging to zero at the newest point — with no error UI anywhere in the component. The same file imports readAllSafe (line 3) and uses it for the movers read (line 25) on the same screen, so the safe pager exists in scope but is not used for the money total. Only caveat: if pool cost is also 0, Return shows \"—\" instead of −100%; the $0 headline and chart plunge occur regardless."
}
```

---

## 151. verify(corr):Cards index portfolio banner l  (phase: Verify, agent a9749620eba692af9, 57241 tokens, 80s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading src/app/cards/page.tsx. Line 119 destructures only { data: vrows } (error discarded; supabase-js returns { data: null, error } without throwing since no .throwOnError() is used), and line 129 `if (!vrows || vrows.length < 1000) break;` treats an error page as a legitimate final short page. A first-page error yields marketValue=0/individualBasis=0 while line 131 keeps costBasis=poolTotal, so line 132 computes returnPct = −100, and the unconditional banner (lines 191-206) renders \"$0\" market value and a red \"−100%\" as fact; a later-page error renders a partial sum the same way. Line 105's pool read also discards its error, zeroing poolTotal/costBasis silently. No other read on the page throws (lines 86-96, 104-108 all swallow errors), so the page always renders. This hand-rolled sum-feeding pager bypasses readAll/readAllSafe, whose contract in src/lib/supabase/page.ts:25-27 is \"Throws on a read error — a partial result must never be mistaken for a complete one\" — a new instance of the audited defect class, distinct from the identical pattern in src/app/cards/portfolio/page.tsx:46-55, and not on the deliberate-leftovers list."
}
```

---

## 152. verify(corr):Portfolio history reads the OL  (phase: Verify, agent a4d93b5c9bb3c38db, 50010 tokens, 58s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. src/app/cards/portfolio/page.tsx:19-20 reads card_portfolio_snapshots with .order(\"snapshot_date\", { ascending: true }).limit(400) — ascending + limit returns the oldest 400 rows, dropping the newest once history exceeds 400 days. The only writer, snapshotUser in src/app/api/cards/daemon/route.ts:203-206, upserts one row per (user_id, snapshot_date) nightly and never prunes; the only deletes on this table are a one-time dedup in migrations/20260731000000_daemon_multitenant.sql, so the per-user count crosses 400 ~13 months after the 2026-07-20 table creation. From then on: points holds days 1-400, the last snapshot's date != today so line 63 appends the live today point, and the chart (index-spaced x-axis, line 82, no date scale) draws days 1-400 then jumps to today with no visual gap — the newest snapshots are silently omitted. chgDays = points.length (line 72) stays pinned at 401 while the real first.date→today span grows, so the \"over N days\" caption (line 139) displays a wrong number forever. No retention job, no documented intent for a 400-day window, and readAllSafe was used for the movers query in the same file — this is an oversight, not a design choice. Low severity (chart display, latent until ~Aug 2027) but real and deterministic."
}
```

---

## 153. verify(corr):Group filter resolves membersh  (phase: Verify, agent a6ecf3482107604c8, 54315 tokens, 66s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/cards/page.tsx:51 — `.from(\"card_group_items\").select(\"card_id\").eq(\"group_id\", groupId).limit(1000)` has no .order() and feeds `.in(\"id\", groupIds)` at line 58 as a membership set. Groups >1000 members are reachable: the add op (src/app/api/cards/groups/route.ts:70) caps at 500 ids per request but upserts cumulatively with no total cap. Not covered by the audit's deliberate leftovers (those are the group_id RLS constraint and the showcase 300-card cap, not this read); the audit's own rule requires readAll for membership sets and permits plain .limit() only for \"most recent N\" display lists. With >1000 members, PostgREST returns an arbitrary unordered 1000-row subset, so real group members silently never match the filter — and combined narrowing filters (group + tag/status/search) make the loss visible well under the browse's 500-row cap. Low severity is correct: RLS user client (own data), and the money aggregates on the page come from a separate paged scan, not the filtered set."
}
```

---

## 154. verify(corr):audit_log inserts use actor va  (phase: Verify, agent ae6521eb4d5876713, 52389 tokens, 72s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. supabase/migrations/20260716040000_todos_calendar.sql:85-88 drop-and-recreates the only actor constraint: `check (actor in ('web','mcp','cron','assistant'))` on public.audit_log — the recreate overwrites any prior widening, and the migration comment says the prior shared-DB set was even narrower ('web','mcp','cron'), so the two values fail under old and new constraints alike. src/app/api/ebay/sync/route.ts:161-165 inserts actor: \"ebay-sync\" for every settled order with the result discarded via .then(() => {}, () => {}) (and supabase-js returns {error} rather than throwing, so it is never seen); this is the only per-order settlement record — the cron summary inserts at lines 202/209 use 'cron' and pass. src/app/api/ebay/account-deletion/route.ts:39-46 inserts actor: \"ebay\" inside try{}catch{}, and line 33's comment stakes eBay compliance on that row (\"the log proves receipt\"). A grep of all migrations shows no other migration touches audit_log_actor_check (later migrations only touch card_pool_adjustments.actor), and a grep of src/ shows every other audit_log insert uses 'web' or 'cron'. So both writes hit a 23514 CHECK violation that is silently swallowed: the per-order settlement audit trail and the account-deletion proof-of-receipt are never written."
}
```

---

## 155. verify(corr):eBay sync match-set paging ord  (phase: Verify, agent a684a82f631be445f, 56777 tokens, 96s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code: src/app/api/ebay/sync/route.ts:41-43 pages the card match set with `.order(\"created_at\", { ascending: false }).range(from, from + 999)` — no unique tiebreaker, and the hand-rolled loop bypasses readAll (it even discards the query error). Ties are real: cards.created_at defaults to now() (supabase/migrations/20260713150000_cardops_init.sql:188) and speed_book_commit (20260713160000_speed_book_rpc.sql:44-70) inserts a whole lot in ONE transaction, so batch cards share a bit-identical created_at; later listing sets listing_refs without touching created_at, so the ties persist into the match set. The codebase's own helper documents the exact hazard being violated (src/lib/supabase/page.ts:14-15: \"Pagination needs a DETERMINISTIC order or rows can repeat/vanish between pages\"). With >1000 listed cards (the loop pages to 20,000, so this state is anticipated), a tie group straddling a page boundary can be reordered between the two separate page queries and a card vanishes from cardRows; it is then absent from both byListingId and bySku (built only from cardRows, lines 54-61), so its PAID order line hits `if (!card && !lot) continue;` at line 96 — no settle, not counted in skipped/failures, no audit row, card still shows listed. Mitigation is only retry luck (getOrders fetches 90 days daily, and a later run's tie order may include the card), so revenue is delayed or, if unlucky past the 90-day order window, silently lost — consistent with the [low] severity."
}
```

---

## 156. verify(corr):Connector mapping-key discover  (phase: Verify, agent ab2dc01aa1cc47570, 48178 tokens, 61s)

```json
{
  "isReal": false,
  "reason": "Refuted. The loop at src/app/api/cards/connectors/route.ts:54-58 pages with .order(\"account\") and collects only the account values themselves into a Set. Under ORDER BY account ASC, rows with equal account values form contiguous blocks whose ordinal positions are fixed (determined by counts of strictly-smaller values); tie instability only permutes rows WITHIN a same-value block. A page boundary inside a block can skip/duplicate a physical row, but every affected position holds the same account value, so the distinct-value set is unchanged. The claimed scenario — a single-use key (block of size 1) vanishing — is impossible: with no ties for its value, its ordinal position is deterministic and exactly one page covers it. Ordering by the collected column is itself the unique-enough tiebreaker for distinct-value discovery; no key can be missed and no entry becomes unpostable."
}
```

---

## 157. verify(corr):Standalone-Supabase debt: tabl  (phase: Verify, agent a75a017b3099a28f0, 46633 tokens, 48s)

```json
{
  "isReal": false,
  "reason": "The claim concedes \"Works today because the DB is shared with Master-Ops (known arrangement)\" — every item is a fresh-standalone-DB hypothetical, not a today failure. This is the documented deliberate design: CLAUDE.md:30-39 (\"One Supabase project, one database, shared with Master-Ops... Some tables CardOps reads (e.g. push_subscriptions) are CREATEd only in Master-Ops migrations; CardOps migrations may only add policies to them\"), and the review scope explicitly excludes \"Tables CREATEd only in Master-Ops migrations — the DB is shared by design; only report schema drift that breaks TODAY.\" Spot-check confirms no today-breakage vector: supabase/migrations/20260716040000_todos_calendar.sql:57 uses \"create table if not exists public.user_settings\", a no-op against the shared DB where the prefs column already exists. No concrete failure scenario traces through the live system."
}
```

---

## 158. verify(corr):Zoho push failures are permane  (phase: Verify, agent a897e8de1d95c9570, 60699 tokens, 96s)

```json
{
  "isReal": true,
  "reason": "Confirmed by direct trace. (1) zoho.ts:62-71 wraps zohoFetch in a catch-all returning {ok:false, attempted:true}, but zohoFetch's first statement (client.ts:51) is `await accessToken()`, which throws at client.ts:37 on refresh failure BEFORE any request to the journals endpoint — violating the attempted-flag contract explicitly documented at types.ts:55-56 (\"'we never sent it' (safe to un-claim and retry)\"). The route (route.ts:127-134) then marks 'uncertain' and keeps the claim; all ~40 batch entries fail identically during a token outage. A 502 HTML body likewise throws at client.ts:66 (res.json()). (2) A crash/timeout between the claim insert (route.ts:104-107) and outcome write strands status 'pending'; maxDuration=60 with 40 sequential Zoho calls makes this reachable. (3) Every later run hits the unique index (migration 20260727000000, card_push_log_uniq) → 23505 → skipped_already_posted (route.ts:108-111) regardless of status. (4) The preview selects only business_id+reference (page.tsx:43-46), so pending/uncertain claims enter alreadyPosted (line 73), are excluded from postable (76-78) and per-biz ready (87), and render the green 'posted' badge (line 178). (5) Repo-wide grep for card_push_log shows the only writers are the push route (delete only for !attempted refusals within the same run) plus migrations — no reconcile, cleanup, or claim-release path exists, and PushToBooks.tsx surfaces only errors[0] transiently. The route's own comment (route.ts:19) says \"a duplicate in real books is worse than a VISIBLE gap,\" but the preview renders the gap invisible as 'posted' — the real books permanently miss an entry while the app asserts it is synced. Only the never-auto-retry quarantine itself is documented as deliberate; the mislabeled attempted flag, status-blind preview, and missing resolution path are not."
}
```

---

## 159. verify(impa):Zoho push failures are permane  (phase: Verify, agent a5b1ea0d919a034cb, 61219 tokens, 120s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading all cited code. (1) zohoFetch calls accessToken() (client.ts:51) before the journals POST (line 52); a token-refresh failure throws with nothing sent, yet pushEntry's catch returns {ok:false, attempted:true} (zoho.ts:68-71), so the route quarantines it as 'uncertain' and keeps the claim (route.ts:127-134) — contradicting the route's own rule that never-sent failures release the claim (route.ts:121-126). A transient Zoho auth outage strands the whole 40-entry batch this way. (2) A crash/timeout between the claim insert (route.ts:104) and the outcome write leaves 'pending' forever; maxDuration=60 with up to 40 sequential Zoho calls plus 1s/2s/4s 429 backoff makes this realistic. (3) Grep proves only the push route and preview page touch card_push_log; the sole delete (route.ts:125) runs only in the same iteration for attempted:false refusals, so no code path anywhere re-opens a pending/uncertain claim; every future run hits 23505 and counts it as skipped_already_posted (route.ts:108-109). (4) The preview selects only business_id+reference (page.tsx:44) — the status column added by migration 20260729000000 is never read — so pending/uncertain claims join alreadyPosted (line 73), are excluded from postable/ready (lines 77, 87), and render a green 'posted' badge (line 178). The only signal is d.errors[0] in ephemeral client state (PushToBooks.tsx:30), which also reads a nonexistent d.failed field, then router.refresh() shows the entry as posted. Not in DO-NOT-REPORT, not in the backlog, not audit territory (audit covered only the 'ready' undercount). Net effect: real books permanently missing an entry while the app asserts it is synced, with no in-app remediation — real money-correctness impact on the one path that writes to real books."
}
```

---

## 160. verify(repr):Zoho push failures are permane  (phase: Verify, agent ae5811b17714b3dc4, 60529 tokens, 114s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED by tracing all links through source. (1) zoho.ts pushEntry (src/lib/cards/connectors/zoho.ts:62-71) returns {ok:false, attempted:true} on ANY throw from zohoFetch, but zohoFetch (src/lib/zoho/client.ts:51) calls accessToken() BEFORE the journals POST and accessToken throws on refresh failure (client.ts:36-37) or non-JSON token response (client.ts:35) — so a pre-send token failure, where nothing reached Zoho, is quarantined as 'uncertain' with the claim kept (route.ts:127-133). (2) A crash/timeout (maxDuration=60) between the claim insert (route.ts:104-107) and the outcome write strands status='pending'; grep confirms only the route, the preview page, and two migrations touch card_push_log — no reaper/resolve/retry path exists, and the only delete (route.ts:125-126) runs solely in the attempted:false branch. (3) card_push_log_uniq is a FULL unique index on (business_id, provider, reference) with no status predicate (migrations/20260727000000:15-16), so every future push hits 23505 and counts the stranded entry as skipped_already_posted (route.ts:108-109). (4) The preview selects only business_id+reference (push-preview/page.tsx:43-46), never status; pending/uncertain rows join alreadyPosted (line 73), are excluded from ready (76-78, 87), counted as \"already posted\" (line 124), and rendered with the green 'posted' badge (line 178). The client (PushToBooks.tsx:26-30) never reads d.uncertain and shows only errors[0] transiently before router.refresh() re-renders the entry as posted. Net effect exactly as claimed: an entry never confirmed in Zoho Books is permanently displayed as synced with no in-app way to see or fix it — directly contradicting the migration's own stated intent (\"a missing one you can see and fix\", 20260729000000:8-9). Not on the do-not-report list."
}
```

---

## 161. verify(corr):eBay list/list-lot: DB persist  (phase: Verify, agent a9fc404ab58438ccc, 68179 tokens, 106s)

```json
{
  "isReal": true,
  "reason": "Confirmed by direct read. list/route.ts:262-264 and :171-173, and list-lot/route.ts:131, all execute `await supabase.from(...).update({ listing_refs, status: 'listed', ... })` after the eBay publish succeeds, discard the {error} result, and return ok:true unconditionally (lines 276/184/138). If that one write fails transiently, the card keeps listing_refs = '{}' (column is `jsonb not null default '{}'::jsonb`, migration 20260713150000_cardops_init.sql:185). Consequence (a) traces: sync/route.ts:36-39 builds the match set with .not(\"listing_refs\",\"eq\",\"{}\"), so the card is absent from both byListingId AND the bySku fallback; the PAID order line hits `if (!card && !lot) continue;` at sync/route.ts:96 with no failure recorded, and hub/route.ts:120 counts unsettled only for orders with o.cardId, which resolves via the same filtered match set (hub:52) — the missed revenue is invisible. Consequence (b) traces: the already-listed guard (list:59-62) needs listing_refs.ebay.listing_id, which is absent, and the card UI (cards/[id]/page.tsx:273) shows it unlisted; a retry on the auction path calls addAuctionItem → Trading AddItem (trading.ts:80) which has no idempotency key and mints a new ItemID every call → two live auctions for one card, both sellable. The relist contrast is real: relist/route.ts:64-69 checks the same write via .select(\"id\") and returns a 409 instructing manual cleanup. Only wording nit: listing_refs can never be NULL (not-null column) — it stays exactly '{}', which is precisely the value the filters exclude, so the trace holds."
}
```

---

## 162. verify(impa):eBay list/list-lot: DB persist  (phase: Verify, agent aeac8ff2ae0ae6a9d, 66393 tokens, 96s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. list/route.ts:262-264 (and auction path 171-173) and list-lot/route.ts:131 discard the supabase update result after the eBay publish succeeds — `await supabase.from(\"cards\").update({ listing_refs: refs, status: \"listed\", ... }).eq(\"id\", card.id);` with no {error} check — then return { ok: true } (lines 276/184/138). On a transient DB failure the listing is live on eBay but listing_refs stays NULL/{}. Downstream: sync/route.ts:36-39 filters the match set with .not(\"listing_refs\",\"eq\",\"{}\") (excludes NULL and {}), so the card is in neither byListingId nor bySku, and the PAID order is silently dropped at sync/route.ts:96 (`if (!card && !lot) continue;`) with no failures entry — the sale never books into card_sales/P&L and the card never flips to sold. hub/route.ts:120 counts `unsettled` only for orders with a matched cardId (its match set at 49-53 uses the same filter), so the stat reads zero. On retry, the Already-listed guard at list/route.ts:59-62 reads the unchanged DB row and passes; the auction path calls Trading AddItem (trading.ts:80) which mints a new ItemID every call with no SKU dedup — two live auctions for one card. relist/route.ts:64-69 guards the identical write with .select(\"id\") + 409, proving list/list-lot omitted an established in-repo safeguard. No backfill/repair route exists under src/app/api/ebay. Only caveat: \"invisible everywhere\" is mildly overstated — the raw PAID order still appears in the hub's recentOrders/awaitingShipment lists — but it is never flagged unsettled, never settles, and the books silently lose the sale."
}
```

---

## 163. verify(repr):eBay list/list-lot: DB persist  (phase: Verify, agent a1e4cabad97d3c0cd, 67529 tokens, 93s)

```json
{
  "isReal": true,
  "reason": "Confirmed by tracing the full scenario through source. (1) list/route.ts:262-264 (fixed) and 171-173 (auction), and list-lot/route.ts:131: `await supabase.from(\"cards\").update({ listing_refs: refs, status: \"listed\", ... }).eq(\"id\", card.id)` — result never destructured, no error check; routes unconditionally return `{ ok: true, url, listingId }` (lines 276/184/138). supabase-js resolves PostgREST failures as {error} without throwing, so a failed persist still yields ok:true while the listing is live on eBay. (2) sync/route.ts:36-39 filters the match set with `.not(\"listing_refs\",\"eq\",\"{}\")` — excludes both {} and NULL, and the bySku fallback (lines 54-61) is built only from those filtered rows, so the orphaned card is in neither map; the PAID order hits `continue` at line 96 with nothing added to failures. (3) hub/route.ts:49-53 uses the same filter for matchCard; line 120 `unsettled: recentOrders.filter((o) => !o.settled && o.cardId)` requires a match, so the missed order counts nowhere. (4) The 'Already listed' guard (list/route.ts:59-62) reads the empty listing_refs, permitting a retry; trading.ts:80 shows addAuctionItem issues Trading AddItem, minting a new ItemID each call — two live auctions for one card. Grep of all 14 listing_refs call sites shows no reconciliation/backfill path. (5) relist/route.ts:64-69 guards the identical write with .select(\"id\") + 409, confirming list/list-lot omitted a known-necessary check."
}
```

---

## 164. verify(corr):Receipt DELETE swallows both d  (phase: Verify, agent a6fec510157dfc92b, 58713 tokens, 83s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. src/app/api/cards/receipts/route.ts:121-123 runs two non-transactional deletes (journal_entries then card_receipts), discards {error} from both, and unconditionally returns {ok:true} — so a journal-delete failure with a successful receipt delete leaves orphaned balanced entries. Nothing reconciles them: the rebuild at src/app/api/cards/books/post/route.ts:82 only deletes/rebuilds source='card_sale', and grep shows source='receipt' rows are written only at receipts/route.ts:94 and deleted only at :121; journal_entries.source_ref is plain text with no FK (supabase/migrations/20260720290000_journal.sql:12), so no cascade. The orphan is push-eligible: buildPushEntries (src/lib/cards/connectors/ledger.ts:52-106) groups by (entity, source, source_ref) with no source filter or card_receipts existence check, receiptEntries produces per-entity balanced lines numbered 0..n-1, so the orphan passes the balanced/complete/mapped filter at src/app/api/cards/connectors/push/route.ts:92-94 and posts a deleted purchase to real Zoho books as CARDOPS-receipt-<id>. The inverse order leaves a posted=true receipt with no ledger backing. Contrast with POST's explicit rollback (receipts/route.ts:99-104) is accurate. Only nit: the rebuild file is src/app/api/cards/books/post/route.ts, not books/post/route.ts, but line 82 matches exactly."
}
```

---

## 165. verify(corr):eBay sync: cancelled-order gua  (phase: Verify, agent a18e0ec298e720737, 58299 tokens, 112s)

```json
{
  "isReal": true,
  "reason": "CONFIRMED. sync/route.ts:50 reads ebay_cancelled_orders with bare .select(\"order_ref\") — no .order()/.range()/readAll — while the same function hand-pages the cards read (lines 35-46), and page.ts:10-11 mandates readAll for idempotency guards. The table only ever grows (sole writer is cancel-order/route.ts:45 upsert; no delete anywhere). The re-book traces fully: card_unsell (20260720120000_card_unsell.sql:66, :71-72) deletes the card_sales row (freeing the unique (platform, order_ref) index) and resets status to 'booked'; card_sell's only status guard is `if v_card.status = 'sold' then raise exception` (20260733000000_card_sales_tenancy.sql:72), so a 'booked' card re-sells; listing_refs is never cleared so the card stays in the match set (line 39 filter, line 135 check false); during eBay's eventual-consistency window (PAID/NONE_REQUESTED, lines 81/84 pass) line 85's Set is the only guard, and past 1000 rows PostgREST returns an unordered subset that can omit the just-cancelled order. The migration's own comment (card_unsell.sql:88-89) names the outcome: \"double pool draw + phantom revenue on a refunded order.\" Line 51 catches read errors but truncation is silent. Part 2 also verified: lines 41-44 and 66 destructure {data} only; a first-page error yields an empty match set, all PAID orders skipped via line 96, run returns ok with settled=[]/failures=[], and the cron audit write is skipped (line 208) — silent non-settlement, though self-healing within the 90-day order window if the error is transient."
}
```

---

## 166. verify(corr):Auto-estimate cron debits the  (phase: Verify, agent a247adde806734da9, 60426 tokens, 123s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. (1) src/app/api/cron/card-estimates/route.ts:123-127: the result of `svc.from(\"card_estimates\").insert({...})` is discarded entirely — supabase-js returns `{error}` rather than throwing (no `.throwOnError()` anywhere; createServiceClient in src/lib/supabase/service.ts is a plain client, and postgrest-js wraps even network failures into the returned error), so the surrounding try/catch cannot catch an insert failure. (2) Lines 128-130 then debit `credit_ledger` unconditionally (error also unchecked — the inverse free-estimate case is real too), and line 131 `made++` reports the card as done; `failed` only counts `!res.ok` (line 122) and thrown exceptions (132-135), so the defect is invisible in the run summary. (3) The loop is real: lastAt is built exclusively from persisted card_estimates rows (lines 79-91); a card whose insert failed has no row, gets `age = -Infinity` (line 100), sorts FIRST (line 103), lands in the `slice(0, PER_USER)` pick (line 106), and is re-charged on every subsequent daily run. Credit amounts check out: estimateCost (src/lib/cards/credits.ts:44-54) gives light mode-A = 4, deep mode-B = 15. (4) Persistent-failure trigger is plausible: value/low/high are `numeric(12,2)` (supabase/migrations/20260722000000_estimates_credits.sql lines 10-12) and runEstimate only clamps the AI's number when `ground > 0` (src/lib/cards/estimate-run.ts:106) — a card with zero sales/quotes/reference passes the raw model output through, and >= 1e10 overflows; additionally card_id's FK means a card deleted mid-run fails the insert while the debit still posts, and the DB is shared with Master-Ops so schema drift on this table is a live vector. Even a single transient DB error = user debited, nothing stored, reported as success. (5) Manual path confirmed identical in shape: src/app/api/cards/estimate/route.ts:81-90 destructures only `{ data: row }` (error ignored) and debits unconditionally at 88-90 — there the user at least receives the estimate in the response, but the cache silently fails and re-viewing/re-running charges again. No compensating mechanism (trigger, reconciliation, constraint) exists anywhere in the repo. The claim's failure scenario traces through the real code end to end; medium severity is appropriate since the ledger is currently soft-enforced but permanently wrong."
}
```

---

## 167. verify(corr):No timeout/AbortSignal on any  (phase: Verify, agent a4b18ccb8f41478ab, 74433 tokens, 139s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading every cited site: a grep for AbortSignal/signal across src/lib returns zero timeout usage — the only hit is a retry setTimeout at zoho/client.ts:57. All cited fetches lack signals (thecardapi.ts:120,148; scryfall.ts:22; pricecharting.ts:39; ebay/listing.ts:14; trading.ts:26; orders.ts:182; zoho/client.ts:34,52), and the surrounding try/catches only catch rejections, not stalls — a no-response connection pends until undici's ~300s default, past every route's maxDuration=60. (a) price-refresh: sequential Promise.all batches (route.ts:160-162) mean one stalled fetch pins the run until Vercel kills it; the card_price_history insert (164, error also unchecked yet reported as history_written at 169) and the rotation-cursor update (166) sit unconditionally after the loop, so the day's history is lost and the hung card stays oldest-priced and is re-selected next run. (b) ebay/sync GET is the documented daily cron (route.ts:19); getOrders pages via timeout-less ebayApi (orders.ts:112) before any card_sell settle, and the error-path audit insert (202-206) never fires on a platform kill — paid orders silently unsettled that day. (c) connectors/push inserts the 'pending' claim (route.ts:104-107) before conn.pushEntry (114); zoho pushEntry's catch (zoho.ts:68-71) never runs on a stall-kill, stranding the row 'pending' forever, and every retry hits 23505 → counted as skipped_already_posted. The counterexample pattern exists exactly as claimed at cron/card-news/route.ts:81 (AbortSignal.timeout(8000)). Two minor overstatements that don't defeat the finding: the every-subsequent-day rotation wedge requires the vendor stall to recur for that query (cards adopted at line 149 in earlier batches do advance last_priced_at), and the push route is an owner-confirmed POST, not a cron (connectors/types.ts:73 says \"never a cron\") — maxDuration 60 applies identically either way."
}
```

---

## 168. verify(corr):eBay hub 30-day sold/profit st  (phase: Verify, agent a9a23278c585c2e15, 51296 tokens, 70s)

```json
{
  "isReal": true,
  "reason": "Confirmed at src/app/api/ebay/hub/route.ts:74-78: `.from(\"card_sales\").select(\"order_ref, sale_price, profit_loss, sold_at\").eq(\"platform\",\"ebay\").limit(1000)` with no .order() and no pagination reads LIFETIME eBay sales (30-day filtering happens in JS at line 85), then feeds the settledOrders membership Set (lines 81-83, driving `settled` at line 106 and `unsettled` at line 120) and the sold30Count/sold30Total/profit30 sums (lines 116-118), which EbayHub.tsx:245 displays as dollar figures. This violates the codebase's own rule in src/lib/supabase/page.ts:10-12 (reads feeding a SUM/COUNT/membership Set must use readAll). Once lifetime eBay card_sales rows exceed 1000, PostgREST returns an arbitrary 1000-row subset, understating the 30-day totals and flagging settled orders as unsettled; the re-settle click is absorbed by the unique (platform, order_ref) index / card_sell already-sold guard (documented at src/app/api/ebay/sync/route.ts:15), so no double-booking — display-only wrong money numbers, consistent with [low]. The companion cards read at lines 49-53 (limit 1000, no order) truncates match display and the cardId input to the unsettled count the same way. RLS does not bound the read (all sales belong to the one selling owner), and this route is not among the deliberately-unfixed items."
}
```

---

## 169. verify(corr):Connector account-map PUT igno  (phase: Verify, agent a92f9a0ad40d7da64, 53810 tokens, 68s)

```json
{
  "isReal": true,
  "reason": "Confirmed by reading the code. connectors/route.ts:111-113 awaits the card_account_map delete without capturing {error} (supabase-js resolves errors, never throws), then line 118 unconditionally returns {ok:true, cleared: clearKeys.length}; the adjacent upsert branch (114-117) does check its error and returns 500. ConnectorMapping.tsx:53 renders \"Saved — …, 1 cleared.\" from those response counts without refetching, so a failed delete is invisible. Downstream, push/route.ts:65-69 loads card_account_map and line 93 keeps an entry eligible if every line has an account_id — a stale surviving row keeps the entry eligible and lines 101-134 post real journal lines to the Zoho account the owner explicitly unmapped (had the delete succeeded, the entry would be withheld as not_ready, line 95 — the claim's \"refused\" wording is a minor mislabel but the substance holds). No other code path deletes card_account_map rows. Failure scenario traces fully: transient delete failure + success message → next confirmed push posts to the unmapped account."
}
```

---

## 170. completeness-critic  (phase: Critic, agent aa8262ad12d738b55, 73867 tokens, 250s)

Completeness check complete. Three sections, as requested.

## 1. Surfaces/classes no lens plausibly covered

**CSV import path — the third card-creation inlet (src/app/cards/import/page.tsx → `importCards` in src/app/cards/actions.ts:169–219).** Findings hit `createCard` (negative money, low) and `updateCard` (any status, critical) in this same file but skipped `importCards`, which is worse on both axes: (a) `status: r.status?.trim() || "booked"` (line 209) — arbitrary CSV status accepted, so cards can be born `sold` with no sale booked — the exact invariant the bulk route enforces explicitly (src/app/api/cards/bulk/route.ts:47–49 rejects `sold` with "Use the sell flow — it draws basis and books P/L"); (b) `market_value` unvalidated (line 208, negatives pass); (c) it inserts **no basis/acquisition fields at all**, so every imported card lands in the never-funded-pool trap already reported for intake — a second unfunded path nobody named; (d) SKU sequencing is a read-then-increment per import (lines 183–195) with no lock — a concurrent import or `createCard` mints duplicate SKUs, and SKU is the eBay offer key (revise/relist resolve offers by `sku`), so duplicates cross-wire listings between cards. `authed()` (line 11) also checks only sign-in, not `hasCardAccess`, unlike every API route.

**User-triggered estimate route repeats the cron's debit-on-failure bug (src/app/api/cards/estimate/route.ts:81–90).** The `card_estimates` insert error is discarded (`{ data: row }`, no error check) and `credit_ledger` is debited unconditionally afterward; the ledger insert error is also discarded. The confirmed finding ("credits debited even when the estimate insert fails") was filed only against src/app/api/cron/card-estimates/route.ts. Same class, second confirmed instance, interactive path.

**account-deletion endpoint is a new instance of the audit-actor CHECK violation (src/app/api/ebay/account-deletion/route.ts:39–47).** Inserts `actor: "ebay"` inside a swallow-all try/catch, then returns 200. The route's own comment says "the log proves receipt" of eBay's compliance notices — but per the confirmed audit_log CHECK finding, `'ebay'` rows are silently never written, so the endpoint's entire purpose (proof of receipt) silently fails while acking eBay.

**src/lib/books/funding.ts (260 lines of pool-funding/draw math) — zero findings cite its internals.** The ledger-books lens hit the post/journal/receipts routes and the intake *default*, but the pool draw/proration arithmetic itself was never examined by name. Given the pool-basis finding is one of the highest-impact items, its underlying math library being unread is a real hole. Test-adequacy flagged `readAll` and RPCs but not this file either.

**Lower concern, for completeness:** I skimmed the uncovered eBay auxiliary routes (revise, relist, send-offer) — all owner-gated with positive-price validation and a sold-guard on relist (route.ts:64–68); ship/end/offers/messages/feedback/location remain unread by any lens but are the same shape. Showcase/group **write** APIs (token mint/revoke, src/app/api/cards/showcases/route.ts) got only a missing-regression-test note, not a review. I also verified every route under src/app/api/** references a gate (`currentRole`/`hasCardAccess`/`CRON_SECRET`/verification token) — no ungated route exists, so the auth surface has no missed-gate gap.

## 2. Severity calibration

- **Intake pool-basis default [high] → argue critical.** It affects every non-Speed-Book card by default, silently corrupts COGS attribution on all future sales, and eventually sells genuinely pooled cards at $0 basis. That is broader and more compounding than the [critical] updateCard hole, which requires a deliberate bad write.
- **Unsell-after-Zoho-push [medium] → high.** Its sibling ("no reconciliation between push claims and ledger" ) is rated high; unsell is the concrete, user-reachable instance producing duplicated revenue in the *filed* external books. Rating the abstract class high and the concrete trigger medium is inverted.
- **Cron and eBay findings need a "latent until cutover" tag, not a downgrade.** Per the DNR list, CRON_SECRET is unset (all crons 401 today) and EBAY_* env is absent on CardOps. Every cron finding (card-estimates double-debit, price-refresh, daemon cursor, card-alerts) and every eBay-runtime finding (sync, cancel-order, list, hub) describes code that cannot execute in this deployment today. Severities are right for cutover day, but the report overstates current-production impact unless it says so once.
- **Same-defect severity divergence (must reconcile to one rating each):** the eBay sync cancelled-order unpaged guard appears five times spanning [high]→[low]; getOrders 300-cap appears as [medium] and [low]; lot negative-fees appears as [high] and [medium]; the CPA CSV sold_at tiebreaker appears four times as [medium]/[low]. Pick one severity per defect and dedupe.

## 3. Contradictions / consistency

- **PushToBooks vs push-preview point in opposite directions:** [low] says *successful* pushes render as *failures* (src/components/cards/PushToBooks.tsx); [high] says *failures* render as *'posted'* (src/app/cards/books/push-preview/page.tsx). Different screens, so both can be true, but the final report should confirm they aren't one field read two ways — as written it reads like the UI lies in both directions simultaneously, which needs an explicit sentence.
- **Alert notified_at [medium] vs DNR "web-push client stack not ported":** if no CardOps user can register a subscription today, *every* alert crossing is consumed with zero deliveries — the finding is systemic-today, not an edge case, but it also abuts the deliberate cutover territory. State which side of the DNR line it falls on (I read it as reportable: the stamping logic is wrong regardless of subscriber count).
- **No true logical contradictions found** among the remaining findings; the lot-cancel pair ([medium] twice) and Zoho-stuck trio ([high] x3) are duplicates of each other, not conflicts — dedupe them.
- **Corroboration worth citing:** the [critical] updateCard finding is independently confirmed by the codebase's own guard in src/app/api/cards/bulk/route.ts:47–49, which blocks exactly the transition updateCard allows — useful evidence line for the report.

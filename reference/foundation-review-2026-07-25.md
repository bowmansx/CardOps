# Core foundation review — 2026-07-25

A 170-agent, ten-lens review of the whole core (ledger/books, sales money math,
crons, eBay, auth surface, input validation, rendering/caching, schema drift,
resilience, test adequacy), run before heavy feature work begins. Every finding
below survived adversarial verification — money-path findings needed 2-of-3
independent skeptics; 8 candidate findings were refuted and dropped. The 71 raw
confirmations dedup to the ~40 distinct defects here.

**What held:** the 2026-07-24 tenancy audit's territory is solid — every route
under `src/app/api/**` is gated (`currentRole` / `hasCardAccess` /
`CRON_SECRET` / verification token; verified exhaustively, no ungated route
exists), and the showcase owner-scoping fix held. **What didn't:** the audit's
two bug classes (capped/unordered reads, swallowed write errors) recur widely
in code the audit didn't reach, the books-push protocol has real gaps, sale
*status* integrity has a hole, and the eBay sync layer is the weakest area.

**Latent vs live:** cron and eBay findings cannot execute on the CardOps
deployment today (CRON_SECRET/EBAY_* interlock) — but the SAME code still runs
daily from the Master-Ops deployment against the shared database, so they are
live defects, just executing from the other repo. Fixes land here; anything
marked **[live-via-MO]** keeps hurting until cutover unless also backported.

---

## P0 — status & basis integrity (fix before volume)

### 1. `updateCard` accepts any status — double-sell and sell-with-no-sale [CRITICAL]
`src/app/cards/actions.ts:133` (fields() at :92). Status from the edit form goes
straight into the UPDATE — no whitelist, no transition rules; the form offers
every status including `sold`. `guard_card_sale`
(20260713170000_card_sell_rpc.sql:83-99) only fires on transitions TO `sold`
and exempts the owner. So: (a) editing a sold card to any other status
"un-sells" it with no reversal — pool basis stays drawn, card_sales row stays,
the card can be sold AGAIN (double-drawn basis, doubled revenue); (b) owner can
set `sold` directly — no sale booked, no basis drawn. The codebase already
knows this is wrong: `src/app/api/cards/bulk/route.ts:47-49` explicitly rejects
`sold` ("Use the sell flow"). Same hole in `createCard`, and **`importCards`
(actions.ts:209) accepts arbitrary CSV status** — cards born `sold`.
**Fix:** whitelist status in fields()/importCards; reject `sold` everywhere
outside the sell flow; refuse edits off `sold` (require card_unsell); extend
guard_card_sale to cover leaving `sold`.

### 2. Default-pooled cards never fund the pool — COGS corruption [CRITICAL]
`src/app/cards/intake/actions.ts:91`, `src/app/cards/actions.ts:196-215`,
`CardForm.tsx:134`. `cards.use_pool_basis` defaults TRUE, but only
`speed_book_commit` ever adds cost to `card_pool` (guarded by its own comment:
"the pool average never gets deflated by $0-basis cards"). Full Intake has no
cost field at all; CSV import and the create form default pooled with no
funding either. Every such card sells via `card_sell`'s pool draw against money
other cards funded — COGS misattributed on every sale, and enough $0-basis
draws deflate the average so genuinely pooled cards sell at understated basis
(overstated profit, wrong tax numbers).
**Fix (decision needed):** default `use_pool_basis=false` outside Speed Book,
or require cost at intake/import/create that writes a pool `add`. Optionally:
card_sell refuses a pool draw for a card with no add/lot lineage.

---

## P1 — the books→Zoho push protocol (you touch this flow today)

### 3. Stuck claims report as "posted" — entries silently missing from real books [HIGH]
`src/app/api/cards/connectors/push/route.ts:104-134` +
`src/app/cards/books/push-preview/page.tsx:43-74`. Three crash points strand a
claim at status `pending`: death between claim insert and send (real risk:
BATCH=40 sequential Zoho POSTs with 1s+2s+4s 429 backoff inside maxDuration=60
— throttling makes the batch outrun the limit); the post-send status update
error is unchecked; the refusal-path claim delete error is unchecked. Every
later run counts the row as `skipped_already_posted`, and the preview page
builds its "already posted" set WITHOUT reading status — green "posted" chip,
excluded from ready, forever. No surface anywhere shows `pending` or
`uncertain`. **Fix:** preview must read + render status (pending/uncertain =
amber "needs review", never "posted"); push run should surface stale pending
claims; check both unchecked write errors; stop the batch cleanly on elapsed
time.

### 4. Never-sent failures quarantined as "uncertain" — batch stuck, never retried [HIGH]
`src/lib/cards/connectors/zoho.ts:62-71` + `src/lib/zoho/client.ts:51`.
`pushEntry` returns `{ok:false, attempted:true}` on ANY throw — but `zohoFetch`
calls `accessToken()` BEFORE the journals POST, so a token-refresh failure
(transient Zoho outage) throws with nothing sent. The route then keeps the
claim as `uncertain` (never auto-retried) for up to the whole batch —
contradicting the documented contract at types.ts:55-56. **Fix:** distinguish
never-sent throws as `attempted:false` (refresh failure, connect-refused);
keep `attempted:true` only once the request may have reached Zoho.

### 5. No reconciliation between push claims and ledger — phantom/stale money in Zoho forever [HIGH]
`push/route.ts:101` + `ledger.ts:95`. Idempotency key is reference only, no
content hash, and nothing compares claims to the current ledger. Path A: sell →
sync to ledger → push → card_unsell (buyer cancelled): internal ledger
self-heals on rebuild, but the Zoho journal stays — revenue in real books for a
reversed sale, invisible on every screen. Path B: push, then fix a price and
rebuild — same reference, push skips it as already-there; Zoho keeps the wrong
amount permanently. **Fix (decision needed):** fingerprint claims (hash +
total); on each run diff posted claims vs current entries → flag "diverged
(edited after post)" and "posted but since reversed" on the preview; ideally
push a reversing journal / void by external_id on unsell.

### 6. PushToBooks reads a field the API never returns — success renders as failure [LOW, fix today]
`src/components/cards/PushToBooks.tsx:29-31`. `ok: d.failed === 0` — the API
has no `failed` field, so `undefined === 0` = false: a perfect push shows the
red failure triangle. Worse, `refused` and `uncertain` counts (the one state
the operator MUST manually verify) are never displayed. **Fix:** `ok = refused
=== 0 && uncertain === 0`; render refused/uncertain counts, uncertain with a
"verify in your books before retrying" warning.

### 7. Ledger rebuild is non-transactional and unserialized [MEDIUM]
`books/post/route.ts:82-88`. Delete-everything-then-insert-chunks, no
transaction, no lock (the busy flag only debounces one tab). Two concurrent
rebuilds interleave into duplicated journal rows; a mid-write crash leaves a
truncated ledger, both silently. (buildPushEntries' completeness check protects
Zoho from the duplicates; the internal ledger and CSV still lie.)
**Fix:** move delete+insert into one Postgres function, or serialize with an
advisory lock / claim row.

### 8. Journal export & push-preview pagination lack a unique tiebreaker [MEDIUM]
`books/journal/route.ts:39-41`, `push-preview/page.tsx:40-41`. Ordered by
(entry_date, source_ref, line) — intercompany advances write IDENTICAL keys for
payer and payee (receipts/route.ts:92-95), exact ties across a page boundary
can duplicate one entity's line and drop the other's: an unbalanced CSV handed
to a CPA as HTTP 200. **Fix:** final `.order("entity_id")` or `.order("id")`
on both reads.

### 9. entry_date is the UTC day — Dec 31 evening sales book into the wrong tax year [MEDIUM]
`books/post/route.ts:71` (`String(s.sold_at).slice(0,10)`), plus the books-page
year buckets (books/page.tsx:76-77). Central-time sales after 6pm on Dec 31
land in January. **Fix (decision needed):** pick the books timezone
(America/Chicago), convert before slicing, use the same zone for year filters.

### 10. Receipt DELETE ignores both delete errors [MEDIUM]
`receipts/route.ts:121-123`. Journal delete then receipt delete, both errors
discarded, always ok:true. A failed journal delete + successful receipt delete
orphans balanced ledger lines with no owning record — and the rebuild only
covers source='card_sale', so they persist and still PUSH to Zoho. **Fix:**
check both; delete receipt first (self-healing order); 500 on failure. Related
small ones: receipts POST accepts sub-cent amounts that store as $0.00 with no
ledger entry (validate `round2(amount) > 0`, :53); connector mapping-clear
ignores its delete error and reports "cleared" (`connectors/route.ts:112`).

---

## P2 — money displays: the capped-read / swallowed-error class (7 screens)

All one family — new instances of the exact class the audit standardized
readAll/readAllSafe for. Mechanical fixes.

11. **Sales & P&L headline totals** sum a `.limit(1000)` read — lifetime
    Net/Basis/P&L silently wrong past 1000 sales (`sales/page.tsx:17-30`). [HIGH]
12. **Reports page** uses a private `pageAll` that discards page errors (partial
    sums rendered as fact, $0 on first-page error) AND pages card_sales on
    non-unique sold_at with no tiebreaker (`reports/page.tsx:33-41, 77-80`). [MEDIUM]
13. **CPA year CSV** pages on sold_at with no tiebreaker — lot settlements tie
    exactly; the tax document can drop/duplicate sale rows
    (`api/cards/reports/route.ts:31-42`). [MEDIUM]
14. **Books page** interco + pool reads bypass the partial-read banner —
    intercompany balances render as zero-as-fact (`books/page.tsx:64,130`). [MEDIUM]
15. **Portfolio page + cards-index banner** live-total pagers treat a read error
    as end-of-data — Market value $0 / Return −100% as fact, and the portfolio
    page OVERWRITES today's chart point with 0 (`portfolio/page.tsx:46-66`,
    `cards/page.tsx:116-130`). [MEDIUM]
16. **Portfolio history** keeps the OLDEST 400 snapshots (ascending+limit) —
    newest data vanishes from day 401 (`portfolio/page.tsx:19-20`). [LOW]
17. **eBay hub** 30-day stats + settled flags from an unordered limit(1000)
    read; **group filter** membership from an unordered capped read
    (`api/ebay/hub/route.ts:74-85`, `cards/page.tsx:51`). [LOW]

Fix pattern for all: readAllSafe + unique tiebreaker + the books-page-style
"records couldn't be read" banner instead of computed-from-partial numbers.

---

## P3 — eBay sync layer [live-via-MO] (weakest area; fix before cutover)

18. **Cancelled-order guard read unpaged/unordered** (`sync/route.ts:50`) — the
    ONLY durable defense against re-settling a refunded order caps silently at
    1000 rows (append-only, shared, never pruned). Past that: re-settle →
    double pool draw + phantom revenue. Confirmed independently by five
    agents. [HIGH]
19. **Cancellation after settlement is never reversed** (`sync/route.ts:81-85`)
    — cancel/refund handled only *before* settling; an order refunded via the
    eBay app after settling keeps its revenue and pool draw forever, silently.
    Only owner-initiated cancel-order reverses. [HIGH]
20. **list / list-lot: DB persist after live publish unchecked**
    (`list/route.ts:171-173, 262-264`; `list-lot/route.ts:131`) — publish
    succeeds, recording write fails, ok:true anyway: card live on eBay with
    empty listing_refs → excluded from the sync match set → its PAID order
    never settles; auction can be double-listed. [HIGH]
21. **Lot cancel strands the lot** (`cancel-order/route.ts:51-62`) — child
    sales reversed via card_unsell but the lot stays status='sold';
    card_lot_unsell then always throws (children already reversed), lot can
    never be relisted or reversed. Fix: detect `:lot:` refs and call
    card_lot_unsell once instead. [MEDIUM]
22. **Match-set reads**: page errors discarded (a failed page = settle against
    an EMPTY set, run reports ok, and the GET path logs no audit row when
    nothing settled); created_at paging without tiebreaker (Speed Book batches
    tie); lots set not paged at all (`sync/route.ts:35-46, 64-66`). [MEDIUM]
23. **getOrders hard 300-order cap**, no truncation signal — orders past 300 in
    the 90-day window never settle and age out permanently
    (`lib/ebay/orders.ts:110`). [MEDIUM]
24. **Lot sell accepts negative fees/shipping** (`api/cards/lots/route.ts:131-133`)
    — the exact hole the single-card sell action closed with a comment; a stray
    minus inflates net proceeds through card_sales into the ledger and Zoho.
    Same-class: order-level fee/shipping allocation has no remainder handling
    (cent drift per order) and the $0.30 per-ORDER estimate fee is applied per
    LINE on combined orders (`sync/route.ts:98-107`). [HIGH/LOW]
25. **audit_log actor CHECK violations** — sync inserts actor 'ebay-sync',
    account-deletion inserts 'ebay'; the constraint allows
    ('web','mcp','cron','assistant') so BOTH are silently never written: no
    settlement audit trail, and the account-deletion endpoint's "log proves
    receipt" compliance purpose silently fails while acking eBay
    (`sync/route.ts:161-165`, `account-deletion/route.ts:39-46`,
    constraint in 20260716040000_todos_calendar.sql:85-88). [MEDIUM]
    Paste-ready fix (or switch the code to actor 'cron'):

    ```sql
    alter table public.audit_log drop constraint audit_log_actor_check;
    alter table public.audit_log add constraint audit_log_actor_check
      check (actor in ('web','mcp','cron','assistant','ebay-sync','ebay'));
    ```

---

## P4 — crons [live-via-MO] (fix before cutover)

26. **card-alerts stamps notified_at even when 0 pushes delivered** —
    sendToAll swallows non-404/410 failures; a push-service blip permanently
    consumes every crossing that fired that run (`card-alerts/route.ts:122-130,
    174-182`). [MEDIUM]
27. **card-estimates: overlap double-runs** (no lock; manual Run + flexible
    window) double-estimate and double-DEBIT credits; **insert error still
    debits** and re-selects the card daily — unbounded charge loop (also in the
    user-triggered estimate route, `api/cards/estimate/route.ts:81-90`);
    **one user's read error aborts all later users**; 80 sequential AI calls
    can't fit 300s and unordered iteration starves the same users daily
    (`cron/card-estimates/route.ts:43-131`). [MEDIUM ×4]
28. **daemon reprice cursor never advances for unchanged cards** — the tail of
    a large inventory is never repriced; contrast price-refresh which advances
    every touched card (`daemon/route.ts:143-151`). [MEDIUM]
29. **Paid-spend crons ignore the role roster** — a demoted member's cards keep
    consuming the owner-paid TheCardAPI budget and estimate credits nightly
    (`price-refresh/route.ts:62-72`, `card-estimates/route.ts:43-46`). [MEDIUM]
30. **No timeout on ANY vendor fetch** (thecardapi, scryfall, pricecharting,
    ebay listing/trading/orders, zoho) — one stalled connection eats the
    route's whole maxDuration; kills cron tails including the price-history
    insert (itself unchecked but reported written). Fix:
    `AbortSignal.timeout(8_000..15_000)` everywhere in src/lib vendors. [MEDIUM]
31. **card-alerts readAll calls have NO .order() at all** — violates the
    documented contract of the primitive itself (`card-alerts/route.ts:108-115,
    149-156`). [LOW]

---

## P5 — validation odds and ends

32. **addComp**: insert error swallowed (silent comp loss) + negative price
    accepted → poisons market_value → NAV, exports, list defaults
    (`[id]/value/actions.ts:81-89`). [MEDIUM]
33. **Card create/edit/import accept negative money** (individual_basis "-450"
    → +$900 phantom profit at sale) (`actions.ts:53-57, 99, 207-208`). [LOW]
34. **Comps import**: model dates regex-checked only — an impossible date
    ("2026-06-31") 500s the whole batch; coerceDate exists and is unused here
    (`api/cards/comps/import/route.ts:103`). [LOW]
35. **importCards** (critic catch): arbitrary status (see #1), no basis fields
    (see #2), `authed()` checks sign-in but not hasCardAccess, and SKU
    read-then-increment races a concurrent import/create into duplicate SKUs —
    SKU is the eBay offer key, so duplicates cross-wire listings
    (`actions.ts:169-219`). [MEDIUM]

---

## Tests worth writing (the review's test-adequacy verdict)

The 16 vitest files are genuinely good on pure TS math (valuation, journal
building, export shaping) — but **nothing executes the plpgsql money core**:

1. `card_sell` / `card_unsell` reversal symmetry (pool draw ↔ correction) — an
   integration harness against `supabase start` (SUPABASE_DB_URL-gated vitest,
   or pgTAP under supabase/tests). The single riskiest untested path.
2. `card_lot_sell` pro-rata + last-child remainder (cent-exact reconciliation).
3. eBay `parseOrder` golden fixtures (the tax-inclusive `total` fallback at
   orders.ts:91 books phantom revenue when lineItemCost is missing — fixture
   would have caught it; also field-rename → silent $0 sales).
4. Order-level fee/shipping allocation (extract to a pure helper first, #24).
5. `pushEntry` attempted-flag contract (both halves; guards the double-post
   protocol against a one-word regression).
6. `readAll`/`readAllSafe` page-window arithmetic (the primitive everything
   trusts; off-by-one = boundary dup/skip everywhere at once).
7. Showcase owner-scoping regression test (extract the filter into a pure
   function; highest-blast-radius regression in the app currently ships green).

## Blind spots (reviewed lightly or not at all — by the completeness critic)

- `src/lib/books/funding.ts` (260 lines of pool math) — no lens read its
  internals; given #2, it should get a dedicated pass when pool wiring changes.
- eBay auxiliary routes ship/end/offers/messages/feedback/location — spot-check
  showed the same gate+validation shape as reviewed siblings, but unread.
- Showcase/group WRITE APIs (token mint/revoke) — only the missing-test note.
- Refuted-but-close: relist double-sale (blocked today by a guard chain that
  deserves a test), eBay token crypto round-trip (untested but correct).

## Suggested order of attack

1. **Today, before the first real Push:** #6 (PushToBooks UI), #3's preview
   status read, #4 (attempted flag) — small, contained, and they make today's
   Zoho run honest. Keep the first push batch small (≤10 entries).
2. **This week (P0 + P1):** #1, #2 (one decision each), then #5, #7-#10.
3. **Mechanical wave (P2 + tiebreakers everywhere):** one sitting, ~15 files.
4. **Before cutover (P3 + P4):** the eBay sync hardening and cron fixes, since
   cutover is what makes CardOps the executor of that code.
5. **Test harness:** the plpgsql integration suite alongside wave 2, fixtures
   alongside wave 4.

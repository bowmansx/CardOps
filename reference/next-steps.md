# CardOps — where things stand and what's left

Written 2026-07-24, the day CardOps became its own app.
Nothing here is urgent. CardOps works today.

## ✅ Done

- **Split complete.** CardOps is its own repo (`bowmansx/CardOps`), its own
  Vercel project (`card-ops`), live at https://card-ops-zeta.vercel.app.
- **Every migration applied and verified**, through
  `20260733000000_card_sales_tenancy.sql`.
- **Multi-tenant isolation closed.** A 158-agent audit found 38 defects; the ones
  that mattered are fixed — see `reference/audit-2026-07-24.md`.
- **Env vars carried over**: Supabase ×3, Anthropic, TheCardAPI, Zoho ×5,
  VAPID ×2.

## 1. Connect a business to its books  ← the next thing worth doing

Per business (AF, HOP, and Personal if you want it). ~2 minutes each.

1. **CardOps → More → Businesses**
2. Confirm the org id (edit the row if missing):
   - The Architect's Foundry → `931036422`
   - House of Packs → `931034783`
   - Personal → *none yet* (decision below)
3. **Connect** → **Bookkeeping app: Zoho Books**
4. **Map the accounts.** It pulls that org's real chart of accounts and lists the
   CardOps keys your ledger actually uses. **Save mapping.**

Then **More → Books → "Preview the Zoho push"**. With mapping saved, "ready"
should be a real number and the `·map` warnings gone. **This screen posts
nothing.** Press **Post** when you're satisfied; it confirms first, naming the
business and the count. Already-posted entries are skipped, and anything
unbalanced or unmapped is refused rather than half-posted.

> **Before you Post — check the mapping on the preview.** Confirm each CardOps
> key landed on the RIGHT Zoho account: inventory, cash, COGS, card sales,
> selling fees. A wrong mapping is the one mistake here that's annoying to unwind
> once it's in real books, and it's trivial to catch on this screen. Worth a
> second pair of eyes — share the preview before pressing Post.
> (Calendar reminder set for 10am ET Sat 2026-07-25.)

MasterOps then reflects it automatically — it already reads those Zoho orgs, so
card activity shows up in your entity cash/P&L with no wiring between the apps.

## 2. Still dark until you act

- **eBay.** The OAuth RuName is registered with eBay against
  `master-ops-iota.vercel.app`. Copying `EBAY_*` here will NOT fix it — a
  redirect URI for the CardOps domain has to be added in eBay's developer
  portal. Until then, eBay listing/sync lives on MasterOps.
- **The nightly crons.** `vercel.json` here declares six of them, but
  `CRON_SECRET` is deliberately NOT set on this project, so they return 401
  and do nothing. **2026-07-25 update: Master-Ops no longer schedules the six
  card crons** (removed in MO `02a7563`; its four own crons remain), so right
  now NO card cron runs anywhere. eBay sales settle via the hub's manual sync
  button on MasterOps until cutover.

## 2b. Migrations queued to PASTE (in this order)

From the `foundation-fixes` branch — paste each, in sequence:

1. `20260734000000_status_is_a_transition.sql` — sold boundary + born-sold
   guards (no owner exemption).
2. `20260735000000_purchase_lots.sql` — READ ITS VERIFICATION SELECT OUTPUT
   before letting the fold+drop half run. Replaces card_pool with purchase
   lots; rewrites card_sell/card_unsell/speed_book_commit.
3. `20260736000000_audit_log_actors.sql` — widens the audit actor CHECK.
4. Then paste `supabase/tests/money-core.test.sql` (rolls back; expect 13
   PASS rows) — the money core's first real execution.

The branch's code assumes 34+35 are applied (use_pool_basis is gone from the
code); merge + deploy and paste in the same sitting.

## 2c. Before the FIRST real Zoho Push (hard gate)

The push protocol posts correctly but REPORTS dishonestly (foundation review
P1). Do these before trusting a Post:

1. PushToBooks reads `d.failed`, which the API never returns — every push
   renders as a failure, and refused/uncertain counts never show.
2. The push-preview must read card_push_log STATUS — a stranded pending/
   uncertain claim currently shows a green "posted" chip forever.
3. `pushEntry` must return `attempted:false` for never-sent throws (token
   refresh failure) so a Zoho blip doesn't quarantine whole batches as
   "uncertain".

Until then: batches ≤10 entries, ignore the red triangle, verify the entry
count in Zoho by hand.

## 3. Final cutover — one sitting, in this order

0. **Hardening gate (from TRIAGE.md "before cutover", eBay/cron section):**
   post-settle cancellations detected and reversed (or surfaced); getOrders
   pages past 300 with a truncation signal; lot cancel repairs the lot
   (card_lot_unsell once, not card_unsell per child); order fee/shipping
   allocation reconciles (remainder to last line, $0.30 once per order);
   card-alerts stamps notified_at only on delivered; card-estimates gets a
   run lock + debit-after-insert + per-user error isolation; daemon reprice
   cursor advances for unchanged cards; paid-spend crons filter by the role
   roster. (Match-set/guard reads, timeouts, and audit integrity already
   landed in foundation-fixes.)
1. In Master-Ops: strip the card code (the six cron entries are ALREADY gone
   from its `vercel.json`), then deploy.
2. Only then: add `CRON_SECRET` to the card-ops Vercel project and redeploy.

**Don't start this until eBay is re-registered** (see above) — and don't set
CRON_SECRET before step 0's cron items are done: the fixed versions are what
make the schedule safe to own.

## 4. Decisions still open

- **Personal**: does personal card activity post to a dedicated Personal Zoho
  Books org, or stay CardOps-only records you hand your CPA? Set the business's
  connector to *None* for the latter.
- **QuickBooks**: one adapter file when you want it — the mapping screen and the
  ledger translation are already backend-neutral.
- **Per-user Zoho OAuth.** The Zoho credential is process-wide, so the connector
  routes are owner-only. Per-user OAuth is what would let other people connect
  their own books.

## 5. Inviting someone

1. Send a MasterOps invite (**Invite a friend…**) — they sign up at
   master-ops-iota.vercel.app.
2. Promote them for CardOps:
   ```sql
   update public.profiles set role = 'card_ops'
   where id = (select id from auth.users where email = 'their-email@gmail.com');
   ```
3. Send them https://card-ops-zeta.vercel.app

They get their own empty inventory, capped at 100 new cards/day. You stay
unlimited. Fully isolated — separate cards, photos, pricing templates, storage
locations, alerts, estimates, sales, pool and books.

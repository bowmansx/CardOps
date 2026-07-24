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
  `CRON_SECRET` is deliberately NOT set on this project, so they return 401 and
  do nothing. That is on purpose — Master-Ops still declares the same six jobs
  and still has its secret, so adding it here right now would run everything
  twice against the same database.

## 3. Final cutover — one sitting, in this order

1. In Master-Ops: strip the card code **and remove those six crons from its
   `vercel.json`**, then deploy.
2. Only then: add `CRON_SECRET` to the card-ops Vercel project and redeploy.

Reversed, there's a window where both deployments run the same jobs.
**Don't start this until eBay is re-registered** (see above).

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

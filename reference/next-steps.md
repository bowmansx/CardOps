# CardOps — where things stand and what's left

## ⚠ READ FIRST (2026-07-25, end of session)

**1. Turn on "AI card scan (Anthropic)" in More → Services.** This is why a
scanned card filled in nothing. `service_config` seeds every service DISABLED,
and the new Supabase project was bootstrapped fresh, so the AI kill-switch came
up off. Every AI path is gated on it and fails closed on purpose (they spend
real money). The other toggles seeded off too — check them while you're there.

**2. Paste queue — FOUR migrations, in order, then the harness:**

| # | File | What it adds |
|---|---|---|
| 1 | `20260737000000_credit_metering.sql` | credit ledger v2, AI cost telemetry |
| 2 | `20260738000000_card_identities.sql` | shared card identity + market data |
| 3 | `20260739000000_investor_assets.sql` | Wave B: asset record, documents, custody |
| 4 | `20260740000000_photo_provenance_storage.sql` | photo provenance + storage metering |

Then `supabase/tests/money-core.test.sql` → expect **39 of 39 PASSED**.

> Migrations 2–4 were adversarially reviewed before pasting (40 agents, 36
> candidates, 18 refuted, 8 distinct defects fixed in place — see commit
> `17b8118`). Two would have silently voided the identity layer: a partial
> unique index that made every upsert fail 42P10 behind a swallowed error, and
> RLS that left shared history unreadable by everyone but one arbitrary owner.
> A third leaked every tenant's out-of-possession assets through a view with no
> `security_invoker`. **AI card scan was switched ON in Services on 2026-07-25
> and verified end-to-end** — the scan route reaches Anthropic and returns a
> parsed card.

**3. Merge PR #2** (github.com/bowmansx/CardOps/pull/2) — it carries everything.

**4. Decisions blocking work:** off-site backup destination (R2 / Drive / S3)
— gates seeding the Mantle; credits org- or user-scoped; and
`VALUATION_ENGINE.md` still isn't in the repo (blocks Wave B3's discovery-plan
display).

Design docs written and awaiting go: `DESIGN_WAVE_B.md` (schema BUILT, UI not),
`DESIGN_WAVE_C.md` (org tenancy, design only), `DESIGN_PHOTO_SYSTEM.md`
(templates, quality presets, quotas — measurement built, policy not).


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

## 1b. ✅ SUPABASE SPLIT — DONE 2026-07-25

CardOps runs on its own Supabase project (`zgkydwvmdnnrxcacegth`). Schema
bootstrapped from `supabase/bootstrap/`, owner promoted, three Vercel env
vars repointed (new-style `sb_publishable_` / `sb_secret_` keys), redeployed
and verified from outside: the live bundle targets the new project and
anon routes answer correctly. Money-core harness on the NEW database:
**13 of 13 PASSED**. The old login-bounce (shared auth redirecting to
Master-Ops) is structurally gone.

Left over from the split, non-urgent:
- Google sign-in isn't configured on the new project yet — magic link works.
  (Add the provider + the new `https://zgkydwvmdnnrxcacegth.supabase.co/auth/v1/callback`
  to the Google Cloud console's authorized redirect URIs.)
- Inventory starts EMPTY; pre-split test cards remain in the old project.
- Master-Ops tax advisor still reads the OLD project's card tables.
- VAPID/push, THECARDAPI, ANTHROPIC, ZOHO env vars were untouched by the
  split — they don't reference Supabase.

## 1c. Credit metering — SHADOW MODE (built 2026-07-25)

The business model Beau chose: users buy computation credits on the WEBSITE
(not in-app — avoids Apple's 15–30% on digital goods; the PWA has no such
constraint anyway) and spend them on metered AI work. Built now so pricing is
set from data, not guesses. Nothing is user-visible or enforced yet.

**Decisions locked:**
- Retail price (credits) is DECOUPLED from measured cost (dollars). Reprice
  retail without redefining what a credit is.
- Flat per-operation pricing. Prompt-cache savings are margin, not a variable
  discount — a run that costs 9 credits one day and 4 the next is worse for
  the user than a stable number. Cache the SHARED prefix (rubric/instructions)
  only, never one user's card data.
- Plan grants EXPIRE at period end; purchased top-ups do NOT. Spending draws
  the soonest-expiring bucket first, so nothing evaporates that could have
  been used. (Rollover cap of 1× allowance / 30d is the intended plan shape —
  the schema supports it; the granting job that applies it comes with billing.)

**What exists (migration `20260737000000_credit_metering.sql`):**
- `ai_usage` — real tokens + computed dollar cost per AI run (service-role
  only). Unknown model ⇒ `cost_usd` null and FLAGGED, never $0.
- `credit_ledger` v2 — `kind` / `expires_at` / `remaining` / `shortfall`.
- `credit_balance()` v2 (unexpired remainders), `credit_grant()` (owner or
  service role), `credit_spend()` (FIFO by expiry, service role).
- `/cards/credits` (owner-only) — $/credit per feature, enforcement toggle,
  test grants, recent ledger.
- Harness extended to **18 assertions** (14–18 cover grants, FIFO draw,
  expiry, shortfall, and non-owner refusal).

**Why `credit_spend` never refuses:** by the time it runs the compute already
happened (rule 7 orders the effect before the charge). Refusing there would
hide a real cost; it records a `shortfall` instead. Refusal lives in app code
BEFORE the AI call, gated on the `credit_enforcement` service_config flag
(currently OFF = shadow mode).

**Before charging anyone:** watch `$ / credit` on `/cards/credits` across real
usage, then set prices. Then Stripe checkout → `credit_grant` (with the same
idempotency discipline as the Zoho push — double-crediting a payment is the
mirror image of double-posting a journal), then flip enforcement on.

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

## 2b. ✅ APPLIED 2026-07-25 — all three migrations pasted; money-core
harness ran against the live database: **13 of 13 PASSED**. (Historical
paste order kept below for reference.)

### Original paste queue (done)

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

0. ~~Hardening gate~~ **DONE 2026-07-25** (foundation-fixes `136c224`): post-
   settle cancellation reversal (shared card/lot-aware helper), getOrders
   paging + truncation signal, cents-exact fee allocation ($0.30 per ORDER),
   checked post-publish writes, delivery-gated notified_at, estimates
   roster/debit-ordering/isolation/time-budget, price-refresh roster,
   daemon cursor advance.
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

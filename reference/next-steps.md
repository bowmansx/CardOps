# CardOps — where things stand and what's left

## STATE AS OF 2026-10-29 (overnight)

**Nothing in the product code was broken.** Three months had passed with only
the strategy review's "nothing material" entries on main. What was wrong sat
outside the code, where typecheck, tests and the build cannot see it. Full
account in `spec/OUTBOX.md`.

- **AI intake: the switch is ON in the live database** (read by the MasterOps
  session). It is seeded `false` in bootstrap and the init migration, so a
  fresh project starts with it off — the likely cause of Beau's 2026-07-26
  report, a day after the split — and that is now step 7 of
  `supabase/bootstrap/README.md`. An earlier draft of this block said it was
  still off; that was inferred from the seed files and was wrong.
  **Open defect:** `FullIntake` shows "AI scan is off — turn it on in
  Services" whenever the user taps *Enter manually*, because both states set
  one `aiOff` flag. It can send Beau to a switch that is already on.
- **Every comp paste fails in production** — `private_to` exists only in the
  unpasted migration 20260752. `scripts/schema-probe.mjs` now checks the live
  schema against what the code expects.
- **The free Supabase plan kept pausing the project** — no crons and no cards
  means zero traffic. A daily GitHub Actions keepalive is live.
- **Built, not merged:** `claude/import-any-format` — import from any
  inventory file's own column names, with the mapping shown before writing.
  Not merged because `npm run check` fails on lint outside the branch.

### Next, in order

**Beau's:**

1. Paste `20260752_source_instances.sql`, then `node scripts/schema-probe.mjs`.
2. Check local dev runs (`npm run dev`, open `/login`) — the MasterOps session
   added the missing anon key to `.env.local`; not yet confirmed end to end.
3. Answer the lint questions (CameraSheet disable vs restructure; the four
   warnings), which is what unblocks every merge — including the import branch.
4. Decide whether to push local main's unpushed commits.

**The loop's, once unblocked:**

- **Next to build:** split `FullIntake`'s `aiOff` into "the server says AI is
  off" and "the user chose manual", so the Services banner only shows for the
  first. Unblocked; deferred tonight only because the machine was down to
  ~1.3 GB free and the build gate couldn't run safely.
- Merge `claude/import-any-format` when the gate passes.
- The card-estimates overlap lock — needs a migration, so it waits until
  20260752 and 20260753 are applied (migrations are never stacked).
- Wire `card_parallel_ratio` into the valuation route, after 20260753.

---

## ✅ STATE AS OF 2026-07-29 (overnight)

**Migrations 20260750 and 20260751 are APPLIED and verified** against
`information_schema`, not against the SQL editor's "Success" banner — which had
already been on screen from the previous run and would have said the same thing
had nothing happened. `card_market_sales` gained provenance / added_by /
price_basis / fetched_at / is_graded, `card_market_rollups` exists with
read-only RLS, and the sweep photo template is seeded.

> [!warning] 21 commits are on local `main` and NOT deployed.
> The camera work is not on card-ops-zeta.vercel.app until `git push`. The
> database is deliberately AHEAD of the deployed code, which is safe: both
> migrations are additive with defaults, and the deployed build ignores columns
> it does not know about.

**What shipped into the repo today, grouped by what it means:**

- **The valuation spine.** Every sales source normalizes into `ObservedSale`
  and declares its `rights` (persist / redisplay / pool), which the write path
  consults and DEFAULT-DENIES for an unknown source. A licence is code.
- **Four money bugs fixed**, all found by reading vendors' own docs rather than
  by reasoning: hammer prices medianed against all-in (~22% error), provisional
  prices stored permanently, raw comps polluted by graded sales whose grade was
  never extracted, and eBay's genuinely tiered fee schedule.
- **The forward money engine** — break-even by inverting the fee equation, fee
  rate preferring Beau's own settled sales over any published table.
- **The paste lane**, end to end. The one source of real depth that no API sells.
- **The camera sweep** — one pass, two photos: glare removed, and a raking-light
  surface map. Plus the legibility rebuild and automatic capture actually firing.

**Three vendor questions closed by reading the actual terms:**

- The Card API §4a **permits** storing to serve your users and displaying
  transaction history in your own product interface. The pricing wall was never
  a wall.
- PriceCharting **forbids** use in "any software... accessible to third parties"
  without written permission — the cautious reading was right. Internal business
  use needs a LEGENDARY subscription; permission has a contact, brady@vgpc.com.
- PriceCharting has **no sales history at any tier**, which is a data limit
  rather than a licence one and makes it permanently a second opinion.

### Next, in order

**Still Beau's, and unchanged by anything above:**

1. **`git push`** — nothing above is testable on a phone until it deploys.
2. **The $9 coverage test.** 50 cards of known value through The Card API's
   Starter tier; count matched quotes. That number decides whether pricing is a
   coverage problem or a depth problem.
3. **Do you have an eBay STORE subscription?** If so the verified fee schedule
   is the wrong page and every break-even is off.
4. **Switch on Seller Hub** — free, one click, and it is the gate in front of
   Terapeak. Whether Terapeak still exists is genuinely unknown; `/sh/ovw`
   redirects to the opt-in exactly as `/sh/research` does, so the redirect never
   said anything about Terapeak.
5. Read `spec/strategy/TEST-THE-CAMERA.md` before picking up a phone — it maps
   each likely symptom to the one constant that fixes it.

---

## STATE AS OF 2026-07-25 (end of session)

**Everything built today is applied, merged and deployed.** The queue below is
now entirely items only Beau can do.

- **All migrations applied** through `20260744000000` — credit metering, card
  identities, investor assets, photo provenance + storage, photo prefs, cost
  basis lines, photo bucket limits, photo templates.
- **Money-core harness: 48 of 48 PASSED** against the live database — basis
  draw, the sold boundary both ways, double-sell refusal, lot balances,
  cross-user isolation, credit FIFO + expiry, identity resolution, shared
  history surviving deletion, custody guards, storage rollup, RLS shape,
  the photo-prefs guards, and the cost-basis layer (full draw, sold lock,
  single cache writer, cache-follows-CRUD, negative floor, unstated-vs-zero).
- **PRs #2–#6 merged**; production is current.
- **AI card scan is ON** in Services and verified end-to-end.

Shipped 2026-07-25, after the Supabase split: the "Saving…" hang fixed (the
server-action body limit), optional cost basis with an editable breakdown,
photo settings and presets, photo templates, direct browser→storage upload,
and corner/surface shots feeding both the grade estimate and eBay listings.

**The autonomous loop is set up** — `reference/LOOP_CHARTER.md` for its terms,
`spec/` for Beau's Obsidian vault. `spec/INBOX.md` is how work reaches it.

Migrations 2–4 were adversarially reviewed *before* pasting (40 agents, 36
candidates, 18 refuted, 8 distinct defects fixed in place — commit `17b8118`).
Two would have silently voided the identity layer: a PARTIAL unique index that
made every upsert fail 42P10 behind a swallowed error, and RLS that left shared
history unreadable by everyone but one arbitrary owner. A third leaked every
tenant's out-of-possession assets through a view missing `security_invoker`.

### Next, in order

**Everything here is Beau's.** The loop checked on 2026-07-25 and found no
unblocked item — which is the charter working as designed, not a failure. To
give it something, write in `spec/INBOX.md` → *Do next*, or answer one of the
questions in that file's *Waiting on you* table.

1. **Put a real box of cards through the scanner.** Everything built today was
   groundwork for this. Log where the capture flow actually hurts into
   `spec/10-intake.md` → *What hurts today* — that section is deliberately
   empty, and per the standing agreement it outranks any feature idea invented
   at a desk. It also unblocks the held P1 work (edge detection, deskew), which
   is waiting on evidence that capture angle is a genuine problem.
2. **Re-add the businesses** (AF, HOP) — that setup lived in the old database.
3. **Connect Zoho books** (§1 below) once the businesses exist.
4. **Install the GitHub CLI** (`winget install --id GitHub.cli`, then
   `gh auth login`). Not product work, but it is what lets the loop open and
   merge its own PRs — browser automation against GitHub proved unreliable, so
   the charter's merge step currently has no dependable mechanism.

### Decisions still open (not blocking)

- Off-site backup destination (R2 / Drive / S3) — **gates seeding the Mantle**,
  because losing evidence documents is the catastrophic failure for an asset
  whose value lives in its paperwork.
- Credits org-scoped or user-scoped — changes the money core, cheap now.
- `VALUATION_ENGINE.md` still isn't in the repo (blocks Wave B3's
  discovery-plan display).

Design docs awaiting go: `DESIGN_WAVE_B.md` (schema BUILT, UI not),
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

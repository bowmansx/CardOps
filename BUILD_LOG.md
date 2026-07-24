# BUILD_LOG — foundation-fixes

Judgment calls made while executing the foundation plan (2026-07-25 review →
fixes). One entry per decision: what, why, commit.

## Item 1 — Master-Ops card crons retired
- Removed exactly the six card entries from Master-Ops vercel.json; the four
  MasterOps crons (refresh, alerts, recap, subs-sync) untouched. Verified on
  the Vercel crons page post-deploy: four scheduled, feature enabled.
  Master-Ops commit `02a7563`. Resolved en route: the master-ops Vercel
  project does own master-ops-iota.vercel.app (earlier "No Production
  Deployment" reading was dashboard flakiness).

## Item 2 — status is a transition
- **Enforced at the DB, not just the app.** The server-action whitelist alone
  is routable-around via raw PostgREST with a user JWT, so the real rule lives
  in triggers: guard_card_sale now guards the sold boundary in BOTH directions
  and drops the owner exemption; a new insert guard blocks cards being born
  'sold'. Non-sold moves (booked/listed/graded_out/archived) stay free — the
  eBay listing routes and archiveCard keep working unchanged.
- **CSV import whitelist = {booked, archived}.** 'listed' from a CSV would
  assert a live marketplace listing no listing_refs backs — excluded. Anything
  else (incl. 'sold') coerces to 'booked' and is counted in the new `coerced`
  return field rather than rejecting the whole file: bulk imports shouldn't
  die on one legacy status string, but the user must see the count.
- **Harness is paste-ready SQL, not a node runner.** No docker/psql/supabase
  CLI on this machine, so a vitest+pg harness could ship only unexecuted.
  Instead: supabase/tests/money-core.test.sql — one transaction, temp results
  table, PASS/FAIL output, unconditional ROLLBACK; safe to paste against the
  live DB (Beau's native migration workflow). Item 8 extends the same file.
  NOT yet executed — I could not run it here; first paste-run pending.
- The RPCs leave cardops.in_sell set for the rest of their transaction; in
  production each request is its own transaction so it cannot leak, but the
  harness resets it after every RPC call before testing the guards.

## Item 4a — funding.ts reviewed (report, no changes)
- It is NOT the pool implementation: a pure simulation engine for the Booking
  Simulator (funding paths, §267/SE flags), balanced by construction, no I/O,
  and it never touches card_pool — so purchase lots do not invalidate it.
  Soft edges only (degenerate negative/zero transfer prices produce odd
  display-only entries); left alone deliberately.

## Item 3 — purchase-lot basis
- **Naming**: `purchase_lots`, never "lots" — `card_lots` already means
  SELL-side listing bundles. Buy-side and sell-side stay distinct words
  everywhere.
- **Ledger untouched**: books/post reads `basis_drawn` off `card_sales`, so
  swapping the draw source required zero books-layer changes.
- **Lot economics guarded like the sold boundary**: remaining/total columns
  move only under the RPC handshake; label/source/date/tax_bucket stay freely
  editable. A card may only link to a lot owned by the same user (FK alone
  would accept foreign lot ids — FK checks bypass RLS).
- **Per-entity pooled basis** on the Books page now follows the CARDS (each
  live lot-card contributes its lot average to its own entity) instead of the
  old card_pool.entity_id column — exact when a lot's cards share an entity,
  and the only definition that survives cards moving between entities.
- **Legacy fold, unconditional**: any funded card_pool row becomes a per-user
  "Legacy pool" purchase lot and its live pooled cards link to it, BEFORE the
  drop — zero data loss even if "effectively empty" hides something. The
  migration opens with a verification SELECT so Beau sees row counts at paste
  time.
- **CSV import cost**: not required per-row (a bulk file shouldn't die on a
  missing column) — defaults individual_basis 0; the create form and Full
  Intake DO require an explicit cost (0 allowed). Speed Book's lot cost now
  requires >= 0 instead of > 0 (a genuinely free lot is legal).
- **Harness rewritten in the same commit** (13 assertions) since it seeded
  card_pool, which this migration drops — the paste sequence stays coherent.
  This absorbs most of item 8's scope. Still not executed locally (no
  Postgres here); first paste-run pending.

## Item 4b/c — audit integrity
- Widened the audit_log actor CHECK to the actors the code actually writes
  ('ebay-sync', 'ebay') instead of collapsing them to 'cron' — the trail is
  more informative and the constraint drop/add is name-agnostic (scans
  pg_constraint). Migration 20260736000000.
- auditOrThrow everywhere (19 sites). Typed actor union = compile-time mirror
  of the CHECK, so a future actor/constraint mismatch is a tsc error first.
- Two deliberate exceptions to throw-on-failure:
  (1) the three eBay list routes audit AFTER a live publish — a thrown 500
      would invite a retry and a double-listing, so audit failure surfaces as
      a warnings[] entry on an ok:true response;
  (2) the sync's per-order audit failure lands in failures[] (response +
      run-summary audit row) so one order's audit problem doesn't abort the
      rest of the run — the settlement itself stands either way.
- account-deletion now logs FIRST and acks second: no logged receipt → 5xx →
  eBay redelivers. Previously it acked notices it silently failed to record.

## Item 6 — free gates
- `npm run check` = types + tests (now 205: +7 readAll contract tests) +
  forbidden-pattern greps. All green at introduction — a gate that starts red
  gets ignored.
- **Lint deferred from the gate**: 30 pre-existing eslint errors (mostly
  react-hooks) predate this work; `check:lint` exists separately and joins
  `check` after a cleanup pass. Type-aware no-floating-promises likewise
  waits for that green baseline.
- Grep gates (check-forbidden.mjs): fire-and-forget `.then(noop,noop)` writes;
  raw audit_log inserts outside auditOrThrow; any resurrection of
  card_pool/use_pool_basis.
- Honest coverage map: the greps catch the swallow-by-.then class and audit
  bypass; the readAll test pins the pagination primitive; "awaited but
  {error} discarded" is NOT machine-catchable here — that class is held by
  prevention rule 1 and review, not tooling.

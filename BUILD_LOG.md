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

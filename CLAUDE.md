# CardOps

Standalone Next.js 16 + Supabase app for trading-card inventory: intake,
pricing, grading, eBay listing/sync, market data, showcases, and a double-entry
books layer with pluggable bookkeeping connectors (Zoho today, backend-neutral
core). Split out of the Master-Ops monorepo on 2026-07-24 by
`scripts/split-cardops.mjs`. Deploys via the Vercel project **card-ops**, live
at https://card-ops-zeta.vercel.app.

## Commands

- `npx tsc --noEmit` — typecheck
- `npm test` — vitest, the full card suite
- `npm run build` — production build

## Layout: app/ shells over src/ implementations

Routes in `app/` are thin re-export shells; implementations live in
`src/app/**` (with `src/lib/cards`, `src/lib/ebay`, `src/lib/books`,
`src/components/cards`). The `@/*` alias maps to `src/*`.

**Segment config does NOT inherit through a re-export.** Every shell must
re-declare `dynamic`, `maxDuration`, etc. literally, matching its
implementation. When adding a route, add both files and keep their config in
sync — a shell that omits the implementation's `maxDuration` silently runs on
the default limit. Any route in `src/app` with no `app/` shell does not exist
in the build (this has shipped as 404s before; the cron/eBay routes are entry
points nothing imports, so tooling and reviews miss them easily).

## Supabase is shared with Master-Ops — deliberately

One Supabase project, one database, shared with Master-Ops. The apps have no
code connection and never call each other; CardOps gets its own Supabase only
if it's ever sold. Consequences:

- **Migrations are never applied automatically.** Beau pastes them by hand —
  when schema changes, provide paste-ready SQL.
- Some tables CardOps reads (e.g. `push_subscriptions`) are CREATEd only in
  Master-Ops migrations; CardOps migrations may only add policies to them.

## The two recurring bug classes (see reference/audit-2026-07-24.md)

1. **Service-role and SECURITY DEFINER code bypasses RLS entirely.** Crons run
   as the service role. Every card read/write on those paths must scope by
   `user_id` explicitly, in code. `has_card_access()` is an app-entry gate,
   never row scoping.
2. **PostgREST silently caps any request at 1000 rows** — `.limit(20000)` is a
   lie. Use `readAll` / `readAllSafe` from `src/lib/supabase/page.ts` for
   anything feeding a sum, count, membership set, idempotency guard, or
   destructive rebuild.

## Cutover interlock — do not "fix" these

Until the one-sitting cutover in `reference/next-steps.md` §3 happens
(Master-Ops sheds its six card crons first):

- **`CRON_SECRET` stays UNSET on the card-ops Vercel project.** The six crons
  in `vercel.json` returning 401 is the double-run protection — Master-Ops
  still declares and runs the same jobs against the shared database.
- **eBay stays single-homed on Master-Ops.** The OAuth RuName is registered
  against `master-ops-iota.vercel.app`; copying `EBAY_*` env vars here does
  nothing until a CardOps redirect URI is added in eBay's developer portal. UI
  deliberately links to the Master-Ops origin.
- **The web-push client stack (sw.js, registration, subscribe route) is not
  ported yet** — deliberate, not an oversight.

The tax advisor stays on Master-Ops permanently (it reads the shared
Supabase); link to `https://master-ops-iota.vercel.app/tax`. It is bookkeeping
hygiene and "flags to raise with your CPA" — never filing or tax advice.

## Working rules

- Money-critical and outward-facing writes are gated on Beau's explicit
  decision. Nothing posts to real books automatically or from a cron.
- Never commit API keys — `THECARDAPI_TOKEN` and friends are Vercel env vars
  only.
- Surface merges or deletions that would lose work instead of just doing them.

## Reference

- `reference/next-steps.md` — current state, cutover order, open decisions
- `reference/audit-2026-07-24.md` — the multi-tenancy audit; read before
  touching service-role, SECURITY DEFINER, or books code

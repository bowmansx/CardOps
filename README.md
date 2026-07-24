# CardOps

Trading-card inventory, pricing, intake, sales and books. Standalone Next.js app.

Split out of the Master-Ops monorepo on 2026-07-24. The split was computed from
the real transitive import closure of CardOps' entry points, not a hand-written
list — see `scripts/split-analyze.mjs` in Master-Ops.

## Layout

- `app/` — the routes. Thin re-exports of the implementations in `src/app/`.
- `src/app/cards`, `src/app/api/cards`, `src/app/api/ebay`, `src/app/showcase`
- `src/lib/cards`, `src/lib/ebay`, `src/lib/books` — the engines
- `src/components/cards` — the UI
- `supabase/migrations` — the card_* tables

## Environment

Same Supabase project as Master-Ops for now (see Phase 4 in the split plan).

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`.
Optional: `THECARDAPI_TOKEN`, `PRICECHARTING_TOKEN`, `ZOHO_*`, `EBAY_*`,
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

## Develop

```bash
npm install
npm run dev     # :3100
npm test
```

# Platform — the things underneath

## Tenancy

RLS is the boundary, everywhere. `has_card_access()` is an app-entry gate, never
row scoping.

**The two recurring bug classes.** A 158-agent audit found 38 defects, mostly
these:

1. **Service-role and SECURITY DEFINER code bypasses RLS entirely.** Crons run
   as the service role. Every card read/write on those paths scopes by `user_id`
   explicitly, in code.
2. **PostgREST silently caps any request at 1000 rows.** `.limit(20000)` is a
   lie. Anything feeding a sum, count, membership set, idempotency guard or
   destructive rebuild uses `readAll` / `readAllSafe`.

## Credits

Users buy computation credits on the WEBSITE — not in-app, which avoids the
app-store cut on digital goods — and spend them on metered AI work. Currently
**shadow mode**: measured, nothing enforced, nothing user-visible.

- Retail price is **decoupled** from measured cost. Reprice retail without
  redefining what a credit is.
- **Flat per-operation pricing.** Prompt-cache savings are margin, not a
  variable discount — a run that costs 9 credits one day and 4 the next is worse
  for the user than a stable number. Cache the SHARED prefix only, never one
  user's card data.
- Plan grants **expire** at period end; purchased top-ups do not. Spending draws
  the soonest-expiring bucket first, so nothing evaporates that could have been
  used.

## Storage

Metered by summing `card_photos.bytes` — recorded on write, never computed by
scanning the bucket. A number you have to scan for is a number you will
eventually get wrong.

The bucket caps objects at 25 MB, images only, because the browser now writes to
it directly.

**Not built: quotas.** Measurement is done; there is nothing to enforce until
plan tiers and prices exist. See [[INBOX]].

## Cutover interlock — do not "fix" these

Until Master-Ops sheds its card crons:

- `CRON_SECRET` stays **unset** on the card-ops Vercel project. The six crons
  returning 401 IS the double-run protection.
- eBay stays single-homed on Master-Ops.
- The web-push client stack isn't ported. Deliberate, not an oversight.

The tax advisor stays on Master-Ops permanently — it reads the shared Supabase.

## Migrations

**Never applied automatically.** Beau pastes them by hand; the app provides
paste-ready SQL. A fresh standalone rebuild is `supabase/bootstrap/`.

## Open

<!-- -->

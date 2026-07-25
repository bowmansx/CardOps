-- ══════════════════════════════════════════════════════════════════════════
-- CardOps — PENDING MIGRATIONS, all four in order. ONE paste.
--
-- Generated 2026-07-25 from supabase/migrations/.
-- Paste the whole thing into the Supabase SQL editor and Run.
--
-- Expected: "Success. No rows returned."
--
-- The SQL editor runs this as a SINGLE TRANSACTION, which is deliberately
-- safer than four separate pastes: if any statement fails, the whole thing
-- rolls back and you are exactly where you started -- no half-applied schema
-- to unpick by hand.
--
-- If Supabase warns about destructive operations or RLS, choose "Run without
-- RLS" -- these migrations enable RLS themselves, table by table.
--
-- AFTER this succeeds, run supabase/tests/money-core.test.sql separately.
-- It reports inside a RED ERROR BOX on purpose (raising is how it rolls its
-- own test data back). Expect: 39 of 39 PASSED.
-- ══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══  PART 1 of 4  ·  20260737000000_credit_metering.sql
-- ═══  Credit ledger v2 + AI cost telemetry (shadow mode)
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- CREDIT METERING v2 + AI COST TELEMETRY (Beau, 2026-07-25)
--
-- The business model: users buy computation credits on the website and spend
-- them on metered AI work. Decisions locked with Beau:
--   · plan grants EXPIRE at period end (rollover capped at 1× allowance, 30d)
--   · purchased top-ups NEVER expire
--   · spending consumes the soonest-expiring bucket first (FIFO by expiry)
--   · retail price (credits, src/lib/cards/credits.ts COST table) is decoupled
--     from measured cost (ai_usage.cost_usd) — cache savings are margin
--   · SHADOW MODE now: everything records, nothing is refused. The
--     'credit_enforcement' service_config flag flips the app-side gate on.
--
-- What this migration does:
--   A. ai_usage — real token/cost telemetry per AI run (the measurement layer)
--   B. credit_ledger v2 — kind / expires_at / remaining / shortfall columns
--   C. credit_balance() v2, credit_grant(), credit_spend() (FIFO draw)
--   D. seeds the (off) enforcement flag
--
-- Ordering rule (prevention rule 7): the app charges AFTER the effect — the
-- estimate row lands first, then credit_spend records the draw. That is why
-- credit_spend never refuses: by the time it runs, the compute already
-- happened; refusing would hide a real cost. Refusal (when enforcement is on)
-- happens in app code BEFORE the AI call, via the same remaining-sum this
-- file's balance function uses.
-- ══════════════════════════════════════════════════════════════════════════

-- ── A. Usage telemetry — every metered vendor call, not just AI ────────────
--
-- ONE table, because users spend ONE currency. But vendor expenses have three
-- different COST SHAPES, and conflating them produces nonsense numbers:
--
--   'metered'      Anthropic tokens, Ximilar per-call. The dollar cost of a
--                  single call is known at call time -> cost_usd is real.
--   'subscription' PriceCharting, TheCardAPI. Flat monthly fee + quota: the
--                  marginal cost of one more call is $0 until the cap, then a
--                  step function. cost_usd is NULL by design — the true cost
--                  is the monthly fee ALLOCATED across the units actually
--                  consumed (see the usage_month_cost view below), which is a
--                  month-end number, not a call-time one.
--   'free'         Scryfall, eBay. No dollars; the scarce thing is quota.
--                  Metered anyway so a runaway loop is visible before it
--                  becomes a rate-limit outage.
--
-- So: ALWAYS record units; record dollars only where dollars are knowable.
-- cost_usd NULL therefore means "not directly attributable" — read alongside
-- cost_model, never silently treated as $0 (rule 9).
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  vendor text not null,                -- 'anthropic' | 'thecardapi' | 'pricecharting' | 'ximilar' | 'ebay' | 'scryfall'
  cost_model text not null default 'metered',
  feature text not null,               -- mirrors the ledger reason, e.g. 'estimate:standard_plus'
  model text,                          -- AI model id; null for non-AI vendors
  units integer not null default 1,    -- quota units consumed (1 = one call)
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6),             -- metered vendors only; null elsewhere BY DESIGN
  credits_charged integer not null default 0, -- 0 when the run wasn't billed (e.g. estimate not stored)
  ref uuid,                            -- card id / job id
  created_at timestamptz not null default now(),
  constraint usage_events_cost_model_chk check (cost_model in ('metered', 'subscription', 'free'))
);
create index if not exists usage_events_created_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_idx on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_vendor_idx on public.usage_events (vendor, created_at desc);

-- Service-role writes only; the owner margin screen reads via the service
-- client. RLS on with no policies = closed to every non-service caller.
alter table public.usage_events enable row level security;

-- Month-end allocation: a subscription's fee spread across the units it
-- actually served that month. This is the ONLY honest per-call cost for a
-- fixed-fee vendor, and it falls as volume rises — which is the whole point
-- of watching it. Metered vendors report their real summed dollars instead.
create or replace view public.usage_month_cost as
select
  date_trunc('month', u.created_at) as month,
  u.vendor,
  u.cost_model,
  count(*)                          as calls,
  sum(u.units)                      as units,
  sum(u.credits_charged)            as credits_charged,
  sum(u.cost_usd)                   as direct_cost_usd,
  count(*) filter (where u.cost_usd is null and u.cost_model = 'metered') as unpriced_calls,
  case when u.cost_model = 'subscription'
    then (select sc.monthly_cost_est from public.service_config sc where sc.key = u.vendor)
  end                               as monthly_fee_usd,
  case when u.cost_model = 'subscription' and sum(u.units) > 0
    then (select sc.monthly_cost_est from public.service_config sc where sc.key = u.vendor) / sum(u.units)
  end                               as allocated_cost_per_unit
from public.usage_events u
group by 1, 2, 3;

-- ── B. credit_ledger v2 ────────────────────────────────────────────────────
alter table public.credit_ledger
  add column if not exists kind text not null default 'adjustment',
  add column if not exists expires_at timestamptz,
  add column if not exists remaining integer,
  add column if not exists shortfall integer not null default 0;

-- Backfill any pre-v2 rows (a freshly-bootstrapped DB has none): negatives
-- become spends; positives become grants funded at face value, then reduced
-- oldest-first by the total already spent — the same answer the old
-- sum(delta) balance gave.
do $$
declare v_user uuid; v_owe int; r record;
begin
  -- RE-ENTRY GUARD. Every other statement in this file is deliberately
  -- re-runnable (if not exists / or replace / on conflict) because migrations
  -- here are pasted by hand and files get re-pasted. This block is the one
  -- destructive statement: it re-applies each user's ENTIRE lifetime spend
  -- against their grant remainders, so a second run would silently debit
  -- already-reconciled spends again (1000-grant with 700 left and 300 spent
  -- becomes 400, then 100, then 0) with no error and no log. Bail out unless
  -- there is genuinely pre-v2 data to convert.
  if not exists (
    select 1 from public.credit_ledger
    where (delta < 0 and kind <> 'spend') or (delta > 0 and remaining is null)
  ) then
    return; -- already migrated (or an empty ledger) — nothing to backfill
  end if;

  update public.credit_ledger set kind = 'spend', remaining = null
    where delta < 0 and kind <> 'spend';
  update public.credit_ledger set remaining = delta
    where delta > 0 and remaining is null;
  for v_user in select distinct user_id from public.credit_ledger loop
    select coalesce(-sum(delta), 0) into v_owe
      from public.credit_ledger where user_id = v_user and kind = 'spend';
    for r in select id, remaining from public.credit_ledger
      where user_id = v_user and kind <> 'spend' and remaining > 0
      order by created_at, id
    loop
      exit when v_owe <= 0;
      update public.credit_ledger
        set remaining = greatest(0, remaining - v_owe) where id = r.id;
      v_owe := v_owe - r.remaining;
    end loop;
  end loop;
end $$;

alter table public.credit_ledger drop constraint if exists credit_ledger_kind_chk;
alter table public.credit_ledger add constraint credit_ledger_kind_chk
  check (kind in ('plan_grant', 'rollover', 'purchase', 'promo', 'adjustment', 'spend'));
alter table public.credit_ledger drop constraint if exists credit_ledger_shape_chk;
alter table public.credit_ledger add constraint credit_ledger_shape_chk check (
  (kind = 'spend' and delta < 0 and remaining is null)
  or (kind <> 'spend' and delta > 0 and remaining is not null
      and remaining >= 0 and remaining <= delta)
);
create index if not exists credit_ledger_draw_idx
  on public.credit_ledger (user_id, expires_at asc nulls last, id asc)
  where kind <> 'spend' and remaining > 0;

-- ── C. functions ───────────────────────────────────────────────────────────

-- Balance v2: what the signed-in user can actually spend — unexpired grant
-- remainders. (The old sum(delta) counted expired grants forever and let
-- spends push the number negative silently.)
create or replace function public.credit_balance()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(remaining), 0)::int from public.credit_ledger
  where user_id = auth.uid() and kind <> 'spend'
    and (expires_at is null or expires_at > now());
$$;
revoke all on function public.credit_balance() from public;
grant execute on function public.credit_balance() to authenticated;

-- Grant credits. Service role (Stripe webhook, admin jobs) or the owner
-- (test grants from the credits screen). Positive grants only — spends go
-- through credit_spend so FIFO accounting can never be bypassed.
create or replace function public.credit_grant(
  p_user uuid, p_amount integer, p_kind text default 'adjustment',
  p_expires_at timestamptz default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_id bigint;
begin
  if v_role <> 'service_role' and not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  ) then
    raise exception 'credit_grant: only the owner or the service role may grant credits';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit_grant: amount must be a positive integer';
  end if;
  if p_kind not in ('plan_grant', 'rollover', 'purchase', 'promo', 'adjustment') then
    raise exception 'credit_grant: invalid kind %', p_kind;
  end if;
  insert into public.credit_ledger (user_id, delta, kind, expires_at, remaining, reason)
    values (p_user, p_amount, p_kind, p_expires_at, p_amount, p_reason)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'granted', p_amount,
    'balance', (select coalesce(sum(remaining), 0) from public.credit_ledger
      where user_id = p_user and kind <> 'spend'
        and (expires_at is null or expires_at > now())));
end $$;
revoke all on function public.credit_grant(uuid, integer, text, timestamptz, text) from public;
grant execute on function public.credit_grant(uuid, integer, text, timestamptz, text) to authenticated, service_role;

-- Record a spend, drawing FIFO from the soonest-expiring unexpired grants.
-- Service role only (both app call sites run on the service client, after the
-- effect exists). NEVER refuses: if the buckets can't cover it, the uncovered
-- part lands in `shortfall` on the spend row — visible, not hidden. The
-- pre-flight refusal (enforcement mode) is app code, before the AI call.
create or replace function public.credit_spend(
  p_user uuid, p_amount integer, p_reason text, p_ref uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_need integer; v_take integer; r record;
begin
  if v_role <> 'service_role' then
    raise exception 'credit_spend: service role only';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit_spend: amount must be a positive integer';
  end if;
  v_need := p_amount;
  for r in select id, remaining from public.credit_ledger
    where user_id = p_user and kind <> 'spend' and remaining > 0
      and (expires_at is null or expires_at > now())
    order by expires_at asc nulls last, id asc
    for update
  loop
    exit when v_need = 0;
    v_take := least(r.remaining, v_need);
    update public.credit_ledger set remaining = remaining - v_take where id = r.id;
    v_need := v_need - v_take;
  end loop;
  insert into public.credit_ledger (user_id, delta, kind, reason, ref, shortfall)
    values (p_user, -p_amount, 'spend', p_reason, p_ref, v_need);
  return jsonb_build_object('spent', p_amount, 'covered', p_amount - v_need,
    'shortfall', v_need,
    'balance', (select coalesce(sum(remaining), 0) from public.credit_ledger
      where user_id = p_user and kind <> 'spend'
        and (expires_at is null or expires_at > now())));
end $$;
revoke all on function public.credit_spend(uuid, integer, text, uuid) from public;
grant execute on function public.credit_spend(uuid, integer, text, uuid) to service_role;

-- ── D. enforcement flag — OFF (shadow mode) until billing exists ───────────
insert into public.service_config (key, enabled, notes)
values ('credit_enforcement', false,
  'ON = estimate runs are refused when the credit balance cannot cover them. OFF = shadow mode: spends record (with shortfall) but nothing is blocked.')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══  PART 2 of 4  ·  20260738000000_card_identities.sql
-- ═══  Shared card identity + market data
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- CARD IDENTITY LAYER (Beau, 2026-07-25) — the foundation for multiple users.
--
-- THE PROBLEM. Market data was keyed to a USER'S CARD ROW:
--   card_market_sales.card_id -> cards(id) on delete cascade
-- so twenty people owning the same 2020 Prizm Herbert PSA 10 meant twenty
-- separate fetches, twenty copies, twenty vendor charges — and each copy
-- started EMPTY the day that user added the card. Deleting the card destroyed
-- the history. Liquidity needs 90-365 days of sales while the vendor's free
-- tier only looks back 3 days, so a new user's collection reads "too thin to
-- say" for months. That is a cold start we would ship to every customer.
--
-- THE FIX. A canonical PRINT IDENTITY — one row per real-world card, shared
-- across every tenant — with market sales attached to the identity instead of
-- to somebody's copy of it. Consequences, all good:
--   · vendor spend falls as ownership overlaps (the whole point at scale)
--   · a new user inherits every day of history we have ever collected
--   · liquidity works on day one instead of month six
--   · deleting a card no longer destroys shared market data
--
-- SCOPE NOTE. Identity is the card AS PRINTED (set/year/player/number/
-- parallel). Grader and grade are properties of a COPY and of each observed
-- sale, not of the identity — sales carry their own grader/grade and the
-- pricing code already filters them to match the card's condition. Do not add
-- grade to the fingerprint: it would re-fragment exactly what this unifies.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Deterministic normalization ────────────────────────────────────────────
-- ONE implementation, in SQL, called from a trigger — never mirrored in TS.
-- Two implementations of a fingerprint drift, and a drifted fingerprint
-- silently splits one identity into two (re-creating the cold start it exists
-- to prevent). '~' marks an absent part so positions can't shift.
create or replace function public.norm_token(p text)
returns text language sql immutable as $$
  select coalesce(nullif(regexp_replace(lower(trim(coalesce(p, ''))), '[^a-z0-9]+', '', 'g'), ''), '~');
$$;

create or replace function public.card_fingerprint(
  p_sport text, p_year int, p_set text, p_player text, p_number text, p_parallel text
) returns text language sql immutable as $$
  select public.norm_token(p_sport) || '|' ||
         coalesce(p_year::text, '~')  || '|' ||
         public.norm_token(p_set)     || '|' ||
         public.norm_token(p_player)  || '|' ||
         public.norm_token(p_number)  || '|' ||
         public.norm_token(p_parallel);
$$;

-- ── The shared catalog ─────────────────────────────────────────────────────
create table if not exists public.card_identities (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  sport_category text,
  year int,
  set_name text,
  player text,
  card_number text,
  parallel text,
  -- When the market feed last pulled for this identity. Lets the refresh job
  -- rotate over IDENTITIES (fetch once, serve every owner) instead of over
  -- cards (fetch once per owner for the same data).
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists card_identities_refresh_idx
  on public.card_identities (last_refreshed_at asc nulls first);
create index if not exists card_identities_player_idx on public.card_identities (player);

-- Catalog facts are not tenant data: any card user reads them. Nobody writes
-- directly — writes go through resolve_card_identity below, so one tenant can
-- never corrupt or enumerate-poison the shared table.
alter table public.card_identities enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_identities' and policyname='card_identities_read') then
    create policy card_identities_read on public.card_identities
      for select to authenticated using (public.has_card_access());
  end if;
end $$;

-- ── Resolve (upsert-and-return) ────────────────────────────────────────────
create or replace function public.resolve_card_identity(
  p_sport text, p_year int, p_set text, p_player text, p_number text, p_parallel text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_fp text; v_id uuid;
begin
  -- SECURITY DEFINER writing to a CROSS-TENANT table: gate it. Without this,
  -- any authenticated account — including one with no card access at all —
  -- could write unlimited rows into the shared catalog every other tenant
  -- reads. The definer bypasses RLS, so the check has to live here.
  if not public.has_card_access() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'resolve_card_identity: card access required';
  end if;
  -- Too little to identify anything: no player AND no set means this would be
  -- a junk identity that every under-filled card in the system collides into.
  if public.norm_token(p_player) = '~' and public.norm_token(p_set) = '~' then
    return null;
  end if;
  v_fp := public.card_fingerprint(p_sport, p_year, p_set, p_player, p_number, p_parallel);
  select id into v_id from public.card_identities where fingerprint = v_fp;
  if v_id is not null then return v_id; end if;
  -- on conflict handles the race between two users adding the same card at once
  insert into public.card_identities
    (fingerprint, sport_category, year, set_name, player, card_number, parallel)
  values (v_fp, p_sport, p_year, p_set, p_player, p_number, p_parallel)
  on conflict (fingerprint) do update set fingerprint = excluded.fingerprint
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.resolve_card_identity(text, int, text, text, text, text) from public;
grant execute on function public.resolve_card_identity(text, int, text, text, text, text) to authenticated, service_role;

-- ── Cards point at their identity, maintained by TRIGGER ───────────────────
-- A trigger, not app code: intake, CSV import, Speed Book, the manual form and
-- anything added later all get an identity without remembering to ask for one.
-- One place to be right.
alter table public.cards add column if not exists identity_id uuid references public.card_identities(id);
create index if not exists cards_identity_idx on public.cards (identity_id);

create or replace function public.cards_set_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.identity_id := public.resolve_card_identity(
    new.sport_category, new.year, new.set_name, new.player, new.card_number, new.parallel);
  return new;
end $$;

drop trigger if exists cards_identity_biu on public.cards;
create trigger cards_identity_biu
  before insert or update of sport_category, year, set_name, player, card_number, parallel
  on public.cards for each row execute function public.cards_set_identity();

-- Backfill (no-op on a fresh install). Updating identity_id does not re-fire
-- the trigger above, which watches only the identifying columns.
update public.cards
   set identity_id = public.resolve_card_identity(sport_category, year, set_name, player, card_number, parallel)
 where identity_id is null;

-- ── Market sales move to the identity ──────────────────────────────────────
alter table public.card_market_sales
  add column if not exists identity_id uuid references public.card_identities(id) on delete cascade;

update public.card_market_sales m
   set identity_id = c.identity_id
  from public.cards c
 where m.card_id = c.id and m.identity_id is null;

-- Dedup by identity now.
--
-- NOT a partial index. It was `where identity_id is not null`, which looked
-- tidier and silently broke the entire layer: Postgres only infers a PARTIAL
-- unique index as an ON CONFLICT arbiter when the statement repeats the index
-- predicate, and PostgREST's `on_conflict=` can only emit a bare column list.
-- Every upsert from the refresh cron would have failed with 42P10 — and that
-- error was swallowed — so card_market_sales would never have gained a row
-- while the run reported success. NULL identity_ids are distinct in a plain
-- unique index anyway, so the predicate bought nothing.
drop index if exists public.card_market_sales_dedup;
create unique index if not exists card_market_sales_identity_dedup
  on public.card_market_sales (identity_id, source, external_id);
create index if not exists card_market_sales_identity_sold_idx
  on public.card_market_sales (identity_id, sold_at desc);

-- ── RLS: the sales are SHARED market facts, not tenant data ───────────────
-- 20260724 (multi-tenant) had replaced the original shared policy with
-- `owns_card(card_id)`. Left alone, that would have defeated this entire
-- migration: rows are written with the group representative's card_id, so
-- every OTHER owner of the same identity would read an empty history — and
-- once card_id goes NULL on delete, owns_card(null) is false and the row
-- becomes invisible to everyone, forever.
--
-- Reads: any card user (these are public marketplace observations, keyed to a
-- catalog identity — the same posture as card_identities above).
-- Writes: SERVICE ROLE ONLY. A tenant-writable shared table would let anyone
-- inject fabricated sales into an identity that prices everyone else's copies.
do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='card_market_sales' and policyname='card_market_sales_own') then
    drop policy card_market_sales_own on public.card_market_sales;
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='card_market_sales' and policyname='card_market_sales_all') then
    drop policy card_market_sales_all on public.card_market_sales;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_market_sales' and policyname='card_market_sales_read') then
    create policy card_market_sales_read on public.card_market_sales
      for select to authenticated using (public.has_card_access());
  end if;
end $$;
-- No INSERT/UPDATE/DELETE policy: authenticated callers cannot write. The
-- price-refresh cron writes with the service client, which bypasses RLS.

-- card_id survives as provenance (which copy first caused us to fetch this),
-- but MUST NOT cascade: deleting one user's card can no longer delete market
-- history that every other owner of that card depends on.
alter table public.card_market_sales alter column card_id drop not null;
alter table public.card_market_sales drop constraint if exists card_market_sales_card_id_fkey;
alter table public.card_market_sales
  add constraint card_market_sales_card_id_fkey
  foreign key (card_id) references public.cards(id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══  PART 3 of 4  ·  20260739000000_investor_assets.sql
-- ═══  Investor asset record, documents, custody
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- WAVE B — THE INVESTOR-ASSET RECORD (Beau, 2026-07-25)
-- Design: reference/DESIGN_WAVE_B.md. Schema half; UI follows.
--
-- The app models a card as dealer inventory moving through a sales funnel.
-- An investor asset is the opposite: it may never be listed, and its value
-- lives in DOCUMENTATION. The questions are "can I prove my basis", "can I
-- prove the chain of custody", "where is it and when is it coming back".
--
-- Three tables, deliberately separate from `cards` (sparse rows, and `cards`
-- is already wide and hit by every list query), plus the tax-bucket
-- inheritance chain and two guarded transitions.
-- ══════════════════════════════════════════════════════════════════════════

-- ── A. Documents — the thing the value actually lives in ───────────────────
-- `proves` is the load-bearing column: it turns a folder of PDFs into an
-- evidence packet, and lets the app say "your basis has no supporting
-- document" instead of showing an undefended number.
create table if not exists public.card_documents (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  proves text not null check (proves in
    ('basis','reported_value','grade','insured_value','custody','title','provenance','other')),
  kind text,                         -- 'appraisal','form_706','cert','receipt','policy'
  bucket text not null default 'receipts',
  path text not null,
  doc_date date,
  bytes bigint,
  -- Integrity: evidence that can't be shown unaltered is weaker evidence, and
  -- this is what makes the backup VERIFIABLE rather than merely present.
  sha256 text,
  backup_state text not null default 'pending'
    check (backup_state in ('pending','backed_up','failed')),
  backup_error text,
  backed_up_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists card_documents_card_idx on public.card_documents (card_id, created_at desc);
create index if not exists card_documents_backup_idx on public.card_documents (backup_state, created_at)
  where backup_state <> 'backed_up';

alter table public.card_documents enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_documents' and policyname='card_documents_own') then
    create policy card_documents_own on public.card_documents for all to authenticated
      using (public.owns_card(card_id)) with check (public.owns_card(card_id));
  end if;
end $$;

-- ── B. The asset record (1:1 with an investor-bucket card) ─────────────────
create table if not exists public.card_asset_records (
  card_id uuid primary key references public.cards(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  -- provenance: the PARTY, distinct from cards.acquisition_source (the channel)
  acquired_from text,
  acquired_relation text,
  -- basis provenance. The enum is not decoration: §1014 (step-up) vs §1015
  -- (carryover) is the difference between a stepped-up and an inherited-cost
  -- basis, and each carries a different substantiation requirement.
  basis_amount numeric(14,2),
  basis_source text check (basis_source in
    ('purchase_receipt','1014_step_up','1015_carryover','1022_modified','other')),
  basis_doc_id uuid references public.card_documents(id) on delete set null,
  appraisal_author text,
  appraisal_credential text,
  appraisal_date date,
  estate_reported_value numeric(14,2),
  -- The most commonly missed rule in stepped-up basis; surfaced as a warning.
  reported_value_caps_basis boolean not null default false,
  -- grade verification
  grade_verification text check (grade_verification in
    ('verified','unverified_grader','pending_crossover','crossover_failed')),
  crossover_target_grader text,
  crossover_min_grade numeric(4,1),
  -- insurance. Deliberately its own number: insured value, basis and market
  -- value are three different things and must never be conflated.
  insured_value numeric(14,2),
  insurer text,
  policy_ref text,
  insurance_valued_at date,
  -- legal title, separate from physical custody
  legal_title_holder text check (legal_title_holder in
    ('individual','trust','estate','joint','entity')),
  legal_title_detail text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.card_asset_records enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_asset_records' and policyname='card_asset_records_own') then
    create policy card_asset_records_own on public.card_asset_records for all to authenticated
      using (public.owns_card(card_id)) with check (public.owns_card(card_id));
  end if;
end $$;

-- ── C. Chain of custody — APPEND ONLY ──────────────────────────────────────
-- A chain of custody you can edit is not a chain of custody. Same discipline
-- as purchase_lot_adjustments: insert and select only.
create table if not exists public.card_custody_log (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  from_state text,
  to_state text not null,
  counterparty text,
  location text,
  sent_at timestamptz not null default now(),
  expected_back date,
  -- Stamped on the row that CLOSES a move (the return to possession). It is
  -- NOT used to find open moves: because the log is append-only, an earlier
  -- row is never edited to mark it closed. Current truth lives on
  -- `cards.asset_state`; this log is the history behind it.
  returned_at timestamptz,
  tracking_ref text,
  declared_value numeric(14,2),
  document_id uuid references public.card_documents(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists card_custody_card_idx on public.card_custody_log (card_id, created_at desc);

alter table public.card_custody_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_custody_log' and policyname='card_custody_log_read') then
    create policy card_custody_log_read on public.card_custody_log for select to authenticated
      using (public.owns_card(card_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_custody_log' and policyname='card_custody_log_insert') then
    create policy card_custody_log_insert on public.card_custody_log for insert to authenticated
      with check (public.owns_card(card_id));
  end if;
end $$;
-- No UPDATE or DELETE policy exists, so RLS refuses both for authenticated
-- callers. Belt and braces for anything running as a definer:
create or replace function public.guard_custody_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'card_custody_log is append-only: correct by adding a row, never by editing one';
end $$;
drop trigger if exists custody_append_only on public.card_custody_log;
create trigger custody_append_only before update or delete on public.card_custody_log
  for each row execute function public.guard_custody_append_only();

-- ── D. Cards: the tax-bucket inheritance chain + asset state ───────────────
-- ONE authoritative value with a documented lineage, never two sources of
-- truth. The LOT carries the default (a purchase usually has one intent); the
-- CARD carries the resolved value, because the tax test is per-property and
-- the Schedule D line is per-card — and one lot legitimately holds two intents
-- (buy 500 to flip 490, keep 10).
alter table public.cards
  add column if not exists tax_bucket text
    check (tax_bucket in ('investment','dealer','hobby')),
  add column if not exists tax_bucket_source text
    check (tax_bucket_source in ('lot_default','explicit_override')),
  add column if not exists tax_bucket_set_at timestamptz,
  add column if not exists tax_bucket_reason text,
  -- Orthogonal to `status`. A vaulted asset is not 'hold' — it has a funnel
  -- position AND a physical disposition, and collapsing them loses one.
  add column if not exists asset_state text
    check (asset_state in ('in_my_possession','at_appraisal','out_for_crossover',
                           'at_auction_house_on_consignment','vaulted',
                           'pledged_as_collateral','crossover_failed'));
create index if not exists cards_asset_state_idx on public.cards (asset_state)
  where asset_state is not null;
create index if not exists cards_tax_bucket_idx on public.cards (user_id, tax_bucket);

-- Inherit the lot's bucket at creation. Same trigger philosophy as identity:
-- one place, so no intake path can forget.
create or replace function public.cards_inherit_tax_bucket()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bucket text;
begin
  if new.tax_bucket is null and new.purchase_lot_id is not null then
    select tax_bucket into v_bucket from public.purchase_lots where id = new.purchase_lot_id;
    if v_bucket is not null then
      new.tax_bucket := v_bucket;
      new.tax_bucket_source := 'lot_default';
      new.tax_bucket_set_at := now();
      new.tax_bucket_reason := 'inherited from purchase lot';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_tax_bucket_bi on public.cards;
create trigger cards_tax_bucket_bi before insert on public.cards
  for each row execute function public.cards_inherit_tax_bucket();

-- Reclass is an explicit ACTION, not an edit. A tax classification that can be
-- silently changed is not defensible; this forces a reason and an audit row.
-- Guards the WHOLE provenance record, not just the value. Watching only
-- `tax_bucket` left the three columns that make it defensible — source, when,
-- and why — freely editable, so a classification could keep its audit trail
-- while the trail was quietly rewritten to say something else.
create or replace function public.guard_tax_bucket()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.tax_bucket is distinct from old.tax_bucket
      or new.tax_bucket_source is distinct from old.tax_bucket_source
      or new.tax_bucket_set_at is distinct from old.tax_bucket_set_at
      or new.tax_bucket_reason is distinct from old.tax_bucket_reason)
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('cardops.in_reclass', true), '') <> '1' then
    raise exception 'tax_bucket is a classification, not a field: use card_reclass_tax_bucket';
  end if;
  return new;
end $$;

-- asset_state had NO guard at all, which made the pledged-collateral block
-- bypassable in two calls: set asset_state to something else, then sell. It
-- also let the card's state drift away from the custody log that is supposed
-- to be its history. Both now require going through card_move_asset.
create or replace function public.guard_asset_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.asset_state is distinct from old.asset_state
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('cardops.in_move', true), '') <> '1' then
    raise exception 'asset_state is a custody transition: use card_move_asset';
  end if;
  return new;
end $$;
drop trigger if exists cards_asset_state_guard on public.cards;
create trigger cards_asset_state_guard before update on public.cards
  for each row execute function public.guard_asset_state();
drop trigger if exists cards_tax_bucket_guard on public.cards;
create trigger cards_tax_bucket_guard before update on public.cards
  for each row execute function public.guard_tax_bucket();

create or replace function public.card_reclass_tax_bucket(
  p_card uuid, p_bucket text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text; v_uid uuid := auth.uid();
begin
  if p_bucket not in ('investment','dealer','hobby') then
    raise exception 'card_reclass_tax_bucket: bucket must be investment, dealer or hobby';
  end if;
  -- The reason is the point: it is what makes the classification defensible
  -- later, and the app records YOUR determination, it does not make one.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'card_reclass_tax_bucket: a reason is required';
  end if;
  select tax_bucket into v_old from public.cards where id = p_card and user_id = v_uid;
  if not found then raise exception 'card_reclass_tax_bucket: card not found'; end if;

  perform set_config('cardops.in_reclass', '1', true);
  update public.cards
     set tax_bucket = p_bucket, tax_bucket_source = 'explicit_override',
         tax_bucket_set_at = now(), tax_bucket_reason = p_reason
   where id = p_card and user_id = v_uid;
  perform set_config('cardops.in_reclass', '', true);

  insert into public.audit_log (actor, action, target, payload, result)
  values ('web', 'card.tax_bucket.reclass', p_card::text,
          jsonb_build_object('from', v_old, 'to', p_bucket, 'reason', p_reason, 'user_id', v_uid),
          'ok');
  return jsonb_build_object('card_id', p_card, 'from', v_old, 'to', p_bucket);
end $$;
revoke all on function public.card_reclass_tax_bucket(uuid, text, text) from public;
grant execute on function public.card_reclass_tax_bucket(uuid, text, text) to authenticated;

-- ── E. Custody moves — the state machine ───────────────────────────────────
-- Every transition writes a log row; that log IS the chain of custody. Every
-- state except in_my_possession and vaulted requires an expected return date,
-- because a consignment with no return date is itself a finding.
create or replace function public.card_move_asset(
  p_card uuid, p_to_state text, p_counterparty text default null,
  p_location text default null, p_expected_back date default null,
  p_tracking text default null, p_declared_value numeric default null,
  p_note text default null, p_document uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from text; v_uid uuid := auth.uid();
begin
  if p_to_state not in ('in_my_possession','at_appraisal','out_for_crossover',
                        'at_auction_house_on_consignment','vaulted',
                        'pledged_as_collateral','crossover_failed') then
    raise exception 'card_move_asset: unknown state %', p_to_state;
  end if;
  select asset_state into v_from from public.cards where id = p_card and user_id = v_uid;
  if not found then raise exception 'card_move_asset: card not found'; end if;
  if p_to_state not in ('in_my_possession','vaulted') and p_expected_back is null then
    raise exception 'card_move_asset: % requires an expected return date', p_to_state;
  end if;

  perform set_config('cardops.in_move', '1', true);
  update public.cards set asset_state = p_to_state where id = p_card and user_id = v_uid;
  perform set_config('cardops.in_move', '', true);

  insert into public.card_custody_log
    (card_id, user_id, from_state, to_state, counterparty, location, expected_back,
     tracking_ref, declared_value, document_id, note,
     returned_at)
  values (p_card, v_uid, v_from, p_to_state, p_counterparty, p_location, p_expected_back,
          p_tracking, p_declared_value, p_document, p_note,
          case when p_to_state = 'in_my_possession' then now() end);

  return jsonb_build_object('card_id', p_card, 'from', v_from, 'to', p_to_state);
end $$;
revoke all on function public.card_move_asset(uuid, text, text, text, date, text, numeric, text, uuid) from public;
grant execute on function public.card_move_asset(uuid, text, text, text, date, text, numeric, text, uuid) to authenticated;

-- The aging board: assets out of your hands, with the expected-return date
-- from the move that put them there. Derived from the CARD's current state
-- (truth) joined to its latest custody row (context) — never from a mutable
-- flag on the log.
-- security_invoker: a view runs as its OWNER by default, which would bypass
-- every RLS policy underneath it and hand each authenticated user a list of
-- EVERY tenant's out-of-possession assets — counterparty, location, declared
-- value. The whole aging board is a leak without this one setting.
create or replace view public.card_assets_out
with (security_invoker = true) as
select c.id as card_id, c.user_id, c.player, c.year, c.set_name, c.asset_state,
       l.counterparty, l.location, l.sent_at, l.expected_back, l.declared_value,
       case
         when l.expected_back is null then 'no_due_date'
         when l.expected_back < current_date then 'overdue'
         else 'ok'
       end as aging
from public.cards c
join lateral (
  select * from public.card_custody_log cl
  where cl.card_id = c.id order by cl.created_at desc, cl.id desc limit 1
) l on true
where c.asset_state is not null
  and c.asset_state not in ('in_my_possession','vaulted');

-- ── F. Pledged property cannot be sold ─────────────────────────────────────
-- Enforced in the database, not hidden in the UI — selling property pledged as
-- collateral is the kind of mistake that ends relationships.
create or replace function public.guard_pledged_not_sold()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('sold','listed')
     and old.asset_state = 'pledged_as_collateral' then
    raise exception 'this asset is pledged as collateral — release it before listing or selling';
  end if;
  return new;
end $$;
drop trigger if exists cards_pledged_guard on public.cards;
create trigger cards_pledged_guard before update on public.cards
  for each row execute function public.guard_pledged_not_sold();

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══  PART 4 of 4  ·  20260740000000_photo_provenance_storage.sql
-- ═══  Photo provenance + storage metering
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- PHOTO PROVENANCE + STORAGE METERING (Beau, 2026-07-25)
-- Design: reference/DESIGN_PHOTO_SYSTEM.md §4 (crop integrity) and §6 (storage).
--
-- Two jobs, both of which get much harder the longer they wait:
--
-- 1. PROVENANCE. The camera now keeps the full uncropped frame beside the
--    margin crop. Until this migration there was nowhere to say which is
--    which, and — worse — the CROPPED image was being stored as
--    variant='original', so the labels actively lied. Corners and edges are
--    the grade; the record of which pixels were removed has to be part of the
--    row, not folklore.
--
-- 2. MEASUREMENT. Storage is the second meter beside credits, and unlike AI
--    spend it recurs every month forever whether or not the user ever returns.
--    You cannot bill, cap, or even warn on bytes you never recorded, and the
--    history is unrecoverable if measurement starts late — so `bytes` lands
--    now, long before any quota exists to enforce.
-- ══════════════════════════════════════════════════════════════════════════

-- ── A. card_photos: provenance + size ──────────────────────────────────────
alter table public.card_photos
  -- Which shot in a template this is. Wider than the old front/back/slab/defect
  -- so corner and surface shots (the grading template) have somewhere to live.
  add column if not exists role text,
  -- Points at the uncropped frame this was derived from. Null on originals.
  add column if not exists derived_from uuid references public.card_photos(id) on delete set null,
  -- {quad, margin_pct, deskewed} — how the derivative was produced, so any
  -- crop can be audited against its source rather than trusted.
  add column if not exists crop_geometry jsonb,
  add column if not exists width int,
  add column if not exists height int,
  -- REQUIRED for metering. Nullable only so pre-existing rows don't block the
  -- migration; new writes always set it.
  add column if not exists bytes bigint,
  add column if not exists capture_meta jsonb;

create index if not exists card_photos_derived_idx on public.card_photos (derived_from)
  where derived_from is not null;

-- The old CHECK only allowed front/back/slab/defect. Template shots need more.
alter table public.card_photos drop constraint if exists card_photos_kind_check;
alter table public.card_photos add constraint card_photos_kind_check check (kind in
  ('front','back','slab','defect',
   'corner_tl','corner_tr','corner_bl','corner_br',
   'corner_tl_back','corner_tr_back','corner_bl_back','corner_br_back',
   'surface_angle','edge','other'));

-- ── B. Per-user storage rollup ─────────────────────────────────────────────
-- Maintained on write. NOT computed by scanning the bucket: a number you have
-- to go and calculate is a number nobody looks at, and the whole point is to
-- warn a user BEFORE they hit a wall rather than explain it afterwards.
create table if not exists public.user_storage_usage (
  user_id uuid primary key,
  bytes bigint not null default 0,
  objects int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_storage_usage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_storage_usage' and policyname='user_storage_usage_self') then
    create policy user_storage_usage_self on public.user_storage_usage for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- The owner is DENORMALISED onto the photo row, and that is load-bearing.
--
-- Resolving it with `select user_id from cards where id = old.card_id` looked
-- equivalent and was not: card_photos cascade-deletes with its card, so by the
-- time the delete trigger ran the card was already gone, the lookup returned
-- null, and the function bailed before decrementing. Deleting a card silently
-- kept charging the user for its photos forever — and a quota built on that
-- number would have been unfixable after the fact.
alter table public.card_photos add column if not exists user_id uuid;
update public.card_photos p set user_id = c.user_id
  from public.cards c where c.id = p.card_id and p.user_id is null;

create or replace function public.card_photos_set_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    select user_id into new.user_id from public.cards where id = new.card_id;
  end if;
  return new;
end $$;
drop trigger if exists card_photos_owner_bi on public.card_photos;
create trigger card_photos_owner_bi before insert on public.card_photos
  for each row execute function public.card_photos_set_owner();

create or replace function public.bump_storage_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_bytes bigint; v_objects int;
begin
  if tg_op = 'INSERT' then
    v_user := new.user_id;
    v_bytes := coalesce(new.bytes, 0); v_objects := 1;
  elsif tg_op = 'DELETE' then
    v_user := old.user_id;   -- survives the parent card's deletion
    v_bytes := -coalesce(old.bytes, 0); v_objects := -1;
  else
    -- UPDATE: only a size change matters.
    v_user := coalesce(new.user_id, old.user_id);
    v_bytes := coalesce(new.bytes, 0) - coalesce(old.bytes, 0); v_objects := 0;
  end if;
  if v_user is null then return coalesce(new, old); end if;

  insert into public.user_storage_usage (user_id, bytes, objects, updated_at)
  values (v_user, greatest(0, v_bytes), greatest(0, v_objects), now())
  on conflict (user_id) do update
    set bytes = greatest(0, public.user_storage_usage.bytes + v_bytes),
        objects = greatest(0, public.user_storage_usage.objects + v_objects),
        updated_at = now();
  return coalesce(new, old);
end $$;

drop trigger if exists card_photos_storage_ai on public.card_photos;
create trigger card_photos_storage_ai after insert or update of bytes or delete
  on public.card_photos for each row execute function public.bump_storage_usage();

-- Backfill the rollup from whatever is already recorded (no-op on a fresh DB;
-- pre-existing rows have null bytes and simply count as objects).
insert into public.user_storage_usage (user_id, bytes, objects, updated_at)
select c.user_id, coalesce(sum(p.bytes), 0), count(*), now()
from public.card_photos p join public.cards c on c.id = p.card_id
group by c.user_id
on conflict (user_id) do update
  set bytes = excluded.bytes, objects = excluded.objects, updated_at = now();

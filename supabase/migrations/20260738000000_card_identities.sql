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

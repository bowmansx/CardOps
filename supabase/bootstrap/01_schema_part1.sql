-- ══════════════════════════════════════════════════════════════════════════
-- STANDALONE BOOTSTRAP · STEP 1 of 3 — the CardOps migration history,
-- concatenated in order. Run AFTER 00_foundations.sql.
-- ══════════════════════════════════════════════════════════════════════════

-- ═══════════ 20260713150000_cardops_init.sql ═══════════
-- CardOps Phase 1 — Foundations (build contract §2–§3, D-CARD-01..05).
-- Role-based access: owner (Beau) sees everything; card_ops (Berlin) sees only
-- card_* data — never entities/cash/deals. Idempotent: safe to re-run.
-- Cards are owned personally by Beau; CARD entity is the app-level home.

-- ============================================================
-- 0) Retire the empty prototype `cards` table (0 rows; unused).
--    Guarded so a RE-RUN never drops the real (populated) CardOps table:
--    only fires when a `cards` table exists WITHOUT the new `player` column.
--    (The prototype had `sku` too, so `player` — new-schema-only — is the
--    correct discriminator.)
-- ============================================================
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'cards')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cards' and column_name = 'player') then
    drop table public.cards cascade;
  end if;
end $$;

-- ============================================================
-- 1) profiles: add role; seed Beau as owner.
-- ============================================================
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists display_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles add constraint profiles_role_check
      check (role in ('owner','card_ops'));
  end if;
end $$;
-- Seed ONLY Beau as owner (scoped to his email, not "every allowlisted user"
-- — otherwise a later re-run would force a newly-allowlisted card_ops user
-- like Berlin to 'owner'). Idempotent for Beau; never touches other profiles.
insert into public.profiles (id, role, display_name)
select u.id, 'owner', 'Beau'
from auth.users u
where lower(u.email) = 'bowmansx@gmail.com'
on conflict (id) do update set role = 'owner';

-- ============================================================
-- 2) Role helper functions (security definer — read profiles.role).
-- ============================================================
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;
create or replace function public.has_card_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','card_ops'));
$$;
revoke all on function public.is_owner() from public;
revoke all on function public.has_card_access() from public;
grant execute on function public.is_owner() to authenticated, anon;
grant execute on function public.has_card_access() to authenticated, anon;

-- profiles.role is now THE security boundary, but the pre-existing
-- profiles_self policy (schema.sql) allows a user to UPDATE their own row.
-- Without this guard, a card_ops user could PATCH their own role to 'owner'
-- via PostgREST and read everything. Block any authenticated non-owner from
-- setting/changing role; service-role + SQL-editor (auth.role() null) + owner
-- pass through.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if public.is_owner() then return new; end if;
  if tg_op = 'INSERT' and new.role is not null then
    raise exception 'role may not be set by non-owners';
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception 'role may not be changed by non-owners';
  end if;
  return new;
end $$;
drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();

-- ============================================================
-- 3) Lock all MasterOps financial/roster tables to OWNER only, so a
--    card_ops session (Berlin) is denied even via direct PostgREST.
--    (These were is_operator() = "any allowlisted user"; Berlin will be
--    allowlisted to hold a session, so email-gate is no longer enough.)
-- ============================================================
drop policy if exists entities_read_operator on public.entities;
drop policy if exists entities_read_owner on public.entities;
create policy entities_read_owner on public.entities
  for select to authenticated using (public.is_owner());

drop policy if exists critical_dates_rw_operator on public.critical_dates;
drop policy if exists critical_dates_rw_owner on public.critical_dates;
create policy critical_dates_rw_owner on public.critical_dates
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists snapshots_read_operator on public.snapshots;
drop policy if exists snapshots_insert_operator on public.snapshots;
drop policy if exists snapshots_read_owner on public.snapshots;
drop policy if exists snapshots_insert_owner on public.snapshots;
create policy snapshots_read_owner on public.snapshots
  for select to authenticated using (public.is_owner());
create policy snapshots_insert_owner on public.snapshots
  for insert to authenticated with check (public.is_owner());

drop policy if exists push_subscriptions_rw_operator on public.push_subscriptions;
drop policy if exists push_subscriptions_rw_owner on public.push_subscriptions;
create policy push_subscriptions_rw_owner on public.push_subscriptions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists sent_alerts_rw_operator on public.sent_alerts;
drop policy if exists sent_alerts_rw_owner on public.sent_alerts;
create policy sent_alerts_rw_owner on public.sent_alerts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists audit_log_insert_operator on public.audit_log;
drop policy if exists audit_log_insert_owner on public.audit_log;
create policy audit_log_insert_owner on public.audit_log
  for insert to authenticated with check (public.is_owner());

drop policy if exists radar_docs_rw_operator on storage.objects;
drop policy if exists radar_docs_rw_owner on storage.objects;
create policy radar_docs_rw_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'radar-docs' and public.is_owner())
  with check (bucket_id = 'radar-docs' and public.is_owner());

-- ============================================================
-- 4) card_pricing_strategies (referenced by cards) + seed.
-- ============================================================
create table if not exists public.card_pricing_strategies (
  key text primary key,
  label text not null,
  target_rule text not null,
  window_days int,
  min_comps int,
  outlier_rule text,
  params jsonb not null default '{}'::jsonb,
  notes text
);
insert into public.card_pricing_strategies (key,label,target_rule,window_days,min_comps,outlier_rule) values
  ('conservative','Conservative','comp_low_plus_5',90,20,'drop top 15%'),
  ('standard','Standard','comp_avg',60,10,'drop top/bottom 10%'),
  ('aggressive','Aggressive','comp_high_minus_5',30,5,'none'),
  ('hot','Hot','comp_high_plus_10',7,3,'none'),
  ('thin_market','Thin Market','manual_comp_plus_20',null,0,'manual'),
  ('manual_lock','Manual Lock','fixed',null,null,'daemon hands-off')
on conflict (key) do nothing;

-- ============================================================
-- 5) cards (core inventory).
-- ============================================================
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  barcode text unique,
  entity_id uuid references public.entities(id),
  player text, year int, set_name text, card_number text,
  parallel text, language text default 'EN',
  sport_category text,
  team text, is_rookie boolean default false, is_auto boolean default false,
  is_relic boolean default false, serial_number text, print_run int,
  condition_type text not null default 'raw' check (condition_type in ('raw','graded')),
  raw_grade_estimate text,
  grader text, grader_custom text, grade numeric(4,1), cert_number text,
  qualifiers text[],
  acquired_date date,
  acquisition_method text check (acquisition_method in
    ('purchased','inherited','partnership_split','trade','pull')),
  acquisition_source text,
  use_pool_basis boolean not null default true,
  individual_basis numeric(12,2),
  basis_drawn numeric(12,2),
  landed_cost numeric(12,2),
  market_value numeric(12,2),
  pricing_strategy text not null default 'standard' references public.card_pricing_strategies(key),
  manual_price numeric(12,2), price_locked boolean not null default false,
  last_priced_at timestamptz,
  hot_flag boolean default false, news_flag boolean default false, news_notes text,
  gradeup_flag boolean default false, quick_booked boolean not null default false,
  status text not null default 'booked' check (status in
    ('intake','review','booked','listed','sold','hold','graded_out','archived')),
  zone text, location_code text,
  listed_at timestamptz, sold_at timestamptz,
  listing_refs jsonb not null default '{}'::jsonb,
  vision_confidence jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cards_status_idx on public.cards (status);
create index if not exists cards_player_idx on public.cards (player);
create index if not exists cards_sport_idx on public.cards (sport_category);
create index if not exists cards_quickbooked_idx on public.cards (quick_booked) where quick_booked;

-- ============================================================
-- 6) Remaining card_* tables.
-- ============================================================
create table if not exists public.card_photos (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  kind text not null check (kind in ('front','back','slab','defect')),
  variant text not null check (variant in ('original','processed')),
  storage_provider text not null default 'supabase',
  bucket text not null, path text not null,
  width int, height int, bytes int,
  created_at timestamptz not null default now()
);
create table if not exists public.card_valuations (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  grader text not null,
  grade numeric(4,1) not null default 0,
  value numeric(12,2),
  basis_source text not null check (basis_source in ('actual','modeled')),
  confidence numeric(3,2), comp_count int default 0, window_days int,
  as_of timestamptz not null default now(),
  unique (card_id, grader, grade)
);
create table if not exists public.card_comps (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  card_id uuid references public.cards(id),
  source text not null,
  grader text, grade numeric(4,1),
  sale_price numeric(12,2), currency text default 'USD', sale_date date,
  listing_url text, raw jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists card_comps_fp_idx on public.card_comps (fingerprint, sale_date desc);
create table if not exists public.card_grade_multipliers (
  id uuid primary key default gen_random_uuid(),
  grader text not null, grade numeric(4,1) not null,
  category text not null default 'all', era_bucket text not null default 'all',
  multiplier numeric(8,3) not null,
  source text not null default 'seed' check (source in ('seed','fitted')),
  updated_at timestamptz not null default now(),
  unique (grader, grade, category, era_bucket)
);
create table if not exists public.card_price_history (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  price numeric(12,2) not null, strategy text, floor_applied boolean default false,
  ts timestamptz not null default now()
);
create table if not exists public.card_pool (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id),
  name text not null default 'main',
  total_cost numeric(14,2) not null default 0,
  card_count int not null default 0
);
create table if not exists public.card_pool_adjustments (
  id bigint generated always as identity primary key,
  pool_id uuid not null references public.card_pool(id),
  ts timestamptz not null default now(),
  kind text not null check (kind in ('seed','add','draw','rebalance','correction')),
  card_id uuid references public.cards(id),
  amount numeric(12,2) not null,
  total_after numeric(14,2) not null, count_after int not null,
  actor text not null, note text
);
create table if not exists public.card_sales (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id),
  platform text not null,
  sale_price numeric(12,2) not null, fee_pct numeric(5,2), fees numeric(12,2),
  shipping_income numeric(12,2) default 0, shipping_cost numeric(12,2) default 0,
  net_proceeds numeric(12,2), basis_drawn numeric(12,2), profit_loss numeric(12,2),
  order_ref text, sold_at timestamptz not null default now(),
  synced_to_books boolean not null default false
);
create table if not exists public.card_format_profiles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null, platform text not null,
  direction text not null check (direction in ('import','export','both')),
  file_type text not null default 'csv',
  header_hash text,
  column_order text[], field_map jsonb not null,
  transforms jsonb not null default '{}'::jsonb,
  constants jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  learned_from_import boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.card_import_batches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.card_format_profiles(id),
  source_filename text, header_hash text, row_count int,
  status text not null default 'staging',
  created_at timestamptz not null default now()
);
create table if not exists public.card_import_staging (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.card_import_batches(id) on delete cascade,
  raw jsonb not null, mapped jsonb,
  match_kind text check (match_kind in ('new','cert','sku','fuzzy','conflict')),
  matched_card_id uuid references public.cards(id),
  resolution text not null default 'pending' check (resolution in ('pending','create','update','skip')),
  committed boolean not null default false, error text
);
create table if not exists public.card_intake_sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('full','speed')),
  started_at timestamptz not null default now(), ended_at timestamptz, item_count int default 0
);
create table if not exists public.card_intake_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.card_intake_sessions(id) on delete cascade,
  photos jsonb not null default '[]'::jsonb,
  vision_raw jsonb, extracted jsonb, confidences jsonb, cert_lookup jsonb,
  status text not null default 'pending' check (status in ('pending','needs_review','committed','discarded')),
  card_id uuid references public.cards(id),
  created_at timestamptz not null default now()
);
create table if not exists public.card_watchlist (
  id uuid primary key default gen_random_uuid(),
  player text not null, sport text, keywords text[], active boolean not null default true
);
create table if not exists public.card_flag_events (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  flag text not null check (flag in ('hot','news','gradeup')),
  payload jsonb, ts timestamptz not null default now()
);
create table if not exists public.service_config (
  key text primary key,
  enabled boolean not null default false,
  mode text, monthly_cost_est numeric(8,2) default 0,
  last_verified date, notes text
);
create table if not exists public.card_grading_submissions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id),
  grader text not null, submitted_at date, cost numeric(10,2),
  expected_grade numeric(4,1), returned_grade numeric(4,1), returned_at date,
  roi_predicted numeric(12,2), roi_realized numeric(12,2), notes text
);

-- ============================================================
-- 7) Seeds: service_config (all off), generic_full profile,
--    grade multipliers, one card_pool for CARD.
-- ============================================================
insert into public.service_config (key, enabled, monthly_cost_est) values
  ('pricecharting', false, 0),
  ('anthropic_vision', false, 0),
  ('ximilar', false, 0),
  ('ebay_api', false, 0),
  ('stripe', false, 0),
  ('news_feed', false, 0),
  ('storage_r2', false, 0)
on conflict (key) do nothing;

insert into public.card_format_profiles (name, platform, direction, file_type, field_map, learned_from_import)
select 'generic_full', 'generic', 'both', 'csv',
  '{"sku":"sku","player":"player","year":"year","set_name":"set_name","card_number":"card_number","parallel":"parallel","sport_category":"sport_category","condition_type":"condition_type","grader":"grader","grade":"grade","market_value":"market_value","status":"status","zone":"zone","location_code":"location_code"}'::jsonb,
  false
where not exists (select 1 from public.card_format_profiles where name = 'generic_full');

-- Starter modeled-ladder multipliers (rough seeds; fit job refines later).
insert into public.card_grade_multipliers (grader, grade, category, era_bucket, multiplier, source) values
  ('PSA',10,'all','modern',4.0,'seed'), ('PSA',9,'all','modern',1.8,'seed'), ('PSA',8,'all','modern',1.2,'seed'),
  ('PSA',10,'all','vintage',6.0,'seed'), ('PSA',9,'all','vintage',3.0,'seed'), ('PSA',8,'all','vintage',1.8,'seed'),
  ('BGS',9.5,'all','modern',3.0,'seed'), ('BGS',9,'all','modern',1.6,'seed'),
  ('SGC',10,'all','modern',3.5,'seed'), ('SGC',9,'all','modern',1.6,'seed'),
  ('CGC',9.5,'all','modern',2.8,'seed'), ('CGC',9,'all','modern',1.5,'seed')
on conflict (grader, grade, category, era_bucket) do nothing;

insert into public.card_pool (entity_id, name, total_cost, card_count)
select 'bfa6ad79-0d3a-412b-a682-603aa9d23f1d'::uuid, 'main', 0, 0
where not exists (select 1 from public.card_pool where name = 'main');

-- ============================================================
-- 8) Pool ledger is append-only (IRS basis trail).
-- ============================================================
create or replace function public.block_pool_adjustment_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'card_pool_adjustments is append-only';
end $$;
drop trigger if exists card_pool_adjustments_no_mutate on public.card_pool_adjustments;
create trigger card_pool_adjustments_no_mutate
  before update or delete on public.card_pool_adjustments
  for each row execute function public.block_pool_adjustment_mutation();

-- ============================================================
-- 9) RLS per §2 matrix.
--    General card_* : owner all; card_ops select/insert/update, NO delete.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'cards','card_photos','card_valuations','card_comps','card_grade_multipliers',
    'card_price_history','card_format_profiles','card_import_batches',
    'card_import_staging','card_intake_sessions','card_intake_items',
    'card_watchlist','card_flag_events','card_grading_submissions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_card_access())', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_card_access())', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_card_access()) with check (public.has_card_access())', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_owner())', t||'_del', t);
  end loop;
end $$;

-- card_pricing_strategies: read for card access; writes owner-only.
alter table public.card_pricing_strategies enable row level security;
drop policy if exists card_pricing_strategies_sel on public.card_pricing_strategies;
create policy card_pricing_strategies_sel on public.card_pricing_strategies
  for select to authenticated using (public.has_card_access());
drop policy if exists card_pricing_strategies_write on public.card_pricing_strategies;
create policy card_pricing_strategies_write on public.card_pricing_strategies
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- card_pool + adjustments: read-only for card access; writes service-role only.
alter table public.card_pool enable row level security;
drop policy if exists card_pool_sel on public.card_pool;
create policy card_pool_sel on public.card_pool
  for select to authenticated using (public.has_card_access());
alter table public.card_pool_adjustments enable row level security;
drop policy if exists card_pool_adjustments_sel on public.card_pool_adjustments;
create policy card_pool_adjustments_sel on public.card_pool_adjustments
  for select to authenticated using (public.has_card_access());

-- card_sales: owner all; card_ops select + insert.
alter table public.card_sales enable row level security;
drop policy if exists card_sales_sel on public.card_sales;
create policy card_sales_sel on public.card_sales
  for select to authenticated using (public.has_card_access());
drop policy if exists card_sales_ins on public.card_sales;
create policy card_sales_ins on public.card_sales
  for insert to authenticated with check (public.has_card_access());
drop policy if exists card_sales_upd on public.card_sales;
create policy card_sales_upd on public.card_sales
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists card_sales_del on public.card_sales;
create policy card_sales_del on public.card_sales
  for delete to authenticated using (public.is_owner());

-- service_config: owner-only (card_ops none).
alter table public.service_config enable row level security;
drop policy if exists service_config_owner on public.service_config;
create policy service_config_owner on public.service_config
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ============================================================
-- 10) Private card-photos storage bucket (has_card_access).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('card-photos','card-photos', false)
on conflict (id) do nothing;
drop policy if exists card_photos_storage_rw on storage.objects;
create policy card_photos_storage_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'card-photos' and public.has_card_access())
  with check (bucket_id = 'card-photos' and public.has_card_access());

-- Done. Owner sees all; card_ops sees only card_* (+ pool read). Run the RLS
-- test suite (npm run test:rls) before creating Berlin's account.

-- ═══════════ 20260713160000_speed_book_rpc.sql ═══════════
-- CardOps Phase 2 fix: atomic Speed Book commit. The app-side read-modify-write
-- of card_pool was not atomic (lost updates) and could orphan pool-basis cards
-- if a mid-batch insert failed — corrupting the IRS basis trail. This RPC does
-- the whole batch (N card inserts + append-only ledger row + pool increment) in
-- ONE transaction, with the pool row locked so concurrent batches serialize and
-- the increment can't be lost. Photos are uploaded by the caller afterward
-- (best-effort, not part of basis integrity).
--
-- SECURITY DEFINER (writes card_pool, which is service-role-only under RLS) but
-- verifies the CALLER has card access, so it's safe to grant to authenticated.

create or replace function public.speed_book_commit(p_items jsonb, p_lot_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool   public.card_pool%rowtype;
  v_item   jsonb;
  v_cat    text;
  v_year   int := extract(year from now())::int;
  v_prefix text;
  v_seq    int;
  v_sku    text;
  v_id     uuid;
  v_ids    uuid[] := '{}';
  v_n      int := 0;
begin
  if not public.has_card_access() then
    raise exception 'forbidden';
  end if;
  if p_lot_cost is null or p_lot_cost <= 0 then
    raise exception 'lot cost required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no items';
  end if;

  -- Lock the pool row → serializes all Speed Book batches (no lost update).
  select * into v_pool from public.card_pool where name = 'main' for update;
  if not found then raise exception 'no main pool'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cat := coalesce(nullif(v_item->>'cat', ''), 'OT');
    v_prefix := v_cat || '-' || v_year || '-';
    -- Atomic SKU allocation with retry against rare cross-path collisions.
    loop
      select coalesce(max(substring(sku from char_length(v_prefix) + 1)::int), 0) + 1
        into v_seq
        from public.cards
        where sku like v_prefix || '%';
      v_sku := v_prefix || lpad(v_seq::text, 6, '0');
      begin
        insert into public.cards
          (sku, entity_id, sport_category, zone, quick_booked, use_pool_basis, status)
        values
          (v_sku, 'bfa6ad79-0d3a-412b-a682-603aa9d23f1d',
           nullif(v_item->>'sport_category', ''),
           coalesce(nullif(v_item->>'zone', ''), 'BULK'),
           true, true, 'booked')
        returning id into v_id;
        exit;
      exception when unique_violation then
        -- someone grabbed this SKU; recompute and retry
      end;
    end loop;
    v_ids := array_append(v_ids, v_id);
    v_n := v_n + 1;
  end loop;

  insert into public.card_pool_adjustments
    (pool_id, kind, amount, total_after, count_after, actor, note)
  values
    (v_pool.id, 'add', p_lot_cost,
     v_pool.total_cost + p_lot_cost, v_pool.card_count + v_n,
     coalesce(auth.uid()::text, 'system'), 'Speed Book lot of ' || v_n);

  update public.card_pool
    set total_cost = total_cost + p_lot_cost,
        card_count = card_count + v_n
    where id = v_pool.id;

  return jsonb_build_object(
    'inserted', v_n,
    'ids', to_jsonb(v_ids),
    'pool_total', v_pool.total_cost + p_lot_cost
  );
end $$;

revoke all on function public.speed_book_commit(jsonb, numeric) from public;
grant execute on function public.speed_book_commit(jsonb, numeric) to authenticated;

-- ═══════════ 20260713170000_card_sell_rpc.sql ═══════════
-- CardOps Phase 5 money loop (contract §7): atomic sale settlement.
-- One transaction: record the sale → draw basis from the pool (pooled cards) →
-- compute P/L → mark the card sold. Pool row is locked so the draw can't race
-- the Speed Book adds; the ledger stays append-only and correct.
-- SECURITY DEFINER (writes card_pool) but verifies the caller has card access.

create or replace function public.card_sell(
  p_card_id     uuid,
  p_platform    text,
  p_sale_price  numeric,
  p_fees        numeric,
  p_ship_income numeric,
  p_ship_cost   numeric,
  p_order_ref   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card  public.cards%rowtype;
  v_pool  public.card_pool%rowtype;
  v_basis numeric := 0;
  v_net   numeric;
  v_pl    numeric;
begin
  if not public.has_card_access() then raise exception 'forbidden'; end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status = 'sold' then raise exception 'card already sold'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  v_net := coalesce(p_sale_price, 0) - coalesce(p_fees, 0)
           + coalesce(p_ship_income, 0) - coalesce(p_ship_cost, 0);

  if v_card.use_pool_basis then
    select * into v_pool from public.card_pool where name = 'main' for update;
    if found and v_pool.card_count > 0 then
      v_basis := round(v_pool.total_cost / v_pool.card_count, 2);
      insert into public.card_pool_adjustments
        (pool_id, kind, card_id, amount, total_after, count_after, actor, note)
      values
        (v_pool.id, 'draw', p_card_id, -v_basis,
         v_pool.total_cost - v_basis, v_pool.card_count - 1,
         coalesce(auth.uid()::text, 'system'), 'Sale draw');
      update public.card_pool
        set total_cost = total_cost - v_basis, card_count = card_count - 1
        where id = v_pool.id;
    end if;
  else
    v_basis := coalesce(v_card.individual_basis, 0);
  end if;

  v_pl := v_net - v_basis;

  -- Tell the sale-guard trigger this sold-transition is coming from the RPC
  -- (transaction-local); a direct PostgREST UPDATE won't have this set.
  perform set_config('cardops.in_sell', '1', true);

  insert into public.card_sales
    (card_id, platform, sale_price, fees, shipping_income, shipping_cost,
     net_proceeds, basis_drawn, profit_loss, order_ref)
  values
    (p_card_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost,
     v_net, v_basis, v_pl, p_order_ref);

  update public.cards
    set status = 'sold', sold_at = now(), basis_drawn = v_basis
    where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis, 'profit_loss', v_pl);
end $$;

revoke all on function public.card_sell(uuid, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.card_sell(uuid, text, numeric, numeric, numeric, numeric, text) to authenticated;

-- Force sales through card_sell: block a card_ops user from directly flipping a
-- card to 'sold' or rewriting its basis via PostgREST (which would skip the
-- pool draw and corrupt the basis trail). The RPC sets cardops.in_sell; the
-- owner may still correct manually; service-role/superuser unaffected.
create or replace function public.guard_card_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status and new.status = 'sold')
     or new.basis_drawn is distinct from old.basis_drawn
     or new.sold_at is distinct from old.sold_at then
    if coalesce(auth.role(), '') = 'authenticated'
       and not public.is_owner()
       and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
      raise exception 'sales must be settled through card_sell';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_sale_guard on public.cards;
create trigger cards_sale_guard before update on public.cards
  for each row execute function public.guard_card_sale();

-- card_sales may only be inserted by the owner or the SECURITY DEFINER RPC
-- (which bypasses RLS) — never directly by a card_ops session.
drop policy if exists card_sales_ins on public.card_sales;
create policy card_sales_ins on public.card_sales
  for insert to authenticated with check (public.is_owner());

-- ═══════════ 20260716040000_todos_calendar.sql ═══════════
-- MasterOps v1 · P1a — To-Dos + Calendar engine schema.
-- Additive except the guarded recreate of the EMPTY legacy `todos` table
-- (D-V1-05). Owner-scoped via is_owner() so card_ops (Berlin) never sees tasks.
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. todos  (guarded drop-and-recreate — legacy table is empty, D-V1-05)
-- ─────────────────────────────────────────────────────────────────────────
-- The legacy scaffold shape (task/due TEXT/status/priority/owner_id/subfolder)
-- is incompatible with the spec. Recreate ONLY if it still has the legacy shape
-- AND holds no rows — so a re-run after the new table exists is a no-op, and a
-- populated legacy table aborts loudly instead of silently dropping data.
do $$
declare
  is_legacy boolean;
  row_count bigint;
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'todos') then
    select exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'todos'
                     and column_name = 'task')
      into is_legacy;
    if is_legacy then
      execute 'select count(*) from public.todos' into row_count;
      if row_count > 0 then
        raise exception 'Refusing to drop populated legacy todos (% rows). Migrate manually.', row_count;
      end if;
      drop table public.todos cascade;
    end if;
  end if;
end $$;

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  -- null bucket == Inbox (unfiled). Non-null constrained to the 4 buckets.
  bucket text check (bucket in ('critical','important','regular','someday')),
  entity text,                       -- entities.short_code, nullable (free-floating tasks)
  due_date date,
  gcal_event_id text,                -- link to the MasterOps-calendar event (null = unscheduled)
  rollover_flag boolean not null default false,
  done_at timestamptz,               -- null = open
  last_touched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists todos_open_idx  on public.todos (done_at) where done_at is null;
create index if not exists todos_due_idx    on public.todos (due_date) where due_date is not null;
create index if not exists todos_bucket_idx on public.todos (bucket);
create index if not exists todos_gcal_idx   on public.todos (gcal_event_id) where gcal_event_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. user_settings  (per-user operator config)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calendar_days int not null default 10 check (calendar_days between 1 and 31),
  day_start text not null default '07:00',
  day_end   text not null default '22:00',
  masterops_calendar_id text,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. google_connections  (OAuth token store — mirrors zoho_connections, D-V1-07)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,       -- long-lived; access token derived server-side
  access_token text,
  token_expiry timestamptz,
  scopes text,
  google_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. audit_log extensions  (D-V1-04 — reuse as the assistant's approval sink)
-- ─────────────────────────────────────────────────────────────────────────
-- Widen the actor CHECK to admit 'assistant'. Existing rows already satisfy the
-- narrower set, so this rewrite-free change cannot fail validation.
alter table public.audit_log drop constraint if exists audit_log_actor_check;
alter table public.audit_log
  add constraint audit_log_actor_check
  check (actor in ('web','mcp','cron','assistant'));
alter table public.audit_log add column if not exists approved_by text;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────
alter table public.todos              enable row level security;
alter table public.user_settings      enable row level security;
alter table public.google_connections enable row level security;

-- todos: owner-only (is_owner() reads profiles.role='owner'; Berlin/card_ops
-- gets nothing). Service role bypasses RLS for cron/assistant server writes.
drop policy if exists todos_rw_owner on public.todos;
create policy todos_rw_owner on public.todos
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- user_settings + google_connections: strict per-user (row is yours iff it's you).
drop policy if exists user_settings_self on public.user_settings;
create policy user_settings_self on public.user_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists google_connections_self on public.google_connections;
create policy google_connections_self on public.google_connections
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 6. touch trigger — keep last_touched_at honest on every update
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.touch_todo() returns trigger
  language plpgsql as $$
begin
  new.last_touched_at := now();
  return new;
end $$;

drop trigger if exists todos_touch on public.todos;
create trigger todos_touch before update on public.todos
  for each row execute function public.touch_todo();

-- ═══════════ 20260719100000_members.sql ═══════════
-- v2.0 — MEMBERS (Level 1 multi-user) + pending intake + due_time.
-- Additive + idempotent, with two guarded semantic changes:
--   (1) todos becomes PER-USER (user_id; RLS flips from is_owner to self) —
--       existing rows are backfilled to the owner, so Beau keeps everything.
--   (2) push_subscriptions gains user_id (backfilled to owner) so the
--       owner-data briefs never push to member devices.

-- ── profiles: allow the 'member' role ────────────────────────────────────
-- CardOps set profiles_role_check to ('owner','card_ops'); widen it or every
-- invite claim (role='member') fails the CHECK → HTTP 500 and burns the code.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','card_ops','member'));

-- ── todos: per-user ownership ────────────────────────────────────────────
alter table public.todos add column if not exists user_id uuid references auth.users(id) default auth.uid();
update public.todos set user_id = (select id from public.profiles where role = 'owner' limit 1)
  where user_id is null;
create index if not exists todos_user_idx on public.todos (user_id);

drop policy if exists todos_rw_owner on public.todos;
drop policy if exists todos_rw_self on public.todos;
create policy todos_rw_self on public.todos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── todos: pending intake (triage) + provenance + snooze ─────────────────
alter table public.todos add column if not exists pending boolean not null default false;
alter table public.todos add column if not exists source text not null default 'user';
alter table public.todos add column if not exists provenance text;
alter table public.todos add column if not exists snoozed_until date;
create index if not exists todos_pending_idx on public.todos (pending) where pending;

-- ── push_subscriptions: per-user ─────────────────────────────────────────
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users(id) default auth.uid();
update public.push_subscriptions set user_id = (select id from public.profiles where role = 'owner' limit 1)
  where user_id is null;
-- Let any signed-in user manage THEIR OWN subscription rows (the owner policy
-- from CardOps stays, so both OR together: owner keeps full access, a member
-- can only touch rows whose user_id = their own uid). Without this, a member
-- toggling notifications on /install hits an RLS denial.
drop policy if exists push_subscriptions_rw_self on public.push_subscriptions;
create policy push_subscriptions_rw_self on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── invite codes (friends-only signup) ───────────────────────────────────
create table if not exists public.invite_codes (
  code text primary key,
  created_by uuid references auth.users(id),
  uses_left int not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
-- No policies: service-role only (claims + generation go through the API).

-- ── critical_dates: optional time-of-day (widget kickoff Phase 0) ────────
alter table public.critical_dates add column if not exists due_time time;

-- ═══════════ 20260720010000_card_categories.sql ═══════════
-- Card categorization v2 (Beau, 2026-07-18): TCG-aware fields.
-- Additive + idempotent. The category registry itself lives in code
-- (src/lib/cards/types.ts) — sport_category stays free text, no constraint.
-- `language` already exists (cardops_init, default 'EN').
alter table public.cards add column if not exists rarity text;

-- ═══════════ 20260720020000_card_tags_storage.sql ═══════════
-- Card tags + storage (Beau, 2026-07-18). Additive + idempotent.
-- Tags themselves are DERIVED in code from card fields (no tag table needed);
-- these are the two fields that couldn't be derived: brand and where the card
-- physically lives. card_storage_locations backs the storage pick-list —
-- creatable on the fly from intake/edit.
alter table public.cards add column if not exists brand text;
alter table public.cards add column if not exists storage_location text;

create table if not exists public.card_storage_locations (
  name text primary key,
  created_at timestamptz not null default now()
);
alter table public.card_storage_locations enable row level security;
drop policy if exists card_storage_locations_rw on public.card_storage_locations;
create policy card_storage_locations_rw on public.card_storage_locations
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

-- ═══════════ 20260720030000_pricing_starters.sql ═══════════
-- Pricing builder starters (Beau, 2026-07-18). Additive + idempotent — five
-- good default calculation formats authored in the v1 pipeline grammar, each
-- tagged with the card types it suits. The six legacy seeds are untouched.
insert into public.card_pricing_strategies (key, label, target_rule, params) values
(
  'c_recent_median', 'Recent Median', 'custom',
  '{"v":1,"pipeline":{"window_days":90,"last_n":10,"min_comps":3,"guards":{"iqr_k":1.5},"aggregate":{"fn":"median"}},"meta":{"tags":["high volume","stable market","outlier-protected"],"desc":"Median of the last 10 sales within 90 days, behind a classic outlier fence."}}'::jsonb
),
(
  'c_patient_vintage', 'Patient Vintage', 'custom',
  '{"v":1,"pipeline":{"window_days":730,"min_comps":2,"guards":{"drop_top_pct":0.1,"drop_bottom_pct":0.1},"aggregate":{"fn":"trimmed_mean","trim_pct":0.1}},"meta":{"tags":["vintage","low volume","low population"],"desc":"Two-year window with trimmed averaging — patient valuation for cards that rarely trade."}}'::jsonb
),
(
  'c_fast_flip', 'Fast Flip', 'custom',
  '{"v":1,"pipeline":{"window_days":60,"last_n":5,"min_comps":2,"guards":{"iqr_k":1.5},"aggregate":{"fn":"min"},"adjust":{"multiplier":0.97,"round_99":true}},"meta":{"tags":["fast flip","high volume"],"desc":"Prices just under the lowest recent sale to move inventory quickly."}}'::jsonb
),
(
  'c_hot_streak', 'Hot Streak', 'custom',
  '{"v":1,"pipeline":{"window_days":30,"min_comps":3,"guards":{"drop_top_pct":0.1},"aggregate":{"fn":"wavg_recency","half_life_days":14},"adjust":{"multiplier":1.03}},"meta":{"tags":["hot player","high volume","modern"],"desc":"Recency-weighted average with a 2-week half-life — rides a heater without chasing one spike."}}'::jsonb
),
(
  'c_numbered_premium', 'Numbered Premium', 'custom',
  '{"v":1,"pipeline":{"window_days":365,"min_comps":2,"guards":{"iqr_k":2},"aggregate":{"fn":"median"},"adjust":{"multiplier":1.08}},"meta":{"tags":["numbered","low population","premium"],"desc":"Year-long median with a scarcity premium for serial-numbered cards."}}'::jsonb
)
on conflict (key) do nothing;

-- ═══════════ 20260720040000_value_snapshots.sql ═══════════
-- Value snapshots (Beau, 2026-07-18): the card's computed value as of 30 days
-- / 1 year ago, stored by the nightly repricer + every recompute so the
-- inventory list can show % change columns without per-row comp math.
-- Additive + idempotent.
alter table public.cards add column if not exists value_30d numeric;
alter table public.cards add column if not exists value_365d numeric;

-- ═══════════ 20260720050000_ebay_connections.sql ═══════════
-- eBay connector Phase 1 (connector plan §2). Additive + idempotent, plus the
-- two Phase-2 landmines fixed ahead of the order-pull cron:
--   (1) card_sell must accept service-role callers (the cron has no auth.uid).
--   (2) card_sales needs (platform, order_ref) uniqueness or a cron re-poll
--       could double-settle a sale and DOUBLE-DRAW the basis pool.

-- ── eBay OAuth connection (tokens stored AES-GCM-encrypted at the app layer;
--    RLS owner-only — this token controls the whole seller account). ────────
create table if not exists public.ebay_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  scopes text,
  ebay_user text,
  updated_at timestamptz not null default now()
);
alter table public.ebay_connections enable row level security;
drop policy if exists ebay_connections_owner on public.ebay_connections;
create policy ebay_connections_owner on public.ebay_connections
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ── Landmine 2: idempotent settles. ─────────────────────────────────────────
create unique index if not exists card_sales_platform_order_uq
  on public.card_sales (platform, order_ref)
  where order_ref is not null;

-- ── Landmine 1: card_sell accepts service-role (cron) callers. Same body as
--    20260713170000 with only the access check amended. ──────────────────────
create or replace function public.card_sell(
  p_card_id     uuid,
  p_platform    text,
  p_sale_price  numeric,
  p_fees        numeric,
  p_ship_income numeric,
  p_ship_cost   numeric,
  p_order_ref   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card  public.cards%rowtype;
  v_pool  public.card_pool%rowtype;
  v_basis numeric := 0;
  v_net   numeric;
  v_pl    numeric;
begin
  if not (public.has_card_access() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status = 'sold' then raise exception 'card already sold'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  v_net := coalesce(p_sale_price, 0) - coalesce(p_fees, 0)
           + coalesce(p_ship_income, 0) - coalesce(p_ship_cost, 0);

  if v_card.use_pool_basis then
    select * into v_pool from public.card_pool where name = 'main' for update;
    if found and v_pool.card_count > 0 then
      v_basis := round(v_pool.total_cost / v_pool.card_count, 2);
      insert into public.card_pool_adjustments
        (pool_id, kind, card_id, amount, total_after, count_after, actor, note)
      values
        (v_pool.id, 'draw', p_card_id, -v_basis,
         v_pool.total_cost - v_basis, v_pool.card_count - 1,
         coalesce(auth.uid()::text, 'system'), 'Sale draw');
      update public.card_pool
        set total_cost = total_cost - v_basis, card_count = card_count - 1
        where id = v_pool.id;
    end if;
  else
    v_basis := coalesce(v_card.individual_basis, 0);
  end if;

  v_pl := v_net - v_basis;

  perform set_config('cardops.in_sell', '1', true);

  insert into public.card_sales
    (card_id, platform, sale_price, fees, shipping_income, shipping_cost,
     net_proceeds, basis_drawn, profit_loss, order_ref)
  values
    (p_card_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost,
     v_net, v_basis, v_pl, p_order_ref);

  update public.cards
    set status = 'sold', sold_at = now(), basis_drawn = v_basis
    where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis, 'profit_loss', v_pl);
end $$;

-- ═══════════ 20260720120000_card_unsell.sql ═══════════
-- CardOps: reverse a mistaken or cancelled sale — the exact inverse of
-- card_sell. Owner or service_role only (the cron uses it when an eBay order
-- is cancelled). Additive + idempotent.
--
-- Why an RPC and not a status flip: cards has a guard trigger (guard_card_sale)
-- that blocks direct edits to status/sold_at/basis_drawn, precisely so a
-- half-fix can't leave a phantom sale in the books or the pool short a card.
--
-- Pool accounting note: the reversal keys off the actual pool 'draw'
-- adjustment card_sell wrote, NOT the card's basis_drawn or its current
-- use_pool_basis flag. The adjustment is the authoritative record of what the
-- sale removed, so restoring it is the true inverse even for a $0 (free) card
-- where basis_drawn is 0 but a card was still removed from the count, and even
-- if use_pool_basis was toggled after the sale.

create or replace function public.card_unsell(p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card     public.cards%rowtype;
  v_sale     public.card_sales%rowtype;
  v_pool     public.card_pool%rowtype;
  v_draw     public.card_pool_adjustments%rowtype;
  v_restored numeric := 0;
  v_count    int := 0;
begin
  if not (public.is_owner() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status <> 'sold' then raise exception 'card is not sold'; end if;

  -- Reverse the pool DRAW this sale made (if any). Find the latest 'draw' for
  -- this card that hasn't already been reversed by a later 'correction'.
  select * into v_draw from public.card_pool_adjustments
    where card_id = p_card_id and kind = 'draw'
    order by ts desc limit 1;
  if v_draw.id is not null and not exists (
        select 1 from public.card_pool_adjustments
        where card_id = p_card_id and kind = 'correction' and ts > v_draw.ts) then
    select * into v_pool from public.card_pool where id = v_draw.pool_id for update;
    if found then
      v_restored := -v_draw.amount;  -- the draw amount was stored negative
      v_count := 1;
      insert into public.card_pool_adjustments
        (pool_id, kind, card_id, amount, total_after, count_after, actor, note)
      values
        (v_pool.id, 'correction', p_card_id, v_restored,
         v_pool.total_cost + v_restored, v_pool.card_count + 1,
         coalesce(auth.uid()::text, 'system'), 'Sale reversed');
      update public.card_pool
        set total_cost = total_cost + v_restored, card_count = card_count + 1
        where id = v_pool.id;
    end if;
  end if;

  -- Drop the sale record so reports/books no longer count it.
  select * into v_sale from public.card_sales
    where card_id = p_card_id order by sold_at desc limit 1;
  if v_sale.id is not null then
    delete from public.card_sales where id = v_sale.id;
  end if;

  -- Sanctioned reset (same handshake card_sell uses for the guard trigger).
  perform set_config('cardops.in_sell', '1', true);
  update public.cards
    set status = 'booked', sold_at = null, basis_drawn = null
    where id = p_card_id;

  return jsonb_build_object(
    'reversed_sale', v_sale.id,
    'restored_basis', v_restored,
    'restored_count', v_count
  );
end $$;

revoke all on function public.card_unsell(uuid) from public;
grant execute on function public.card_unsell(uuid) to authenticated;

-- ── Durable cancelled-order guard ───────────────────────────────────────────
-- When we seller-cancel an eBay order we reverse its settlement immediately,
-- but eBay's Fulfillment feed keeps reporting the order PAID / not-cancelled
-- for a while (eventual consistency). Without a local marker the next sync
-- would re-settle it — double pool draw + phantom revenue on a refunded order.
-- This table is that marker; the sync skips any order_ref listed here.
create table if not exists public.ebay_cancelled_orders (
  order_ref    text primary key,
  cancelled_at timestamptz not null default now()
);
alter table public.ebay_cancelled_orders enable row level security;
drop policy if exists ebay_cancelled_orders_owner on public.ebay_cancelled_orders;
create policy ebay_cancelled_orders_owner on public.ebay_cancelled_orders
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ═══════════ 20260720140000_card_lots.sql ═══════════
-- CardOps: multi-card LOTS — bundle several inventory cards into one sellable
-- unit that lists + sells as a single item, then settles each child card
-- correctly (proceeds allocated pro-rata by comp value). Additive + idempotent.

create sequence if not exists public.card_lot_sku_seq;

create table if not exists public.card_lots (
  id           uuid primary key default gen_random_uuid(),
  sku          text unique not null default ('LOT-' || lpad(nextval('public.card_lot_sku_seq')::text, 6, '0')),
  title        text,
  description  text,
  status       text not null default 'draft' check (status in ('draft','listed','sold','archived')),
  ask_price    numeric(12,2),
  listing_refs jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.card_lots enable row level security;
drop policy if exists card_lots_rw on public.card_lots;
create policy card_lots_rw on public.card_lots
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

create table if not exists public.card_lot_items (
  lot_id             uuid not null references public.card_lots(id) on delete cascade,
  card_id            uuid not null references public.cards(id),
  -- comp value snapshot at add time — the weight used to split proceeds so the
  -- allocation is stable even if market values move before the lot sells.
  comp_value_at_add  numeric(12,2),
  primary key (lot_id, card_id)
);
create index if not exists card_lot_items_card_idx on public.card_lot_items (card_id);
alter table public.card_lot_items enable row level security;
drop policy if exists card_lot_items_rw on public.card_lot_items;
create policy card_lot_items_rw on public.card_lot_items
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

-- ── Sell a lot: allocate the sale across children by comp weight, settle each
--    through card_sell (pool draw + card_sales + status), mark the lot sold.
--    Atomic (one transaction) — if any child fails, the whole sale rolls back.
--    Rounding remainder goes to the last child so allocations sum EXACTLY.
create or replace function public.card_lot_sell(
  p_lot_id      uuid,
  p_platform    text,
  p_sale_price  numeric,
  p_fees        numeric,
  p_ship_income numeric,
  p_ship_cost   numeric,
  p_order_ref   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot      public.card_lots%rowtype;
  v_ids      uuid[];
  v_ws       numeric[];
  v_total    numeric := 0;
  v_n        int := 0;
  v_i        int := 0;
  v_weight   numeric;
  v_ap numeric; v_af numeric; v_asi numeric; v_asc numeric;   -- this child's allocation
  v_sp numeric := 0; v_sf numeric := 0; v_ssi numeric := 0; v_ssc numeric := 0; -- running sums
  v_children jsonb := '[]'::jsonb;
begin
  if not (public.has_card_access() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;
  select * into v_lot from public.card_lots where id = p_lot_id for update;
  if not found then raise exception 'lot not found'; end if;
  -- Only draft/listed lots may sell — never a sold lot (double-sell) or an
  -- archived/cancelled one (booking a lot the operator killed).
  if v_lot.status not in ('draft','listed') then
    raise exception 'lot is not sellable (status %)', v_lot.status;
  end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  -- Lock the membership so a concurrent add/remove can't change it mid-settle,
  -- then capture it ONCE (ordered) into arrays. count, total, and the loop all
  -- read from this single snapshot — so a removal can't skip the remainder
  -- branch and under-allocate the sale.
  perform 1 from public.card_lot_items where lot_id = p_lot_id for update;
  select array_agg(t.card_id order by t.w desc, t.card_id),
         array_agg(t.w        order by t.w desc, t.card_id),
         coalesce(sum(t.w), 0)
    into v_ids, v_ws, v_total
    from (select li.card_id, coalesce(li.comp_value_at_add, c.market_value, 0) as w
          from public.card_lot_items li join public.cards c on c.id = li.card_id
          where li.lot_id = p_lot_id) t;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'lot has no cards'; end if;

  for v_i in 1 .. v_n loop
    if v_total > 0 then v_weight := v_ws[v_i] / v_total; else v_weight := 1.0 / v_n; end if;
    if v_i < v_n then
      v_ap := round(p_sale_price  * v_weight, 2);
      v_af := round(p_fees        * v_weight, 2);
      v_asi := round(p_ship_income * v_weight, 2);
      v_asc := round(p_ship_cost   * v_weight, 2);
    else
      -- last child absorbs the rounding remainder so totals reconcile exactly
      v_ap := p_sale_price  - v_sp;
      v_af := p_fees        - v_sf;
      v_asi := p_ship_income - v_ssi;
      v_asc := p_ship_cost   - v_ssc;
    end if;
    v_sp := v_sp + v_ap; v_sf := v_sf + v_af; v_ssi := v_ssi + v_asi; v_ssc := v_ssc + v_asc;

    v_children := v_children || jsonb_build_object(
      'card_id', v_ids[v_i],
      'result', public.card_sell(v_ids[v_i], coalesce(p_platform, 'ebay'), v_ap, v_af, v_asi, v_asc,
                                  p_order_ref || ':lot:' || v_ids[v_i]::text)
    );
  end loop;

  update public.card_lots set status = 'sold', updated_at = now() where id = p_lot_id;
  return jsonb_build_object('lot', p_lot_id, 'cards', v_n, 'children', v_children);
end $$;
revoke all on function public.card_lot_sell(uuid, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.card_lot_sell(uuid, text, numeric, numeric, numeric, numeric, text) to authenticated;

-- ── Reverse a lot sale: unwind every child through card_unsell, reopen the lot.
create or replace function public.card_lot_unsell(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.card_lots%rowtype;
  v_item record;
  v_children jsonb := '[]'::jsonb;
begin
  -- Owner-only, matching card_unsell (which each child reversal calls) — so a
  -- helper gets a clean 'forbidden' here rather than a deep partial failure.
  if not (public.is_owner() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;
  select * into v_lot from public.card_lots where id = p_lot_id for update;
  if not found then raise exception 'lot not found'; end if;
  if v_lot.status <> 'sold' then raise exception 'lot is not sold'; end if;

  for v_item in select card_id from public.card_lot_items where lot_id = p_lot_id loop
    v_children := v_children || jsonb_build_object(
      'card_id', v_item.card_id,
      'result', public.card_unsell(v_item.card_id)
    );
  end loop;

  update public.card_lots set status = 'draft', updated_at = now() where id = p_lot_id;
  return jsonb_build_object('lot', p_lot_id, 'children', v_children);
end $$;
revoke all on function public.card_lot_unsell(uuid) from public;
grant execute on function public.card_lot_unsell(uuid) to authenticated;

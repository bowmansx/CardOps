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

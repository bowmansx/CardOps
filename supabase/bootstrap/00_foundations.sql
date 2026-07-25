-- ══════════════════════════════════════════════════════════════════════════
-- STANDALONE BOOTSTRAP · STEP 0 — foundations the migrations assume exist.
-- Run FIRST on the fresh CardOps Supabase project, before 01_schema_*.
--
-- These four tables + two buckets were created by Master-Ops-era migrations
-- (or its original schema.sql) in the shared database; CardOps' own
-- migrations only ALTER or use them. DDL extracted verbatim from those
-- sources, with two deliberate deltas, both marked below:
--   · audit_log is born with the WIDENED actor CHECK (20260736 applied it
--     retroactively in the shared DB);
--   · entities pins the Card Operations row to the exact uuid the app's
--     CARD_ENTITY constant expects.
-- Idempotent; safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── profiles (from Master-Ops schema.sql; role columns come in 01) ──────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- ── entities (from 20260710120000_base_entities_audit.sql) ──────────────────
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_code text not null unique,
  type text check (type in ('c_corp','s_corp','llc','partnership','sole_prop','personal')),
  zoho_books_org_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.entities enable row level security;
drop policy if exists "entities_read_authenticated" on public.entities;
create policy "entities_read_authenticated" on public.entities
  for select to authenticated using (true);

-- DELTA: Card Operations gets the EXACT id the app hardcodes (CARD_ENTITY in
-- src/app/cards/actions.ts + intake) — a random id would break card creation.
insert into public.entities (id, name, short_code, type, active) values
  ('bfa6ad79-0d3a-412b-a682-603aa9d23f1d', 'Card Operations', 'CARD', null, true)
on conflict (short_code) do nothing;
-- The rest of the roster, for the funding simulator's entity pickers.
insert into public.entities (name, short_code, type, active) values
  ('The Architect''s Foundry', 'AF',   's_corp',   true),
  ('House of Packs',           'HOP',  'llc',      true),
  ('Personal',                 'PERS', 'personal', true)
on conflict (short_code) do nothing;

-- ── audit_log (base_entities_audit + the 20260736 actor widening) ──────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor text not null check (actor in ('web','mcp','cron','assistant','ebay-sync','ebay')),
  action text not null,
  target text,
  payload jsonb,
  result text
);
alter table public.audit_log enable row level security;
-- Insert-only from the browser; history stays append-only and unreadable there.
drop policy if exists audit_log_insert_authenticated on public.audit_log;
create policy audit_log_insert_authenticated on public.audit_log
  for insert to authenticated with check (true);

-- ── push_subscriptions (from 20260713100000_alerts_push_parser.sql) ─────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null,              -- { p256dh, auth } from PushSubscription
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_rw_authenticated on public.push_subscriptions;
create policy push_subscriptions_rw_authenticated on public.push_subscriptions
  for all to authenticated using (true) with check (true);

-- ── receipts bucket (was created outside the migration trail) ───────────────
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
drop policy if exists receipts_rw_card_access on storage.objects;
create policy receipts_rw_card_access on storage.objects
  for all to authenticated
  using (bucket_id = 'receipts')
  with check (bucket_id = 'receipts');
-- (card-photos bucket + its per-tenant policies are created by 01 —
--  cardops_init and the multitenant hardening migration own them.)

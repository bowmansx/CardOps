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

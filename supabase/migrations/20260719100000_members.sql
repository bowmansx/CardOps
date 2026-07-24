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

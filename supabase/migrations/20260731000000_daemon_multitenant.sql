-- Daemon multi-tenancy fix (Beau, 2026-07-24).
--
-- 20260724000000_multi_tenant_cards.sql gave card_portfolio_snapshots a user_id
-- (default auth.uid()) and a `user_id = auth.uid()` RLS policy — but left the
-- PRIMARY KEY on snapshot_date alone. Two consequences, both live:
--
--   1. The nightly daemon writes via the SERVICE role, where auth.uid() is NULL,
--      so every snapshot written since that migration landed has user_id = NULL
--      and is INVISIBLE to the portfolio page (which reads under RLS). The NAV
--      chart has been silently frozen.
--   2. One row per DATE means one global snapshot, so a second user's inventory
--      would be summed into the same row rather than tracked separately.
--
-- Re-key to (user_id, snapshot_date): one snapshot per user per day.
-- Idempotent; safe to re-run.

-- ── 1) Adopt the orphaned service-written rows ───────────────────────────────
-- Give NULL-owner rows to the owner, but drop any whose date ALREADY has an
-- owner row (that date's owner row is the good one — the NULL row is the
-- service-written duplicate that nobody could see).
do $$
declare v_owner uuid;
begin
  select coalesce(
    (select id from public.profiles where role = 'owner' order by id limit 1),
    (select id from auth.users where email = 'bowmansx@gmail.com')
  ) into v_owner;
  if v_owner is null then return; end if;

  delete from public.card_portfolio_snapshots s
   where s.user_id is null
     and exists (
       select 1 from public.card_portfolio_snapshots o
        where o.snapshot_date = s.snapshot_date and o.user_id = v_owner
     );

  update public.card_portfolio_snapshots
     set user_id = v_owner
   where user_id is null;
end $$;

-- ── 2) Re-key: (user_id, snapshot_date) ──────────────────────────────────────
do $$
declare pk text;
begin
  -- Only proceed once every row has an owner, so the NOT NULL can't fail.
  if exists (select 1 from public.card_portfolio_snapshots where user_id is null) then
    raise notice 'card_portfolio_snapshots still has NULL user_id rows — skipping re-key';
    return;
  end if;

  select con.conname into pk
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
   where cl.relname = 'card_portfolio_snapshots' and con.contype = 'p';

  if pk is distinct from 'card_portfolio_snapshots_user_date_pk' then
    if pk is not null then
      execute format('alter table public.card_portfolio_snapshots drop constraint %I', pk);
    end if;
    alter table public.card_portfolio_snapshots alter column user_id set not null;
    alter table public.card_portfolio_snapshots
      add constraint card_portfolio_snapshots_user_date_pk primary key (user_id, snapshot_date);
  end if;
end $$;

create index if not exists card_portfolio_snapshots_user_date_idx
  on public.card_portfolio_snapshots (user_id, snapshot_date);

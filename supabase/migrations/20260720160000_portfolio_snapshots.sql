-- CardOps: daily portfolio snapshot — the history the value-over-time chart,
-- trend leaderboards, and velocity metrics all read from. One row per day,
-- written by the nightly pricing daemon. Additive + idempotent.
--
-- Start the clock early: history only accrues going forward, so this table
-- exists to begin collecting even before the chart UI matters.

create table if not exists public.card_portfolio_snapshots (
  snapshot_date date primary key,
  card_count    int not null default 0,
  cost_basis    numeric(14,2) not null default 0,   -- pool total + individual bases
  market_value  numeric(14,2) not null default 0,   -- sum of manual??market over live cards
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.card_portfolio_snapshots enable row level security;
-- Card users may read the history; the cron writes via service role (bypasses RLS).
drop policy if exists card_portfolio_snapshots_sel on public.card_portfolio_snapshots;
create policy card_portfolio_snapshots_sel on public.card_portfolio_snapshots
  for select to authenticated using (public.has_card_access());

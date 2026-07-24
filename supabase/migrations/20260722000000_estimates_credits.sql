-- Pricing intelligence: estimate cache + credit metering (Beau, 2026-07-22).
-- card_estimates caches each AI estimate (so viewing it again is free); credit_ledger
-- is the metered-compute account (managed model: each run debits the user). Additive
-- + idempotent.

create table if not exists public.card_estimates (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  mode text not null check (mode in ('standard_plus', 'all_sales_plus')),
  value numeric(12,2),
  low numeric(12,2),
  high numeric(12,2),
  confidence text,
  rationale text,
  sources jsonb,               -- what data it used (own-sales stats, comparables, sample, flags)
  credits_spent integer not null default 0,
  model text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists card_estimates_card_idx on public.card_estimates (card_id, mode, created_at desc);

alter table public.card_estimates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_estimates' and policyname='card_estimates_all') then
    create policy card_estimates_all on public.card_estimates for all to authenticated
      using (public.has_card_access()) with check (public.has_card_access());
  end if;
end $$;

-- Metered-compute ledger. Balance = sum(delta). Positive = granted/purchased,
-- negative = spent. Written server-side (service role); users read their own.
create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  delta integer not null,
  reason text,
  ref uuid,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='credit_ledger' and policyname='credit_ledger_self_read') then
    create policy credit_ledger_self_read on public.credit_ledger for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- O(1) balance for the signed-in user (SQL sum, not a client-side fetch-and-add).
create or replace function public.credit_balance()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.credit_ledger where user_id = auth.uid();
$$;
revoke all on function public.credit_balance() from public;
grant execute on function public.credit_balance() to authenticated;

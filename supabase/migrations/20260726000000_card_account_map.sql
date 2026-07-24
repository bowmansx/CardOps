-- CardOps connector mapping (Beau, 2026-07-24). Each business picks which
-- bookkeeping app it syncs to, and maps CardOps' internal account keys to that
-- app's real accounts. Per-business so one user can run different books per
-- company (and a CardOps-only customer can point at QuickBooks instead).
-- Additive + idempotent.

-- Which backend this business syncs to: null = none (CardOps' own books only).
alter table public.card_businesses add column if not exists connector text;

create table if not exists public.card_account_map (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.card_businesses(id) on delete cascade,
  provider text not null default 'zoho',
  account_key text not null,              -- ours: inventory, cash, cogs, ...
  external_account_id text not null,      -- theirs
  external_account_name text,
  updated_at timestamptz not null default now()
);
create unique index if not exists card_account_map_uniq
  on public.card_account_map (business_id, provider, account_key);
create index if not exists card_account_map_biz_idx on public.card_account_map (business_id);

alter table public.card_account_map enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_account_map' and policyname='card_account_map_own') then
    create policy card_account_map_own on public.card_account_map for all to authenticated
      using (exists (select 1 from public.card_businesses b where b.id = business_id and b.user_id = auth.uid()))
      with check (exists (select 1 from public.card_businesses b where b.id = business_id and b.user_id = auth.uid()));
  end if;
end $$;

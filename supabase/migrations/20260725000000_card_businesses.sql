-- Phase 1b: CardOps owns its businesses (Beau, 2026-07-24).
-- CardOps is becoming a standalone product, so it can't depend on MasterOps'
-- `entities` table. It gets its own per-user `card_businesses` — the thing a card
-- is attributed to, carrying the tax treatment and the bookkeeping connection
-- (zoho_books_org_id today, QuickBooks later).
--
-- The owner's existing entities are copied in WITH THEIR IDs PRESERVED, so every
-- existing card / receipt / journal attribution keeps working with zero data
-- migration; only the foreign keys are repointed.
-- (`journal_entries` is already CardOps-only — MasterOps never touches it.)
-- Additive + idempotent.

create table if not exists public.card_businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  short_code text not null,
  type text,                       -- llc / s_corp / personal / ...
  zoho_books_org_id text,          -- the bookkeeping connection target
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists card_businesses_user_idx on public.card_businesses (user_id);
create unique index if not exists card_businesses_user_code_uniq on public.card_businesses (user_id, short_code);

alter table public.card_businesses enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_businesses' and policyname='card_businesses_own') then
    create policy card_businesses_own on public.card_businesses for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- Seed the owner's businesses from entities, preserving ids (owner resolved from
-- profiles.role='owner', falling back to the known owner email).
insert into public.card_businesses (id, user_id, name, short_code, type, zoho_books_org_id, active)
select e.id,
       coalesce((select p.id from public.profiles p where p.role = 'owner' limit 1),
                (select u.id from auth.users u where u.email = 'bowmansx@gmail.com')),
       e.name, e.short_code, e.type, e.zoho_books_org_id, coalesce(e.active, true)
from public.entities e
where coalesce((select p.id from public.profiles p where p.role = 'owner' limit 1),
               (select u.id from auth.users u where u.email = 'bowmansx@gmail.com')) is not null
on conflict (id) do nothing;

-- Repoint every card-side FK from entities -> card_businesses. Safe because the
-- seed above preserved ids, so no reference is orphaned.
do $$
declare r record;
begin
  for r in
    select con.conname, cl.relname as tbl
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and ref.relname = 'entities'
      and cl.relname in ('cards','card_pool','journal_entries','card_receipts')
  loop
    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_business_fk') then
    alter table public.cards add constraint cards_business_fk
      foreign key (entity_id) references public.card_businesses(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_pool_business_fk') then
    alter table public.card_pool add constraint card_pool_business_fk
      foreign key (entity_id) references public.card_businesses(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_business_fk') then
    alter table public.journal_entries add constraint journal_entries_business_fk
      foreign key (entity_id) references public.card_businesses(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_receipts_business_fk') then
    alter table public.card_receipts add constraint card_receipts_business_fk
      foreign key (entity_id) references public.card_businesses(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_receipts_to_business_fk') then
    alter table public.card_receipts add constraint card_receipts_to_business_fk
      foreign key (to_entity_id) references public.card_businesses(id) on delete set null;
  end if;
end $$;

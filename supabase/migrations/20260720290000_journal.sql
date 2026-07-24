-- Canonical internal journal (Beau, 2026-07-20). The generic double-entry ledger
-- CardOps posts INTO — and any future asset module (properties, machines) can post
-- to the same table. Each business event (a card sale, later a purchase) writes
-- balanced debit/credit lines tagged by entity + source. This is the internal book
-- of record that a later, gated Zoho/QBO push reads from. Owner-only. Idempotent.

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id) on delete set null,
  entry_date date not null,
  source text not null,        -- 'card_sale' | 'card_purchase' | …
  source_ref text not null,    -- the originating row's id (e.g. card_sales.id)
  line int not null default 0, -- ordering within one entry
  account text not null,       -- internal chart: cash, sales_revenue, platform_fees, shipping_expense, cogs, inventory, …
  debit numeric(12,2) not null default 0,
  credit numeric(12,2) not null default 0,
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists journal_entries_source_idx on public.journal_entries (source, source_ref);
create index if not exists journal_entries_entity_idx on public.journal_entries (entity_id, entry_date);

alter table public.journal_entries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='journal_entries' and policyname='journal_entries_owner') then
    create policy journal_entries_owner on public.journal_entries
      for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
end $$;

-- Card cost receipts + intercompany advances (Beau, 2026-07-21). Each receipt is
-- either the paying entity's own purchase (its pool or specific cards) or an
-- ADVANCE to an affiliate — where the receiving company then decides how IT books
-- the money (pool basis or specific purchases). Owner-only (business bookkeeping).
-- The double-entry lands in journal_entries; this table is the source record.
create table if not exists public.card_receipts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id) on delete set null,   -- who paid
  receipt_date date not null default current_date,
  vendor text,
  amount numeric(12,2) not null,
  image_path text,                    -- optional stored image (receipts bucket)
  note text,
  disposition text not null check (disposition in ('pool', 'cards', 'advance')),
  card_ids uuid[] not null default '{}',                              -- for 'cards'
  to_entity_id uuid references public.entities(id) on delete set null, -- for 'advance': the affiliate
  advance_disposition text check (advance_disposition in ('pool', 'cards')), -- how the receiver books it
  posted boolean not null default false,                              -- journal entries generated?
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists card_receipts_entity_idx on public.card_receipts (entity_id, receipt_date desc);

alter table public.card_receipts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_receipts' and policyname='card_receipts_owner') then
    create policy card_receipts_owner on public.card_receipts
      for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
end $$;

-- Card tags + storage (Beau, 2026-07-18). Additive + idempotent.
-- Tags themselves are DERIVED in code from card fields (no tag table needed);
-- these are the two fields that couldn't be derived: brand and where the card
-- physically lives. card_storage_locations backs the storage pick-list —
-- creatable on the fly from intake/edit.
alter table public.cards add column if not exists brand text;
alter table public.cards add column if not exists storage_location text;

create table if not exists public.card_storage_locations (
  name text primary key,
  created_at timestamptz not null default now()
);
alter table public.card_storage_locations enable row level security;
drop policy if exists card_storage_locations_rw on public.card_storage_locations;
create policy card_storage_locations_rw on public.card_storage_locations
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

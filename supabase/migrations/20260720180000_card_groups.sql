-- CardOps: card GROUPS / folders — arbitrary named collections a card can
-- belong to (many at once), for organizing inventory however you like.
-- Distinct from lots (which are for selling). Additive + idempotent.

create table if not exists public.card_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.card_groups enable row level security;
drop policy if exists card_groups_rw on public.card_groups;
create policy card_groups_rw on public.card_groups
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

create table if not exists public.card_group_items (
  group_id uuid not null references public.card_groups(id) on delete cascade,
  card_id  uuid not null references public.cards(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, card_id)
);
create index if not exists card_group_items_card_idx on public.card_group_items (card_id);
alter table public.card_group_items enable row level security;
drop policy if exists card_group_items_rw on public.card_group_items;
create policy card_group_items_rw on public.card_group_items
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

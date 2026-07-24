-- CardOps: price alerts / watchlist — watch a card for a target price. The
-- watchlist reads the current value live, so a crossing shows immediately
-- (push notifications on crossing are a later add). One alert per card.
-- Additive + idempotent.

create table if not exists public.card_alerts (
  card_id      uuid primary key references public.cards(id) on delete cascade,
  target_price numeric(12,2) not null,
  direction    text not null default 'above' check (direction in ('above','below')),
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.card_alerts enable row level security;
drop policy if exists card_alerts_rw on public.card_alerts;
create policy card_alerts_rw on public.card_alerts
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

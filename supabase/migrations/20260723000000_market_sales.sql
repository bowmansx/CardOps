-- Observed market sales history (Beau, 2026-07-23). The Card API free tier only
-- shows a ~3-day window; by storing each day's sales here (deduped), we build up a
-- full price-over-time history ourselves. Feeds the estimate engine + the card
-- sparkline. Additive + idempotent.
create table if not exists public.card_market_sales (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  source text not null default 'thecardapi',
  external_id text,                 -- the platform listing/sale id (dedup key)
  title text,
  price numeric(12,2) not null,
  currency text default 'USD',
  grader text,
  grade numeric(4,1),
  platform text,                    -- ebay, tcgplayer, goldin, ...
  sold_at date,
  raw jsonb,
  seen_at timestamptz not null default now()
);
-- One row per (card, source, sale) — re-seeing a sale is a no-op.
create unique index if not exists card_market_sales_dedup on public.card_market_sales (card_id, source, external_id);
create index if not exists card_market_sales_card_idx on public.card_market_sales (card_id, sold_at desc);

alter table public.card_market_sales enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_market_sales' and policyname='card_market_sales_all') then
    create policy card_market_sales_all on public.card_market_sales for all to authenticated
      using (public.has_card_access()) with check (public.has_card_access());
  end if;
end $$;

-- Per-card toggle: whether the daily job keeps accumulating its sales history.
alter table public.cards add column if not exists track_history boolean not null default true;

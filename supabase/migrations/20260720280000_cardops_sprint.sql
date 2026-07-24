-- CardOps sprint (Beau, 2026-07-20): %-move alerts, card news, shareable
-- showcases. Additive + idempotent. Paste once.

-- ── 1. %-move alerts ────────────────────────────────────────────────────────
-- Extend card_alerts so a watch can be a target price OR a percentage move over
-- a window. target_price becomes optional (a pct_move alert doesn't need one).
alter table public.card_alerts add column if not exists kind text not null default 'target'; -- 'target' | 'pct_move'
alter table public.card_alerts add column if not exists threshold_pct numeric;   -- pct_move: absolute % move that fires
alter table public.card_alerts add column if not exists window_days int;          -- pct_move: over this many days
alter table public.card_alerts alter column target_price drop not null;

-- ── 2. Card news ────────────────────────────────────────────────────────────
-- News items discovered for a card's subject (player / set / card name), scored
-- for significance + likely market direction. Shared inventory (has_card_access).
create table if not exists public.card_news (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  card_id uuid references public.cards(id) on delete set null,
  title text not null,
  url text not null,
  source text,
  published_at timestamptz,
  significance numeric,               -- 0..1 (AI)
  direction text,                     -- 'up' | 'down' | 'neutral'
  market_moving boolean not null default false,
  summary text,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (url)
);
create index if not exists card_news_rank_idx on public.card_news (significance desc nulls last, created_at desc);
create index if not exists card_news_card_idx on public.card_news (card_id, created_at desc);

alter table public.card_news enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_news' and policyname='card_news_read') then
    create policy card_news_read on public.card_news for select to authenticated using (public.has_card_access());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_news' and policyname='card_news_write_owner') then
    create policy card_news_write_owner on public.card_news for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
end $$;

-- ── 3. Shareable showcases ──────────────────────────────────────────────────
-- A public, link-shareable gallery of chosen cards. The public page reads via
-- the service role (by token); RLS here only governs the owner's management.
create table if not exists public.card_showcases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token text not null unique,
  title text not null default 'My Showcase',
  card_ids uuid[] not null default '{}',
  show_prices boolean not null default true,
  for_sale boolean not null default false,
  is_public boolean not null default true,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists card_showcases_user_idx on public.card_showcases (user_id, created_at desc);

alter table public.card_showcases enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_showcases' and policyname='card_showcases_rw_self') then
    create policy card_showcases_rw_self on public.card_showcases
      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

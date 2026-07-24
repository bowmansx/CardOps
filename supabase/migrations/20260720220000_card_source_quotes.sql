-- Card source quotes (Beau, 2026-07-20): a per-source pricing layer that sits
-- ALONGSIDE realized sold-comps (card_comps). Each vendor — PriceCharting,
-- Scryfall, … — drops its CURRENT value(s) here so the card page can show every
-- source SEPARATELY and a blended consensus. Display-only guidance: nothing here
-- writes the authoritative cards.market_value (that stays comp-driven).
-- Additive + idempotent.

create table if not exists public.card_source_quotes (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  source text not null,                  -- 'pricecharting' | 'scryfall' | …
  kind text not null default 'guide' check (kind in ('guide','sold')),
  grader text,                           -- null = raw / ungraded
  grade numeric(4,1),
  price numeric(12,2) not null,
  currency text not null default 'USD',
  label text,                            -- human tag, e.g. 'PSA 10', 'Ungraded · foil'
  url text,
  product_ref text,                      -- vendor product id, for stable re-fetch
  payload jsonb,
  fetched_at timestamptz not null default now(),
  -- one current row per (card, source, grade-slot): the upsert / dedupe target.
  slot text generated always as (
    source || ':' || coalesce(grader, 'RAW') || ':' ||
    coalesce(grade::text, 'raw') || ':' || coalesce(label, '')
  ) stored
);
create unique index if not exists card_source_quotes_slot_uniq
  on public.card_source_quotes (card_id, slot);
create index if not exists card_source_quotes_card_idx
  on public.card_source_quotes (card_id, source);

alter table public.card_source_quotes enable row level security;

-- RLS mirrors the card_* convention: any card-access user reads/writes; only the
-- owner deletes.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_source_quotes' and policyname='card_source_quotes_sel') then
    create policy card_source_quotes_sel on public.card_source_quotes
      for select to authenticated using (public.has_card_access());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_source_quotes' and policyname='card_source_quotes_ins') then
    create policy card_source_quotes_ins on public.card_source_quotes
      for insert to authenticated with check (public.has_card_access());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_source_quotes' and policyname='card_source_quotes_upd') then
    create policy card_source_quotes_upd on public.card_source_quotes
      for update to authenticated using (public.has_card_access()) with check (public.has_card_access());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_source_quotes' and policyname='card_source_quotes_del') then
    create policy card_source_quotes_del on public.card_source_quotes
      for delete to authenticated using (public.is_owner());
  end if;
end $$;

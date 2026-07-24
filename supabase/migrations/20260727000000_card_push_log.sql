-- Connector push log (Beau, 2026-07-24). The idempotency record: one row per
-- entry successfully posted to a bookkeeping app. The push endpoint skips any
-- entry already logged, so re-running a push can never duplicate a journal in
-- someone's real books. Additive + idempotent.
create table if not exists public.card_push_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.card_businesses(id) on delete cascade,
  provider text not null,
  reference text not null,        -- our CARDOPS-... reference = the idempotency key
  external_id text,               -- their journal id, when returned
  pushed_at timestamptz not null default now(),
  pushed_by uuid
);
-- The guarantee: one successful post per (business, backend, entry).
create unique index if not exists card_push_log_uniq
  on public.card_push_log (business_id, provider, reference);
create index if not exists card_push_log_biz_idx on public.card_push_log (business_id, pushed_at desc);

alter table public.card_push_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_push_log' and policyname='card_push_log_own') then
    create policy card_push_log_own on public.card_push_log for all to authenticated
      using (exists (select 1 from public.card_businesses b where b.id = business_id and b.user_id = auth.uid()))
      with check (exists (select 1 from public.card_businesses b where b.id = business_id and b.user_id = auth.uid()));
  end if;
end $$;

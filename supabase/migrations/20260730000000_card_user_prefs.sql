-- CardOps per-user preferences (Beau, 2026-07-24). Currently just the automatic
-- estimate policy: whether estimates run on their own, which of the two modes,
-- and at what model depth. Default is ON with the cheap model, as Beau specced.
-- Additive + idempotent.
create table if not exists public.card_user_prefs (
  user_id uuid primary key default auth.uid(),
  auto_estimate text not null default 'both',    -- off | A | B | both
  estimate_model text not null default 'light',  -- light (Haiku) | deep (Opus)
  updated_at timestamptz not null default now()
);
alter table public.card_user_prefs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_user_prefs' and policyname='card_user_prefs_own') then
    create policy card_user_prefs_own on public.card_user_prefs for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

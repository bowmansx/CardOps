-- ══════════════════════════════════════════════════════════════════════════
-- PHOTO PROVENANCE + STORAGE METERING (Beau, 2026-07-25)
-- Design: reference/DESIGN_PHOTO_SYSTEM.md §4 (crop integrity) and §6 (storage).
--
-- Two jobs, both of which get much harder the longer they wait:
--
-- 1. PROVENANCE. The camera now keeps the full uncropped frame beside the
--    margin crop. Until this migration there was nowhere to say which is
--    which, and — worse — the CROPPED image was being stored as
--    variant='original', so the labels actively lied. Corners and edges are
--    the grade; the record of which pixels were removed has to be part of the
--    row, not folklore.
--
-- 2. MEASUREMENT. Storage is the second meter beside credits, and unlike AI
--    spend it recurs every month forever whether or not the user ever returns.
--    You cannot bill, cap, or even warn on bytes you never recorded, and the
--    history is unrecoverable if measurement starts late — so `bytes` lands
--    now, long before any quota exists to enforce.
-- ══════════════════════════════════════════════════════════════════════════

-- ── A. card_photos: provenance + size ──────────────────────────────────────
alter table public.card_photos
  -- Which shot in a template this is. Wider than the old front/back/slab/defect
  -- so corner and surface shots (the grading template) have somewhere to live.
  add column if not exists role text,
  -- Points at the uncropped frame this was derived from. Null on originals.
  add column if not exists derived_from uuid references public.card_photos(id) on delete set null,
  -- {quad, margin_pct, deskewed} — how the derivative was produced, so any
  -- crop can be audited against its source rather than trusted.
  add column if not exists crop_geometry jsonb,
  add column if not exists width int,
  add column if not exists height int,
  -- REQUIRED for metering. Nullable only so pre-existing rows don't block the
  -- migration; new writes always set it.
  add column if not exists bytes bigint,
  add column if not exists capture_meta jsonb;

create index if not exists card_photos_derived_idx on public.card_photos (derived_from)
  where derived_from is not null;

-- The old CHECK only allowed front/back/slab/defect. Template shots need more.
alter table public.card_photos drop constraint if exists card_photos_kind_check;
alter table public.card_photos add constraint card_photos_kind_check check (kind in
  ('front','back','slab','defect',
   'corner_tl','corner_tr','corner_bl','corner_br',
   'corner_tl_back','corner_tr_back','corner_bl_back','corner_br_back',
   'surface_angle','edge','other'));

-- ── B. Per-user storage rollup ─────────────────────────────────────────────
-- Maintained on write. NOT computed by scanning the bucket: a number you have
-- to go and calculate is a number nobody looks at, and the whole point is to
-- warn a user BEFORE they hit a wall rather than explain it afterwards.
create table if not exists public.user_storage_usage (
  user_id uuid primary key,
  bytes bigint not null default 0,
  objects int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_storage_usage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_storage_usage' and policyname='user_storage_usage_self') then
    create policy user_storage_usage_self on public.user_storage_usage for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- Photos are owned through their card. Resolve the owner once per change.
create or replace function public.bump_storage_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_bytes bigint; v_objects int;
begin
  if tg_op = 'INSERT' then
    select user_id into v_user from public.cards where id = new.card_id;
    v_bytes := coalesce(new.bytes, 0); v_objects := 1;
  elsif tg_op = 'DELETE' then
    select user_id into v_user from public.cards where id = old.card_id;
    v_bytes := -coalesce(old.bytes, 0); v_objects := -1;
  else
    -- UPDATE: only a size change matters.
    select user_id into v_user from public.cards where id = new.card_id;
    v_bytes := coalesce(new.bytes, 0) - coalesce(old.bytes, 0); v_objects := 0;
  end if;
  if v_user is null then return coalesce(new, old); end if;

  insert into public.user_storage_usage (user_id, bytes, objects, updated_at)
  values (v_user, greatest(0, v_bytes), greatest(0, v_objects), now())
  on conflict (user_id) do update
    set bytes = greatest(0, public.user_storage_usage.bytes + v_bytes),
        objects = greatest(0, public.user_storage_usage.objects + v_objects),
        updated_at = now();
  return coalesce(new, old);
end $$;

drop trigger if exists card_photos_storage_ai on public.card_photos;
create trigger card_photos_storage_ai after insert or update of bytes or delete
  on public.card_photos for each row execute function public.bump_storage_usage();

-- Backfill the rollup from whatever is already recorded (no-op on a fresh DB;
-- pre-existing rows have null bytes and simply count as objects).
insert into public.user_storage_usage (user_id, bytes, objects, updated_at)
select c.user_id, coalesce(sum(p.bytes), 0), count(*), now()
from public.card_photos p join public.cards c on c.id = p.card_id
group by c.user_id
on conflict (user_id) do update
  set bytes = excluded.bytes, objects = excluded.objects, updated_at = now();

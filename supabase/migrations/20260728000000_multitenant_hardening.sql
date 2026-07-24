-- Multi-tenant hardening (Beau, 2026-07-24). The follow-ups flagged when CardOps
-- went multi-tenant — all of them only bite once a SECOND user exists, so they're
-- being closed before any invites go out. Additive + idempotent.
--
--   1. card-photos storage: the FILES weren't per-user (only their metadata was)
--   2. pricing templates: shared, so one user could edit/delete another's
--   3. grade multipliers: global config any card user could rewrite
--   4. two globally-unique names that a second user would collide with

-- ── 1) card-photos: a user sees their own files, plus legacy files for cards they own
-- New uploads are foldered <user_id>/<card_id>/…; existing ones are <card_id>/…,
-- so both layouts are honoured without moving a single object.
create or replace function public.card_photo_visible(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare seg text; cid uuid;
begin
  if p_name is null then return false; end if;
  seg := split_part(p_name, '/', 1);
  if seg = auth.uid()::text then return true; end if;   -- new layout
  begin
    cid := seg::uuid;                                    -- legacy layout: <card_id>/…
  exception when others then
    return false;
  end;
  return public.owns_card(cid);
end $$;
revoke all on function public.card_photo_visible(text) from public;
grant execute on function public.card_photo_visible(text) to authenticated;

drop policy if exists card_photos_storage_rw on storage.objects;
create policy card_photos_storage_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'card-photos' and public.card_photo_visible(name))
  with check (bucket_id = 'card-photos' and public.card_photo_visible(name));

-- ── 2) pricing templates: built-ins stay shared, custom formats become per-user
alter table public.card_pricing_strategies add column if not exists user_id uuid;
-- Anything that isn't a built-in seed belongs to the owner who made it.
update public.card_pricing_strategies
   set user_id = coalesce((select p.id from public.profiles p where p.role = 'owner' limit 1),
                          (select u.id from auth.users u where u.email = 'bowmansx@gmail.com'))
 where user_id is null
   and key not in ('standard','conservative','aggressive','hot','thin_market','manual_lock');
alter table public.card_pricing_strategies alter column user_id set default auth.uid();
create index if not exists card_pricing_strategies_user_idx on public.card_pricing_strategies (user_id);

alter table public.card_pricing_strategies enable row level security;
do $$ declare pol text; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='card_pricing_strategies' loop
    execute format('drop policy %I on public.card_pricing_strategies', pol);
  end loop;
  -- Read: the shared built-ins (user_id null) + your own formats.
  create policy card_pricing_strategies_read on public.card_pricing_strategies for select to authenticated
    using (user_id is null or user_id = auth.uid());
  -- Write: only your own — nobody can edit or delete a built-in or someone else's.
  create policy card_pricing_strategies_ins on public.card_pricing_strategies for insert to authenticated
    with check (user_id = auth.uid());
  create policy card_pricing_strategies_upd on public.card_pricing_strategies for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy card_pricing_strategies_del on public.card_pricing_strategies for delete to authenticated
    using (user_id = auth.uid());
end $$;

-- ── 3) grade multipliers: shared reference data, owner-maintained
alter table public.card_grade_multipliers enable row level security;
do $$ declare pol text; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='card_grade_multipliers' loop
    execute format('drop policy %I on public.card_grade_multipliers', pol);
  end loop;
  create policy card_grade_multipliers_read on public.card_grade_multipliers for select to authenticated
    using (public.has_card_access());
  create policy card_grade_multipliers_write on public.card_grade_multipliers for all to authenticated
    using (public.is_owner()) with check (public.is_owner());
end $$;

-- ── 4) names that were globally unique now scope to the user
-- format profiles: drop the global unique on name, add (user_id, name)
do $$ declare c text; begin
  for c in
    select con.conname from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    where cl.relname = 'card_format_profiles' and con.contype = 'u'
  loop
    execute format('alter table public.card_format_profiles drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists card_format_profiles_user_name_uniq
  on public.card_format_profiles (user_id, name);

-- storage locations: PK was the bare name, so two users couldn't both have "Box 1".
-- Nothing references this table, so re-keying is safe.
do $$ declare pk text; begin
  if not exists (select 1 from public.card_storage_locations where user_id is null) then
    select con.conname into pk from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      where cl.relname = 'card_storage_locations' and con.contype = 'p';
    if pk is not null and pk <> 'card_storage_locations_user_name_pk' then
      execute format('alter table public.card_storage_locations drop constraint %I', pk);
      alter table public.card_storage_locations alter column user_id set not null;
      alter table public.card_storage_locations add constraint card_storage_locations_user_name_pk primary key (user_id, name);
    end if;
  end if;
end $$;

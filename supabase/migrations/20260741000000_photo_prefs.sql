-- ══════════════════════════════════════════════════════════════════════════
-- PHOTO CAPTURE PREFERENCES (Beau, 2026-07-25) — CAPTURE_WORK_ITEMS.md P2.
--
-- "All of these things should have variations in settings people can save
-- along with what they set as defaults."
--
-- Extends card_user_prefs rather than adding a card_photo_prefs table: it is
-- the same concern (one row per user, own-row RLS, one upsert path), and a
-- second table would mean a second policy and a second API route to keep in
-- step for no gain.
--
-- Every knob here changes how many BYTES a card costs to keep, which is why
-- the quality preset and keep_originals sit next to each other: storage is a
-- metered resource (20260740) and the trade has to be visible where the choice
-- is made, not discovered on a bill.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.card_user_prefs
  -- 'in_app' = the scanner with guide + auto-snap; 'os_camera' = hand off to
  -- the phone's own camera app. The fallback stays selectable because the OS
  -- camera applies HDR and noise reduction we cannot reproduce on a raw frame.
  add column if not exists capture_mode text not null default 'in_app'
    check (capture_mode in ('in_app', 'os_camera')),
  add column if not exists photo_quality text not null default 'standard'
    check (photo_quality in ('economy', 'standard', 'high', 'archive')),
  add column if not exists auto_snap boolean not null default false,
  add column if not exists burst_count int not null default 3
    check (burst_count between 1 and 5),
  add column if not exists auto_crop text not null default 'margin'
    check (auto_crop in ('off', 'margin', 'tight')),
  -- Percent of card width kept as background around the crop. Bounded, not
  -- free: 0 puts the card's edge ON the image boundary, which is exactly the
  -- misrepresentation the margin exists to prevent.
  add column if not exists crop_margin_pct numeric(4,3) not null default 0.040
    check (crop_margin_pct between 0.005 and 0.250),
  add column if not exists keep_originals boolean not null default true,
  add column if not exists default_template text;

-- Named bundles: "bulk intake" vs "consignment quality", so switching working
-- modes is one tap instead of re-tuning six knobs.
create table if not exists public.card_photo_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  settings jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.card_photo_presets enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_photo_presets' and policyname='card_photo_presets_own') then
    create policy card_photo_presets_own on public.card_photo_presets for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- keep_originals is the one setting that can quietly destroy evidence: turned
-- off, a crop becomes the ONLY record of a card's edges. It is not blocked --
-- it's the user's storage -- but the change is recorded so "when did we stop
-- keeping originals?" has an answer.
create or replace function public.log_keep_originals_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.keep_originals is distinct from old.keep_originals then
    insert into public.audit_log (actor, action, target, payload, result)
    values ('web', 'photo_prefs.keep_originals', new.user_id::text,
            jsonb_build_object('from', old.keep_originals, 'to', new.keep_originals),
            'ok');
  end if;
  return new;
end $$;
drop trigger if exists card_user_prefs_keep_originals_au on public.card_user_prefs;
create trigger card_user_prefs_keep_originals_au after update of keep_originals
  on public.card_user_prefs for each row execute function public.log_keep_originals_change();

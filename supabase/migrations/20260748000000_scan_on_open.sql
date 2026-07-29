-- ══════════════════════════════════════════════════════════════════════════
-- WRONG-DATABASE GUARD. Runs first, changes nothing, refuses everything after
-- it if this is not CardOps.
--
-- On 2026-07-28 a whole evening of diagnostics ran against the OLD SHARED
-- Master-Ops project (wjcalfuwqantwhizkdks) instead of CardOps
-- (zgkydwvmdnnrxcacegth), because the Supabase URL autocompleted to whichever
-- project was typed first. Seven migrations looked like they had vanished. One
-- stray column got added to the wrong database.
--
-- card_identities exists ONLY in CardOps - it was created after the split - so
-- its absence is a reliable "you are in the wrong place".
-- ══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.card_identities') is null then
    raise exception using
      errcode = '42P01',
      message = 'WRONG DATABASE - this is a CardOps migration',
      detail  = 'public.card_identities is missing, so this is almost certainly the old shared Master-Ops project (wjcalfuwqantwhizkdks). Nothing has been changed.',
      hint    = 'CardOps is https://supabase.com/dashboard/project/zgkydwvmdnnrxcacegth/sql/new';
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- FRAME FIRST, THEN SCAN (2026-07-27)
--
-- Beau: "i would like for there to be a 'start scan' button before immediately
--        jumping into it when loading into the camera.... this is a setting
--        that can be toggled on/off."
--        "make the start scan button be at the bottom of the regular scanning
--         overlay.... so you can see your camera space and position your camera
--         and item into position... then you hit start scan at the bottom"
--
-- The camera and the guide frame come up immediately — you cannot line a card
-- up against a black screen. What waits is the SCAN: edge detection, the
-- distance/angle readout, auto-snap, and the light sampling. Those all used to
-- begin the instant the sheet opened, which meant they spent their first
-- seconds measuring a lap or a ceiling while the phone was still on its way to
-- the card, and on a twelve-shot template that happened twelve times.
--
-- DEFAULT FALSE, meaning the Start scan button IS shown. That is the behaviour
-- asked for, and it is the better default on its own: framing is what a person
-- does first, and scanning is a thing they should commit to rather than have
-- begin around them. Setting it true starts the scan the moment the viewfinder
-- is live, for anyone who prefers the speed.
--
-- Sits on card_user_prefs with the rest of the photo settings for the reason
-- 20260741 gives — one row per user, own-row RLS, one upsert path.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.card_user_prefs
  add column if not exists scan_on_open boolean not null default false;

comment on column public.card_user_prefs.scan_on_open is
  'When true, edge detection and auto-snap begin as soon as the viewfinder is live. When false (the default) the camera still opens for framing, but scanning waits for the Start scan button.';

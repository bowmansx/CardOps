-- ══════════════════════════════════════════════════════════════════════════
-- ASK BEFORE TAKING THE CAMERA (2026-07-27)
--
-- Beau: "i would like for there to be a 'start scan' button before immediately
--        jumping into it when loading into the camera.... this is a setting
--        that can be toggled on/off."
--
-- Opening a camera surface currently calls getUserMedia immediately: the
-- sensor spins up, the permission prompt fires on a first run, and the
-- detection loop starts running against whatever the lens happens to be
-- pointed at - usually a lap or a ceiling - before the user has decided they
-- are ready. On a twelve-shot template that happens twelve times.
--
-- DEFAULT FALSE, meaning the start screen IS shown. That is the behaviour
-- asked for, and it is also the better default on its own merits: nothing
-- reaches for a camera until someone asks it to. Setting it true restores the
-- old straight-to-viewfinder behaviour for anyone who prefers the speed.
--
-- Sits on card_user_prefs with the rest of the photo settings for the reason
-- 20260741 gives - one row per user, own-row RLS, one upsert path.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.card_user_prefs
  add column if not exists scan_on_open boolean not null default false;

comment on column public.card_user_prefs.scan_on_open is
  'When true the camera opens straight into the live viewfinder. When false (the default) it shows a Start scan screen first, and no getUserMedia call is made until the user taps it.';

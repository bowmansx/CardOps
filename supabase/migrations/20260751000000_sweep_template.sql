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
-- A TEMPLATE THAT WALKS YOU THROUGH THE SCANNING TECHNIQUE (2026-07-29)
--
-- Beau: "we could even have a photo session template that walks you through a
--        scanning technique."
--
-- Every existing template's surface shot says "Tilt to catch the light" and has
-- NO IDEA whether anyone did. That is the difference a sweep makes: it measures
-- the tilt instead of asking for it, and says so when there wasn't any.
--
-- FOUR PHOTOS FROM TWO PASSES. A sweep merges several angles into two images at
-- once — the card with its glare removed, and a raking-light map of its surface
-- — so one pass over the front produces both the listing photo and the grading
-- evidence. Under the old templates those were separate shots, and the surface
-- one depended on the user tilting well by hand.
--
-- The `sweep` flag is what the camera reads; the hints are what the person
-- reads. Both matter: the flag starts the sweep, the hint explains why they are
-- being asked to wave their phone about.
-- ══════════════════════════════════════════════════════════════════════════

insert into public.card_photo_templates (user_id, key, name, shots, sort) values
  (null, 'sweep', 'Sweep scan — glare-free + surface',
   '[{"role":"front","label":"FRONT SWEEP","sweep":true,
      "hint":"Move the phone through a slow arc, tilting as you go. Keep the whole card in frame."},
     {"role":"surface_angle","label":"FRONT SURFACE","sweep":true,
      "hint":"Same sweep — this one keeps the raking light so scratches and print lines show."},
     {"role":"back","label":"BACK SWEEP","sweep":true,
      "hint":"Turn the card over and sweep again."},
     {"role":"edge","label":"EDGES",
      "hint":"Along one long edge. A single shot is fine here."}]'::jsonb, 25)
on conflict (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
do update set name = excluded.name, shots = excluded.shots, sort = excluded.sort;

-- The upgrade the sweep makes possible for the templates that already exist:
-- their surface shot becomes measured rather than requested. Left as a comment
-- rather than applied, because changing a template someone may have customised
-- is a decision, not a migration.
--
--   update public.card_photo_templates
--      set shots = jsonb_set(shots, '{4,sweep}', 'true'::jsonb)
--    where user_id is null and key = 'listing';

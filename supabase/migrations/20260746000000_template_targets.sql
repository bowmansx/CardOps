-- ══════════════════════════════════════════════════════════════════════════
-- PROXIMITY AND ANGLE TARGETS ON THE BUILT-IN TEMPLATES (2026-07-26)
--
-- Beau, `Photo Process and Format`:
--   "We may have a suggested zoom/proximity assignment for taking corner
--    photos... it would be up to the app to aid them in getting the
--    proximity/zoom level set in the template."
--   "Similar to corners, we may have a box that the user can input a number
--    that would be the number of angle degree when taking a photo."
--   "I hope that we, the app, can have an indicator and a guide to the user as
--    to how far away they are from the card during the photo... to let them
--    know how much further or closer they need to move their camera."
--
-- NO SCHEMA CHANGE. `card_photo_templates.shots` is already jsonb, so the
-- targets ride inside each shot object. This migration only rewrites the
-- BUILT-IN templates to carry them; custom templates are untouched and keep
-- working with no targets at all.
--
-- TARGETS ARE FRAME FILL, NOT INCHES. What makes two corner shots comparable
-- is how much of the frame the corner occupies, and that needs no calibration
-- to be right. Inches drift with every phone's lens; the app still SHOWS
-- inches because that is what a human thinks in, but what a template stores
-- and matches against is the fraction.
-- ══════════════════════════════════════════════════════════════════════════

update public.card_photo_templates set shots = '[
  {"role":"front","label":"FRONT","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"back","label":"BACK","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0}
]'::jsonb where user_id is null and key = 'front_back';

update public.card_photo_templates set shots = '[
  {"role":"front","label":"FRONT","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"back","label":"BACK","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"corner_tl","label":"TOP-LEFT CORNER","hint":"Fill the frame with the corner","targetFill":0.30},
  {"role":"corner_br","label":"BOTTOM-RIGHT CORNER","hint":"Fill the frame with the corner","targetFill":0.30},
  {"role":"surface_angle","label":"SURFACE","hint":"Tilt to catch the light - show gloss and any print lines","targetTilt":35},
  {"role":"edge","label":"EDGES","hint":"Along one long edge","targetFill":0.45}
]'::jsonb where user_id is null and key = 'listing';

-- The grading set is where consistency actually pays: every corner shot taken
-- at the same distance is directly comparable, card to card and month to
-- month. That is the whole argument for a target.
update public.card_photo_templates set shots = '[
  {"role":"front","label":"FRONT","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"corner_tl","label":"FRONT - TOP-LEFT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"corner_tr","label":"FRONT - TOP-RIGHT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"corner_bl","label":"FRONT - BOTTOM-LEFT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"corner_br","label":"FRONT - BOTTOM-RIGHT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"surface_angle","label":"FRONT SURFACE","hint":"Tilt to catch the light - print lines, dimples, scratches","targetTilt":35},
  {"role":"edge","label":"EDGES","hint":"Along one long edge","targetFill":0.45},
  {"role":"back","label":"BACK","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"corner_tl_back","label":"BACK - TOP-LEFT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"corner_tr_back","label":"BACK - TOP-RIGHT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"corner_bl_back","label":"BACK - BOTTOM-LEFT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0},
  {"role":"corner_br_back","label":"BACK - BOTTOM-RIGHT","hint":"Fill the frame with the corner","targetFill":0.30,"targetTilt":0}
]'::jsonb where user_id is null and key = 'grading';

update public.card_photo_templates set shots = '[
  {"role":"front","label":"FRONT","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"back","label":"BACK","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0},
  {"role":"defect","label":"THE FLAW","hint":"Close on whatever you would disclose","targetFill":0.35},
  {"role":"edge","label":"EDGES","hint":"Along one long edge","targetFill":0.45}
]'::jsonb where user_id is null and key = 'condition';

-- Front-only, which Beau asked to sit second in the list.
insert into public.card_photo_templates (user_id, key, name, shots, sort) values
  (null, 'front_only', 'Front only',
   '[{"role":"front","label":"FRONT","hint":"Whole card, straight on","targetFill":0.62,"targetTilt":0}]'::jsonb, 15)
on conflict do nothing;

-- Every role must still be one card_photos will accept, or a template asks for
-- a shot that cannot be saved and the user finds out at the end of a run.
do $$
declare bad text;
begin
  select string_agg(distinct r, ', ') into bad
    from public.card_photo_templates t,
         lateral jsonb_array_elements(t.shots) s,
         lateral (select s->>'role') x(r)
   where r not in ('front','back','slab','defect',
                   'corner_tl','corner_tr','corner_bl','corner_br',
                   'corner_tl_back','corner_tr_back','corner_bl_back','corner_br_back',
                   'surface_angle','edge','other');
  if bad is not null then
    raise exception 'template roles that card_photos would reject: %', bad;
  end if;
end $$;

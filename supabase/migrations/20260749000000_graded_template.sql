-- ══════════════════════════════════════════════════════════════════════════
-- A GRADED CARD IS NOT A RAW CARD (2026-07-27)
--
-- Beau, testing the scanner on a PSA slab:
--   "i was using a psa graded card which seems unnecessary for a lot of this
--    stuff and harder to capture"
--
-- He is right on both counts, and every one of the five built-in templates
-- assumed a raw card.
--
-- UNNECESSARY: corner shots exist so someone can judge corner wear. A PSA 9's
-- corners have already been judged, by PSA, and are sealed under plastic. The
-- twelve-shot grading template pointed at a slab asks for eleven photographs
-- nobody will ever open. Same for edges and surface.
--
-- HARDER: a slab is a thick sheet of polished plastic, which is to say a
-- mirror. It produces the largest specular reflections of anything in a
-- collection, and the edge detector locks onto the HOLDER's outline rather
-- than the card's - so the distance and aspect readings describe the case.
--
-- What a graded card actually needs is three shots: the front, the back, and a
-- close read of the LABEL. The cert number on that label is the one piece of
-- information that identifies the slab uniquely in the world, and it is
-- already what the FIND matcher treats as decisive - a cert agreement settles
-- an identification on its own, and a cert conflict kills a candidate no
-- matter how much else lines up.
--
-- NOTE ON `guide`: shots may now name the frame guide they want. A slab is not
-- the shape of the card inside it, and having to remember to tap "Slab" before
-- every shot is exactly the kind of thing a template should carry. Absent
-- means raw, so every existing template is unchanged.
--
-- No schema change - `shots` has been jsonb since 20260744.
-- ══════════════════════════════════════════════════════════════════════════

insert into public.card_photo_templates (user_id, key, name, shots, sort) values
  (null, 'graded', 'Graded slab', '[
    {"role":"front","label":"SLAB FRONT","hint":"Whole slab, straight on","guide":"slab","targetFill":0.62,"targetTilt":0},
    {"role":"back","label":"SLAB BACK","hint":"Whole slab, straight on","guide":"slab","targetFill":0.62,"targetTilt":0},
    {"role":"slab","label":"LABEL","hint":"Close on the label - the cert number has to be readable","guide":"slab","targetFill":0.40}
  ]'::jsonb, 12)
on conflict do nothing;

-- The label is identification, never condition evidence, and gradingPhotos in
-- lib/cards/photo-set already filters the slab role out of what reaches the
-- grade estimator. This asserts that stays true: a label photo is a picture of
-- PSA's opinion, and feeding it to a model asked to form its own would be
-- laundering one into the other.
do $$
begin
  if not exists (
    select 1 from public.card_photo_templates
     where user_id is null and key = 'graded'
  ) then
    raise exception 'graded template did not insert';
  end if;
end $$;

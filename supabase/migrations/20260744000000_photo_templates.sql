-- ══════════════════════════════════════════════════════════════════════════
-- PHOTO TEMPLATES (Beau, 2026-07-25) — CAPTURE_WORK_ITEMS.md P3, ideas 12-14.
--
-- "save multiple different photos of a card... users set up their own photo
--  templates... e.g. all four corners front+back, surface angles... to give
--  better info for AUTO-GRADING and for eBAY LISTING export."
--
-- A template is an ORDERED list of shots. The camera walks it, announcing each
-- one ("CORNER 2 of 12") so you never have to remember what comes next with a
-- card in one hand and a phone in the other.
--
-- The `role` column and the widened `kind` CHECK it writes into already exist
-- (20260740) — corner_tl … surface_angle … edge were added for exactly this.
-- This migration adds the templates themselves and nothing else.
--
-- WHY THE SHOTS ARE JSONB AND NOT A CHILD TABLE: a template is read whole,
-- written whole, and never queried across. A child table would buy ordering
-- ceremony and a second RLS policy for no question anyone will ask.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.card_photo_templates (
  id uuid primary key default gen_random_uuid(),
  -- NULL = built-in, shared by everyone. A user's own sit alongside.
  user_id uuid references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  -- [{ role, label, hint }] in capture order. `role` must be one of the kinds
  -- card_photos accepts; the app validates before writing a photo, and the
  -- card_photos CHECK is the backstop.
  shots jsonb not null,
  sort int not null default 100,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  -- A template with no shots would present a camera that can never finish.
  constraint card_photo_templates_shots_nonempty
    check (jsonb_typeof(shots) = 'array' and jsonb_array_length(shots) between 1 and 40)
);

-- NULLs are never equal in a unique constraint, so a plain unique(user_id,key)
-- would let the built-in list acquire duplicates. Fold NULL to a sentinel.
create unique index if not exists card_photo_templates_owner_key
  on public.card_photo_templates (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

alter table public.card_photo_templates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_photo_templates' and policyname='card_photo_templates_read') then
    create policy card_photo_templates_read on public.card_photo_templates for select to authenticated
      using (user_id is null or user_id = auth.uid());
  end if;
  -- Own rows only for writes — the built-ins are not user-editable.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_photo_templates' and policyname='card_photo_templates_write') then
    create policy card_photo_templates_write on public.card_photo_templates for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- ── the built-ins ─────────────────────────────────────────────────────────
-- Ordered so the card is turned as few times as possible: everything on the
-- front, then everything on the back. Photographing corners in the order they
-- are listed means one rotation per side rather than eight.
insert into public.card_photo_templates (user_id, key, name, shots, sort) values
  (null, 'front_back', 'Front & back',
   '[{"role":"front","label":"FRONT","hint":"Whole card, straight on"},
     {"role":"back","label":"BACK","hint":"Whole card, straight on"}]'::jsonb, 10),

  (null, 'listing', 'eBay listing',
   '[{"role":"front","label":"FRONT","hint":"Whole card, straight on"},
     {"role":"back","label":"BACK","hint":"Whole card, straight on"},
     {"role":"corner_tl","label":"TOP-LEFT CORNER","hint":"Fill the frame with the corner"},
     {"role":"corner_br","label":"BOTTOM-RIGHT CORNER","hint":"Fill the frame with the corner"},
     {"role":"surface_angle","label":"SURFACE","hint":"Tilt to catch the light — show gloss and any print lines"},
     {"role":"edge","label":"EDGES","hint":"Along one long edge"}]'::jsonb, 20),

  (null, 'grading', 'Grading — corners & surface',
   '[{"role":"front","label":"FRONT","hint":"Whole card, straight on"},
     {"role":"corner_tl","label":"FRONT · TOP-LEFT","hint":"Fill the frame with the corner"},
     {"role":"corner_tr","label":"FRONT · TOP-RIGHT","hint":"Fill the frame with the corner"},
     {"role":"corner_bl","label":"FRONT · BOTTOM-LEFT","hint":"Fill the frame with the corner"},
     {"role":"corner_br","label":"FRONT · BOTTOM-RIGHT","hint":"Fill the frame with the corner"},
     {"role":"surface_angle","label":"FRONT SURFACE","hint":"Tilt to catch the light — print lines, dimples, scratches"},
     {"role":"edge","label":"EDGES","hint":"Along one long edge"},
     {"role":"back","label":"BACK","hint":"Whole card, straight on"},
     {"role":"corner_tl_back","label":"BACK · TOP-LEFT","hint":"Fill the frame with the corner"},
     {"role":"corner_tr_back","label":"BACK · TOP-RIGHT","hint":"Fill the frame with the corner"},
     {"role":"corner_bl_back","label":"BACK · BOTTOM-LEFT","hint":"Fill the frame with the corner"},
     {"role":"corner_br_back","label":"BACK · BOTTOM-RIGHT","hint":"Fill the frame with the corner"}]'::jsonb, 30),

  (null, 'condition', 'Condition notes',
   '[{"role":"front","label":"FRONT","hint":"Whole card, straight on"},
     {"role":"back","label":"BACK","hint":"Whole card, straight on"},
     {"role":"defect","label":"THE FLAW","hint":"Close on whatever you would disclose"},
     {"role":"edge","label":"EDGES","hint":"Along one long edge"}]'::jsonb, 40)
on conflict do nothing;

-- Every built-in role must be a kind card_photos will actually accept —
-- otherwise the template presents a shot that can never be saved, and the user
-- finds out at the end of a twelve-photo run.
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

-- ══════════════════════════════════════════════════════════════════════════
-- SESSION ORDER IS SAVE ORDER (2026-07-27)
--
-- Beau, `Photo Process and Format`:
--   "there will also be the option to grab and move around the order of your
--    session and this will also be the order of how your photos are saved."
--
-- Until now a card's photos had no order of their own. `created_at` looked
-- like one but is an artefact: recordCardPhotos inserts every UNCROPPED frame
-- before any crop, so a card's rows come back interleaved by variant rather
-- than in the order the shots were taken. Reordering a session had nothing to
-- write to.
--
-- `position` is the slot's index in the session that produced it. A crop and
-- the frame it came from SHARE a position — they are one shot, and the crop
-- wins presentation by the existing derived_from rule, not by sorting.
--
-- NULL means "taken before this column existed". Ordering falls back to
-- created_at for those, so old cards keep the order they already appeared in
-- rather than collapsing into an arbitrary one.
--
-- THE eBAY LEAD IMAGE DOES NOT MOVE. Session order is the owner's gallery
-- order; the listing still picks its lead by rule (whole card before close
-- detail — see lib/cards/photo-set). Those answer different questions, and
-- letting a reordered session promote a corner close-up to the thumbnail
-- buyers see would undo P5.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.card_photos
  add column if not exists position int;

comment on column public.card_photos.position is
  'Index of this shot within the capture session that produced it. A crop and its uncropped original share one. NULL for rows predating 2026-07-27.';

-- Ordering a card's gallery is the only read that uses it.
create index if not exists card_photos_card_position_idx
  on public.card_photos (card_id, position, created_at);

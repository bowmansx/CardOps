-- Card categorization v2 (Beau, 2026-07-18): TCG-aware fields.
-- Additive + idempotent. The category registry itself lives in code
-- (src/lib/cards/types.ts) — sport_category stays free text, no constraint.
-- `language` already exists (cardops_init, default 'EN').
alter table public.cards add column if not exists rarity text;

-- Value snapshots (Beau, 2026-07-18): the card's computed value as of 30 days
-- / 1 year ago, stored by the nightly repricer + every recompute so the
-- inventory list can show % change columns without per-row comp math.
-- Additive + idempotent.
alter table public.cards add column if not exists value_30d numeric;
alter table public.cards add column if not exists value_365d numeric;

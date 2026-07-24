-- Push-log claim status (Beau, 2026-07-24). The push now CLAIMS an entry in this
-- table *before* posting it outward, so the unique index becomes a real lock that
-- fires before money moves (previously it only fired on the log write afterwards,
-- which is too late). Statuses:
--   pending   — claimed, post in flight
--   posted    — confirmed landed
--   uncertain — the request failed after being sent; we do NOT know if it landed,
--               so it is never auto-retried (a duplicate in real books is worse
--               than a missing one you can see and fix)
-- Additive + idempotent. Existing rows were only ever written on success.
alter table public.card_push_log add column if not exists status text not null default 'posted';
alter table public.card_push_log add column if not exists error text;
alter table public.card_push_log add column if not exists updated_at timestamptz not null default now();
create index if not exists card_push_log_status_idx on public.card_push_log (business_id, status);

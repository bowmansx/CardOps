-- CardOps: price-alert push dedup — remember when we pushed a crossing so it
-- fires once per crossing (re-armed when the price goes back the other way).
-- Additive + idempotent.
alter table public.card_alerts add column if not exists notified_at timestamptz;

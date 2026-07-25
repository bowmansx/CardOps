-- ══════════════════════════════════════════════════════════════════════════
-- CREDIT METERING v2 + AI COST TELEMETRY (Beau, 2026-07-25)
--
-- The business model: users buy computation credits on the website and spend
-- them on metered AI work. Decisions locked with Beau:
--   · plan grants EXPIRE at period end (rollover capped at 1× allowance, 30d)
--   · purchased top-ups NEVER expire
--   · spending consumes the soonest-expiring bucket first (FIFO by expiry)
--   · retail price (credits, src/lib/cards/credits.ts COST table) is decoupled
--     from measured cost (ai_usage.cost_usd) — cache savings are margin
--   · SHADOW MODE now: everything records, nothing is refused. The
--     'credit_enforcement' service_config flag flips the app-side gate on.
--
-- What this migration does:
--   A. ai_usage — real token/cost telemetry per AI run (the measurement layer)
--   B. credit_ledger v2 — kind / expires_at / remaining / shortfall columns
--   C. credit_balance() v2, credit_grant(), credit_spend() (FIFO draw)
--   D. seeds the (off) enforcement flag
--
-- Ordering rule (prevention rule 7): the app charges AFTER the effect — the
-- estimate row lands first, then credit_spend records the draw. That is why
-- credit_spend never refuses: by the time it runs, the compute already
-- happened; refusing would hide a real cost. Refusal (when enforcement is on)
-- happens in app code BEFORE the AI call, via the same remaining-sum this
-- file's balance function uses.
-- ══════════════════════════════════════════════════════════════════════════

-- ── A. AI cost telemetry ───────────────────────────────────────────────────
-- One row per model call. cost_usd is NULL when the model has no rate on
-- file — an unknown price is flagged, never defaulted to $0 (rule 9).
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  feature text not null,               -- mirrors the ledger reason, e.g. 'estimate:standard_plus'
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6),             -- computed at write time from src/lib/ai/rates.ts; null = unpriced
  credits_charged integer not null default 0, -- 0 when the run wasn't billed (e.g. estimate not stored)
  ref uuid,                            -- card id / job id
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

-- Service-role writes only; the owner margin screen reads via the service
-- client. RLS on with no policies = closed to every non-service caller.
alter table public.ai_usage enable row level security;

-- ── B. credit_ledger v2 ────────────────────────────────────────────────────
alter table public.credit_ledger
  add column if not exists kind text not null default 'adjustment',
  add column if not exists expires_at timestamptz,
  add column if not exists remaining integer,
  add column if not exists shortfall integer not null default 0;

-- Backfill any pre-v2 rows (a freshly-bootstrapped DB has none): negatives
-- become spends; positives become grants funded at face value, then reduced
-- oldest-first by the total already spent — the same answer the old
-- sum(delta) balance gave.
do $$
declare v_user uuid; v_owe int; r record;
begin
  update public.credit_ledger set kind = 'spend', remaining = null
    where delta < 0 and kind <> 'spend';
  update public.credit_ledger set remaining = delta
    where delta > 0 and remaining is null;
  for v_user in select distinct user_id from public.credit_ledger loop
    select coalesce(-sum(delta), 0) into v_owe
      from public.credit_ledger where user_id = v_user and kind = 'spend';
    for r in select id, remaining from public.credit_ledger
      where user_id = v_user and kind <> 'spend' and remaining > 0
      order by created_at, id
    loop
      exit when v_owe <= 0;
      update public.credit_ledger
        set remaining = greatest(0, remaining - v_owe) where id = r.id;
      v_owe := v_owe - r.remaining;
    end loop;
  end loop;
end $$;

alter table public.credit_ledger drop constraint if exists credit_ledger_kind_chk;
alter table public.credit_ledger add constraint credit_ledger_kind_chk
  check (kind in ('plan_grant', 'rollover', 'purchase', 'promo', 'adjustment', 'spend'));
alter table public.credit_ledger drop constraint if exists credit_ledger_shape_chk;
alter table public.credit_ledger add constraint credit_ledger_shape_chk check (
  (kind = 'spend' and delta < 0 and remaining is null)
  or (kind <> 'spend' and delta > 0 and remaining is not null
      and remaining >= 0 and remaining <= delta)
);
create index if not exists credit_ledger_draw_idx
  on public.credit_ledger (user_id, expires_at asc nulls last, id asc)
  where kind <> 'spend' and remaining > 0;

-- ── C. functions ───────────────────────────────────────────────────────────

-- Balance v2: what the signed-in user can actually spend — unexpired grant
-- remainders. (The old sum(delta) counted expired grants forever and let
-- spends push the number negative silently.)
create or replace function public.credit_balance()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(remaining), 0)::int from public.credit_ledger
  where user_id = auth.uid() and kind <> 'spend'
    and (expires_at is null or expires_at > now());
$$;
revoke all on function public.credit_balance() from public;
grant execute on function public.credit_balance() to authenticated;

-- Grant credits. Service role (Stripe webhook, admin jobs) or the owner
-- (test grants from the credits screen). Positive grants only — spends go
-- through credit_spend so FIFO accounting can never be bypassed.
create or replace function public.credit_grant(
  p_user uuid, p_amount integer, p_kind text default 'adjustment',
  p_expires_at timestamptz default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_id bigint;
begin
  if v_role <> 'service_role' and not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  ) then
    raise exception 'credit_grant: only the owner or the service role may grant credits';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit_grant: amount must be a positive integer';
  end if;
  if p_kind not in ('plan_grant', 'rollover', 'purchase', 'promo', 'adjustment') then
    raise exception 'credit_grant: invalid kind %', p_kind;
  end if;
  insert into public.credit_ledger (user_id, delta, kind, expires_at, remaining, reason)
    values (p_user, p_amount, p_kind, p_expires_at, p_amount, p_reason)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'granted', p_amount,
    'balance', (select coalesce(sum(remaining), 0) from public.credit_ledger
      where user_id = p_user and kind <> 'spend'
        and (expires_at is null or expires_at > now())));
end $$;
revoke all on function public.credit_grant(uuid, integer, text, timestamptz, text) from public;
grant execute on function public.credit_grant(uuid, integer, text, timestamptz, text) to authenticated, service_role;

-- Record a spend, drawing FIFO from the soonest-expiring unexpired grants.
-- Service role only (both app call sites run on the service client, after the
-- effect exists). NEVER refuses: if the buckets can't cover it, the uncovered
-- part lands in `shortfall` on the spend row — visible, not hidden. The
-- pre-flight refusal (enforcement mode) is app code, before the AI call.
create or replace function public.credit_spend(
  p_user uuid, p_amount integer, p_reason text, p_ref uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_need integer; v_take integer; r record;
begin
  if v_role <> 'service_role' then
    raise exception 'credit_spend: service role only';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit_spend: amount must be a positive integer';
  end if;
  v_need := p_amount;
  for r in select id, remaining from public.credit_ledger
    where user_id = p_user and kind <> 'spend' and remaining > 0
      and (expires_at is null or expires_at > now())
    order by expires_at asc nulls last, id asc
    for update
  loop
    exit when v_need = 0;
    v_take := least(r.remaining, v_need);
    update public.credit_ledger set remaining = remaining - v_take where id = r.id;
    v_need := v_need - v_take;
  end loop;
  insert into public.credit_ledger (user_id, delta, kind, reason, ref, shortfall)
    values (p_user, -p_amount, 'spend', p_reason, p_ref, v_need);
  return jsonb_build_object('spent', p_amount, 'covered', p_amount - v_need,
    'shortfall', v_need,
    'balance', (select coalesce(sum(remaining), 0) from public.credit_ledger
      where user_id = p_user and kind <> 'spend'
        and (expires_at is null or expires_at > now())));
end $$;
revoke all on function public.credit_spend(uuid, integer, text, uuid) from public;
grant execute on function public.credit_spend(uuid, integer, text, uuid) to service_role;

-- ── D. enforcement flag — OFF (shadow mode) until billing exists ───────────
insert into public.service_config (key, enabled, notes)
values ('credit_enforcement', false,
  'ON = estimate runs are refused when the credit balance cannot cover them. OFF = shadow mode: spends record (with shortfall) but nothing is blocked.')
on conflict (key) do nothing;

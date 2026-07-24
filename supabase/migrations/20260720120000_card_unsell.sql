-- CardOps: reverse a mistaken or cancelled sale — the exact inverse of
-- card_sell. Owner or service_role only (the cron uses it when an eBay order
-- is cancelled). Additive + idempotent.
--
-- Why an RPC and not a status flip: cards has a guard trigger (guard_card_sale)
-- that blocks direct edits to status/sold_at/basis_drawn, precisely so a
-- half-fix can't leave a phantom sale in the books or the pool short a card.
--
-- Pool accounting note: the reversal keys off the actual pool 'draw'
-- adjustment card_sell wrote, NOT the card's basis_drawn or its current
-- use_pool_basis flag. The adjustment is the authoritative record of what the
-- sale removed, so restoring it is the true inverse even for a $0 (free) card
-- where basis_drawn is 0 but a card was still removed from the count, and even
-- if use_pool_basis was toggled after the sale.

create or replace function public.card_unsell(p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card     public.cards%rowtype;
  v_sale     public.card_sales%rowtype;
  v_pool     public.card_pool%rowtype;
  v_draw     public.card_pool_adjustments%rowtype;
  v_restored numeric := 0;
  v_count    int := 0;
begin
  if not (public.is_owner() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status <> 'sold' then raise exception 'card is not sold'; end if;

  -- Reverse the pool DRAW this sale made (if any). Find the latest 'draw' for
  -- this card that hasn't already been reversed by a later 'correction'.
  select * into v_draw from public.card_pool_adjustments
    where card_id = p_card_id and kind = 'draw'
    order by ts desc limit 1;
  if v_draw.id is not null and not exists (
        select 1 from public.card_pool_adjustments
        where card_id = p_card_id and kind = 'correction' and ts > v_draw.ts) then
    select * into v_pool from public.card_pool where id = v_draw.pool_id for update;
    if found then
      v_restored := -v_draw.amount;  -- the draw amount was stored negative
      v_count := 1;
      insert into public.card_pool_adjustments
        (pool_id, kind, card_id, amount, total_after, count_after, actor, note)
      values
        (v_pool.id, 'correction', p_card_id, v_restored,
         v_pool.total_cost + v_restored, v_pool.card_count + 1,
         coalesce(auth.uid()::text, 'system'), 'Sale reversed');
      update public.card_pool
        set total_cost = total_cost + v_restored, card_count = card_count + 1
        where id = v_pool.id;
    end if;
  end if;

  -- Drop the sale record so reports/books no longer count it.
  select * into v_sale from public.card_sales
    where card_id = p_card_id order by sold_at desc limit 1;
  if v_sale.id is not null then
    delete from public.card_sales where id = v_sale.id;
  end if;

  -- Sanctioned reset (same handshake card_sell uses for the guard trigger).
  perform set_config('cardops.in_sell', '1', true);
  update public.cards
    set status = 'booked', sold_at = null, basis_drawn = null
    where id = p_card_id;

  return jsonb_build_object(
    'reversed_sale', v_sale.id,
    'restored_basis', v_restored,
    'restored_count', v_count
  );
end $$;

revoke all on function public.card_unsell(uuid) from public;
grant execute on function public.card_unsell(uuid) to authenticated;

-- ── Durable cancelled-order guard ───────────────────────────────────────────
-- When we seller-cancel an eBay order we reverse its settlement immediately,
-- but eBay's Fulfillment feed keeps reporting the order PAID / not-cancelled
-- for a while (eventual consistency). Without a local marker the next sync
-- would re-settle it — double pool draw + phantom revenue on a refunded order.
-- This table is that marker; the sync skips any order_ref listed here.
create table if not exists public.ebay_cancelled_orders (
  order_ref    text primary key,
  cancelled_at timestamptz not null default now()
);
alter table public.ebay_cancelled_orders enable row level security;
drop policy if exists ebay_cancelled_orders_owner on public.ebay_cancelled_orders;
create policy ebay_cancelled_orders_owner on public.ebay_cancelled_orders
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

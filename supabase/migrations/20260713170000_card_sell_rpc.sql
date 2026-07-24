-- CardOps Phase 5 money loop (contract §7): atomic sale settlement.
-- One transaction: record the sale → draw basis from the pool (pooled cards) →
-- compute P/L → mark the card sold. Pool row is locked so the draw can't race
-- the Speed Book adds; the ledger stays append-only and correct.
-- SECURITY DEFINER (writes card_pool) but verifies the caller has card access.

create or replace function public.card_sell(
  p_card_id     uuid,
  p_platform    text,
  p_sale_price  numeric,
  p_fees        numeric,
  p_ship_income numeric,
  p_ship_cost   numeric,
  p_order_ref   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card  public.cards%rowtype;
  v_pool  public.card_pool%rowtype;
  v_basis numeric := 0;
  v_net   numeric;
  v_pl    numeric;
begin
  if not public.has_card_access() then raise exception 'forbidden'; end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status = 'sold' then raise exception 'card already sold'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  v_net := coalesce(p_sale_price, 0) - coalesce(p_fees, 0)
           + coalesce(p_ship_income, 0) - coalesce(p_ship_cost, 0);

  if v_card.use_pool_basis then
    select * into v_pool from public.card_pool where name = 'main' for update;
    if found and v_pool.card_count > 0 then
      v_basis := round(v_pool.total_cost / v_pool.card_count, 2);
      insert into public.card_pool_adjustments
        (pool_id, kind, card_id, amount, total_after, count_after, actor, note)
      values
        (v_pool.id, 'draw', p_card_id, -v_basis,
         v_pool.total_cost - v_basis, v_pool.card_count - 1,
         coalesce(auth.uid()::text, 'system'), 'Sale draw');
      update public.card_pool
        set total_cost = total_cost - v_basis, card_count = card_count - 1
        where id = v_pool.id;
    end if;
  else
    v_basis := coalesce(v_card.individual_basis, 0);
  end if;

  v_pl := v_net - v_basis;

  -- Tell the sale-guard trigger this sold-transition is coming from the RPC
  -- (transaction-local); a direct PostgREST UPDATE won't have this set.
  perform set_config('cardops.in_sell', '1', true);

  insert into public.card_sales
    (card_id, platform, sale_price, fees, shipping_income, shipping_cost,
     net_proceeds, basis_drawn, profit_loss, order_ref)
  values
    (p_card_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost,
     v_net, v_basis, v_pl, p_order_ref);

  update public.cards
    set status = 'sold', sold_at = now(), basis_drawn = v_basis
    where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis, 'profit_loss', v_pl);
end $$;

revoke all on function public.card_sell(uuid, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.card_sell(uuid, text, numeric, numeric, numeric, numeric, text) to authenticated;

-- Force sales through card_sell: block a card_ops user from directly flipping a
-- card to 'sold' or rewriting its basis via PostgREST (which would skip the
-- pool draw and corrupt the basis trail). The RPC sets cardops.in_sell; the
-- owner may still correct manually; service-role/superuser unaffected.
create or replace function public.guard_card_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status and new.status = 'sold')
     or new.basis_drawn is distinct from old.basis_drawn
     or new.sold_at is distinct from old.sold_at then
    if coalesce(auth.role(), '') = 'authenticated'
       and not public.is_owner()
       and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
      raise exception 'sales must be settled through card_sell';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_sale_guard on public.cards;
create trigger cards_sale_guard before update on public.cards
  for each row execute function public.guard_card_sale();

-- card_sales may only be inserted by the owner or the SECURITY DEFINER RPC
-- (which bypasses RLS) — never directly by a card_ops session.
drop policy if exists card_sales_ins on public.card_sales;
create policy card_sales_ins on public.card_sales
  for insert to authenticated with check (public.is_owner());

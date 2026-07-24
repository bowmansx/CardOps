-- eBay connector Phase 1 (connector plan §2). Additive + idempotent, plus the
-- two Phase-2 landmines fixed ahead of the order-pull cron:
--   (1) card_sell must accept service-role callers (the cron has no auth.uid).
--   (2) card_sales needs (platform, order_ref) uniqueness or a cron re-poll
--       could double-settle a sale and DOUBLE-DRAW the basis pool.

-- ── eBay OAuth connection (tokens stored AES-GCM-encrypted at the app layer;
--    RLS owner-only — this token controls the whole seller account). ────────
create table if not exists public.ebay_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  scopes text,
  ebay_user text,
  updated_at timestamptz not null default now()
);
alter table public.ebay_connections enable row level security;
drop policy if exists ebay_connections_owner on public.ebay_connections;
create policy ebay_connections_owner on public.ebay_connections
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ── Landmine 2: idempotent settles. ─────────────────────────────────────────
create unique index if not exists card_sales_platform_order_uq
  on public.card_sales (platform, order_ref)
  where order_ref is not null;

-- ── Landmine 1: card_sell accepts service-role (cron) callers. Same body as
--    20260713170000 with only the access check amended. ──────────────────────
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
  if not (public.has_card_access() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

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

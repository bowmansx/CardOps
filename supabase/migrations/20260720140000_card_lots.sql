-- CardOps: multi-card LOTS — bundle several inventory cards into one sellable
-- unit that lists + sells as a single item, then settles each child card
-- correctly (proceeds allocated pro-rata by comp value). Additive + idempotent.

create sequence if not exists public.card_lot_sku_seq;

create table if not exists public.card_lots (
  id           uuid primary key default gen_random_uuid(),
  sku          text unique not null default ('LOT-' || lpad(nextval('public.card_lot_sku_seq')::text, 6, '0')),
  title        text,
  description  text,
  status       text not null default 'draft' check (status in ('draft','listed','sold','archived')),
  ask_price    numeric(12,2),
  listing_refs jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.card_lots enable row level security;
drop policy if exists card_lots_rw on public.card_lots;
create policy card_lots_rw on public.card_lots
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

create table if not exists public.card_lot_items (
  lot_id             uuid not null references public.card_lots(id) on delete cascade,
  card_id            uuid not null references public.cards(id),
  -- comp value snapshot at add time — the weight used to split proceeds so the
  -- allocation is stable even if market values move before the lot sells.
  comp_value_at_add  numeric(12,2),
  primary key (lot_id, card_id)
);
create index if not exists card_lot_items_card_idx on public.card_lot_items (card_id);
alter table public.card_lot_items enable row level security;
drop policy if exists card_lot_items_rw on public.card_lot_items;
create policy card_lot_items_rw on public.card_lot_items
  for all to authenticated
  using (public.has_card_access())
  with check (public.has_card_access());

-- ── Sell a lot: allocate the sale across children by comp weight, settle each
--    through card_sell (pool draw + card_sales + status), mark the lot sold.
--    Atomic (one transaction) — if any child fails, the whole sale rolls back.
--    Rounding remainder goes to the last child so allocations sum EXACTLY.
create or replace function public.card_lot_sell(
  p_lot_id      uuid,
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
  v_lot      public.card_lots%rowtype;
  v_ids      uuid[];
  v_ws       numeric[];
  v_total    numeric := 0;
  v_n        int := 0;
  v_i        int := 0;
  v_weight   numeric;
  v_ap numeric; v_af numeric; v_asi numeric; v_asc numeric;   -- this child's allocation
  v_sp numeric := 0; v_sf numeric := 0; v_ssi numeric := 0; v_ssc numeric := 0; -- running sums
  v_children jsonb := '[]'::jsonb;
begin
  if not (public.has_card_access() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;
  select * into v_lot from public.card_lots where id = p_lot_id for update;
  if not found then raise exception 'lot not found'; end if;
  -- Only draft/listed lots may sell — never a sold lot (double-sell) or an
  -- archived/cancelled one (booking a lot the operator killed).
  if v_lot.status not in ('draft','listed') then
    raise exception 'lot is not sellable (status %)', v_lot.status;
  end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  -- Lock the membership so a concurrent add/remove can't change it mid-settle,
  -- then capture it ONCE (ordered) into arrays. count, total, and the loop all
  -- read from this single snapshot — so a removal can't skip the remainder
  -- branch and under-allocate the sale.
  perform 1 from public.card_lot_items where lot_id = p_lot_id for update;
  select array_agg(t.card_id order by t.w desc, t.card_id),
         array_agg(t.w        order by t.w desc, t.card_id),
         coalesce(sum(t.w), 0)
    into v_ids, v_ws, v_total
    from (select li.card_id, coalesce(li.comp_value_at_add, c.market_value, 0) as w
          from public.card_lot_items li join public.cards c on c.id = li.card_id
          where li.lot_id = p_lot_id) t;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'lot has no cards'; end if;

  for v_i in 1 .. v_n loop
    if v_total > 0 then v_weight := v_ws[v_i] / v_total; else v_weight := 1.0 / v_n; end if;
    if v_i < v_n then
      v_ap := round(p_sale_price  * v_weight, 2);
      v_af := round(p_fees        * v_weight, 2);
      v_asi := round(p_ship_income * v_weight, 2);
      v_asc := round(p_ship_cost   * v_weight, 2);
    else
      -- last child absorbs the rounding remainder so totals reconcile exactly
      v_ap := p_sale_price  - v_sp;
      v_af := p_fees        - v_sf;
      v_asi := p_ship_income - v_ssi;
      v_asc := p_ship_cost   - v_ssc;
    end if;
    v_sp := v_sp + v_ap; v_sf := v_sf + v_af; v_ssi := v_ssi + v_asi; v_ssc := v_ssc + v_asc;

    v_children := v_children || jsonb_build_object(
      'card_id', v_ids[v_i],
      'result', public.card_sell(v_ids[v_i], coalesce(p_platform, 'ebay'), v_ap, v_af, v_asi, v_asc,
                                  p_order_ref || ':lot:' || v_ids[v_i]::text)
    );
  end loop;

  update public.card_lots set status = 'sold', updated_at = now() where id = p_lot_id;
  return jsonb_build_object('lot', p_lot_id, 'cards', v_n, 'children', v_children);
end $$;
revoke all on function public.card_lot_sell(uuid, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.card_lot_sell(uuid, text, numeric, numeric, numeric, numeric, text) to authenticated;

-- ── Reverse a lot sale: unwind every child through card_unsell, reopen the lot.
create or replace function public.card_lot_unsell(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.card_lots%rowtype;
  v_item record;
  v_children jsonb := '[]'::jsonb;
begin
  -- Owner-only, matching card_unsell (which each child reversal calls) — so a
  -- helper gets a clean 'forbidden' here rather than a deep partial failure.
  if not (public.is_owner() or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;
  select * into v_lot from public.card_lots where id = p_lot_id for update;
  if not found then raise exception 'lot not found'; end if;
  if v_lot.status <> 'sold' then raise exception 'lot is not sold'; end if;

  for v_item in select card_id from public.card_lot_items where lot_id = p_lot_id loop
    v_children := v_children || jsonb_build_object(
      'card_id', v_item.card_id,
      'result', public.card_unsell(v_item.card_id)
    );
  end loop;

  update public.card_lots set status = 'draft', updated_at = now() where id = p_lot_id;
  return jsonb_build_object('lot', p_lot_id, 'children', v_children);
end $$;
revoke all on function public.card_lot_unsell(uuid) from public;
grant execute on function public.card_lot_unsell(uuid) to authenticated;

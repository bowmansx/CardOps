-- card_sales tenancy + reversal rights (Beau, 2026-07-24).
--
-- Three gaps the multi-tenant pass left behind:
--
--  1. card_sales has no user_id, and its SELECT policy is
--     `owns_card(card_id) or is_owner()` — so the owner's every unfiltered read
--     returns EVERY user's sales (reports, ledger rebuild, tax insights).
--  2. The idempotency index is `unique (platform, order_ref)` GLOBALLY, while
--     order_ref is free text the seller types. Two users typing "1" or an
--     invoice number on platform 'ebay' collide: the second real sale is
--     rejected with a raw duplicate-key error naming a row RLS forbids them to
--     see. It is also an existence oracle over another user's order refs, and a
--     squatted real eBay order id makes the nightly sync classify the owner's
--     own settlement as "skipped" so that revenue never books.
--  3. card_sell was re-gated to owns_card() by the multi-tenant pass, but
--     card_unsell and card_lot_unsell were left on is_owner(). A card_ops user
--     can therefore SELL but never UN-SELL: one fat-fingered sale price strands
--     their pool basis and P/L permanently, because every other correction path
--     (guard_card_sale, card_sales UPDATE/DELETE, the select-only pool policies)
--     is also owner-gated. Those two functions ALSO never check that the card or
--     lot belongs to the caller.
--
-- Idempotent; safe to re-run.

-- ── 1) card_sales.user_id, backfilled from the card ─────────────────────────
alter table public.card_sales add column if not exists user_id uuid;
update public.card_sales s
   set user_id = c.user_id
  from public.cards c
 where c.id = s.card_id and s.user_id is null;
create index if not exists card_sales_user_idx on public.card_sales (user_id);

-- ── 2) Per-user idempotency namespace ───────────────────────────────────────
drop index if exists public.card_sales_platform_order_uq;
create unique index if not exists card_sales_user_platform_order_uq
  on public.card_sales (user_id, platform, order_ref)
  where order_ref is not null;

-- ── 3) card_sales is read by its owner, not by every owner ──────────────────
do $$ declare pol text; begin
  execute 'alter table public.card_sales enable row level security';
  for pol in select policyname from pg_policies where schemaname='public' and tablename='card_sales' loop
    execute format('drop policy %I on public.card_sales', pol);
  end loop;
  -- Fall back to the card's owner for any row a backfill couldn't reach.
  create policy card_sales_sel on public.card_sales for select to authenticated
    using (coalesce(user_id = auth.uid(), public.owns_card(card_id)));
  -- Writes still only through card_sell / card_unsell (SECURITY DEFINER), which
  -- keep the pool draw and the basis in step. A direct insert would skip that.
  create policy card_sales_ins on public.card_sales for insert to authenticated
    with check (public.is_owner());
  create policy card_sales_upd on public.card_sales for update to authenticated
    using (public.is_owner()) with check (public.is_owner());
  create policy card_sales_del on public.card_sales for delete to authenticated
    using (public.is_owner());
end $$;

-- ── 4) card_sell stamps the owner onto the sale ─────────────────────────────
-- Same body as 20260724000000 with only the card_sales insert amended.
create or replace function public.card_sell(
  p_card_id uuid, p_platform text, p_sale_price numeric, p_fees numeric,
  p_ship_income numeric, p_ship_cost numeric, p_order_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards%rowtype; v_pool public.card_pool%rowtype;
  v_basis numeric := 0; v_net numeric; v_pl numeric;
begin
  if not (public.owns_card(p_card_id) or auth.role() = 'service_role') then raise exception 'forbidden'; end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status = 'sold' then raise exception 'card already sold'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  v_net := coalesce(p_sale_price, 0) - coalesce(p_fees, 0) + coalesce(p_ship_income, 0) - coalesce(p_ship_cost, 0);

  if v_card.use_pool_basis then
    select * into v_pool from public.card_pool where name = 'main' and user_id = v_card.user_id for update;
    if found and v_pool.card_count > 0 then
      v_basis := round(v_pool.total_cost / v_pool.card_count, 2);
      insert into public.card_pool_adjustments (pool_id, kind, card_id, amount, total_after, count_after, actor, note)
      values (v_pool.id, 'draw', p_card_id, -v_basis, v_pool.total_cost - v_basis, v_pool.card_count - 1,
              coalesce(auth.uid()::text, 'system'), 'Sale draw');
      update public.card_pool set total_cost = total_cost - v_basis, card_count = card_count - 1 where id = v_pool.id;
    end if;
  else
    v_basis := coalesce(v_card.individual_basis, 0);
  end if;

  v_pl := v_net - v_basis;
  perform set_config('cardops.in_sell', '1', true);

  insert into public.card_sales
    (card_id, user_id, platform, sale_price, fees, shipping_income, shipping_cost, net_proceeds, basis_drawn, profit_loss, order_ref)
  values (p_card_id, v_card.user_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost, v_net, v_basis, v_pl, p_order_ref);
  update public.cards set status = 'sold', sold_at = now(), basis_drawn = v_basis where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis, 'profit_loss', v_pl);
end $$;

-- ── 5) Whoever may sell a card may reverse that same card ───────────────────
-- Only the access check changes; the reversal body is untouched.
-- The rewrite is textual, so it MUST fail loudly if the source doesn't match —
-- a silent no-op here would leave the exact bug this migration exists to close.
do $$
declare
  src text;
  old_gate constant text := 'if not (public.is_owner() or auth.role() = ''service_role'') then';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'card_unsell';
  if src is null then
    raise notice 'card_unsell not present — skipping';
    return;
  end if;

  if position('public.owns_card(p_card_id)' in src) > 0 then
    raise notice 'card_unsell already scoped — skipping';
    return;
  end if;

  if position(old_gate in src) = 0 then
    raise exception 'card_unsell gate not found — refusing to leave it unscoped. Re-gate it by hand.';
  end if;

  -- is_owner() -> owns_card(p_card_id): a card_ops user may undo their OWN sale,
  -- and the owner may no longer silently reverse someone else's.
  execute replace(src, old_gate,
    'if not (public.owns_card(p_card_id) or auth.role() = ''service_role'') then');
end $$;

do $$
declare
  src text;
  old_gate constant text := 'if not (public.is_owner() or auth.role() = ''service_role'') then';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'card_lot_unsell';
  if src is null then
    raise notice 'card_lot_unsell not present — skipping';
    return;
  end if;

  if position('l.user_id = auth.uid()' in src) > 0 then
    raise notice 'card_lot_unsell already scoped — skipping';
    return;
  end if;

  if position(old_gate in src) = 0 then
    raise exception 'card_lot_unsell gate not found — refusing to leave it unscoped. Re-gate it by hand.';
  end if;

  execute replace(src, old_gate,
    'if not (exists (select 1 from public.card_lots l where l.id = p_lot_id and l.user_id = auth.uid())'
    || ' or auth.role() = ''service_role'') then');
end $$;

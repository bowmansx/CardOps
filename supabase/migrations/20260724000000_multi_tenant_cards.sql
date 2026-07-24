-- Multi-tenant CardOps (Beau, 2026-07-23). Each user gets their OWN card inventory:
-- cards gains an owner (user_id, defaulting to the creator), and every card-scoped
-- table is isolated to that owner. The owner (Beau) is unlimited; other users are
-- capped at 100 NEW cards per day. The public showcase reads via the service role,
-- so per-user RLS does NOT affect public browsing. Additive + idempotent; all
-- existing inventory is backfilled to the owner.
--
-- Model: has_card_access() still gates entry to the CardOps app; user_id scopes
-- WHICH cards you see. A promoted card user starts with an empty inventory.

-- Owner's auth id (all existing rows belong to Beau).
-- ── 1) cards: owner column + default + backfill + index ──────────────────────
alter table public.cards add column if not exists user_id uuid;
alter table public.cards add column if not exists created_at timestamptz not null default now();
update public.cards set user_id = (select id from auth.users where email = 'bowmansx@gmail.com') where user_id is null;
alter table public.cards alter column user_id set default auth.uid();
do $$ begin
  if not exists (select 1 from public.cards where user_id is null) then
    alter table public.cards alter column user_id set not null;
  end if;
end $$;
create index if not exists cards_user_idx on public.cards (user_id);
create index if not exists cards_user_created_idx on public.cards (user_id, created_at);

-- ── 2) ownership helper ──────────────────────────────────────────────────────
create or replace function public.owns_card(p_card uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cards where id = p_card and user_id = auth.uid());
$$;
revoke all on function public.owns_card(uuid) from public;
grant execute on function public.owns_card(uuid) to authenticated;

-- ── 3) cards RLS: app-entry gate AND own the row ─────────────────────────────
do $$ declare pol text; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='cards' loop
    execute format('drop policy %I on public.cards', pol);
  end loop;
  create policy cards_own on public.cards for all to authenticated
    using (public.has_card_access() and user_id = auth.uid())
    with check (public.has_card_access() and user_id = auth.uid());
end $$;

-- ── 4) every card_id child → isolated to the card's owner ────────────────────
do $$
declare t text; pol text;
  tabs text[] := array['card_alerts','card_comps','card_estimates','card_flag_events','card_grading_submissions','card_group_items','card_intake_items','card_lot_items','card_market_sales','card_photos','card_price_history','card_source_quotes','card_valuations'];
begin
  foreach t in array tabs loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
      for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy %I on public.%I', pol, t);
      end loop;
      execute format('create policy %I on public.%I for all to authenticated using (public.owns_card(card_id)) with check (public.owns_card(card_id))', t||'_own', t);
    end if;
  end loop;
end $$;

-- ── 5) rootless card-scoped tables → their own owner column, per-user ────────
do $$
declare t text; pol text;
  tabs text[] := array['card_groups','card_lots','card_watchlist','card_intake_sessions','card_import_batches','card_import_staging','card_portfolio_snapshots','card_format_profiles','card_storage_locations'];
begin
  foreach t in array tabs loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I add column if not exists user_id uuid', t);
      execute format('update public.%I set user_id = (select id from auth.users where email = ''bowmansx@gmail.com'') where user_id is null', t);
      execute format('alter table public.%I alter column user_id set default auth.uid()', t);
      execute format('alter table public.%I enable row level security', t);
      for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy %I on public.%I', pol, t);
      end loop;
      execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t||'_own', t);
    end if;
  end loop;
end $$;

-- ── 6) 100 NEW cards per DAY for non-owners (owner unlimited) ─────────────────
-- AFTER STATEMENT so a single multi-row INSERT can't slip past a per-row count
-- (the just-inserted rows are visible here); rolls back the whole statement.
create or replace function public.enforce_daily_card_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    if (select count(*) from public.cards where user_id = auth.uid() and created_at >= date_trunc('day', now())) > 100 then
      raise exception 'Daily limit reached: up to 100 new cards per day.';
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_daily_card_cap on public.cards;
create trigger trg_daily_card_cap after insert on public.cards
  for each statement execute function public.enforce_daily_card_cap();

-- ── 7) card_pool per-user (SELECT-only) + pool ownership helper + ledger ─────
-- card_pool + its ledger are per-user, but SELECT-only for users — WRITES happen
-- only through the SECURITY DEFINER RPCs (which bypass RLS), preserving the
-- basis-integrity invariant (no hand-edited cost basis). The user_id column is
-- added FIRST because owns_pool() is a language-sql function validated at create.
alter table public.card_pool add column if not exists user_id uuid;
update public.card_pool set user_id = (select id from auth.users where email = 'bowmansx@gmail.com') where user_id is null;
alter table public.card_pool alter column user_id set default auth.uid();
create unique index if not exists card_pool_user_name_uniq on public.card_pool (user_id, name);

create or replace function public.owns_pool(p_pool uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.card_pool where id = p_pool and user_id = auth.uid());
$$;
revoke all on function public.owns_pool(uuid) from public;
grant execute on function public.owns_pool(uuid) to authenticated;

alter table public.card_pool enable row level security;
do $$ declare pol text; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='card_pool' loop
    execute format('drop policy %I on public.card_pool', pol);
  end loop;
  create policy card_pool_sel on public.card_pool for select to authenticated using (user_id = auth.uid());
end $$;

do $$ declare pol text; begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='card_pool_adjustments') then
    execute 'alter table public.card_pool_adjustments enable row level security';
    for pol in select policyname from pg_policies where schemaname='public' and tablename='card_pool_adjustments' loop
      execute format('drop policy %I on public.card_pool_adjustments', pol);
    end loop;
    create policy card_pool_adjustments_sel on public.card_pool_adjustments for select to authenticated
      using (public.owns_pool(pool_id));
  end if;
end $$;

-- card_news: market/player news is shared context, not private inventory (and
-- player/set items carry a null card_id) — keep a shared read for everyone.
do $$ declare pol text; begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='card_news') then
    execute 'alter table public.card_news enable row level security';
    for pol in select policyname from pg_policies where schemaname='public' and tablename='card_news' loop
      execute format('drop policy %I on public.card_news', pol);
    end loop;
    create policy card_news_read on public.card_news for select to authenticated using (public.has_card_access());
  end if;
end $$;

-- ── 8) per-user pools in the SECURITY DEFINER RPCs ───────────────────────────
-- These bypass RLS, so they must scope the pool to the caller/card owner
-- themselves — otherwise every user's lot would land in the owner's pool.

-- Speed Book: book a lot into the CALLER's own 'main' pool (lazily created).
create or replace function public.speed_book_commit(p_items jsonb, p_lot_cost numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pool   public.card_pool%rowtype;
  v_item   jsonb; v_cat text; v_year int := extract(year from now())::int;
  v_prefix text; v_seq int; v_sku text; v_id uuid; v_ids uuid[] := '{}'; v_n int := 0;
begin
  if not public.has_card_access() then raise exception 'forbidden'; end if;
  if p_lot_cost is null or p_lot_cost <= 0 then raise exception 'lot cost required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no items'; end if;

  -- The caller's own pool (create one on first use), locked to serialize batches.
  -- on-conflict + re-select handles a concurrent first-use without a duplicate pool.
  select * into v_pool from public.card_pool where name = 'main' and user_id = auth.uid() for update;
  if not found then
    insert into public.card_pool (name, user_id, total_cost, card_count) values ('main', auth.uid(), 0, 0)
      on conflict (user_id, name) do nothing;
    select * into v_pool from public.card_pool where name = 'main' and user_id = auth.uid() for update;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cat := coalesce(nullif(v_item->>'cat', ''), 'OT');
    v_prefix := v_cat || '-' || v_year || '-';
    loop
      select coalesce(max(substring(sku from char_length(v_prefix) + 1)::int), 0) + 1 into v_seq
        from public.cards where sku like v_prefix || '%';
      v_sku := v_prefix || lpad(v_seq::text, 6, '0');
      begin
        insert into public.cards (sku, entity_id, sport_category, zone, quick_booked, use_pool_basis, status)
        values (v_sku,
          case when public.is_owner() then 'bfa6ad79-0d3a-412b-a682-603aa9d23f1d'::uuid else null end,
          nullif(v_item->>'sport_category', ''), coalesce(nullif(v_item->>'zone', ''), 'BULK'),
          true, true, 'booked')
        returning id into v_id;
        exit;
      exception when unique_violation then end;
    end loop;
    v_ids := array_append(v_ids, v_id); v_n := v_n + 1;
  end loop;

  insert into public.card_pool_adjustments (pool_id, kind, amount, total_after, count_after, actor, note)
  values (v_pool.id, 'add', p_lot_cost, v_pool.total_cost + p_lot_cost, v_pool.card_count + v_n,
          coalesce(auth.uid()::text, 'system'), 'Speed Book lot of ' || v_n);
  update public.card_pool set total_cost = total_cost + p_lot_cost, card_count = card_count + v_n where id = v_pool.id;

  return jsonb_build_object('inserted', v_n, 'ids', to_jsonb(v_ids), 'pool_total', v_pool.total_cost + p_lot_cost);
end $$;

-- Sale: draw from the CARD OWNER's pool, and only for a card the caller owns.
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
    (card_id, platform, sale_price, fees, shipping_income, shipping_cost, net_proceeds, basis_drawn, profit_loss, order_ref)
  values (p_card_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost, v_net, v_basis, v_pl, p_order_ref);
  update public.cards set status = 'sold', sold_at = now(), basis_drawn = v_basis where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis, 'profit_loss', v_pl);
end $$;

-- ── 9) card_sales: see your own; but only the owner or the card_sell RPC may
-- WRITE it (a direct non-owner insert would skip the pool draw) ──────────────
do $$ declare pol text; begin
  execute 'alter table public.card_sales enable row level security';
  for pol in select policyname from pg_policies where schemaname='public' and tablename='card_sales' loop
    execute format('drop policy %I on public.card_sales', pol);
  end loop;
  create policy card_sales_sel on public.card_sales for select to authenticated using (public.owns_card(card_id) or public.is_owner());
  create policy card_sales_ins on public.card_sales for insert to authenticated with check (public.is_owner());
  create policy card_sales_upd on public.card_sales for update to authenticated using (public.is_owner()) with check (public.is_owner());
  create policy card_sales_del on public.card_sales for delete to authenticated using (public.is_owner());
end $$;

-- NOTE (left intentionally shared/owner-scoped, not per-card-user):
--   card_grade_multipliers  → global grading config
--   card_pricing_strategies → pricing templates (built-ins shared; per-user custom is a later step)
--   card_receipts           → owner-only business bookkeeping (already owner-gated)
--   card_showcases          → already has user_id; public read is via the service role
-- FOLLOW-UP (not isolated by this migration): the card-photos STORAGE bucket still
--   uses has_card_access() on the files themselves (paths are random UUIDs). Scope
--   the bucket per-user before relying on photo privacy across tenants.

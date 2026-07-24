-- Per-user SKU namespace (Beau, 2026-07-24).
--
-- cards.sku has been `text unique not null` since 20260713150000_cardops_init.sql
-- (line 155) — a GLOBAL unique. The multi-tenant work re-keyed
-- card_format_profiles and card_storage_locations per user but missed this one.
--
-- Why that blocks every invite: nextSku() (src/lib/cards/skudb.ts) computes
-- max+1 from an RLS-SCOPED read, so a brand-new user with an empty inventory
-- always computes sequence 1 — e.g. BB-2026-000001 — which already exists on the
-- owner's row. The insert fails 23505, and the retry loop recomputes the SAME
-- sku, so it fails every time. A new card user cannot create a card in any
-- category+year the owner has already used, from /cards/new, /cards/intake, or
-- CSV import.
--
-- A SKU is a per-collection label, not a global identifier, so the correct key
-- is (user_id, sku). Idempotent; safe to re-run.

-- ── 1) Per-user uniqueness first, so we are never briefly unconstrained ──────
create unique index if not exists cards_user_sku_uniq on public.cards (user_id, sku);

-- ── 2) Drop the global unique (constraint or bare index, whichever it is) ────
do $$
declare c text;
begin
  -- The unique CONSTRAINT form.
  for c in
    select con.conname
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_attribute a on a.attrelid = cl.oid and a.attnum = any (con.conkey)
     where cl.relname = 'cards'
       and con.contype = 'u'
       and array_length(con.conkey, 1) = 1
       and a.attname = 'sku'
  loop
    execute format('alter table public.cards drop constraint %I', c);
  end loop;

  -- The bare unique INDEX form (not backed by a constraint).
  for c in
    select i.relname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
     where t.relname = 'cards'
       and x.indisunique
       and x.indnatts = 1
       and a.attname = 'sku'
       and i.relname <> 'cards_user_sku_uniq'
       and not exists (select 1 from pg_constraint con where con.conindid = i.oid)
  loop
    execute format('drop index public.%I', c);
  end loop;
end $$;

-- ── 3) Speed Book scans globally for the next sequence — scope it to the caller
-- so two users don't serialize against each other's numbering. Everything else
-- in this function is unchanged from 20260724000000.
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
      -- Scoped to the caller: SKUs are per-collection labels now.
      select coalesce(max(substring(sku from char_length(v_prefix) + 1)::int), 0) + 1 into v_seq
        from public.cards where sku like v_prefix || '%' and user_id = auth.uid();
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

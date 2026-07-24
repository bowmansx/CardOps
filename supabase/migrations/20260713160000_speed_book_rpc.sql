-- CardOps Phase 2 fix: atomic Speed Book commit. The app-side read-modify-write
-- of card_pool was not atomic (lost updates) and could orphan pool-basis cards
-- if a mid-batch insert failed — corrupting the IRS basis trail. This RPC does
-- the whole batch (N card inserts + append-only ledger row + pool increment) in
-- ONE transaction, with the pool row locked so concurrent batches serialize and
-- the increment can't be lost. Photos are uploaded by the caller afterward
-- (best-effort, not part of basis integrity).
--
-- SECURITY DEFINER (writes card_pool, which is service-role-only under RLS) but
-- verifies the CALLER has card access, so it's safe to grant to authenticated.

create or replace function public.speed_book_commit(p_items jsonb, p_lot_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool   public.card_pool%rowtype;
  v_item   jsonb;
  v_cat    text;
  v_year   int := extract(year from now())::int;
  v_prefix text;
  v_seq    int;
  v_sku    text;
  v_id     uuid;
  v_ids    uuid[] := '{}';
  v_n      int := 0;
begin
  if not public.has_card_access() then
    raise exception 'forbidden';
  end if;
  if p_lot_cost is null or p_lot_cost <= 0 then
    raise exception 'lot cost required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no items';
  end if;

  -- Lock the pool row → serializes all Speed Book batches (no lost update).
  select * into v_pool from public.card_pool where name = 'main' for update;
  if not found then raise exception 'no main pool'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cat := coalesce(nullif(v_item->>'cat', ''), 'OT');
    v_prefix := v_cat || '-' || v_year || '-';
    -- Atomic SKU allocation with retry against rare cross-path collisions.
    loop
      select coalesce(max(substring(sku from char_length(v_prefix) + 1)::int), 0) + 1
        into v_seq
        from public.cards
        where sku like v_prefix || '%';
      v_sku := v_prefix || lpad(v_seq::text, 6, '0');
      begin
        insert into public.cards
          (sku, entity_id, sport_category, zone, quick_booked, use_pool_basis, status)
        values
          (v_sku, 'bfa6ad79-0d3a-412b-a682-603aa9d23f1d',
           nullif(v_item->>'sport_category', ''),
           coalesce(nullif(v_item->>'zone', ''), 'BULK'),
           true, true, 'booked')
        returning id into v_id;
        exit;
      exception when unique_violation then
        -- someone grabbed this SKU; recompute and retry
      end;
    end loop;
    v_ids := array_append(v_ids, v_id);
    v_n := v_n + 1;
  end loop;

  insert into public.card_pool_adjustments
    (pool_id, kind, amount, total_after, count_after, actor, note)
  values
    (v_pool.id, 'add', p_lot_cost,
     v_pool.total_cost + p_lot_cost, v_pool.card_count + v_n,
     coalesce(auth.uid()::text, 'system'), 'Speed Book lot of ' || v_n);

  update public.card_pool
    set total_cost = total_cost + p_lot_cost,
        card_count = card_count + v_n
    where id = v_pool.id;

  return jsonb_build_object(
    'inserted', v_n,
    'ids', to_jsonb(v_ids),
    'pool_total', v_pool.total_cost + p_lot_cost
  );
end $$;

revoke all on function public.speed_book_commit(jsonb, numeric) from public;
grant execute on function public.speed_book_commit(jsonb, numeric) to authenticated;

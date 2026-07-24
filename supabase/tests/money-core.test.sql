-- ══════════════════════════════════════════════════════════════════════════
-- MONEY-CORE TEST HARNESS — paste-ready, self-contained, ROLLS BACK.
--
-- Run: paste the whole file into the Supabase SQL editor and execute.
-- It creates throwaway rows inside one transaction, exercises the sell/unsell
-- RPCs, the status guards, and the purchase-lot draw/return, prints a
-- PASS/FAIL table, and rolls everything back — nothing persists.
--
-- Requires migrations through 20260735000000_purchase_lots.sql.
-- Simulated auth: sets request.jwt.claims the way PostgREST does. NOTE each
-- RPC leaves cardops.in_sell='1' for the rest of the TRANSACTION (harmless in
-- prod where every request is its own transaction) — the harness resets it
-- after every RPC call before testing the guards.
-- ══════════════════════════════════════════════════════════════════════════
begin;

create temp table t_results (n serial, name text, pass boolean, detail text) on commit drop;

do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_card  uuid;
  v_solo  uuid;
  v_lot   uuid;
  v_out   jsonb;
  v_cnt   int;
  v_total numeric;
  v_n     numeric;
  v_err   text;
begin
  -- ── seed: user, profile, one purchase lot (4 cards, $100), one lot card,
  --         one individual-basis card ────────────────────────────────────────
  insert into auth.users (id, email) values (v_uid, 'harness+' || v_uid || '@test.local');
  insert into public.profiles (id, role) values (v_uid, 'card_ops')
    on conflict (id) do update set role = 'card_ops';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into public.purchase_lots
    (user_id, label, total_cost, card_count, remaining_cost, remaining_count)
    values (v_uid, 'Harness lot', 100.00, 4, 100.00, 4) returning id into v_lot;
  insert into public.cards (user_id, sku, player, status, purchase_lot_id)
    values (v_uid, 'TST-2026-000001', 'LotCard', 'booked', v_lot) returning id into v_card;
  insert into public.cards (user_id, sku, player, status, individual_basis)
    values (v_uid, 'TST-2026-000002', 'SoloCard', 'booked', 12.34) returning id into v_solo;

  -- ── 1. sell draws the LOT average (100/4 = 25.00) ─────────────────────────
  v_out := public.card_sell(v_card, 'test', 50, 5, 0, 0, 'TEST-ORDER-1');
  perform set_config('cardops.in_sell', '', true);
  select remaining_cost, remaining_count into v_total, v_cnt from public.purchase_lots where id = v_lot;
  insert into t_results (name, pass, detail) values
    ('sell draws lot basis 25.00',
     (v_out->>'basis')::numeric = 25.00 and v_total = 75.00 and v_cnt = 3,
     format('basis=%s lot=%s/%s', v_out->>'basis', v_total, v_cnt));

  -- ── 2. individual-basis card uses its stated cost ─────────────────────────
  v_out := public.card_sell(v_solo, 'test', 30, 0, 0, 0, 'TEST-ORDER-S');
  perform set_config('cardops.in_sell', '', true);
  insert into t_results (name, pass, detail) values
    ('no-lot card uses individual_basis',
     (v_out->>'basis')::numeric = 12.34 and (v_out->>'profit_loss')::numeric = 17.66,
     format('basis=%s pl=%s', v_out->>'basis', v_out->>'profit_loss'));

  -- ── 3. selling a sold card refuses ────────────────────────────────────────
  begin
    perform public.card_sell(v_card, 'test', 60, 0, 0, 0, 'TEST-ORDER-2');
    insert into t_results (name, pass, detail) values ('double card_sell refused', false, 'no exception raised');
  exception when others then
    v_err := sqlerrm;
    perform set_config('cardops.in_sell', '', true);
    insert into t_results (name, pass, detail) values
      ('double card_sell refused', v_err like '%already sold%', v_err);
  end;

  -- ── 4. flipping a sold card off sold via UPDATE refuses (the CRITICAL) ────
  begin
    update public.cards set status = 'booked' where id = v_card;
    insert into t_results (name, pass, detail) values ('un-sell via UPDATE blocked', false, 'update was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('un-sell via UPDATE blocked', sqlerrm like '%card_sell / card_unsell%', sqlerrm);
  end;

  -- ── 5. the OWNER gets no exemption either ─────────────────────────────────
  update public.profiles set role = 'owner' where id = v_uid;
  begin
    update public.cards set status = 'booked' where id = v_card;
    insert into t_results (name, pass, detail) values ('owner un-sell via UPDATE blocked', false, 'update was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('owner un-sell via UPDATE blocked', sqlerrm like '%card_sell / card_unsell%', sqlerrm);
  end;
  update public.profiles set role = 'card_ops' where id = v_uid;

  -- ── 6. lot balances cannot be edited directly ─────────────────────────────
  begin
    update public.purchase_lots set remaining_cost = 0 where id = v_lot;
    insert into t_results (name, pass, detail) values ('lot balance edit blocked', false, 'update was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values ('lot balance edit blocked', true, sqlerrm);
  end;

  -- ── 7. lot metadata stays freely editable ─────────────────────────────────
  begin
    update public.purchase_lots set label = 'Harness lot (renamed)', source = 'LCS' where id = v_lot;
    insert into t_results (name, pass, detail) values ('lot metadata editable', true, 'label/source updated');
  exception when others then
    insert into t_results (name, pass, detail) values ('lot metadata editable', false, sqlerrm);
  end;

  -- ── 8. a card cannot link to another user's lot ───────────────────────────
  begin
    update public.cards set purchase_lot_id = v_lot where id = v_solo;  -- same user: fine
    insert into public.cards (user_id, sku, player, status, purchase_lot_id)
      values (gen_random_uuid(), 'TST-2026-000009', 'Thief', 'booked', v_lot);
    insert into t_results (name, pass, detail) values ('cross-user lot link blocked', false, 'insert was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('cross-user lot link blocked', sqlerrm like '%different user%', sqlerrm);
  end;
  update public.cards set purchase_lot_id = null where id = v_solo;

  -- ── 9. unsell fully reverses: lot restored, sale gone, card booked ────────
  v_out := public.card_unsell(v_card);
  perform set_config('cardops.in_sell', '', true);
  select remaining_cost, remaining_count into v_total, v_cnt from public.purchase_lots where id = v_lot;
  select count(*) into v_n from public.card_sales where card_id = v_card;
  insert into t_results (name, pass, detail) values
    ('unsell restores lot + deletes sale',
     v_total = 100.00 and v_cnt = 4 and v_n = 0
       and (select status from public.cards where id = v_card) = 'booked',
     format('lot=%s/%s sales=%s restored=%s', v_total, v_cnt, v_n, v_out->>'restored_basis'));

  -- ── 10. cannot sell twice against the same basis: re-sell after reversal is
  --       a FRESH draw against the restored lot ──────────────────────────────
  v_out := public.card_sell(v_card, 'test', 80, 0, 0, 0, 'TEST-ORDER-3');
  perform set_config('cardops.in_sell', '', true);
  select count(*) into v_cnt from public.purchase_lot_adjustments
    where card_id = v_card and kind = 'draw';
  select count(*) into v_n from public.card_sales where card_id = v_card;
  select remaining_cost into v_total from public.purchase_lots where id = v_lot;
  insert into t_results (name, pass, detail) values
    ('re-sell after unsell = one live sale, one net draw',
     v_n = 1 and v_cnt = 2  -- two draw rows, but draw#1 carries a correction between
       and v_total = 75.00, -- net effect: exactly ONE basis drawn from the lot
     format('sales=%s draws=%s lot_remaining=%s', v_n, v_cnt, v_total));

  -- ── 11. a card cannot be BORN sold ────────────────────────────────────────
  begin
    insert into public.cards (user_id, sku, player, status)
      values (v_uid, 'TST-2026-000003', 'BornSold', 'sold');
    insert into t_results (name, pass, detail) values ('insert status=sold blocked', false, 'insert was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('insert status=sold blocked', sqlerrm like '%cannot be created sold%', sqlerrm);
  end;

  -- ── 12. non-sold status moves stay free (listed → booked) ─────────────────
  begin
    insert into public.cards (user_id, sku, player, status)
      values (v_uid, 'TST-2026-000004', 'Lister', 'listed');
    update public.cards set status = 'booked' where sku = 'TST-2026-000004' and user_id = v_uid;
    insert into t_results (name, pass, detail) values ('non-sold transitions unaffected', true, 'listed→booked ok');
  exception when others then
    insert into t_results (name, pass, detail) values ('non-sold transitions unaffected', false, sqlerrm);
  end;

  -- ── 13. exhausted lot draws $0 basis, never negative ──────────────────────
  perform set_config('cardops.in_sell', '1', true);
  update public.purchase_lots set remaining_cost = 0, remaining_count = 0 where id = v_lot;
  perform set_config('cardops.in_sell', '', true);
  insert into public.cards (user_id, sku, player, status, purchase_lot_id)
    values (v_uid, 'TST-2026-000005', 'LateAdd', 'booked', v_lot);
  v_out := public.card_sell(
    (select id from public.cards where sku = 'TST-2026-000005' and user_id = v_uid),
    'test', 10, 0, 0, 0, 'TEST-ORDER-4');
  perform set_config('cardops.in_sell', '', true);
  select remaining_cost, remaining_count into v_total, v_cnt from public.purchase_lots where id = v_lot;
  insert into t_results (name, pass, detail) values
    ('exhausted lot draws 0, stays at 0',
     (v_out->>'basis')::numeric = 0 and v_total = 0 and v_cnt = 0,
     format('basis=%s lot=%s/%s', v_out->>'basis', v_total, v_cnt));
end $$;

select n, case when pass then 'PASS' else 'FAIL' end as result, name, detail
from t_results order by n;

rollback;

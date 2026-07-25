-- ══════════════════════════════════════════════════════════════════════════
-- MONEY-CORE TEST HARNESS — paste-ready, self-contained, self-rolling-back.
--
-- Run: paste the whole file into the Supabase SQL editor and execute.
-- It seeds throwaway rows, exercises card_sell / card_unsell, the status
-- guards, and the purchase-lot draw/return, then RAISES with a full report —
-- the raise is what rolls every test row back, so nothing ever persists.
-- THE RED ERROR BOX IS EXPECTED: read the message inside it.
--
-- Requires migrations through 20260737000000. Simulated auth: sets
-- request.jwt.claims the way PostgREST does. The RPCs leave cardops.in_sell
-- set for the rest of the transaction (harmless in prod where each request is
-- its own transaction) — the harness resets it after every RPC call.
-- ══════════════════════════════════════════════════════════════════════════
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
  v_ok    boolean;
  v_name  text;
  v_note  text;
  v_pass  int := 0;
  v_fail  int := 0;
  v_r     text := E'\n';
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
  v_name := '1. sell draws lot basis 25.00';
  v_ok := (v_out->>'basis')::numeric = 25.00 and v_total = 75.00 and v_cnt = 3;
  v_note := format('basis=%s lot=%s/%s', v_out->>'basis', v_total, v_cnt);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 2. individual-basis card uses its stated cost ─────────────────────────
  v_out := public.card_sell(v_solo, 'test', 30, 0, 0, 0, 'TEST-ORDER-S');
  perform set_config('cardops.in_sell', '', true);
  v_name := '2. no-lot card uses individual_basis';
  v_ok := (v_out->>'basis')::numeric = 12.34 and (v_out->>'profit_loss')::numeric = 17.66;
  v_note := format('basis=%s pl=%s', v_out->>'basis', v_out->>'profit_loss');
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 3. selling a sold card refuses ────────────────────────────────────────
  v_name := '3. double card_sell refused';
  begin
    perform public.card_sell(v_card, 'test', 60, 0, 0, 0, 'TEST-ORDER-2');
    v_ok := false; v_note := 'no exception raised';
  exception when others then
    v_ok := sqlerrm like '%already sold%'; v_note := sqlerrm;
  end;
  perform set_config('cardops.in_sell', '', true);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 4. flipping a sold card off sold via UPDATE refuses (the CRITICAL) ────
  v_name := '4. un-sell via UPDATE blocked';
  begin
    update public.cards set status = 'booked' where id = v_card;
    v_ok := false; v_note := 'update was allowed';
  exception when others then
    v_ok := sqlerrm like '%card_sell / card_unsell%'; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 5. the OWNER gets no exemption either ─────────────────────────────────
  -- guard_profile_role (a shared-DB safety trigger) rightly blocks an
  -- authenticated non-owner from changing roles — step outside the simulated
  -- session for the flip, then step back in as the (now-owner) test user.
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set role = 'owner' where id = v_uid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_name := '5. owner un-sell via UPDATE blocked';
  begin
    update public.cards set status = 'booked' where id = v_card;
    v_ok := false; v_note := 'update was allowed';
  exception when others then
    v_ok := sqlerrm like '%card_sell / card_unsell%'; v_note := sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set role = 'card_ops' where id = v_uid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 6. lot balances cannot be edited directly ─────────────────────────────
  v_name := '6. lot balance edit blocked';
  begin
    update public.purchase_lots set remaining_cost = 0 where id = v_lot;
    v_ok := false; v_note := 'update was allowed';
  exception when others then
    v_ok := true; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 7. lot metadata stays freely editable ─────────────────────────────────
  v_name := '7. lot metadata editable';
  begin
    update public.purchase_lots set label = 'Harness lot (renamed)', source = 'LCS' where id = v_lot;
    v_ok := true; v_note := '';
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 8. a card cannot link to another user's lot ───────────────────────────
  v_name := '8. cross-user lot link blocked';
  begin
    insert into public.cards (user_id, sku, player, status, purchase_lot_id)
      values (gen_random_uuid(), 'TST-2026-000009', 'Thief', 'booked', v_lot);
    v_ok := false; v_note := 'insert was allowed';
  exception when others then
    v_ok := sqlerrm like '%different user%'; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 9. unsell fully reverses: lot restored, sale gone, card booked ────────
  v_out := public.card_unsell(v_card);
  perform set_config('cardops.in_sell', '', true);
  select remaining_cost, remaining_count into v_total, v_cnt from public.purchase_lots where id = v_lot;
  select count(*) into v_n from public.card_sales where card_id = v_card;
  v_name := '9. unsell restores lot + deletes sale';
  v_ok := v_total = 100.00 and v_cnt = 4 and v_n = 0
    and (select status from public.cards where id = v_card) = 'booked';
  v_note := format('lot=%s/%s sales=%s restored=%s', v_total, v_cnt, v_n, v_out->>'restored_basis');
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 10. cannot sell twice against the same basis: re-sell after reversal
  --       is a FRESH draw against the restored lot ────────────────────────────
  v_out := public.card_sell(v_card, 'test', 80, 0, 0, 0, 'TEST-ORDER-3');
  perform set_config('cardops.in_sell', '', true);
  select count(*) into v_cnt from public.purchase_lot_adjustments
    where card_id = v_card and kind = 'draw';
  select count(*) into v_n from public.card_sales where card_id = v_card;
  select remaining_cost into v_total from public.purchase_lots where id = v_lot;
  v_name := '10. re-sell after unsell = one live sale, one net draw';
  v_ok := v_n = 1 and v_cnt = 2 and v_total = 75.00; -- draw#1 carries a correction between
  v_note := format('sales=%s draws=%s lot_remaining=%s', v_n, v_cnt, v_total);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 11. a card cannot be BORN sold ────────────────────────────────────────
  v_name := '11. insert status=sold blocked';
  begin
    insert into public.cards (user_id, sku, player, status)
      values (v_uid, 'TST-2026-000003', 'BornSold', 'sold');
    v_ok := false; v_note := 'insert was allowed';
  exception when others then
    v_ok := sqlerrm like '%cannot be created sold%'; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 12. non-sold status moves stay free (listed → booked) ─────────────────
  v_name := '12. non-sold transitions unaffected';
  begin
    insert into public.cards (user_id, sku, player, status)
      values (v_uid, 'TST-2026-000004', 'Lister', 'listed');
    update public.cards set status = 'booked' where sku = 'TST-2026-000004' and user_id = v_uid;
    v_ok := true; v_note := '';
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

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
  v_name := '13. exhausted lot draws 0, stays at 0';
  v_ok := (v_out->>'basis')::numeric = 0 and v_total = 0 and v_cnt = 0;
  v_note := format('basis=%s lot=%s/%s', v_out->>'basis', v_total, v_cnt);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ══ credit ledger v2 (migration 20260737) ═══════════════════════════════
  -- Grants/spends are service-role surface — simulate the service role the
  -- way PostgREST presents it, flipping back to the user to read balances.

  -- ── 14. grant lands, balance = unexpired remainders ───────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform public.credit_grant(v_uid, 100, 'purchase', null, 'harness: open grant');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_n := public.credit_balance();
  v_name := '14. credit grant funds the balance';
  v_ok := v_n = 100;
  v_note := format('balance=%s (want 100)', v_n);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 15. spend draws the SOONEST-EXPIRING bucket first ─────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform public.credit_grant(v_uid, 50, 'plan_grant', now() + interval '1 hour', 'harness: expiring grant');
  v_out := public.credit_spend(v_uid, 60, 'harness: fifo spend', null);
  select remaining into v_cnt from public.credit_ledger
    where user_id = v_uid and reason = 'harness: expiring grant';
  select remaining into v_total from public.credit_ledger
    where user_id = v_uid and reason = 'harness: open grant';
  v_name := '15. spend drains soonest-expiring first';
  v_ok := v_cnt = 0 and v_total = 90 and (v_out->>'shortfall')::int = 0
    and (v_out->>'balance')::int = 90;
  v_note := format('expiring=%s open=%s out=%s', v_cnt, v_total, v_out);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 16. an expired grant never counts and is never drawn ──────────────────
  perform public.credit_grant(v_uid, 40, 'plan_grant', now() - interval '1 hour', 'harness: expired grant');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_n := public.credit_balance();
  v_name := '16. expired grants are dead weight';
  v_ok := v_n = 90;
  v_note := format('balance=%s (want 90, expired 40 excluded)', v_n);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 17. overspend records an honest shortfall (shadow mode) ───────────────
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  v_out := public.credit_spend(v_uid, 120, 'harness: overspend', null);
  select shortfall into v_cnt from public.credit_ledger
    where user_id = v_uid and reason = 'harness: overspend';
  v_name := '17. overspend records shortfall, balance floors at 0';
  v_ok := (v_out->>'covered')::int = 90 and (v_out->>'shortfall')::int = 30
    and v_cnt = 30 and (v_out->>'balance')::int = 0;
  v_note := format('out=%s row_shortfall=%s', v_out, v_cnt);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 18. a non-owner cannot grant credits ──────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_name := '18. non-owner grant refused';
  begin
    perform public.credit_grant(v_uid, 999999, 'promo', null, 'harness: should fail');
    v_ok := false; v_note := 'grant was allowed';
  exception when others then
    v_ok := true; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── report + rollback in one move: raising undoes every row above ─────────
  raise exception using message = format(
    E'\n════ MONEY-CORE HARNESS REPORT — THIS RED BOX IS EXPECTED ════\n'
    || '%s of 18 PASSED · %s FAILED'
    || E'%s'
    || E'\nAll test data from this run has been ROLLED BACK — nothing persisted.\n'
    || '(Raising an exception is how the harness undoes itself. 18 PASS = your money core is verified.)',
    v_pass, v_fail, v_r);
end $$;

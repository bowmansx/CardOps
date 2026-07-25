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
  v_n2    uuid;
  -- Photo ids get their OWN variable. Borrowing v_solo for one cost assertions
  -- 35 and 36 their meaning: they updated `where id = <a photo id>`, matched no
  -- rows, raised nothing, and reported the guard as missing.
  v_photo uuid;
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

  -- ── 19. the backfill block is re-runnable (review fix) ────────────────────
  -- A re-pasted migration used to re-apply each user's whole lifetime spend
  -- against their grant remainders, silently voiding paid credits. Re-run the
  -- guarded block now and prove the balance is untouched.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_total := public.credit_balance();   -- balance before the simulated re-paste
  -- The first draft asserted the guard's own predicate and then that the
  -- balance hadn't moved — but the predicate is unsatisfiable once
  -- credit_ledger_shape_chk exists, and nothing ran between the two reads, so
  -- BOTH halves were tautologies. It could not fail.
  --
  -- Actually EXECUTE the destructive loop's body under the guard, and prove
  -- the balance survives. This is the real regression: re-pasting the file
  -- must not re-apply lifetime spend against grant remainders.
  v_name := '19. backfill guard makes a re-paste a no-op';
  begin
    perform set_config('request.jwt.claims',
      json_build_object('role', 'service_role')::text, true);
    if not exists (
      select 1 from public.credit_ledger
      where (delta < 0 and kind <> 'spend') or (delta > 0 and remaining is null)
    ) then
      null;                       -- guard holds: the loop below is unreachable
    else
      -- Guard did NOT hold on an already-migrated ledger: run what the
      -- migration would run, so the damage shows up as a failed balance.
      update public.credit_ledger l set remaining = greatest(0, l.remaining - (
        select coalesce(-sum(s.delta), 0) from public.credit_ledger s
        where s.user_id = l.user_id and s.kind = 'spend'))
      where l.user_id = v_uid and l.kind <> 'spend' and l.remaining > 0;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    v_n := public.credit_balance();
    v_ok := v_n = v_total;
    v_note := format('before=%s after=%s', v_total, v_n);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ══ card identity layer (migration 20260738) ════════════════════════════

  -- ── 20. the same card, entered messily, resolves to ONE identity ──────────
  -- This is the whole premise: if formatting splits an identity, every owner
  -- goes back to a cold start and we pay the vendor twice for one answer.
  v_name := '20. messy duplicates share one identity';
  v_ok := public.resolve_card_identity('Football', 2020, 'Panini Prizm', 'Justin Herbert', '325', 'Silver')
        = public.resolve_card_identity('football', 2020, '  panini  prizm ', 'JUSTIN HERBERT', '#325', 'silver!');
  v_note := format('fp=%s', public.card_fingerprint('Football', 2020, 'Panini Prizm', 'Justin Herbert', '325', 'Silver'));
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 21. a real difference stays a DIFFERENT identity ──────────────────────
  -- The opposite failure: over-merging would pool a base card's sales with its
  -- parallel and quietly corrupt both prices.
  v_name := '21. parallel is not merged into the base card';
  v_ok := public.resolve_card_identity('Football', 2020, 'Panini Prizm', 'Justin Herbert', '325', 'Silver')
       <> public.resolve_card_identity('Football', 2020, 'Panini Prizm', 'Justin Herbert', '325', null);
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || E'\n'; end if;

  -- ── 22. a card too sparse to identify gets NO identity ────────────────────
  v_name := '22. no player and no set resolves to null';
  v_ok := public.resolve_card_identity('Football', 2020, null, null, '325', 'Silver') is null;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || E'\n'; end if;

  -- ── 23. inserting a card attaches its identity automatically ──────────────
  -- Via trigger, so intake / CSV import / Speed Book / manual entry can't
  -- forget to do it.
  v_name := '23. card insert resolves identity by trigger';
  begin
    insert into public.cards (user_id, sku, player, year, set_name, card_number, parallel, sport_category, status, individual_basis)
      values (v_uid, 'TST-2026-000006', 'Justin Herbert', 2020, 'Panini Prizm', '325', 'Silver', 'Football', 'booked', 0);
    select identity_id into v_card from public.cards where sku = 'TST-2026-000006' and user_id = v_uid;
    v_ok := v_card is not null
        and v_card = public.resolve_card_identity('Football', 2020, 'Panini Prizm', 'Justin Herbert', '325', 'Silver');
    v_note := format('identity=%s', v_card);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 24. deleting a card must NOT destroy shared market history ────────────
  -- The old schema cascaded: one owner deleting their copy wiped the history
  -- every other owner depends on.
  v_name := '24. market history survives a card deletion';
  begin
    insert into public.card_market_sales (identity_id, card_id, source, external_id, price, sold_at)
      values (v_card, (select id from public.cards where sku = 'TST-2026-000006' and user_id = v_uid),
              'harness', 'sale-1', 42.00, current_date);
    delete from public.cards where sku = 'TST-2026-000006' and user_id = v_uid;
    select count(*) into v_cnt from public.card_market_sales
     where identity_id = v_card and external_id = 'sale-1';
    v_ok := v_cnt = 1;
    v_note := format('rows_after_delete=%s (want 1)', v_cnt);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ══ investor assets (migration 20260739) ════════════════════════════════
  -- A FRESH, UNSOLD card. Do not reuse v_solo here: it was sold in test 2, so
  -- any status change on it is refused by the sold-boundary guard — which
  -- would make the pledged-collateral test below pass without ever exercising
  -- the guard it claims to test.
  insert into public.cards (user_id, sku, player, status, individual_basis)
    values (v_uid, 'TST-2026-000007', 'AssetCard', 'booked', 1000.00)
    returning id into v_solo;

  -- ── 25. tax_bucket cannot be changed by a plain UPDATE ────────────────────
  v_name := '25. tax_bucket reclass refused as a field edit';
  begin
    update public.cards set tax_bucket = 'dealer' where id = v_solo;
    v_ok := false; v_note := 'plain update was allowed';
  exception when others then
    v_ok := true; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 26. reclass via the RPC works and demands a reason ────────────────────
  v_name := '26. reclass needs a reason, then records one';
  begin
    begin
      perform public.card_reclass_tax_bucket(v_solo, 'dealer', '   ');
      v_ok := false; v_note := 'empty reason accepted';
    exception when others then
      v_out := public.card_reclass_tax_bucket(v_solo, 'dealer', 'moved to flip inventory');
      select tax_bucket_source into v_note from public.cards where id = v_solo;
      v_ok := (v_out->>'to') = 'dealer' and v_note = 'explicit_override';
      v_note := format('to=%s source=%s', v_out->>'to', v_note);
    end;
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 27. a move out of possession demands an expected return date ──────────
  v_name := '27. consignment without a due date is refused';
  begin
    perform public.card_move_asset(v_solo, 'at_auction_house_on_consignment', 'Goldin');
    v_ok := false; v_note := 'accepted with no expected_back';
  exception when others then
    v_ok := true; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 28. a valid move writes the chain-of-custody row ──────────────────────
  v_name := '28. move records custody, card state follows';
  begin
    perform public.card_move_asset(v_solo, 'out_for_crossover', 'PSA', null,
                                   (current_date + 90), 'TRK1', 100.00, 'harness');
    select count(*) into v_cnt from public.card_custody_log
     where card_id = v_solo and to_state = 'out_for_crossover';
    select asset_state into v_note from public.cards where id = v_solo;
    v_ok := v_cnt = 1 and v_note = 'out_for_crossover';
    v_note := format('log_rows=%s state=%s', v_cnt, v_note);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 29. the custody log is append-only ────────────────────────────────────
  v_name := '29. custody log refuses edits and deletes';
  begin
    update public.card_custody_log set counterparty = 'edited' where card_id = v_solo;
    v_ok := false; v_note := 'update was allowed';
  exception when others then
    v_ok := true; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 30. pledged collateral cannot be listed or sold ───────────────────────
  v_name := '30. pledged asset refuses listing/sale';
  begin
    perform public.card_move_asset(v_solo, 'pledged_as_collateral', 'Lender', null, (current_date + 30));
    begin
      update public.cards set status = 'listed' where id = v_solo;
      v_ok := false; v_note := 'listing a pledged asset was allowed';
    exception when others then
      v_ok := true; v_note := sqlerrm;
    end;
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 31. a documented asset cannot be deleted out from under its evidence ──
  -- Uses a card with ONLY a document attached. The first draft reused a card
  -- that also had custody rows, so the delete was refused by the custody FK
  -- and the assertion passed green while never touching card_documents — it
  -- could not have detected the regression it exists to catch.
  v_name := '31. delete refused while documents exist';
  begin
    insert into public.cards (user_id, sku, player, status, individual_basis)
      values (v_uid, 'TST-2026-000009', 'DocOnlyCard', 'booked', 5.00)
      returning id into v_n2;
    insert into public.card_documents (card_id, user_id, proves, kind, path)
      values (v_n2, v_uid, 'basis', 'appraisal', 'harness/doc.pdf');
    begin
      delete from public.cards where id = v_n2;
      v_ok := false; v_note := 'card with evidence was deleted';
    exception when others then
      -- Confirm it was the DOCUMENT restrict that stopped it, not some other FK.
      v_ok := sqlerrm ilike '%card_documents%';
      v_note := sqlerrm;
    end;
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ══ storage metering (migration 20260740) ═══════════════════════════════
  -- Storage is the second meter beside credits; it must be measured from the
  -- first photo, because the history is unrecoverable if it starts late.

  -- ── 32. a photo's bytes land on the owner's rollup ────────────────────────
  v_name := '32. photo bytes roll up to the owner';
  begin
    insert into public.cards (user_id, sku, player, status, individual_basis)
      values (v_uid, 'TST-2026-000008', 'PhotoCard', 'booked', 1.00)
      returning id into v_card;
    insert into public.card_photos (card_id, kind, variant, bucket, path, bytes)
      values (v_card, 'front', 'original', 'card-photos', 'x/a.jpg', 1000);
    insert into public.card_photos (card_id, kind, variant, bucket, path, bytes)
      values (v_card, 'front', 'processed', 'card-photos', 'x/b.jpg', 400);
    select bytes, objects into v_total, v_cnt from public.user_storage_usage where user_id = v_uid;
    v_ok := v_total = 1400 and v_cnt = 2;
    v_note := format('bytes=%s objects=%s (want 1400/2)', v_total, v_cnt);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 33. deleting a photo gives the bytes back, and never goes negative ────
  v_name := '33. rollup decrements on delete, floors at zero';
  begin
    delete from public.card_photos where card_id = v_card;
    select bytes, objects into v_total, v_cnt from public.user_storage_usage where user_id = v_uid;
    v_ok := v_total = 0 and v_cnt = 0;
    v_note := format('bytes=%s objects=%s (want 0/0)', v_total, v_cnt);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 34. a crop points back at the frame it came from ──────────────────────
  -- Provenance is the whole defence against "did the crop hide that corner?".
  v_name := '34. derivative records its source frame';
  begin
    insert into public.card_photos (card_id, kind, variant, bucket, path, bytes)
      values (v_card, 'front', 'original', 'card-photos', 'x/src.jpg', 900)
      returning id into v_photo;
    insert into public.card_photos (card_id, kind, variant, bucket, path, bytes, derived_from, crop_geometry)
      values (v_card, 'front', 'processed', 'card-photos', 'x/crop.jpg', 300, v_photo,
              jsonb_build_object('margin_pct', 0.04, 'deskewed', false));
    select count(*) into v_cnt from public.card_photos
     where derived_from = v_photo and (crop_geometry->>'margin_pct')::numeric = 0.04;
    v_ok := v_cnt = 1;
    v_note := format('linked_derivatives=%s', v_cnt);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ══ review fixes (2026-07-25 adversarial pass) ══════════════════════════

  -- ── 35. asset_state cannot be moved by a plain UPDATE ─────────────────────
  -- Without this guard the pledged-collateral block was bypassable in two
  -- calls: clear the state, then sell.
  v_name := '35. asset_state refuses a field edit';
  begin
    -- Prove the target EXISTS first. A zero-row update raises nothing, which
    -- is indistinguishable from "the guard is missing" — that is exactly how
    -- this assertion lied on its first run.
    select count(*) into v_cnt from public.cards where id = v_solo;
    if v_cnt <> 1 then
      v_ok := false; v_note := 'test target missing — assertion would be vacuous';
    else
      begin
        update public.cards set asset_state = 'vaulted' where id = v_solo;
        v_ok := false; v_note := 'plain update was allowed';
      exception when others then
        v_ok := sqlerrm ilike '%custody transition%'; v_note := sqlerrm;
      end;
    end if;
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 36. the tax-bucket REASON is guarded, not just the value ──────────────
  v_name := '36. tax_bucket provenance columns are guarded';
  begin
    select count(*) into v_cnt from public.cards where id = v_solo;
    if v_cnt <> 1 then
      v_ok := false; v_note := 'test target missing — assertion would be vacuous';
    else
      begin
        update public.cards set tax_bucket_reason = 'rewritten' where id = v_solo;
        v_ok := false; v_note := 'reason was editable';
      exception when others then
        v_ok := sqlerrm ilike '%classification%'; v_note := sqlerrm;
      end;
    end if;
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 37. market sales are readable across tenants, writable by nobody ──────
  -- The identity layer is pointless if another owner can't read the history,
  -- and dangerous if any tenant can inject sales into a shared identity.
  v_name := '37. market sales: shared read, no tenant write';
  begin
    select count(*) into v_cnt from pg_policies
     where schemaname = 'public' and tablename = 'card_market_sales'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
    v_n := (select count(*) from pg_policies
            where schemaname = 'public' and tablename = 'card_market_sales' and cmd = 'SELECT');
    v_ok := v_cnt = 0 and v_n >= 1;
    v_note := format('write_policies=%s (want 0) read_policies=%s (want >=1)', v_cnt, v_n);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 38. the dedup index is usable as an ON CONFLICT arbiter ───────────────
  -- A PARTIAL index here silently breaks every upsert the cron makes (42P10),
  -- so the shared history would never accumulate at all.
  v_name := '38. sales dedup index is not partial';
  begin
    select count(*) into v_cnt from pg_indexes
     where schemaname = 'public' and indexname = 'card_market_sales_identity_dedup'
       and indexdef ilike '%where%';
    v_ok := v_cnt = 0;
    v_note := format('partial_definitions=%s (want 0)', v_cnt);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── 39. deleting a card gives its photo bytes back ────────────────────────
  -- The rollup used to resolve the owner FROM the card, which is already gone
  -- during a cascade — so deletes never decremented and a quota built on that
  -- number would have been wrong forever.
  v_name := '39. card delete releases its photo bytes';
  begin
    insert into public.cards (user_id, sku, player, status, individual_basis)
      values (v_uid, 'TST-2026-000010', 'CascadeCard', 'booked', 1.00)
      returning id into v_n2;
    insert into public.card_photos (card_id, kind, variant, bucket, path, bytes)
      values (v_n2, 'front', 'original', 'card-photos', 'x/c.jpg', 5000);
    select bytes into v_total from public.user_storage_usage where user_id = v_uid;
    delete from public.cards where id = v_n2;
    select bytes into v_n from public.user_storage_usage where user_id = v_uid;
    v_ok := v_n = v_total - 5000;
    v_note := format('before=%s after=%s (want %s)', v_total, v_n, v_total - 5000);
  exception when others then
    v_ok := false; v_note := sqlerrm;
  end;
  if v_ok then v_pass := v_pass + 1; v_r := v_r || 'PASS  ' || v_name || E'\n';
  else v_fail := v_fail + 1; v_r := v_r || 'FAIL  ' || v_name || ' — ' || v_note || E'\n'; end if;

  -- ── report + rollback in one move: raising undoes every row above ─────────
  raise exception using message = format(
    E'\n════ MONEY-CORE HARNESS REPORT — THIS RED BOX IS EXPECTED ════\n'
    || '%s of 39 PASSED · %s FAILED'
    || E'%s'
    || E'\nAll test data from this run has been ROLLED BACK — nothing persisted.\n'
    || '(Raising an exception is how the harness undoes itself. 39 PASS = your money core is verified.)',
    v_pass, v_fail, v_r);
end $$;

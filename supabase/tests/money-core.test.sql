-- ══════════════════════════════════════════════════════════════════════════
-- MONEY-CORE TEST HARNESS — paste-ready, self-contained, ROLLS BACK.
--
-- Run: paste the whole file into the Supabase SQL editor and execute.
-- It creates throwaway rows inside one transaction, exercises the sell/unsell
-- RPCs and the status guards, prints a PASS/FAIL table, and rolls everything
-- back — nothing persists, safe against the live database.
--
-- Requires: migrations through 20260734000000_status_is_a_transition.sql.
-- Simulated auth: sets request.jwt.claims the way PostgREST does, so
-- auth.uid()/auth.role() and the RLS-adjacent guards behave as in production.
-- NOTE each RPC leaves cardops.in_sell='1' for the rest of the TRANSACTION
-- (harmless in prod where each request is its own transaction) — the harness
-- must reset it after every RPC call before testing the guards.
-- ══════════════════════════════════════════════════════════════════════════
begin;

create temp table t_results (n serial, name text, pass boolean, detail text) on commit drop;

do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_card  uuid;
  v_pool  uuid;
  v_out   jsonb;
  v_cnt   int;
  v_total numeric;
  v_basis numeric;
  v_err   text;
begin
  -- ── seed: user, profile, funded pool, one pooled card ─────────────────────
  insert into auth.users (id, email) values (v_uid, 'harness+' || v_uid || '@test.local');
  insert into public.profiles (id, role) values (v_uid, 'card_ops')
    on conflict (id) do update set role = 'card_ops';
  insert into public.card_pool (user_id, name, total_cost, card_count)
    values (v_uid, 'main', 100.00, 4) returning id into v_pool;
  -- act as the seeded authenticated user (transaction-local, like PostgREST)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into public.cards (user_id, sku, player, status, use_pool_basis)
    values (v_uid, 'TST-2026-000001', 'Harness', 'booked', true)
    returning id into v_card;

  -- ── 1. sell draws pool basis (100/4 = 25.00) ──────────────────────────────
  v_out := public.card_sell(v_card, 'test', 50, 5, 0, 0, 'TEST-ORDER-1');
  perform set_config('cardops.in_sell', '', true);
  select total_cost, card_count into v_total, v_cnt from public.card_pool where id = v_pool;
  insert into t_results (name, pass, detail) values
    ('sell draws pool basis 25.00',
     (v_out->>'basis')::numeric = 25.00 and v_total = 75.00 and v_cnt = 3,
     format('basis=%s pool=%s/%s', v_out->>'basis', v_total, v_cnt));

  -- ── 2. selling a sold card refuses ────────────────────────────────────────
  begin
    perform public.card_sell(v_card, 'test', 60, 0, 0, 0, 'TEST-ORDER-2');
    insert into t_results (name, pass, detail) values ('double card_sell refused', false, 'no exception raised');
  exception when others then
    v_err := sqlerrm;
    perform set_config('cardops.in_sell', '', true);
    insert into t_results (name, pass, detail) values
      ('double card_sell refused', v_err like '%already sold%', v_err);
  end;

  -- ── 3. flipping a sold card off sold via UPDATE refuses (the CRITICAL) ────
  begin
    update public.cards set status = 'booked' where id = v_card;
    insert into t_results (name, pass, detail) values ('un-sell via UPDATE blocked', false, 'update was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('un-sell via UPDATE blocked', sqlerrm like '%card_sell / card_unsell%', sqlerrm);
  end;

  -- ── 4. the OWNER gets no exemption either ─────────────────────────────────
  update public.profiles set role = 'owner' where id = v_uid;
  begin
    update public.cards set status = 'booked' where id = v_card;
    insert into t_results (name, pass, detail) values ('owner un-sell via UPDATE blocked', false, 'update was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('owner un-sell via UPDATE blocked', sqlerrm like '%card_sell / card_unsell%', sqlerrm);
  end;
  update public.profiles set role = 'card_ops' where id = v_uid;

  -- ── 5. basis_drawn cannot be edited directly ──────────────────────────────
  begin
    update public.cards set basis_drawn = 0 where id = v_card;
    insert into t_results (name, pass, detail) values ('basis_drawn edit blocked', false, 'update was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values ('basis_drawn edit blocked', true, sqlerrm);
  end;

  -- ── 6. unsell fully reverses: pool restored, sale gone, card booked ───────
  v_out := public.card_unsell(v_card);
  perform set_config('cardops.in_sell', '', true);
  select total_cost, card_count into v_total, v_cnt from public.card_pool where id = v_pool;
  select count(*) into v_basis from public.card_sales where card_id = v_card;
  insert into t_results (name, pass, detail) values
    ('unsell restores pool + deletes sale',
     v_total = 100.00 and v_cnt = 4 and v_basis = 0
       and (select status from public.cards where id = v_card) = 'booked',
     format('pool=%s/%s sales=%s restored=%s', v_total, v_cnt, v_basis, v_out->>'restored_basis'));

  -- ── 7. cannot sell twice against the same basis: re-sell after reversal is
  --      a FRESH draw against the restored pool, not a second draw of the old ─
  v_out := public.card_sell(v_card, 'test', 80, 0, 0, 0, 'TEST-ORDER-3');
  perform set_config('cardops.in_sell', '', true);
  select count(*) into v_cnt from public.card_pool_adjustments
    where card_id = v_card and kind = 'draw';
  select count(*) into v_basis from public.card_sales where card_id = v_card;
  select total_cost into v_total from public.card_pool where id = v_pool;
  insert into t_results (name, pass, detail) values
    ('re-sell after unsell = one live sale, one net draw',
     v_basis = 1 and v_cnt = 2  -- two draw rows, but draw#1 has a correction between
       and v_total = 75.00,     -- net effect: exactly ONE basis drawn from the pool
     format('sales=%s draws=%s pool_total=%s', v_basis, v_cnt, v_total));

  -- ── 8. a card cannot be BORN sold ─────────────────────────────────────────
  begin
    insert into public.cards (user_id, sku, player, status)
      values (v_uid, 'TST-2026-000002', 'BornSold', 'sold');
    insert into t_results (name, pass, detail) values ('insert status=sold blocked', false, 'insert was allowed');
  exception when others then
    insert into t_results (name, pass, detail) values
      ('insert status=sold blocked', sqlerrm like '%cannot be created sold%', sqlerrm);
  end;

  -- ── 9. non-sold status moves stay free (listed → booked) ──────────────────
  begin
    insert into public.cards (user_id, sku, player, status)
      values (v_uid, 'TST-2026-000003', 'Lister', 'listed');
    update public.cards set status = 'booked' where sku = 'TST-2026-000003' and user_id = v_uid;
    insert into t_results (name, pass, detail) values ('non-sold transitions unaffected', true, 'listed→booked ok');
  exception when others then
    insert into t_results (name, pass, detail) values ('non-sold transitions unaffected', false, sqlerrm);
  end;
end $$;

select n, case when pass then 'PASS' else 'FAIL' end as result, name, detail
from t_results order by n;

rollback;

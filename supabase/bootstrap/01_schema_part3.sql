-- ══════════════════════════════════════════════════════════════════════════
-- STANDALONE BOOTSTRAP · STEP 3 of 3 — the CardOps migration history,
-- concatenated in order. Run AFTER 00_foundations.sql and part 2.
-- ══════════════════════════════════════════════════════════════════════════

-- ═══════════ 20260733000000_card_sales_tenancy.sql ═══════════
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

-- ═══════════ 20260734000000_status_is_a_transition.sql ═══════════
-- Status is a transition, not a field (foundation-fixes item 2).
--
-- The 2026-07-25 review's one CRITICAL: generic update paths accepted any
-- status, so an edit could pull a sold card back to 'booked' with no reversal
-- (basis stays drawn, sale row stays, card sellable AGAIN), and cards could be
-- created 'sold' with no sale booked. guard_card_sale only watched transitions
-- TO 'sold' and exempted the owner entirely.
--
-- New rule, enforced at the database so PostgREST can't route around it:
-- crossing the 'sold' boundary in EITHER direction — and any edit of
-- basis_drawn / sold_at — happens only inside card_sell / card_unsell (the
-- cardops.in_sell handshake). No owner exemption: the owner corrects mistakes
-- through card_unsell like everyone else. service_role is unaffected (crons
-- settle through the RPCs anyway). Non-sold status moves (booked/listed/
-- graded_out/archived) stay free.
--
-- Idempotent; safe to re-run.

create or replace function public.guard_card_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status
        and (new.status = 'sold' or old.status = 'sold'))
     or new.basis_drawn is distinct from old.basis_drawn
     or new.sold_at is distinct from old.sold_at then
    if coalesce(auth.role(), '') = 'authenticated'
       and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
      raise exception 'sold is a transition: use card_sell / card_unsell';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_sale_guard on public.cards;
create trigger cards_sale_guard before update on public.cards
  for each row execute function public.guard_card_sale();

-- Cards cannot be BORN sold: an insert with status='sold' has no sale row, no
-- basis draw, no P/L — it is a lie the books would repeat. Applies to every
-- authenticated insert (form, CSV import, raw PostgREST).
create or replace function public.guard_card_birth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sold'
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
    raise exception 'cards cannot be created sold — import as booked and enter the sale explicitly';
  end if;
  return new;
end $$;
drop trigger if exists cards_birth_guard on public.cards;
create trigger cards_birth_guard before insert on public.cards
  for each row execute function public.guard_card_birth();

-- ═══════════ 20260735000000_purchase_lots.sql ═══════════
-- Purchase-lot basis (foundation-fixes item 3). DESTRUCTIVE by design.
--
-- The global card_pool answered "average cost of everything ever pooled" — it
-- cannot answer "which purchase, what cost", the first question in any audit,
-- and its default-on flag let unfunded cards dilute basis other cards funded
-- (the review's second CRITICAL). It is replaced by PURCHASE LOTS:
--
--   purchase_lots            one row per purchase EVENT (a box break, a
--                            collection buy): what it cost, when, from where,
--                            which tax bucket — immutable purchase record plus
--                            a mutable remaining_cost/remaining_count that
--                            draws consume.
--   purchase_lot_adjustments the append-only draw/correction trail (the same
--                            authoritative-ledger pattern card_pool used).
--   cards.purchase_lot_id    which purchase a card came from. Basis at sale:
--                            lot average of what REMAINS in that lot; a card
--                            with no lot uses individual_basis. No third path.
--
-- NAMING: "lot" was already taken by card_lots — those are SALE lots (bundle
-- cards into one listing) and are untouched. Purchase-side is purchase_lots
-- everywhere, including in code.
--
-- Zero sales exist (confirmed 2026-07-25), so there is no draw history to
-- carry. Any FUNDED pool balance still folds into a per-user "Legacy pool"
-- purchase lot before the drop — nothing is destroyed even if the pool turns
-- out to be non-empty. The verification SELECT below shows what the fold will
-- touch; review its output before continuing past it.

-- ── 0) verification: what exists right now ──────────────────────────────────
select 'card_pool rows' as what, count(*)::text as n from public.card_pool
union all
select 'funded pools (cost>0 or count>0)',
       count(*)::text from public.card_pool where total_cost > 0 or card_count > 0
union all
select 'pool adjustments', count(*)::text from public.card_pool_adjustments
union all
select 'cards flagged use_pool_basis', count(*)::text from public.cards where use_pool_basis
union all
select 'card_sales rows (expect 0)', count(*)::text from public.card_sales;

-- ── 1) the new tables ───────────────────────────────────────────────────────
create table if not exists public.purchase_lots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id),
  label           text,
  source          text,
  acquired_on     date not null default current_date,
  tax_bucket      text check (tax_bucket in ('investment','dealer','hobby') or tax_bucket is null),
  total_cost      numeric(14,2) not null check (total_cost >= 0),
  card_count      int not null check (card_count >= 0),
  remaining_cost  numeric(14,2) not null,
  remaining_count int not null,
  receipt_id      uuid references public.card_receipts(id),  -- books-side twin, when booked
  created_at      timestamptz not null default now()
);
create index if not exists purchase_lots_user_idx on public.purchase_lots (user_id);

create table if not exists public.purchase_lot_adjustments (
  id                    bigint generated always as identity primary key,
  lot_id                uuid not null references public.purchase_lots(id),
  ts                    timestamptz not null default now(),
  kind                  text not null check (kind in ('draw','correction','adjust')),
  card_id               uuid references public.cards(id),
  amount                numeric(12,2) not null,
  remaining_cost_after  numeric(14,2) not null,
  remaining_count_after int not null,
  actor                 text not null,
  note                  text
);
create index if not exists purchase_lot_adj_card_idx on public.purchase_lot_adjustments (card_id, kind, ts);

alter table public.cards add column if not exists purchase_lot_id uuid references public.purchase_lots(id);

-- RLS: each user sees and manages their own lots; the money columns are
-- RPC-only (trigger below), metadata stays freely editable.
alter table public.purchase_lots enable row level security;
drop policy if exists purchase_lots_own on public.purchase_lots;
create policy purchase_lots_own on public.purchase_lots
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.purchase_lot_adjustments enable row level security;
drop policy if exists purchase_lot_adj_sel on public.purchase_lot_adjustments;
create policy purchase_lot_adj_sel on public.purchase_lot_adjustments
  for select to authenticated
  using (exists (select 1 from public.purchase_lots l where l.id = lot_id and l.user_id = auth.uid()));
-- no insert/update/delete policies: the trail is written only by the RPCs.

-- Money columns move only inside the RPC handshake (same GUC card_sell uses).
create or replace function public.guard_purchase_lot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.remaining_cost  is distinct from old.remaining_cost
      or new.remaining_count is distinct from old.remaining_count
      or new.total_cost   is distinct from old.total_cost
      or new.card_count   is distinct from old.card_count)
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('cardops.in_sell', true), '') <> '1' then
    raise exception 'lot balances move only through card_sell / card_unsell / speed_book_commit';
  end if;
  return new;
end $$;
drop trigger if exists purchase_lots_guard on public.purchase_lots;
create trigger purchase_lots_guard before update on public.purchase_lots
  for each row execute function public.guard_purchase_lot();

-- A card may only point at a lot owned by the SAME user (the FK alone would
-- accept another user's lot id, since FK checks bypass RLS).
create or replace function public.guard_card_lot_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.purchase_lot_id is not null and not exists (
       select 1 from public.purchase_lots l
       where l.id = new.purchase_lot_id and l.user_id = new.user_id) then
    raise exception 'purchase lot belongs to a different user';
  end if;
  return new;
end $$;
drop trigger if exists cards_lot_link_guard on public.cards;
create trigger cards_lot_link_guard before insert or update of purchase_lot_id on public.cards
  for each row execute function public.guard_card_lot_link();

-- ── 2) card_sell: draw from the card's OWN purchase lot ─────────────────────
create or replace function public.card_sell(
  p_card_id uuid, p_platform text, p_sale_price numeric, p_fees numeric,
  p_ship_income numeric, p_ship_cost numeric, p_order_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards%rowtype; v_lot public.purchase_lots%rowtype;
  v_basis numeric := 0; v_net numeric; v_pl numeric;
begin
  if not (public.owns_card(p_card_id) or auth.role() = 'service_role') then raise exception 'forbidden'; end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status = 'sold' then raise exception 'card already sold'; end if;
  if p_sale_price is null or p_sale_price < 0 then raise exception 'sale price required'; end if;

  v_net := coalesce(p_sale_price, 0) - coalesce(p_fees, 0) + coalesce(p_ship_income, 0) - coalesce(p_ship_cost, 0);

  perform set_config('cardops.in_sell', '1', true);

  if v_card.purchase_lot_id is not null then
    select * into v_lot from public.purchase_lots where id = v_card.purchase_lot_id for update;
    if found and v_lot.remaining_count > 0 then
      v_basis := round(v_lot.remaining_cost / v_lot.remaining_count, 2);
      insert into public.purchase_lot_adjustments
        (lot_id, kind, card_id, amount, remaining_cost_after, remaining_count_after, actor, note)
      values
        (v_lot.id, 'draw', p_card_id, -v_basis,
         v_lot.remaining_cost - v_basis, v_lot.remaining_count - 1,
         coalesce(auth.uid()::text, 'system'), 'Sale draw');
      update public.purchase_lots
        set remaining_cost = remaining_cost - v_basis, remaining_count = remaining_count - 1
        where id = v_lot.id;
    end if;
  else
    v_basis := coalesce(v_card.individual_basis, 0);
  end if;

  v_pl := v_net - v_basis;

  insert into public.card_sales
    (card_id, user_id, platform, sale_price, fees, shipping_income, shipping_cost, net_proceeds, basis_drawn, profit_loss, order_ref)
  values (p_card_id, v_card.user_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost, v_net, v_basis, v_pl, p_order_ref);
  update public.cards set status = 'sold', sold_at = now(), basis_drawn = v_basis where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis, 'profit_loss', v_pl);
end $$;

-- ── 3) card_unsell: reverse the lot draw this sale made ─────────────────────
create or replace function public.card_unsell(p_card_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards%rowtype; v_sale public.card_sales%rowtype;
  v_lot public.purchase_lots%rowtype; v_draw public.purchase_lot_adjustments%rowtype;
  v_restored numeric := 0; v_count int := 0;
begin
  if not (public.owns_card(p_card_id) or auth.role() = 'service_role') then
    raise exception 'forbidden';
  end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.status <> 'sold' then raise exception 'card is not sold'; end if;

  -- Reverse the latest lot 'draw' for this card not already corrected. The
  -- adjustment trail is authoritative — not basis_drawn, not the current lot
  -- link — so the reversal is exact even for a $0 draw or a since-relinked card.
  select * into v_draw from public.purchase_lot_adjustments
    where card_id = p_card_id and kind = 'draw'
    order by ts desc, id desc limit 1;
  if v_draw.id is not null and not exists (
        select 1 from public.purchase_lot_adjustments
        where card_id = p_card_id and kind = 'correction'
          and (ts, id) > (v_draw.ts, v_draw.id)) then
    select * into v_lot from public.purchase_lots where id = v_draw.lot_id for update;
    if found then
      v_restored := -v_draw.amount;
      v_count := 1;
      perform set_config('cardops.in_sell', '1', true);
      insert into public.purchase_lot_adjustments
        (lot_id, kind, card_id, amount, remaining_cost_after, remaining_count_after, actor, note)
      values
        (v_lot.id, 'correction', p_card_id, v_restored,
         v_lot.remaining_cost + v_restored, v_lot.remaining_count + 1,
         coalesce(auth.uid()::text, 'system'), 'Sale reversed');
      update public.purchase_lots
        set remaining_cost = remaining_cost + v_restored, remaining_count = remaining_count + 1
        where id = v_lot.id;
    end if;
  end if;

  select * into v_sale from public.card_sales
    where card_id = p_card_id order by sold_at desc limit 1;
  if v_sale.id is not null then
    delete from public.card_sales where id = v_sale.id;
  end if;

  perform set_config('cardops.in_sell', '1', true);
  update public.cards
    set status = 'booked', sold_at = null, basis_drawn = null
    where id = p_card_id;

  return jsonb_build_object(
    'reversed_sale', v_sale.id,
    'restored_basis', v_restored,
    'restored_count', v_count
  );
end $$;

-- ── 4) speed_book_commit: a batch IS a purchase lot ─────────────────────────
create or replace function public.speed_book_commit(p_items jsonb, p_lot_cost numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot_id uuid;
  v_item jsonb; v_cat text; v_year int := extract(year from now())::int;
  v_prefix text; v_seq int; v_sku text; v_id uuid; v_ids uuid[] := '{}'; v_n int := 0;
begin
  if not public.has_card_access() then raise exception 'forbidden'; end if;
  if p_lot_cost is null or p_lot_cost < 0 then raise exception 'lot cost required (0 allowed for a free lot)'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no items'; end if;

  perform set_config('cardops.in_sell', '1', true);
  insert into public.purchase_lots
    (user_id, label, acquired_on, total_cost, card_count, remaining_cost, remaining_count)
  values
    (auth.uid(), 'Speed Book ' || to_char(now(), 'YYYY-MM-DD'), current_date,
     p_lot_cost, jsonb_array_length(p_items), p_lot_cost, jsonb_array_length(p_items))
  returning id into v_lot_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_cat := coalesce(nullif(v_item->>'cat', ''), 'OT');
    v_prefix := v_cat || '-' || v_year || '-';
    loop
      select coalesce(max(substring(sku from char_length(v_prefix) + 1)::int), 0) + 1 into v_seq
        from public.cards where sku like v_prefix || '%';
      v_sku := v_prefix || lpad(v_seq::text, 6, '0');
      begin
        insert into public.cards (sku, entity_id, sport_category, zone, quick_booked, purchase_lot_id, status)
        values (v_sku,
          case when public.is_owner() then 'bfa6ad79-0d3a-412b-a682-603aa9d23f1d'::uuid else null end,
          nullif(v_item->>'sport_category', ''), coalesce(nullif(v_item->>'zone', ''), 'BULK'),
          true, v_lot_id, 'booked')
        returning id into v_id;
        exit;
      exception when unique_violation then end;
    end loop;
    v_ids := array_append(v_ids, v_id); v_n := v_n + 1;
  end loop;

  return jsonb_build_object('inserted', v_n, 'ids', to_jsonb(v_ids), 'lot_id', v_lot_id, 'lot_cost', p_lot_cost);
end $$;

-- ── 5) fold any funded legacy pool, then drop the old world ─────────────────
do $$
declare r record; v_lot uuid;
begin
  for r in select * from public.card_pool
            where (total_cost > 0 or card_count > 0) and user_id is not null loop
    insert into public.purchase_lots
      (user_id, label, acquired_on, total_cost, card_count, remaining_cost, remaining_count)
    values (r.user_id, 'Legacy pool (pre-lot basis)', current_date,
            r.total_cost, r.card_count, r.total_cost, r.card_count)
    returning id into v_lot;
    update public.cards c set purchase_lot_id = v_lot
      where c.user_id = r.user_id and c.use_pool_basis = true
        and c.status <> 'sold' and c.purchase_lot_id is null;
  end loop;
end $$;

drop table if exists public.card_pool_adjustments;
drop table if exists public.card_pool;
alter table public.cards drop column if exists use_pool_basis;

-- ═══════════ 20260736000000_audit_log_actors.sql ═══════════
-- Audit integrity (foundation-fixes item 4b).
--
-- The actor CHECK allowed only ('web','mcp','cron','assistant'), but the eBay
-- sync writes actor 'ebay-sync' per settled order and the account-deletion
-- endpoint writes 'ebay' — both inserts were silently rejected (23514 inside
-- swallowed promises), so the ONLY per-order settlement trail and the
-- compliance proof-of-receipt log never existed. Widen the constraint to the
-- actors the code actually writes; the code side now goes through
-- auditOrThrow, so any future constraint/actor mismatch fails loudly instead.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%actor%'
  loop
    execute format('alter table public.audit_log drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.audit_log add constraint audit_log_actor_check
  check (actor in ('web','mcp','cron','assistant','ebay-sync','ebay'));

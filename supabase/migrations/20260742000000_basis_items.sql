-- ══════════════════════════════════════════════════════════════════════════
-- COST BASIS BREAKDOWN (Beau, 2026-07-25)
--
-- "it should be called a cost basis area... 'Total Cost Basis'... a drop down
--  or extra area that you can expand where you can add a breakdown of the
--  items that make up your cost basis... grading fees, appraisal fees, etc...
--  and the ability to make your own cost basis items. then these can be
--  edited/added later."
--
-- DESIGN: costs ACCRETE, they don't replace acquisition.
--
-- CLAUDE.md says a card's basis has exactly two sources and there is no third
-- path. That stays true. `individual_basis` still means ONE thing — what the
-- card cost to acquire — and a purchase lot still means the other. Everything
-- here is a THIRD CATEGORY, not a third source: costs capitalized into the
-- card AFTER acquisition. That is also what they are in tax terms, which is
-- why a lot-funded card can carry a grading fee without the lot's own balance
-- moving a cent.
--
--   total basis = (lot average OR individual_basis) + basis_items_total
--
-- `cards.basis_items_total` is a trigger-maintained CACHE of the child rows.
-- It exists so cardBasis() stays a pure function over a card row already in
-- memory: every money screen pages `cards` and sums that column. Making the
-- screens page a second table instead would have put a 1000-row PostgREST cap
-- (prevention rule 5) in front of every basis figure in the app.
--
-- SOLD CARDS ARE REFUSED, not restated. Profit is recorded at sale, in
-- card_sales; letting basis move afterwards silently rewrites a number that
-- may already be posted to real books. Un-sell, edit, re-sell — that path is
-- DB-enforced and leaves a trail. (A proper restatement flow, with a
-- books-drift flag, is a later job and wants Beau's decision first.)
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. what a cost line can be ────────────────────────────────────────────
-- user_id NULL = built-in, shared by everyone. A user's own kinds sit
-- alongside; they can't collide with a built-in key because the resolver
-- prefers the built-in and the index below forbids a duplicate per owner.
create table if not exists public.card_basis_item_kinds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null,
  sort int not null default 100,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
-- NULLs are never equal in a unique constraint, so a plain unique(user_id,key)
-- would let the built-in list acquire duplicates. Fold NULL to a sentinel.
create unique index if not exists card_basis_item_kinds_owner_key
  on public.card_basis_item_kinds (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

insert into public.card_basis_item_kinds (user_id, key, label, sort) values
  (null, 'grading_fee',        'Grading fee',              10),
  (null, 'grading_shipping',   'Shipping to grader',       20),
  (null, 'authentication',     'Authentication',           30),
  (null, 'appraisal_fee',      'Appraisal',                40),
  (null, 'sales_tax',          'Sales tax paid',           50),
  (null, 'shipping_in',        'Shipping in',              60),
  (null, 'buyers_premium',     'Buyer''s premium',         70),
  (null, 'auction_fee',        'Auction / marketplace fee',80),
  (null, 'restoration',        'Repair or restoration',    90),
  (null, 'supplies',           'Supplies (case, sleeve)', 100),
  (null, 'insurance',          'Insurance',               110),
  (null, 'other',              'Other',                   900)
on conflict do nothing;

alter table public.card_basis_item_kinds enable row level security;
do $$ begin
  -- Everyone reads the built-ins and their own; nobody sees anyone else's.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_basis_item_kinds' and policyname='card_basis_item_kinds_read') then
    create policy card_basis_item_kinds_read on public.card_basis_item_kinds for select to authenticated
      using (user_id is null or user_id = auth.uid());
  end if;
  -- Own rows only for writes — the built-in list is not user-editable.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_basis_item_kinds' and policyname='card_basis_item_kinds_write') then
    create policy card_basis_item_kinds_write on public.card_basis_item_kinds for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- ── 2. the cost lines themselves ──────────────────────────────────────────
create table if not exists public.card_basis_items (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  -- Denormalized, exactly as card_photos had to be (20260740): during a
  -- cascade delete the parent card is ALREADY GONE, so a trigger that looks
  -- the owner up from cards finds nothing.
  user_id uuid not null,
  kind_key text not null,
  -- Snapshot of the label at write time, so renaming or archiving a kind
  -- never silently relabels a historical cost line.
  label text not null,
  -- Negative is allowed: a refund, a discount or a returned grading fee is a
  -- real cost line. The TOTAL is what gets floored at zero, below.
  amount numeric(12,2) not null check (amount between -10000000 and 10000000),
  incurred_on date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists card_basis_items_card_idx on public.card_basis_items (card_id, created_at, id);
create index if not exists card_basis_items_user_idx on public.card_basis_items (user_id, created_at, id);

alter table public.card_basis_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_basis_items' and policyname='card_basis_items_own') then
    create policy card_basis_items_own on public.card_basis_items for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- ── 3. the cached total, and the flag that keeps 0 honest ─────────────────
alter table public.cards
  add column if not exists basis_items_total numeric(12,2) not null default 0,
  -- Beau asked for cost to be optional and default to 0. That is fine as long
  -- as "I didn't say" stays distinguishable from "it genuinely cost nothing" —
  -- otherwise an un-costed card reads as a free card and shows full sale price
  -- as profit (prevention rule 4: never $0-as-fact). Screens read this flag,
  -- not the number, to decide whether to prompt.
  add column if not exists basis_entered boolean not null default false;

-- Existing rows: anything with a basis already stated, or funded by a lot,
-- counts as entered. Only genuinely blank ones get flagged.
update public.cards
   set basis_entered = true
 where basis_entered = false
   and (individual_basis is not null or purchase_lot_id is not null);

create index if not exists cards_basis_unentered_idx
  on public.cards (user_id) where basis_entered = false;

-- ── 4. keep the cache exactly equal to the rows ───────────────────────────
create or replace function public.sync_card_basis_items_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_card uuid; v_total numeric;
begin
  v_card := coalesce(new.card_id, old.card_id);
  select coalesce(sum(amount), 0) into v_total
    from public.card_basis_items where card_id = v_card;
  -- The handshake that lets this write past guard_card_basis_total. It is
  -- transaction-local and reset immediately: a flag left set would disable the
  -- guard for the rest of the transaction (the money-core harness learned this
  -- the hard way with cardops.in_sell).
  perform set_config('cardops.in_basis', '1', true);
  update public.cards set basis_items_total = v_total where id = v_card;
  perform set_config('cardops.in_basis', '', true);
  return coalesce(new, old);
end $$;

drop trigger if exists card_basis_items_sync on public.card_basis_items;
create trigger card_basis_items_sync
  after insert or update or delete on public.card_basis_items
  for each row execute function public.sync_card_basis_items_total();

-- The cache has exactly ONE writer. Without this, a PostgREST update of
-- `cards` could set any total it liked and no screen would ever disagree.
create or replace function public.guard_card_basis_total()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.basis_items_total is distinct from old.basis_items_total
     and coalesce(current_setting('cardops.in_basis', true), '') <> '1' then
    raise exception 'basis_items_total is maintained from card_basis_items — add or edit a cost line instead';
  end if;
  return new;
end $$;
drop trigger if exists cards_basis_total_guard on public.cards;
create trigger cards_basis_total_guard before update on public.cards
  for each row execute function public.guard_card_basis_total();

-- ── 5. what a cost line may not do ────────────────────────────────────────
create or replace function public.guard_card_basis_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_status text; v_indiv numeric; v_total numeric; v_card uuid;
begin
  v_card := coalesce(new.card_id, old.card_id);
  select user_id, status, coalesce(individual_basis, 0)
    into v_owner, v_status, v_indiv
    from public.cards where id = v_card;

  -- No card = a cascade delete in flight. Let the rows go.
  if v_owner is null then return coalesce(new, old); end if;

  if tg_op <> 'DELETE' then
    -- The FK alone would accept another user's card id: FK checks bypass RLS.
    -- Same reasoning as guard_card_lot_link in 20260735.
    if new.user_id is distinct from v_owner then
      raise exception 'a cost line must belong to the same user as its card';
    end if;

    -- Resolve the kind from its KEY and stamp both label and key from what we
    -- resolved. Accepting a caller-supplied kind id would let one tenant point
    -- at another tenant's private kind row.
    if not exists (
      select 1 from public.card_basis_item_kinds
       where key = new.kind_key and (user_id is null or user_id = v_owner) and not archived
    ) then
      raise exception 'unknown or archived cost kind: %', new.kind_key;
    end if;
    if new.label is null or btrim(new.label) = '' then
      select label into new.label from public.card_basis_item_kinds
       where key = new.kind_key and (user_id is null or user_id = v_owner)
       order by user_id nulls last limit 1;
    end if;
  end if;

  -- A sold card's profit is already recorded in card_sales and may already be
  -- posted to real books. Moving its basis afterwards rewrites history in
  -- silence. Un-sell, edit, re-sell — that path exists and leaves a trail.
  if v_status = 'sold' then
    raise exception 'this card is sold — un-sell it first if its cost basis really needs to change';
  end if;

  -- Credit lines are allowed, but they may not drive total basis negative.
  select coalesce(sum(amount), 0) into v_total
    from public.card_basis_items
   where card_id = v_card and id is distinct from coalesce(new.id, old.id);
  if tg_op <> 'DELETE' then v_total := v_total + new.amount; end if;
  if v_indiv + v_total < 0 then
    raise exception 'that would make the card''s total cost basis negative (%).', v_indiv + v_total;
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists card_basis_items_guard on public.card_basis_items;
create trigger card_basis_items_guard before insert or update or delete
  on public.card_basis_items for each row execute function public.guard_card_basis_item();

-- ── 6. stating a basis marks it stated ────────────────────────────────────
-- Set on any write that names a figure, so the "no cost basis entered" list
-- empties itself as Beau fills cards in, without a second thing to remember.
create or replace function public.mark_basis_entered()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.individual_basis is not null or new.purchase_lot_id is not null then
      new.basis_entered := true;
    end if;
  elsif new.individual_basis is distinct from old.individual_basis
        or new.purchase_lot_id is distinct from old.purchase_lot_id then
    if new.individual_basis is not null or new.purchase_lot_id is not null then
      new.basis_entered := true;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_mark_basis_entered on public.cards;
create trigger cards_mark_basis_entered before insert or update on public.cards
  for each row execute function public.mark_basis_entered();

-- Adding a cost line is also stating a basis.
create or replace function public.mark_basis_entered_from_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cards set basis_entered = true
   where id = new.card_id and basis_entered = false;
  return new;
end $$;
drop trigger if exists card_basis_items_mark_entered on public.card_basis_items;
create trigger card_basis_items_mark_entered after insert on public.card_basis_items
  for each row execute function public.mark_basis_entered_from_item();

-- ── 7. card_sell draws the FULL basis, acquisition + cost lines ───────────
-- Without this the breakdown would be decoration: you could record $60 of
-- grading and still book profit as if the card cost only what you paid for it.
-- The lot half is unchanged — the lot's own balance still moves by the lot
-- average alone, so `Σ(draws) = lot.total_cost` still holds.
create or replace function public.card_sell(
  p_card_id uuid, p_platform text, p_sale_price numeric, p_fees numeric,
  p_ship_income numeric, p_ship_cost numeric, p_order_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards%rowtype; v_lot public.purchase_lots%rowtype;
  v_basis numeric := 0; v_acq numeric := 0; v_items numeric := 0;
  v_net numeric; v_pl numeric;
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
      v_acq := round(v_lot.remaining_cost / v_lot.remaining_count, 2);
      insert into public.purchase_lot_adjustments
        (lot_id, kind, card_id, amount, remaining_cost_after, remaining_count_after, actor, note)
      values
        (v_lot.id, 'draw', p_card_id, -v_acq,
         v_lot.remaining_cost - v_acq, v_lot.remaining_count - 1,
         coalesce(auth.uid()::text, 'system'), 'Sale draw');
      update public.purchase_lots
        set remaining_cost = remaining_cost - v_acq, remaining_count = remaining_count - 1
        where id = v_lot.id;
    end if;
  else
    v_acq := coalesce(v_card.individual_basis, 0);
  end if;

  -- Read the rows, not the cache. The cache is what the SCREENS read; the
  -- money figure that lands in card_sales is computed from the source.
  select coalesce(sum(amount), 0) into v_items
    from public.card_basis_items where card_id = p_card_id;

  v_basis := v_acq + v_items;
  v_pl := v_net - v_basis;

  insert into public.card_sales
    (card_id, user_id, platform, sale_price, fees, shipping_income, shipping_cost, net_proceeds, basis_drawn, profit_loss, order_ref)
  values (p_card_id, v_card.user_id, p_platform, p_sale_price, p_fees, p_ship_income, p_ship_cost, v_net, v_basis, v_pl, p_order_ref);
  update public.cards set status = 'sold', sold_at = now(), basis_drawn = v_basis where id = p_card_id;

  return jsonb_build_object('net', v_net, 'basis', v_basis,
                            'acquisition', v_acq, 'cost_lines', v_items, 'profit_loss', v_pl);
end $$;

revoke all on function public.card_sell(uuid, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.card_sell(uuid, text, numeric, numeric, numeric, numeric, text) to authenticated, service_role;

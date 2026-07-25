-- ══════════════════════════════════════════════════════════════════════════
-- WAVE B — THE INVESTOR-ASSET RECORD (Beau, 2026-07-25)
-- Design: reference/DESIGN_WAVE_B.md. Schema half; UI follows.
--
-- The app models a card as dealer inventory moving through a sales funnel.
-- An investor asset is the opposite: it may never be listed, and its value
-- lives in DOCUMENTATION. The questions are "can I prove my basis", "can I
-- prove the chain of custody", "where is it and when is it coming back".
--
-- Three tables, deliberately separate from `cards` (sparse rows, and `cards`
-- is already wide and hit by every list query), plus the tax-bucket
-- inheritance chain and two guarded transitions.
-- ══════════════════════════════════════════════════════════════════════════

-- ── A. Documents — the thing the value actually lives in ───────────────────
-- `proves` is the load-bearing column: it turns a folder of PDFs into an
-- evidence packet, and lets the app say "your basis has no supporting
-- document" instead of showing an undefended number.
create table if not exists public.card_documents (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  proves text not null check (proves in
    ('basis','reported_value','grade','insured_value','custody','title','provenance','other')),
  kind text,                         -- 'appraisal','form_706','cert','receipt','policy'
  bucket text not null default 'receipts',
  path text not null,
  doc_date date,
  bytes bigint,
  -- Integrity: evidence that can't be shown unaltered is weaker evidence, and
  -- this is what makes the backup VERIFIABLE rather than merely present.
  sha256 text,
  backup_state text not null default 'pending'
    check (backup_state in ('pending','backed_up','failed')),
  backup_error text,
  backed_up_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists card_documents_card_idx on public.card_documents (card_id, created_at desc);
create index if not exists card_documents_backup_idx on public.card_documents (backup_state, created_at)
  where backup_state <> 'backed_up';

alter table public.card_documents enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_documents' and policyname='card_documents_own') then
    create policy card_documents_own on public.card_documents for all to authenticated
      using (public.owns_card(card_id)) with check (public.owns_card(card_id));
  end if;
end $$;

-- ── B. The asset record (1:1 with an investor-bucket card) ─────────────────
create table if not exists public.card_asset_records (
  card_id uuid primary key references public.cards(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  -- provenance: the PARTY, distinct from cards.acquisition_source (the channel)
  acquired_from text,
  acquired_relation text,
  -- basis provenance. The enum is not decoration: §1014 (step-up) vs §1015
  -- (carryover) is the difference between a stepped-up and an inherited-cost
  -- basis, and each carries a different substantiation requirement.
  basis_amount numeric(14,2),
  basis_source text check (basis_source in
    ('purchase_receipt','1014_step_up','1015_carryover','1022_modified','other')),
  basis_doc_id uuid references public.card_documents(id) on delete set null,
  appraisal_author text,
  appraisal_credential text,
  appraisal_date date,
  estate_reported_value numeric(14,2),
  -- The most commonly missed rule in stepped-up basis; surfaced as a warning.
  reported_value_caps_basis boolean not null default false,
  -- grade verification
  grade_verification text check (grade_verification in
    ('verified','unverified_grader','pending_crossover','crossover_failed')),
  crossover_target_grader text,
  crossover_min_grade numeric(4,1),
  -- insurance. Deliberately its own number: insured value, basis and market
  -- value are three different things and must never be conflated.
  insured_value numeric(14,2),
  insurer text,
  policy_ref text,
  insurance_valued_at date,
  -- legal title, separate from physical custody
  legal_title_holder text check (legal_title_holder in
    ('individual','trust','estate','joint','entity')),
  legal_title_detail text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.card_asset_records enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_asset_records' and policyname='card_asset_records_own') then
    create policy card_asset_records_own on public.card_asset_records for all to authenticated
      using (public.owns_card(card_id)) with check (public.owns_card(card_id));
  end if;
end $$;

-- ── C. Chain of custody — APPEND ONLY ──────────────────────────────────────
-- A chain of custody you can edit is not a chain of custody. Same discipline
-- as purchase_lot_adjustments: insert and select only.
create table if not exists public.card_custody_log (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  from_state text,
  to_state text not null,
  counterparty text,
  location text,
  sent_at timestamptz not null default now(),
  expected_back date,
  -- Stamped on the row that CLOSES a move (the return to possession). It is
  -- NOT used to find open moves: because the log is append-only, an earlier
  -- row is never edited to mark it closed. Current truth lives on
  -- `cards.asset_state`; this log is the history behind it.
  returned_at timestamptz,
  tracking_ref text,
  declared_value numeric(14,2),
  document_id uuid references public.card_documents(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists card_custody_card_idx on public.card_custody_log (card_id, created_at desc);

alter table public.card_custody_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_custody_log' and policyname='card_custody_log_read') then
    create policy card_custody_log_read on public.card_custody_log for select to authenticated
      using (public.owns_card(card_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_custody_log' and policyname='card_custody_log_insert') then
    create policy card_custody_log_insert on public.card_custody_log for insert to authenticated
      with check (public.owns_card(card_id));
  end if;
end $$;
-- No UPDATE or DELETE policy exists, so RLS refuses both for authenticated
-- callers. Belt and braces for anything running as a definer:
create or replace function public.guard_custody_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'card_custody_log is append-only: correct by adding a row, never by editing one';
end $$;
drop trigger if exists custody_append_only on public.card_custody_log;
create trigger custody_append_only before update or delete on public.card_custody_log
  for each row execute function public.guard_custody_append_only();

-- ── D. Cards: the tax-bucket inheritance chain + asset state ───────────────
-- ONE authoritative value with a documented lineage, never two sources of
-- truth. The LOT carries the default (a purchase usually has one intent); the
-- CARD carries the resolved value, because the tax test is per-property and
-- the Schedule D line is per-card — and one lot legitimately holds two intents
-- (buy 500 to flip 490, keep 10).
alter table public.cards
  add column if not exists tax_bucket text
    check (tax_bucket in ('investment','dealer','hobby')),
  add column if not exists tax_bucket_source text
    check (tax_bucket_source in ('lot_default','explicit_override')),
  add column if not exists tax_bucket_set_at timestamptz,
  add column if not exists tax_bucket_reason text,
  -- Orthogonal to `status`. A vaulted asset is not 'hold' — it has a funnel
  -- position AND a physical disposition, and collapsing them loses one.
  add column if not exists asset_state text
    check (asset_state in ('in_my_possession','at_appraisal','out_for_crossover',
                           'at_auction_house_on_consignment','vaulted',
                           'pledged_as_collateral','crossover_failed'));
create index if not exists cards_asset_state_idx on public.cards (asset_state)
  where asset_state is not null;
create index if not exists cards_tax_bucket_idx on public.cards (user_id, tax_bucket);

-- Inherit the lot's bucket at creation. Same trigger philosophy as identity:
-- one place, so no intake path can forget.
create or replace function public.cards_inherit_tax_bucket()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bucket text;
begin
  if new.tax_bucket is null and new.purchase_lot_id is not null then
    select tax_bucket into v_bucket from public.purchase_lots where id = new.purchase_lot_id;
    if v_bucket is not null then
      new.tax_bucket := v_bucket;
      new.tax_bucket_source := 'lot_default';
      new.tax_bucket_set_at := now();
      new.tax_bucket_reason := 'inherited from purchase lot';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cards_tax_bucket_bi on public.cards;
create trigger cards_tax_bucket_bi before insert on public.cards
  for each row execute function public.cards_inherit_tax_bucket();

-- Reclass is an explicit ACTION, not an edit. A tax classification that can be
-- silently changed is not defensible; this forces a reason and an audit row.
create or replace function public.guard_tax_bucket()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tax_bucket is distinct from old.tax_bucket
     and coalesce(auth.role(), '') = 'authenticated'
     and coalesce(current_setting('cardops.in_reclass', true), '') <> '1' then
    raise exception 'tax_bucket is a classification, not a field: use card_reclass_tax_bucket';
  end if;
  return new;
end $$;
drop trigger if exists cards_tax_bucket_guard on public.cards;
create trigger cards_tax_bucket_guard before update on public.cards
  for each row execute function public.guard_tax_bucket();

create or replace function public.card_reclass_tax_bucket(
  p_card uuid, p_bucket text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text; v_uid uuid := auth.uid();
begin
  if p_bucket not in ('investment','dealer','hobby') then
    raise exception 'card_reclass_tax_bucket: bucket must be investment, dealer or hobby';
  end if;
  -- The reason is the point: it is what makes the classification defensible
  -- later, and the app records YOUR determination, it does not make one.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'card_reclass_tax_bucket: a reason is required';
  end if;
  select tax_bucket into v_old from public.cards where id = p_card and user_id = v_uid;
  if not found then raise exception 'card_reclass_tax_bucket: card not found'; end if;

  perform set_config('cardops.in_reclass', '1', true);
  update public.cards
     set tax_bucket = p_bucket, tax_bucket_source = 'explicit_override',
         tax_bucket_set_at = now(), tax_bucket_reason = p_reason
   where id = p_card and user_id = v_uid;
  perform set_config('cardops.in_reclass', '', true);

  insert into public.audit_log (actor, action, target, payload, result)
  values ('web', 'card.tax_bucket.reclass', p_card::text,
          jsonb_build_object('from', v_old, 'to', p_bucket, 'reason', p_reason, 'user_id', v_uid),
          'ok');
  return jsonb_build_object('card_id', p_card, 'from', v_old, 'to', p_bucket);
end $$;
revoke all on function public.card_reclass_tax_bucket(uuid, text, text) from public;
grant execute on function public.card_reclass_tax_bucket(uuid, text, text) to authenticated;

-- ── E. Custody moves — the state machine ───────────────────────────────────
-- Every transition writes a log row; that log IS the chain of custody. Every
-- state except in_my_possession and vaulted requires an expected return date,
-- because a consignment with no return date is itself a finding.
create or replace function public.card_move_asset(
  p_card uuid, p_to_state text, p_counterparty text default null,
  p_location text default null, p_expected_back date default null,
  p_tracking text default null, p_declared_value numeric default null,
  p_note text default null, p_document uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from text; v_uid uuid := auth.uid();
begin
  if p_to_state not in ('in_my_possession','at_appraisal','out_for_crossover',
                        'at_auction_house_on_consignment','vaulted',
                        'pledged_as_collateral','crossover_failed') then
    raise exception 'card_move_asset: unknown state %', p_to_state;
  end if;
  select asset_state into v_from from public.cards where id = p_card and user_id = v_uid;
  if not found then raise exception 'card_move_asset: card not found'; end if;
  if p_to_state not in ('in_my_possession','vaulted') and p_expected_back is null then
    raise exception 'card_move_asset: % requires an expected return date', p_to_state;
  end if;

  update public.cards set asset_state = p_to_state where id = p_card and user_id = v_uid;

  insert into public.card_custody_log
    (card_id, user_id, from_state, to_state, counterparty, location, expected_back,
     tracking_ref, declared_value, document_id, note,
     returned_at)
  values (p_card, v_uid, v_from, p_to_state, p_counterparty, p_location, p_expected_back,
          p_tracking, p_declared_value, p_document, p_note,
          case when p_to_state = 'in_my_possession' then now() end);

  return jsonb_build_object('card_id', p_card, 'from', v_from, 'to', p_to_state);
end $$;
revoke all on function public.card_move_asset(uuid, text, text, text, date, text, numeric, text, uuid) from public;
grant execute on function public.card_move_asset(uuid, text, text, text, date, text, numeric, text, uuid) to authenticated;

-- The aging board: assets out of your hands, with the expected-return date
-- from the move that put them there. Derived from the CARD's current state
-- (truth) joined to its latest custody row (context) — never from a mutable
-- flag on the log.
create or replace view public.card_assets_out as
select c.id as card_id, c.user_id, c.player, c.year, c.set_name, c.asset_state,
       l.counterparty, l.location, l.sent_at, l.expected_back, l.declared_value,
       case
         when l.expected_back is null then 'no_due_date'
         when l.expected_back < current_date then 'overdue'
         else 'ok'
       end as aging
from public.cards c
join lateral (
  select * from public.card_custody_log cl
  where cl.card_id = c.id order by cl.created_at desc, cl.id desc limit 1
) l on true
where c.asset_state is not null
  and c.asset_state not in ('in_my_possession','vaulted');

-- ── F. Pledged property cannot be sold ─────────────────────────────────────
-- Enforced in the database, not hidden in the UI — selling property pledged as
-- collateral is the kind of mistake that ends relationships.
create or replace function public.guard_pledged_not_sold()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('sold','listed')
     and old.asset_state = 'pledged_as_collateral' then
    raise exception 'this asset is pledged as collateral — release it before listing or selling';
  end if;
  return new;
end $$;
drop trigger if exists cards_pledged_guard on public.cards;
create trigger cards_pledged_guard before update on public.cards
  for each row execute function public.guard_pledged_not_sold();

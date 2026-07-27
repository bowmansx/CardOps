-- ══════════════════════════════════════════════════════════════════════════
-- AUTOGRAPH AND RELIC BELONG IN THE IDENTITY (2026-07-26)
--
-- THE DEFECT. `card_fingerprint()` covered sport, year, set, player, number
-- and parallel — and not `is_auto` or `is_relic`. So a signed copy and an
-- unsigned copy of the same card resolved to the SAME identity, and therefore
-- shared ONE pooled `card_market_sales` history that every tenant reads.
-- Nothing filtered them downstream either: `is_auto` and `is_relic` appear
-- nowhere in valuation or comp selection.
--
-- An autograph routinely multiplies a card's value. Pooling signed sales with
-- unsigned ones does not blur a price, it invents one — and this is the single
-- most-repeated credibility complaint against every scanning app on the
-- market. In a SHARED catalog it would be served to every tenant at once.
--
-- WHY GRADE STAYED OUT AND AUTOGRAPH GOES IN — the rule that distinguishes
-- them, since this migration otherwise looks like it contradicts CLAUDE.md:
--
--   Identity is the card AS PRINTED.
--   Grade is a property of a COPY — one card can be raw today and PSA 9 next
--   month, and it is the same printed object throughout. It is filtered at
--   query time instead, which is why the same identity can serve raw and
--   graded owners from one history.
--   An autograph or a relic swatch is printed/inserted at manufacture and
--   never changes. It IS the card. It belongs in the fingerprint.
--
-- BLAST RADIUS. One user today, and it only grows: every tenant added before
-- this fix pours more mixed sales into shared rows. Splitting later means
-- re-partitioning accumulated history with no way to tell which sales were
-- which.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. the fingerprint learns two more facts ──────────────────────────────
-- Old six-argument form kept as an overload so nothing that still calls it
-- breaks mid-deploy; it now delegates with both flags false, which is the
-- correct reading of "not stated".
create or replace function public.card_fingerprint(
  p_sport text, p_year int, p_set text, p_player text, p_number text,
  p_parallel text, p_is_auto boolean, p_is_relic boolean
) returns text language sql immutable as $$
  select public.norm_token(p_sport) || '|' ||
         coalesce(p_year::text, '~')  || '|' ||
         public.norm_token(p_set)     || '|' ||
         public.norm_token(p_player)  || '|' ||
         public.norm_token(p_number)  || '|' ||
         public.norm_token(p_parallel)|| '|' ||
         case when coalesce(p_is_auto, false)  then 'au' else '~' end || '|' ||
         case when coalesce(p_is_relic, false) then 're' else '~' end;
$$;

create or replace function public.card_fingerprint(
  p_sport text, p_year int, p_set text, p_player text, p_number text, p_parallel text
) returns text language sql immutable as $$
  select public.card_fingerprint(p_sport, p_year, p_set, p_player, p_number,
                                 p_parallel, false, false);
$$;

-- ── 2. the catalog records them ───────────────────────────────────────────
alter table public.card_identities
  add column if not exists is_auto boolean not null default false,
  add column if not exists is_relic boolean not null default false;

-- ── 3. resolve, with the two flags ────────────────────────────────────────
create or replace function public.resolve_card_identity(
  p_sport text, p_year int, p_set text, p_player text, p_number text,
  p_parallel text, p_is_auto boolean default false, p_is_relic boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_fp text; v_id uuid;
begin
  if not public.has_card_access() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'resolve_card_identity: card access required';
  end if;
  if public.norm_token(p_player) = '~' and public.norm_token(p_set) = '~' then
    return null;
  end if;
  v_fp := public.card_fingerprint(p_sport, p_year, p_set, p_player, p_number,
                                  p_parallel, p_is_auto, p_is_relic);
  select id into v_id from public.card_identities where fingerprint = v_fp;
  if v_id is not null then return v_id; end if;
  insert into public.card_identities
    (fingerprint, sport_category, year, set_name, player, card_number, parallel,
     is_auto, is_relic)
  values (v_fp, p_sport, p_year, p_set, p_player, p_number, p_parallel,
          coalesce(p_is_auto, false), coalesce(p_is_relic, false))
  on conflict (fingerprint) do update set fingerprint = excluded.fingerprint
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.resolve_card_identity(text, int, text, text, text, text, boolean, boolean) from public;
grant execute on function public.resolve_card_identity(text, int, text, text, text, text, boolean, boolean) to authenticated, service_role;

-- ── 4. the trigger passes them, and fires when they change ────────────────
create or replace function public.cards_set_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.identity_id := public.resolve_card_identity(
    new.sport_category, new.year, new.set_name, new.player, new.card_number,
    new.parallel, new.is_auto, new.is_relic);
  return new;
end $$;

-- Flipping is_auto on an existing card must re-point it at the signed
-- identity. Leaving those two columns off the trigger's UPDATE list was half
-- the defect: a correction would have been recorded and then ignored.
drop trigger if exists cards_identity_biu on public.cards;
create trigger cards_identity_biu
  before insert or update of sport_category, year, set_name, player,
                             card_number, parallel, is_auto, is_relic
  on public.cards for each row execute function public.cards_set_identity();

-- ── 5. re-point every existing card ───────────────────────────────────────
-- A no-op UPDATE fires the trigger, which recomputes each card's fingerprint
-- and creates the signed/relic identities that never existed. Cards that were
-- neither auto nor relic keep the identity they already had, because their
-- fingerprint gains two '~' segments identically to the backfill below.
update public.card_identities set fingerprint = fingerprint || '|~|~'
 where fingerprint not like '%|~|~' and fingerprint not like '%|au|%'
   and fingerprint not like '%|re|%'
   and length(fingerprint) - length(replace(fingerprint, '|', '')) = 5;

update public.cards set updated_at = updated_at
 where is_auto = true or is_relic = true;

-- ── 6. the sales that were already pooled ─────────────────────────────────
-- Every existing card_market_sales row was gathered under a fingerprint that
-- could not distinguish signed from unsigned, so its rows may be a mixture and
-- there is NO WAY to tell which were which. Flagging beats guessing: mark them
-- and let the refresh re-gather cleanly under the corrected identities.
alter table public.card_market_sales
  add column if not exists pre_auto_split boolean not null default false;

update public.card_market_sales set pre_auto_split = true where pre_auto_split = false;

comment on column public.card_market_sales.pre_auto_split is
  'Gathered before autograph/relic entered the fingerprint (20260745), so this row may belong to a signed or unsigned copy indistinguishably. Excluded from valuation until re-gathered.';

create index if not exists card_market_sales_pre_split_idx
  on public.card_market_sales (identity_id) where pre_auto_split = false;

-- Force a re-fetch for every identity so clean history accumulates.
update public.card_identities set last_refreshed_at = null;

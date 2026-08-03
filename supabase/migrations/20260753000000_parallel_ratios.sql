-- MEASURED PARALLEL RATIOS (2026-08-02)
--
-- The data `src/lib/cards/transfer.ts` needs and cannot get. It performs the
-- transfers `thinReason` licenses — pricing a card with no history from a
-- neighbouring parallel — and every multiplier it uses must be MEASURED, from
-- cards where both variants were actually observed. Nothing supplied those
-- pairs.
--
-- A VIEW AND A FUNCTION, not a table and a cron. There is no new write path, no
-- refresh to schedule, and nothing to go stale: the numbers are computed from
-- `card_market_sales` at query time. Reversible with two DROPs. This matters
-- because the six crons in vercel.json are deliberately 401ing until the
-- Master-Ops cutover, so anything needing a scheduled refresh would have been
-- born broken.
--
-- Does NOT depend on 20260752 (which is still unapplied); it needs only the
-- `price_basis` and `is_graded` columns from 20260750, which is live.
--
-- ⚠️ NOT YET RUN AGAINST A DATABASE. Written from the schema, not from a live
-- session. Read it before pasting.
--
-- ⚠️ NEEDS POSTGRES 15+ for `with (security_invoker = on)`. Supabase projects
-- are 15 or 17, so this should be fine — but if that line errors, the project is
-- older and the view must be created without it AND without RLS-sensitive use
-- until it can be. Check with `show server_version;` before assuming.
--
-- VERIFY AFTER PASTING (both should run without error; the second returns zero
-- rows until there are three cards observed at both parallels, which is correct
-- and is the whole point):
--
--   select count(*) from public.card_identity_medians;
--   select * from public.card_parallel_ratio(
--     'Bowman Chrome', 2021, '(base)', 'Refractor', false, '', null);
--
-- ── THE THREE THINGS THAT MAKE THIS HONEST ────────────────────────────────
--
-- 1. NEVER MEDIAN ACROSS PRICE BASES. eBay quotes what the buyer paid; an
--    auction house quotes the hammer with a premium still to come. Only
--    `price_basis = 'all_in'` rows are aggregated. A row whose basis was never
--    resolved is EXCLUDED, not assumed — the same rule `partitionByBasis`
--    applies in TypeScript.
--
-- 2. PAIRED, NOT POOLED. Comparing every /5 in a set against every base card
--    conflates the parallel effect with the PLAYER effect: /5s get pulled for
--    stars and base cards trade for commons, so a pooled ratio measures roster
--    quality as much as scarcity. The join is on the SAME card — same set, year,
--    player and card number — observed at both parallels.
--
-- 3. MEDIAN OF RATIOS, not ratio of medians. One expensive card that happens to
--    have both variants would otherwise dominate the estimate for a whole set.
--
-- Below three pairs the function returns NO ROW. That is the point: a transfer
-- resting on one or two coincidences is a guess with arithmetic attached.

-- ── Per-identity medians, at a stated condition ───────────────────────────
--
-- `security_invoker` so RLS on `card_market_sales` applies to the CALLER rather
-- than to the view's owner. It changes nothing today (market data is readable by
-- any card user) and everything the day 20260752 lands `private_to`, at which
-- point a definer view would leak one tenant's rows into another's ratios.
create or replace view public.card_identity_medians
with (security_invoker = on) as
select
  s.identity_id,
  i.set_name,
  i.year,
  i.player,
  i.card_number,
  -- NULL and '' are the same thing here — a card with no parallel is the base
  -- card — and leaving them distinct would split one group into three.
  coalesce(nullif(btrim(i.parallel), ''), '(base)')      as parallel,
  s.is_graded,
  upper(btrim(coalesce(s.grader, '')))                   as grader_key,
  s.grade,
  (percentile_cont(0.5) within group (order by s.price::float8))::numeric(12,2)
                                                         as median_price,
  count(*)::int                                          as sale_count,
  max(s.sold_at)                                         as last_sold
from public.card_market_sales s
join public.card_identities i on i.id = s.identity_id
where s.price > 0
  -- Rule 1. An unresolvable basis is excluded, never converted by guess.
  and s.price_basis = 'all_in'
group by 1, 2, 3, 4, 5, 6, 7, 8, 9
-- Three sales before a median means anything. With one it IS the sale; with two
-- it is their average wearing a median's name.
having count(*) >= 3;

comment on view public.card_identity_medians is
  'Median all-in price per identity and condition. Only price_basis=''all_in'' rows: eBay quotes what the buyer paid, an auction house quotes hammer, and medianing across the two mis-states money. Minimum three sales.';

-- ── The measured ratio between two parallels of the same set ──────────────
--
-- Mirrors `measureRatio` in `src/lib/cards/transfer.ts` exactly, including the
-- three-pair floor. Returns zero rows rather than a null ratio, so a caller
-- cannot accidentally treat "not enough evidence" as a number.
create or replace function public.card_parallel_ratio(
  p_set_name      text,
  p_year          int,
  p_from_parallel text,      -- the variant we HAVE evidence for
  p_to_parallel   text,      -- the variant we WANT
  p_is_graded     boolean,
  p_grader        text,
  p_grade         numeric
)
returns table (ratio numeric, pairs int, low numeric, high numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select
      f.median_price as from_price,
      t.median_price as to_price
    from public.card_identity_medians f
    join public.card_identity_medians t
      -- Rule 2: the SAME card, at a different parallel. `is not distinct from`
      -- rather than `=` throughout, because a null player or card number must
      -- match another null instead of matching nothing.
      on  t.set_name    =                 f.set_name
      and t.year        is not distinct from f.year
      and t.player      is not distinct from f.player
      and t.card_number is not distinct from f.card_number
      and t.is_graded   is not distinct from f.is_graded
      and t.grader_key  =                 f.grader_key
      and t.grade       is not distinct from f.grade
      and t.parallel    <>                f.parallel
    where f.set_name   = p_set_name
      and f.year       is not distinct from p_year
      and f.parallel   = p_from_parallel
      and t.parallel   = p_to_parallel
      and f.is_graded  is not distinct from p_is_graded
      and f.grader_key = upper(btrim(coalesce(p_grader, '')))
      and f.grade      is not distinct from p_grade
      and f.median_price > 0
  )
  select
    -- Rule 3: median of the per-card ratios, so every card gets one vote.
    (percentile_cont(0.5) within group (order by (to_price / from_price)::float8))::numeric(10,4),
    count(*)::int,
    min(to_price / from_price)::numeric(10,4),
    max(to_price / from_price)::numeric(10,4)
  from matched
  -- NO ROW below the floor. Deliberately not a null ratio: an abstention that
  -- arrives as an empty result cannot be mistaken for a number.
  having count(*) >= 3;
$$;

comment on function public.card_parallel_ratio is
  'Median of per-card price ratios between two parallels of one set, from cards observed at BOTH. Paired rather than pooled: pooling conflates the parallel effect with the player effect, because /5s get pulled for stars. Returns no row below three pairs.';

grant select on public.card_identity_medians to authenticated;
grant execute on function public.card_parallel_ratio(text, int, text, text, boolean, text, numeric) to authenticated;

-- Supports the view's grouping and the function's self-join.
create index if not exists card_market_sales_basis_identity_idx
  on public.card_market_sales (identity_id, price_basis, is_graded, grader, grade)
  where price_basis = 'all_in';

create index if not exists card_identities_set_year_idx
  on public.card_identities (set_name, year);

-- ── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.card_parallel_ratio(text, int, text, text, boolean, text, numeric);
-- drop view if exists public.card_identity_medians;
-- drop index if exists public.card_market_sales_basis_identity_idx;
-- drop index if exists public.card_identities_set_year_idx;

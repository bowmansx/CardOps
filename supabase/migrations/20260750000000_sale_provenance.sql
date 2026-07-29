-- ══════════════════════════════════════════════════════════════════════════
-- WRONG-DATABASE GUARD. Runs first, changes nothing, refuses everything after
-- it if this is not CardOps.
--
-- On 2026-07-28 a whole evening of diagnostics ran against the OLD SHARED
-- Master-Ops project (wjcalfuwqantwhizkdks) instead of CardOps
-- (zgkydwvmdnnrxcacegth), because the Supabase URL autocompleted to whichever
-- project was typed first. Seven migrations looked like they had vanished. One
-- stray column got added to the wrong database.
--
-- card_identities exists ONLY in CardOps - it was created after the split - so
-- its absence is a reliable "you are in the wrong place".
-- ══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.card_identities') is null then
    raise exception using
      errcode = '42P01',
      message = 'WRONG DATABASE - this is a CardOps migration',
      detail  = 'public.card_identities is missing, so this is almost certainly the old shared Master-Ops project (wjcalfuwqantwhizkdks). Nothing has been changed.',
      hint    = 'CardOps is https://supabase.com/dashboard/project/zgkydwvmdnnrxcacegth/sql/new';
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- WHERE A SALE CAME FROM, AND WHAT ITS PRICE MEANS (2026-07-29)
--
-- Beau: "if we can't get good sales data and determine accurate prices of
--        scanned in cards and show where that data came from then i don't know
--        what good we are"
--
-- Four columns, each closing a hole that is cheap now and expensive later.
--
-- 1. PROVENANCE - which lane a row arrived through.
--    A vendor row pulled from an API, a user's own settled marketplace order,
--    a file the user uploaded, and a figure typed by hand are four different
--    things legally and four different things in terms of trust, and today
--    they are indistinguishable. This matters most for the pooling question:
--    eBay's API licence forbids blending users' order data into a comp shown
--    to another user, and it anticipates the consent argument by name -
--    "Notwithstanding Your Users' access to and use of their own
--    information...". Its own carve-out is the other half: "eBay Content does
--    not include information that you lawfully obtain independent of eBay."
--    A boundary that decides that question cannot live in a query, because a
--    query gets rewritten by someone who does not know it was load-bearing.
--
-- 2. ADDED_BY - who contributed the row.
--    `GO-LIVE.md` already flags this: card_id is nullable ON DELETE SET NULL,
--    so deleting a card severs the only link back to who contributed a sale.
--    One bad paste or wash sale reaches every owner of that identity and can
--    become PERMANENTLY UN-ATTRIBUTABLE. Cheapest to fix while the only
--    contributor is Beau.
--
-- 3. PRICE_BASIS - what the number includes.
--    The Card API's own field reference: "For eBay: all-in buyer price. For
--    Goldin: hammer price only - buyer also pays ~22% buyer's premium on top."
--    Nothing accounted for it, so a Goldin hammer price and an all-in eBay
--    price were medianed as though they were the same figure. Stored per row
--    because the platform's convention can change and history must keep
--    meaning what it meant when it was written.
--
-- 4. FETCHED_AT - when we learned it.
--    A provenance chip that cannot say "fetched 2 hours ago" is not provenance.
--    Distinct from sold_at: one is when the card sold, the other is when we
--    found out.
--
-- Nothing is backfilled with a guess. Existing rows get provenance 'vendor'
-- (true - every row to date came from the price-refresh cron) and price_basis
-- 'unknown' (also true - we did not record it, and pretending otherwise would
-- put a fabricated basis on real money).
-- ══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_type where typname = 'card_sale_provenance') then
    create type card_sale_provenance as enum (
      'vendor',       -- pulled from a paid data API under its licence
      'own_sale',     -- this user's own settled marketplace order (their OAuth)
      'user_upload',  -- a file the user exported themselves and gave us
      'manual_paste'  -- typed or pasted by hand
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'card_price_basis') then
    create type card_price_basis as enum (
      'all_in',   -- what the buyer actually paid
      'hammer',   -- auction close, buyer's premium NOT included
      'unknown'   -- not recorded; excluded from any median rather than guessed
    );
  end if;
end $$;

alter table public.card_market_sales
  add column if not exists provenance  card_sale_provenance not null default 'vendor',
  add column if not exists added_by    uuid references auth.users(id) on delete set null,
  add column if not exists price_basis card_price_basis     not null default 'unknown',
  add column if not exists fetched_at  timestamptz          not null default now(),
  -- Graded-vs-raw as recorded AT FETCH TIME, from the query we actually made.
  -- The vendor populates `grader` on only ~12% of records, so absence of a
  -- grader is mostly "not extracted" rather than "ungraded" - deriving raw-ness
  -- from it counts graded sales as raw comps and inflates ungraded values.
  -- NULL means genuinely unknown, which is the honest state for every row that
  -- predates this column.
  add column if not exists is_graded   boolean;

comment on column public.card_market_sales.provenance is
  'Which lane this row arrived through. A cross-tenant pool may only ever draw on lanes whose licence permits it; see the CHECK below.';
comment on column public.card_market_sales.price_basis is
  'What `price` includes. hammer rows carry a buyer''s premium that is NOT in the number; unknown rows are excluded from medians rather than guessed at.';
comment on column public.card_market_sales.added_by is
  'Who contributed the row, so a poisoned sale is always traceable even after the originating card is deleted.';

-- ══════════════════════════════════════════════════════════════════════════
-- THE STRUCTURAL BOUNDARY
--
-- A vendor row is licensed to us, not sublicensed by us: it may be cached and
-- shown inside this product, and it may NOT be attributed to a user as though
-- that user had contributed it. An own_sale row is the reverse - it always has
-- a contributor, because it came from one person's marketplace account.
--
-- Written as a CHECK rather than as application logic on purpose. The whole
-- point of this column is to answer a question with money and a licence behind
-- it, and the answer has to survive a developer who has never read this file.
-- ══════════════════════════════════════════════════════════════════════════
alter table public.card_market_sales
  drop constraint if exists card_market_sales_provenance_attribution;
alter table public.card_market_sales
  add constraint card_market_sales_provenance_attribution check (
    case provenance
      when 'vendor'   then added_by is null
      when 'own_sale' then added_by is not null
      else true            -- uploads and pastes may be either, per how they arrive
    end
  );

-- Finding every row from one source is not housekeeping - it is a contractual
-- obligation. The Card API §5: "Upon cancellation or termination of your
-- subscription, all locally stored records must be deleted within 30 days."
-- An obligation nobody can execute is an obligation nobody meets.
create index if not exists card_market_sales_source_idx
  on public.card_market_sales (source, fetched_at desc);

-- The pool read path: "every poolable sale for this identity".
create index if not exists card_market_sales_identity_provenance_idx
  on public.card_market_sales (identity_id, provenance, sold_at desc);

-- ══════════════════════════════════════════════════════════════════════════
-- THE COLD TIER
--
-- Storage arithmetic forces this. eBay did $2.32B in card singles in H1 2026;
-- at a $25-30 average that is on the order of 400-500K card transactions a day
-- from eBay alone. The Card API's Pro plan permits 25,000,000 stored records -
-- roughly 50-60 days of that firehose. Individual sales CANNOT be kept forever,
-- and any design that assumes they can breaks in the second month.
--
-- So: individual sales stay hot for a recent window and are compacted into
-- per-identity/per-grade/per-week rollups, which are orders of magnitude
-- smaller and are what a price graph and a valuation actually consume.
--
-- THE ROLLUP CARRIES ITS PROVENANCE. "Median of 41 PSA 9 sales, week of 12 May,
-- The Card API" survives compaction intact - only the tap-through to the
-- individual listings degrades, and that is a labelled loss rather than a
-- silent one. A rollup that dropped its provenance would defeat the entire
-- reason this migration exists.
--
-- Derived analytics are ours under §4a ("fair value estimates, price indexes,
-- premium/discount models... these are your intellectual property"), which is
-- why a rollup is a different kind of object from a stored transaction record.
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.card_market_rollups (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references public.card_identities(id) on delete cascade,
  -- The bucket. period_start is the Monday of the ISO week.
  period_start date not null,
  period       text not null default 'week' check (period in ('week', 'month')),
  -- Condition, matching how a quote is drawn. NULL grader = raw/ungraded.
  grader       text,
  grade        numeric(4,1),

  -- Every figure is all-in. Rows whose basis could not be established are
  -- counted in `excluded_unknown_basis` and are NOT in the statistics - a
  -- rollup computed from part of the data must say so (rules 4 and 10).
  n            integer not null check (n > 0),
  median_price numeric(12,2) not null check (median_price > 0),
  min_price    numeric(12,2) not null check (min_price > 0),
  max_price    numeric(12,2) not null check (max_price > 0),
  first_sold   date not null,
  last_sold    date not null,
  excluded_unknown_basis integer not null default 0 check (excluded_unknown_basis >= 0),

  -- Provenance, preserved through compaction.
  sources      text[] not null default '{}',
  platforms    text[] not null default '{}',
  provenances  card_sale_provenance[] not null default '{}',
  computed_at  timestamptz not null default now(),

  constraint card_market_rollups_price_order check (min_price <= median_price and median_price <= max_price),
  constraint card_market_rollups_date_order  check (first_sold <= last_sold),
  unique (identity_id, period, period_start, grader, grade)
);

comment on table public.card_market_rollups is
  'Compacted sale statistics per identity/grade/period. Individual sales age out under vendor storage caps; these do not. Carries provenance so a compacted price is still defensible.';

create index if not exists card_market_rollups_identity_idx
  on public.card_market_rollups (identity_id, grader, grade, period_start desc);

-- ══════════════════════════════════════════════════════════════════════════
-- RLS
--
-- Market data is SHARED, deliberately. Beau, 2026-07-29: "if someone has a sale
-- of a card, i want that information to be public and used all over." Rollups
-- hang off the identity - the canonical catalogue - exactly as card_market_sales
-- does, so every owner of a card inherits one accumulated history.
--
-- Read is open to any authenticated app user; WRITES ARE SERVICE-ROLE ONLY.
-- There is no user-facing policy to insert or update a rollup, because a rollup
-- is computed, never asserted. Note that service-role code bypasses RLS
-- entirely, so the compaction job must scope its own work explicitly - the
-- first of the two recurring bug classes in `reference/audit-2026-07-24.md`.
-- ══════════════════════════════════════════════════════════════════════════
alter table public.card_market_rollups enable row level security;

-- Mirrors card_market_sales_read exactly (20260738), including the deliberate
-- absence of any INSERT/UPDATE/DELETE policy — an authenticated caller must not
-- be able to inject figures that price every other owner's copy.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_market_rollups' and policyname='card_market_rollups_read') then
    create policy card_market_rollups_read on public.card_market_rollups
      for select to authenticated using (public.has_card_access());
  end if;
end $$;

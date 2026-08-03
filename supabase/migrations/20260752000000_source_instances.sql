-- ══════════════════════════════════════════════════════════════════════════
-- WRONG-DATABASE GUARD. Runs first, changes nothing, refuses everything after
-- it if this is not CardOps.
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
-- BRING YOUR OWN SOURCES (2026-07-30)
--
-- Beau: "i want this to not be very specific to any certain api or sales data
--        collector... a user will be able to more specifically dial in what data
--        sources they want to use... them customizing piecing in their data
--        sources/apis additional to whatever we can provide while we also
--        furnish everything else to do around that data."
--
-- This dissolves the wall two days of research kept hitting. Every licence that
-- blocked us — PriceCharting "internal use only", Card Hedge's silence on
-- redistribution — blocks US REDISTRIBUTING TO A USER. None of them blocks a
-- USER USING THEIR OWN SUBSCRIPTION. Move the credential and the same data
-- becomes reachable.
--
-- THE CONSEQUENCE, AND IT INVERTS SOMETHING ALREADY BUILT.
--
-- `card_market_sales` is shared cross-tenant by design: keyed on identity, read
-- policy `has_card_access()` with no owner scoping, so twenty owners of a card
-- share one accumulated history and one vendor fetch. That is correct for data
-- fetched under CARDOPS' OWN licence — The Card API §4a permits storing "to
-- serve your users", plural.
--
-- It is exactly wrong for data fetched under a USER'S credential. Showing user
-- B a row that user A's PriceCharting key retrieved is the redistribution their
-- licence forbids, and it would be CardOps doing it.
--
-- So POOLABILITY IS NOT A PROPERTY OF A SOURCE. It is a property of (source,
-- whose credential paid for the call). The same adapter is poolable on the
-- platform's key and private on a user's. `rights.pool` in code could never
-- express that, because it had no idea whose key was used.
--
-- AND A LIVE INCONSISTENCY THIS FIXES. `rights.pool` is already declared false
-- on several sources, and nothing enforced it: the read policy shares every row
-- with every user regardless. A rule declared in code and not enforced at the
-- read layer is not a rule. `private_to` makes the database the enforcer.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Who may see a sale row ────────────────────────────────────────────────
--
-- NULL  = shared. Fetched under CardOps' own licence from a source whose terms
--         permit serving it to our users.
-- SET   = private to that user. Fetched under their credential, or from a
--         source whose poolability is unresolved.
--
-- Nullable and defaulting to NULL so existing rows keep the visibility they
-- have today. Retroactively hiding history people can already see would be a
-- silent data loss dressed as a security fix; the write path decides going
-- forward, and the backfill asserts nothing it cannot support.
alter table public.card_market_sales
  add column if not exists private_to uuid references auth.users(id) on delete cascade;

comment on column public.card_market_sales.private_to is
  'NULL = shared across tenants (fetched under CardOps'' own licence, terms permit). Set = visible only to this user, because the fetch used THEIR credential and re-displaying it to anyone else would be redistribution.';

-- The read path: every shared row, plus your own private ones.
create index if not exists card_market_sales_private_idx
  on public.card_market_sales (private_to, identity_id) where private_to is not null;

-- ── RLS: the database enforces poolability, not a comment ─────────────────
do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='card_market_sales' and policyname='card_market_sales_read') then
    drop policy card_market_sales_read on public.card_market_sales;
  end if;
  create policy card_market_sales_read on public.card_market_sales
    for select to authenticated
    using (
      public.has_card_access()
      and (private_to is null or private_to = auth.uid())
    );
end $$;
-- Still no INSERT/UPDATE/DELETE policy. Writes go through the service client,
-- which BYPASSES RLS — so the write path must set `private_to` itself and a
-- test has to prove it does. See `reference/audit-2026-07-24.md`, bug class 1.

-- ── The user's own configured sources ─────────────────────────────────────
--
-- One row per source a user has switched on. The platform's own sources are NOT
-- rows here — they are the adapters in code, available to everyone, and their
-- credentials live in environment variables.
create table if not exists public.card_source_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which adapter this configures, e.g. 'pricecharting', 'thecardapi'.
  source_type text not null,
  label text,
  enabled boolean not null default true,

  -- CREDENTIALS ARE NOT STORED HERE IN PLAINTEXT.
  --
  -- `credential_ref` names a secret held outside this table; `credential_hint`
  -- is the last four characters, for a UI that has to show WHICH key is
  -- configured without being able to show the key. A vendor key in a jsonb
  -- column is one SELECT away from a support screenshot, a log line, or a
  -- backup — and it is the user's account, not ours, that gets drained.
  credential_ref text,
  credential_hint text,

  -- Per-source options: tier, lookback, category filters, rate caps.
  config jsonb not null default '{}'::jsonb,

  -- Health, so the app can flag a source that has rotted rather than silently
  -- returning nothing. APIs decay fast — PSA cut its public API to roughly one
  -- call a day in mid-2026.
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  calls_today integer not null default 0,
  calls_reset_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type)
);

comment on table public.card_source_configs is
  'A user''s own data sources. Data fetched through one of these is PRIVATE to that user (card_market_sales.private_to), because the licence is theirs and re-displaying it to another tenant would be redistribution.';

alter table public.card_source_configs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_source_configs' and policyname='card_source_configs_own') then
    -- Both halves matter: has_card_access() is the app-entry gate, user_id is
    -- the row scope. `has_card_access()` alone would let any card user read
    -- every other user's vendor configuration.
    create policy card_source_configs_own on public.card_source_configs
      for all to authenticated
      using (public.has_card_access() and user_id = auth.uid())
      with check (public.has_card_access() and user_id = auth.uid());
  end if;
end $$;

-- ── The source registry: what exists, and what it is allowed to do ────────
--
-- Data rather than prose, so the app can monitor its own sources and flag
-- decay. Platform-wide, readable by any card user, writable only by the
-- service role — a user must not be able to edit the recorded legal basis of a
-- source and thereby widen what the app will do with its data.
create table if not exists public.card_data_sources (
  source_type text primary key,
  display_name text not null,
  status text not null default 'available'
    check (status in ('available', 'degraded', 'retired', 'planned')),
  auth_type text not null default 'none'
    check (auth_type in ('none', 'api_key', 'oauth', 'paste', 'own_book')),

  -- What the terms permit. Mirrors `SourceRights` in code; the code is still
  -- the enforcer, this is what the UI explains to a user deciding whether to
  -- switch a source on.
  returns_comps boolean not null default false,
  returns_aggregate_only boolean not null default false,
  captures_best_offer boolean not null default false,
  may_persist boolean not null default false,
  may_redisplay boolean not null default false,
  -- Poolable ONLY when the platform holds the credential. Under a user's own
  -- key this is false whatever the source says, and the write path enforces it.
  may_pool_on_platform_credential boolean not null default false,

  legal_basis text not null default 'unverified'
    check (legal_basis in ('licensed_api', 'user_credential', 'own_records', 'public_web', 'tos_risk', 'unverified')),
  legal_note text,

  cost_model text,
  rate_limit text,
  coverage_notes text,
  -- APIs rot. A source nobody has re-read in a year is a liability, not an asset.
  last_verified_at date,
  created_at timestamptz not null default now()
);

alter table public.card_data_sources enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='card_data_sources' and policyname='card_data_sources_read') then
    create policy card_data_sources_read on public.card_data_sources
      for select to authenticated using (public.has_card_access());
  end if;
end $$;

-- Seeded from what has actually been READ, with the date it was read. Anything
-- unverified says so rather than guessing — an unread licence recorded as
-- permissive is worse than no row at all.
insert into public.card_data_sources
  (source_type, display_name, status, auth_type, returns_comps, returns_aggregate_only,
   captures_best_offer, may_persist, may_redisplay, may_pool_on_platform_credential,
   legal_basis, legal_note, cost_model, rate_limit, coverage_notes, last_verified_at)
values
  ('thecardapi', 'The Card API', 'available', 'api_key', true, false, true, true, true, true,
   'licensed_api',
   '§4a permits "Caching and storing API responses locally in your own database to serve your users" and "Displaying card prices, transaction history, and market data within your own product interface". Storage caps per tier; 30-day delete on cancellation (§5).',
   'Free (3d lookback) / $9 (14d) / $49 (30d) / $199 (90d); +$99 unlimited lookback',
   '5k-200k rows/day by tier; 1000 rows/request',
   'Sports + TCG realized sales across eBay, Goldin, Lelands, SCP, Hakes, REA, TCGplayer. grader/grade ~12% populated. best_offer price is the true negotiated figure.',
   '2026-07-29'),

  ('pricecharting', 'PriceCharting', 'available', 'api_key', false, true, false, false, false, false,
   'user_credential',
   'VERIFIED 2026-07-29: "Price Data cannot be used in any software, application, or system that is accessible to third parties... without express written permission." Internal business use requires a LEGENDARY subscription. Permission contact brady@vgpc.com. Usable ONLY on the user''s own credential, for that user alone.',
   'Subscription tiers; Legendary required for internal business use',
   '1 call/second, account revocation threatened for overrun',
   'Guide values across 9 grade points, no sales history at any tier. sales-volume field is a liquidity signal.',
   '2026-07-29'),

  ('scryfall', 'Scryfall', 'available', 'none', false, true, false, false, true, false,
   'licensed_api',
   'Free and unrestricted for this use. Their data may NOT sit behind the credit meter — catalogue lookups stay free even when other things are metered.',
   'Free', 'Light use requested, descriptive User-Agent',
   'MTG only. Current values, no sales history.',
   '2026-07-29'),

  ('paste-ebay',     'eBay sold search (paste)',      'available', 'paste', true, false, true, true, true, false, 'own_records', 'The user''s own transcription of a public sale. Poolability unresolved pending the eBay written-permission question.', 'Free', 'None', 'Whatever the user pastes.', '2026-07-29'),
  ('paste-terapeak', 'Terapeak / Seller Hub (paste)', 'available', 'paste', true, false, true, true, true, false, 'own_records', 'As above. Terapeak requires Seller Hub, which is a free opt-in.', 'Free', 'None', 'Accepted Best Offers show their real negotiated price.', '2026-07-29'),
  ('paste-130point', '130point (paste)',              'available', 'paste', true, false, true, true, true, false, 'own_records', 'As above.', 'Free', 'None', 'Surfaces accepted Best Offers a plain sold search hides.', '2026-07-29'),
  ('paste-auction',  'Auction prices realized (paste)','available', 'paste', true, false, false, true, true, false, 'own_records', 'As above. Hammer prices — the buyer''s premium is on top.', 'Free', 'None', 'Vintage and high-end, where eBay comps are worst.', '2026-07-29'),
  ('paste-manual',   'Typed by hand',                 'available', 'paste', true, false, false, true, true, false, 'own_records', 'The user''s own record.', 'Free', 'None', 'Anything.', '2026-07-29'),

  -- Planned, and recorded now so the registry is the plan rather than a
  -- separate document that drifts from it.
  ('own-book', 'Your own completed sales', 'planned', 'own_book', true, false, true, true, true, false,
   'own_records',
   'A seller recording their own transaction — the same act as writing it in a ledger. eBay''s contract lever bites on eBay Content, meaning data retrieved from eBay, not a number a user typed into their own books. Judgement: this is an ABSENCE OF PROHIBITION, not a grant. Pooling it needs the k-anonymity floor and explicit opt-in consent before may_pool is ever set true.',
   'Free', 'None', 'Highest trust available. Compounds with use.', '2026-07-30'),

  ('justtcg', 'JustTCG', 'planned', 'api_key', false, true, false, true, true, true,
   'unverified',
   'Terms reportedly permit caching server-side and displaying trends to end users within your own application. NOT independently verified, and "your own application" is load-bearing for a multi-tenant SaaS — confirm in writing before relying on it. Reported as not pure realized sales.',
   'Free 1k/mo / $19 (10k) / $49 (50k)', 'By tier',
   '18 TCG games. NO sports.', null),

  ('pokepricetracker', 'PokePriceTracker', 'planned', 'api_key', true, false, false, true, true, true,
   'unverified',
   'Reportedly permits storing and serving to end users on the Business tier, with daily bulk CSV. NOT independently verified; their pricing page and §6 reportedly disagree about which tier carries commercial use. Resolve in writing first.',
   'Free / $9.99 / $99 Business / $300 Enterprise', 'By tier',
   'Pokémon only. PSA 8/9/10 sales + pop reports, 12+ months.', null)
on conflict (source_type) do update set
  display_name = excluded.display_name,
  status = excluded.status,
  may_persist = excluded.may_persist,
  may_redisplay = excluded.may_redisplay,
  may_pool_on_platform_credential = excluded.may_pool_on_platform_credential,
  legal_basis = excluded.legal_basis,
  legal_note = excluded.legal_note,
  last_verified_at = excluded.last_verified_at;

# Wave C — Org / Workspace Tenancy Model

**Status: DESIGN ONLY. Build last. Nothing here is implemented.**
Written 2026-07-25 against the repo at `b0fbeef`.

---

## 0. Why this is a tenancy change, not a role flag

The original spec described Berlin Mode in three bullets — a restricted role
that can intake, pick, pack, ship and correct, but can't price, reclass or
delete. That reads like adding a value to an enum.

It isn't, because of what the current model actually is:

> **Today, every user owns a separate, isolated inventory.**
> `cards` is scoped by `user_id`. `has_card_access()` returns true for anyone
> with role `owner` or `card_ops`, and the row-level scoping on top of it is
> per-user. Two `card_ops` users are two businesses that never see each other.

Berlin needs the opposite: **two people acting on one inventory, with
different powers.** There is no way to express "her cards" and "his cards are
the same cards" in the current schema, because ownership *is* the boundary.

That is a tenancy model change, and it touches **51 RLS policies across 38
tables** (enumerated in §4). It is the same category of retrofit cost as the
card identity layer: cheap now while the tables are empty, expensive once
multiple real accounts hold real rows.

**Recommendation stands: design now, build last.** But design now — because
every table added between today and then either does or doesn't carry an
`org_id`, and adding it retroactively to twenty more tables is the expensive
version.

---

## 1. The model

### 1.1 Concepts

```
  organization         the tenant. owns inventory, books, settings, billing.
    └─ membership      (user, org, role) — a user may belong to several orgs
         └─ role       owner | manager | operator | viewer
```

- **`user_id` stops being the tenancy boundary.** `org_id` becomes it.
- A solo user is an org of one. **This is the important property**: the
  migration path is "give every existing user a personal org and stamp their
  rows with it", after which nothing about their experience changes.
- Roles are **per-membership**, not per-user. Beau is `owner` of his own org;
  Berlin is `operator` in it and could be `owner` of her own.

### 1.2 Roles and what they mean

| Role | Intake | Correct IDs | Price | Sell / ship | tax_bucket / lot | Delete | Investor-bucket records | Books / connectors |
|---|---|---|---|---|---|---|---|---|
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `manager` | ✓ | ✓ | ✓ up to threshold | ✓ | ✗ | ✗ | read | ✗ |
| `operator` (Berlin) | ✓ | ✓ | ✗ | ✓ pick/pack/ship | ✗ | ✗ | **invisible** | ✗ |
| `viewer` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | read | ✗ |

Two deliberate choices:

1. **Investor-bucket records are invisible to `operator`, not merely
   read-only.** A $1M asset's existence, location and custody chain is not
   operational information for a packing shift. Hiding beats restricting.
2. **`operator` cannot set price at all**, rather than "up to a threshold."
   Thresholds are for `manager`. Berlin's job is volume; pricing authority is
   the thing being protected.

### 1.3 Approval queue — one mechanism, two consumers

The spec's C2 is right that this should share a mechanism with the assistant
gate. The generalised shape:

```
pending_actions
  id, org_id, requested_by, action_type, target_table, target_id,
  payload jsonb, reason text,
  status ('pending','approved','rejected','expired'),
  decided_by, decided_at, decided_reason,
  created_at
```

Anything a role can't do directly, it *requests*. The approver sees a queue.
Approval executes the write **server-side under the approver's authority** —
never by relaxing the requester's RLS, which is the mistake that turns an
approval queue into a privilege-escalation path.

---

## 2. Wireframes

### 2.1 Operator home (Berlin, phone)

```
┌──────────────────────────────────┐
│  Bowman Cards            Berlin  │
│  ────────────────────────────    │
│                                   │
│   TODAY                           │
│   ┌────────────┐ ┌────────────┐  │
│   │  INTAKE    │ │   PICK     │  │
│   │            │ │            │  │
│   │  box 3 of 7│ │  4 orders  │  │
│   └────────────┘ └────────────┘  │
│   ┌────────────┐ ┌────────────┐  │
│   │  DOUBT     │ │  SHIP      │  │
│   │  12 to fix │ │  2 packed  │  │
│   └────────────┘ └────────────┘  │
│                                   │
│   ⓘ 3 requests awaiting Beau      │
│                                   │
└──────────────────────────────────┘
```

No inventory value anywhere. No portfolio, no P&L, no investor assets. The
operator surface is a **work surface**.

### 2.2 Pick ticket (C3)

```
┌ PICK · order #1043 ────────────────┐
│                                     │
│   ZONE  GR      ← walk here first  │
│   BOX   GR-014                      │
│   POS   37                          │
│                                     │
│   2020 Prizm #325                   │
│   Justin Herbert  Silver            │
│   PSA 10 · cert 8837211             │
│                                     │
│   [ photo ]                         │
│                                     │
│   ✓ Found     ✗ Not there           │
└─────────────────────────────────────┘
```

Sorted by **zone → box → position** so a multi-item pick is one walk, not
several. "Not there" is a first-class outcome — it opens a discrepancy, which
is exactly the signal that location data has drifted.

### 2.3 Approval queue (Beau)

```
┌ Awaiting your approval (3) ────────────────────────────────┐
│  Berlin · 2h ago                                            │
│  Set price $340 on 1998 Jeter auto   (limit $200)          │
│  Reason: "comp sold $355 yesterday, ours is cleaner"        │
│                     [ Approve ]  [ Reject ]  [ Ask ]        │
│  ──────────────────────────────────────────────────────    │
│  Berlin · yesterday                                         │
│  Correct identification: 2021→2020 on 14 cards              │
│                     [ Approve ]  [ Reject ]  [ Ask ]        │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Data model deltas

```
organizations
  id uuid pk, name text, slug text unique,
  personal boolean not null default false,   -- an org of one
  created_at

org_memberships
  org_id uuid, user_id uuid, primary key (org_id, user_id)
  role text check in ('owner','manager','operator','viewer')
  price_limit numeric(12,2)     -- manager threshold; null = no authority
  invited_by uuid, joined_at timestamptz

pending_actions            -- §1.3
```

Plus, on **every tenant-scoped table**: `org_id uuid not null references
organizations(id)`, indexed, and included in the RLS predicate.

New helper functions, replacing the current pair:

```
current_org()            -- the active org for this request
is_org_member(org uuid)
org_role(org uuid)       -- returns the caller's role in that org
can(org uuid, action text)  -- the single capability oracle
```

**Design rule: policies call `can()`, not role string comparisons.** Scattering
`role in ('owner','manager')` across 51 policies is how a capability change
becomes a 51-file migration and how one of them gets missed.

### 3.1 Active-org selection

A user in multiple orgs needs a current one. Options:

- **JWT claim** (`app_metadata.active_org`) — fastest, RLS reads it directly,
  but requires a token refresh to switch orgs.
- **Session table** — switch is instant, costs a join in every policy.

**Recommendation: JWT claim**, with an explicit "switch workspace" action that
refreshes the token. RLS predicates stay cheap, and cheap predicates matter
when they're evaluated on every row of every query.

---

## 4. RLS blast radius — every policy this touches

**51 policies across 38 tables.** Grouped by the predicate they use today,
because the rewrite differs per group.

### Group A — `has_card_access()` (18 tables)
`card_alerts · card_estimates · card_grade_multipliers · card_group_items ·
card_groups · card_identities · card_lot_items · card_lots · card_market_sales ·
card_news · card_pool · card_pool_adjustments · card_portfolio_snapshots ·
card_pricing_strategies · card_sales · card_source_quotes ·
card_storage_locations · cards`

Rewrite: `has_card_access()` → `is_org_member(org_id)` plus a capability check
where the action is privileged.

> **Exception — `card_identities` must NOT get an `org_id`.** It is the shared
> cross-tenant catalog built in `20260738`; scoping it per-org would undo the
> entire point of the identity layer. It stays readable by any authenticated
> card user and writable only through `resolve_card_identity()`.
> Same reasoning applies to `card_market_sales`: the *sales* are shared market
> facts keyed to identity. **Do not add `org_id` to either.** This is the one
> place where the tenancy sweep must deliberately skip.

### Group B — `is_owner()` (17 tables)
`audit_log · card_grade_multipliers · card_news · card_pricing_strategies ·
card_receipts · card_sales · card_source_quotes · critical_dates ·
ebay_cancelled_orders · ebay_connections · entities · journal_entries ·
push_subscriptions · sent_alerts · service_config · snapshots · todos`

Rewrite: `is_owner()` → `can(org_id, '<capability>')`. Note this group is where
"owner" currently means *the single instance owner*; under orgs it must mean
*owner of THIS org*. Several of these (`service_config`, `entities`,
`critical_dates`) are arguably **instance-level, not org-level** — decide
per-table rather than sweeping. Getting this wrong either leaks one org's
config to another or locks every org out of its own settings.

### Group C — `user_id = auth.uid()` (14 tables)
`card_account_map · card_businesses · card_pool · card_pricing_strategies ·
card_push_log · card_showcases · card_user_prefs · credit_ledger ·
google_connections · purchase_lot_adjustments · purchase_lots ·
push_subscriptions · todos · user_settings`

Rewrite: mostly `org_id = current_org()`. **Two must stay user-scoped:**
`card_user_prefs` and `user_settings` are personal preferences, not org data.
`credit_ledger` is the interesting one — **billing is per-org, not per-user**
(an org buys credits, its members spend them), so it moves to `org_id` and
`credit_spend`/`credit_grant` change signature. Flagging it because it directly
touches the money core built this week.

### Group D — ownership helpers (2)
`owns_card()` on `card_sales`, `owns_pool()` on `card_pool_adjustments` →
re-expressed through org membership.

### Group E — deliberately unchanged
`card_identities`, `card_market_sales` (shared catalog, see Group A note),
`profiles` (identity, not tenancy), and any public showcase policy.

---

## 5. Migration path

Ordered so nothing is ever half-scoped:

1. Create `organizations`, `org_memberships`, helper functions.
2. **Create a personal org per existing user**, membership `owner`.
3. Add nullable `org_id` to every Group A/B/C/D table; backfill from `user_id`.
4. Set `not null` + FK + index once backfilled.
5. Swap policies table-by-table, **verifying each with a harness assertion
   before moving on** — a half-swapped policy set is a data leak between
   tenants, which is the worst possible outcome of this work.
6. Introduce roles beyond `owner`; add `pending_actions` and the approval flow.
7. Only then: the operator UI.

Steps 1–5 are invisible to a solo user. That's the test of whether the design
is right.

---

## 6. What it invalidates

| Area | Impact |
|---|---|
| **Every RLS policy** (51) | Rewritten. The dominant cost. |
| `has_card_access()` / `is_owner()` | Replaced by `is_org_member()` / `can()`. Both are called from app code too (`src/lib/cards/roles.ts`). |
| `credit_ledger`, `credit_spend`, `credit_grant` | Billing becomes org-scoped; signatures change. Built this week — cheap to change now, annoying later. |
| Cron roster queries | `profiles.role in ('owner','card_ops')` becomes a membership query; the price-refresh and estimate crons both do this. |
| Per-user SKU sequence (`20260732`) | Becomes per-org. |
| Showcases | Public-share tokens must resolve to an org, not a user. |
| `card_identities` / `card_market_sales` | **Untouched by design** — the shared layer stays shared. |

---

## 7. Build size (honest)

| Piece | Size |
|---|---|
| Org/membership schema + helpers + active-org claim | 6–8 h |
| RLS rewrite, 38 tables, with per-table harness assertions | **20–30 h** — this is the bulk, and it is careful, unglamorous work |
| Role capabilities + `can()` oracle | 4–6 h |
| `pending_actions` + approval queue UI | 10–14 h |
| Operator UI (home, pick ticket, doubt queue) | 12–16 h |
| Migration + backfill + verification | 6–10 h |
| **Total** | **58–84 h** |

Confidence: **low-to-moderate**, and skewed to the high side. Tenancy
migrations are where "one more table" keeps appearing, and the failure mode
(cross-tenant leakage) demands slower, more verified work than feature code.

### If you only had one weekend

Do **steps 1–4 only**: create the org tables, give every user a personal org,
add `org_id` everywhere and backfill it — but leave every policy exactly as it
is today. That's the retrofit-expensive half, it's invisible to you, and it
means every table added afterwards is born with `org_id`. The policy rewrite
and the operator UI can wait indefinitely without getting more expensive.

---

## 8. Open questions

1. **Is Berlin a member of your org, or a contractor with her own account?**
   Changes whether `operator` is a membership role or a delegation grant.
2. **Which of the Group B tables are instance-level vs org-level?**
   `service_config` in particular — one AI kill-switch for the whole instance,
   or one per org? Affects billing too.
3. **Do credits belong to the org or the user?** I've designed org; confirm,
   because it changes the money core.
4. **Multi-org from day one, or single-org-per-user forever?** If the latter,
   `org_id` is still worth adding, but the active-org claim and switcher
   collapse to nothing and ~10h disappears.

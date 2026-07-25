# Wave B — The Investor-Asset Record

**Status: DESIGN ONLY. Nothing here is built. Awaiting go.**
Written 2026-07-25 against the repo at `b0fbeef`.

---

## 0. What this wave is for

The app today models a card as **dealer inventory moving through a sales
funnel**: acquire → book → list → sell. Every screen, status value and report
assumes that shape.

An investor asset is the opposite. It may never be listed. Its value lives in
**documentation**, not in a comp. The questions it has to answer are not "what
is it worth today" but:

- Can I *prove* my basis to the IRS?
- Can I *prove* the chain of custody to an insurer?
- Where is it right now, and when is it coming back?
- If I sell it, is the gain capital or ordinary — and can I defend that?

The 1952 Topps Mantle in an ASA 8 holder with a ~$1M §1014 stepped-up basis is
the forcing function. If a field it needs doesn't exist, the schema is wrong.

### Spec-vs-repo diff (standing rule)

| Original spec claim | Reality |
|---|---|
| "Fields the current schema lacks: provenance chain" | **Partially exists.** `cards.acquisition_method` already has `('purchased','inherited','partnership_split','trade','pull')` and `acquisition_source`, `acquired_date`. Missing: the *document* that proves it, and who it came from as a party. |
| "tax_bucket (investor \| dealer)" | **Exists on `purchase_lots`** as `('investment','dealer','hobby')`. Corrected per Beau: three values kept (§183 hobby-loss disallowance and §165(c) make `hobby` a real and distinct state), and it is an **inheritance chain**, not a duplicate — see §3. |
| "Class G in VALUATION_ENGINE.md" | **`VALUATION_ENGINE.md` is still not in the repo** as of this writing. §5 below designs the discovery-plan display from first principles and is explicitly **pending reconciliation** with the real class definitions. |
| Grade verification, insurance, custody, legal title | **Genuinely absent.** All new. |
| Asset states (`at_appraisal` … `pledged_as_collateral`) | **Genuinely absent.** Current `cards.status` is a funnel: `intake, review, booked, listed, sold, hold, graded_out, archived`. |

---

## 1. Wireframes

### 1.1 The asset record — top of card detail, investor bucket only

```
┌────────────────────────────────────────────────────────────────┐
│  1952 Topps #311 Mickey Mantle                    ASA 8        │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│   ⓘ NO POINT PRICE — structurally unique, grade unverified     │
│     See Discovery Plan below.                                   │
│                                                                 │
│   BASIS            $1,000,000    §1014 step-up                 │
│                    Appraisal · R. Vasquez ASA · 2024-03-11     │
│                    Estate return reported $1,000,000            │
│                    ⚠ Reported value CAPS basis                 │
│                                                                 │
│   TITLE            Bowman Family Trust        (not: me)         │
│   CUSTODY          PWCC Vault · since 2025-11-02   [chain ▸]   │
│   STATE            ● vaulted                                    │
│   INSURANCE        Scheduled $1,000,000 · Collectibles Ins.    │
│                    Policy CX-88123 · valued 2024-03-11          │
│                    ⚠ Valuation 16 months old — review at 24    │
│                                                                 │
│   [ Documents (7) ]  [ Move / change state ]  [ Reclass bucket ]│
└────────────────────────────────────────────────────────────────┘
```

Design intent: **every number carries its provenance inline.** A basis with no
visible source is exactly the number that fails under examination, so the
source, the author and the date sit on the same line as the figure. The
reported-value cap is a warning, not a footnote — it is the single most
commonly missed rule in stepped-up basis.

### 1.2 Documents tab — the thing the value actually lives in

```
┌ Documents ─────────────────────────────────────────────────────┐
│  ▣ Estate appraisal (§1014)      PDF · 2024-03-11 · 4.2 MB     │
│      proves: BASIS            ✓ verified copy in cold storage  │
│  ▣ Form 706 excerpt, Sch. F     PDF · 2024-06-30 · 1.1 MB      │
│      proves: REPORTED VALUE   ✓ verified copy in cold storage  │
│  ▣ ASA grading cert            IMG · 2019-08-04                │
│      proves: GRADE            ⚠ grader not independently verif.│
│  ▣ Insurance schedule          PDF · 2024-04-01                │
│      proves: INSURED VALUE    ✓                                │
│  ▣ Vault intake receipt        PDF · 2025-11-02                │
│      proves: CUSTODY          ✓                                │
│  ─────────────────────────────────────────────────────────     │
│  Last off-site backup: 2026-07-25 03:14  ✓ 7/7 documents       │
│  [ + Add document ]    [ Download evidence packet (.zip) ]      │
└────────────────────────────────────────────────────────────────┘
```

Every document declares **what it proves**. That single field is what turns a
folder of PDFs into an evidence packet, and it's what lets the app tell you
*"your basis has no supporting document"* instead of silently showing a number.

### 1.3 State + custody move

```
┌ Move this asset ───────────────────────────────────────────────┐
│  Current: ● vaulted at PWCC Vault  (since 2025-11-02)          │
│                                                                 │
│  New state   ( ) at_appraisal                                   │
│              (•) out_for_crossover                              │
│              ( ) at_auction_house_on_consignment                │
│              ( ) vaulted                                        │
│              ( ) pledged_as_collateral                          │
│              ( ) in_my_possession                               │
│                                                                 │
│  Counterparty  [ PSA                        ]                   │
│  Sent          [ 2026-07-25 ]                                   │
│  Expected back [ 2026-10-25 ]   ← aging alert fires at +14d    │
│  Tracking      [ 1Z999AA1012...            ]                    │
│  Declared val. [ $1,000,000 ]                                   │
│  Document      [ + attach shipping receipt ]                    │
│                                                                 │
│  ⚠ Crossover risk: an ASA 8 may not cross at 8. A failed        │
│    crossover changes value materially. Record the minimum        │
│    grade you will accept:  [ 7 ]                                │
│                                                                 │
│              [ Cancel ]        [ Record move ]                  │
└────────────────────────────────────────────────────────────────┘
```

### 1.4 "Assets I cannot sell" — the aging board

```
┌ Out of possession ─────────────────────────────────────────────┐
│  ASSET                 STATE            SINCE    DUE     AGING │
│  1952 Mantle #311      out_for_crossover 07-25   10-25    ok   │
│  1986 Jordan RC        at_appraisal      04-02   05-02  ⚠ 84d  │
│  1998 Jeter auto       consignment       01-15   —      ⚠ no   │
│                                                          due   │
│  ──────────────────────────────────────────────────────────    │
│  3 assets · $1,340,000 scheduled value out of your hands        │
└────────────────────────────────────────────────────────────────┘
```

The spec's phrase — *"assets I cannot find and cannot sell"* — is the whole
point. A consignment with no expected-return date is itself a finding.

---

## 2. Data model deltas

### 2.1 New: `card_asset_records` (1:1 with an investor-bucket card)

Kept as a **separate table**, not columns on `cards`, for three reasons: it is
sparse (a handful of rows out of thousands), it is the only place documents and
custody matter, and `cards` is already wide and hot on every list query.

```
card_asset_records
  card_id            uuid pk references cards(id) on delete restrict
                     -- RESTRICT, not cascade: you may not delete a card that
                     -- carries a $1M evidence trail. Archive it instead.
  -- provenance
  acquired_from      text            -- the party, not the channel
  acquired_relation  text            -- 'estate of', 'dealer', 'private party'
  -- basis provenance
  basis_amount       numeric(14,2)
  basis_source       text check in ('purchase_receipt','1014_step_up',
                                    '1015_carryover','1022_modified','other')
  basis_doc_id       uuid references card_documents(id)
  appraisal_author   text
  appraisal_credential text          -- 'ASA', 'ISA AM', 'USPAP compliant'
  appraisal_date     date
  estate_reported_value numeric(14,2)
  reported_value_caps_basis boolean not null default false
  -- grade verification
  grade_verification text check in ('verified','unverified_grader',
                                    'pending_crossover','crossover_failed')
  crossover_target_grader text
  crossover_min_grade numeric(4,1)
  -- insurance
  insured_value      numeric(14,2)
  insurer            text
  policy_ref         text
  insurance_valued_at date
  -- title, separate from custody
  legal_title_holder text check in ('individual','trust','estate','joint','entity')
  legal_title_detail text
  created_at, updated_at
```

**Why `basis_source` is an enum and not free text:** it drives a different
substantiation requirement per value, and §1014 vs §1015 is the difference
between a stepped-up basis and a carryover basis — a several-hundred-thousand
dollar distinction on this card.

### 2.2 New: `card_documents`

```
card_documents
  id            uuid pk
  card_id       uuid not null references cards(id) on delete restrict
  user_id       uuid not null                      -- RLS scope
  proves        text not null check in ('basis','reported_value','grade',
                                        'insured_value','custody','title',
                                        'provenance','other')
  kind          text          -- 'appraisal','form_706','cert','receipt','policy'
  bucket        text not null default 'receipts'   -- existing private bucket
  path          text not null
  doc_date      date
  bytes         bigint
  sha256        text          -- integrity: proves the file didn't change
  backup_state  text not null default 'pending'
                check in ('pending','backed_up','failed')
  backed_up_at  timestamptz
  created_at    timestamptz not null default now()
```

`sha256` matters more than it looks: an evidence packet whose contents can't be
shown to be unaltered is weaker evidence. It also makes the backup verifiable
(§6) rather than assumed.

### 2.3 New: `card_custody_log` (append-only)

```
card_custody_log
  id             bigint identity pk
  card_id        uuid not null references cards(id) on delete restrict
  user_id        uuid not null
  from_state     text
  to_state       text not null      -- see §4 state machine
  counterparty   text
  location       text
  sent_at        timestamptz not null
  expected_back  date
  returned_at    timestamptz
  tracking_ref   text
  declared_value numeric(14,2)
  document_id    uuid references card_documents(id)
  note           text
  created_at     timestamptz not null default now()
```

Append-only, same discipline as `purchase_lot_adjustments`: **no UPDATE, no
DELETE.** A chain of custody you can edit is not a chain of custody.

### 2.4 `cards` — the tax bucket inheritance chain

Per the corrected brief, this is **one authoritative value with a documented
lineage**, never two sources of truth:

```
alter table cards
  add tax_bucket        text check in ('investment','dealer','hobby')
  add tax_bucket_source text check in ('lot_default','explicit_override')
  add tax_bucket_set_at timestamptz
  add tax_bucket_reason text
  add asset_state       text        -- null for ordinary inventory; see §4
```

**Resolution order at creation:** `purchase_lots.tax_bucket` (the lot default,
because a purchase usually has one intent) → written onto the card as the
**resolved authoritative value** with `tax_bucket_source='lot_default'`. The
card is what the Schedule D line is drawn from, because the tax test is
per-property, and one lot legitimately holds two intents (buy 500 to flip 490,
keep 10).

**Reclass is an explicit action**, never an edit: an RPC that writes the new
value, sets `tax_bucket_source='explicit_override'`, requires a non-empty
`tax_bucket_reason`, and appends to `audit_log`. Guarded by a trigger the same
way the sold boundary is — normal `UPDATE` on the column is refused.

> **Posture (now a standing rule in CLAUDE.md):** the app records Beau's
> classification and reason. It never makes the determination. Reports say
> "as classified by you on <date>", and the tax package is evidence for a CPA,
> not a filing position.

### 2.5 What's wrong in the current schema

- `cards.acquisition_source` is a single text field doing double duty as
  *channel* ("eBay") and *party* ("estate of R. Bowman"). Wave D1 wants to
  group sell-through by channel; the asset record wants the party. **Split
  them** — `acquisition_source` stays the channel, `acquired_from` on the
  asset record is the party.
- `cards.status` conflates *sales funnel position* with *physical
  disposition*. A vaulted asset is not `hold`. §4 separates them.
- `card_photos` has `kind check in ('front','back','slab','defect')` — fine for
  cards, wrong for documents. Hence a separate `card_documents` table rather
  than overloading it.

---

## 3. State machine

`asset_state` is **orthogonal to `status`** and null for ordinary inventory.
This is the key modelling decision: a card can be `status='hold'` *and*
`asset_state='out_for_crossover'`; collapsing them loses one of the two facts.

```
                    ┌──────────────────────┐
        ┌──────────▶│  in_my_possession    │◀─────────┐
        │           └──────────┬───────────┘          │
        │                      │                       │
        │        ┌─────────────┼─────────────┬─────────┴────────┐
        │        ▼             ▼             ▼                  │
        │  ┌───────────┐ ┌───────────┐ ┌──────────┐             │
        │  │at_appraisal│ │out_for_   │ │ vaulted  │             │
        │  │            │ │crossover  │ │          │             │
        │  └─────┬──────┘ └─────┬─────┘ └────┬─────┘             │
        │        │              │             │                  │
        │        │              ▼             ▼                  │
        │        │       ┌──────────────┐ ┌──────────────────┐   │
        │        │       │crossover_    │ │pledged_as_       │   │
        │        │       │failed        │ │collateral        │   │
        │        │       └──────┬───────┘ └────────┬─────────┘   │
        │        │              │                  │             │
        │        └──────────────┴──────────────────┘             │
        │                       │                                │
        │           ┌───────────▼────────────────┐               │
        └───────────│ at_auction_house_          │───────────────┘
                    │ on_consignment             │
                    └───────────┬────────────────┘
                                │ (sells)
                                ▼
                           status='sold'
```

**Rules:**

1. Every transition writes a `card_custody_log` row. No exceptions — that log
   *is* the chain of custody.
2. Every state except `in_my_possession` and `vaulted` requires an
   `expected_back` date. Consignment without a return date is a finding
   surfaced on the aging board (§1.4), not a silent gap.
3. **Aging alerts:** warn at `expected_back`, escalate at +14d, and flag
   *"no expected return date"* immediately. Reuses the existing
   `card_alerts` machinery rather than a new notification path.
4. `pledged_as_collateral` **blocks listing and selling** at the RPC layer —
   selling pledged property is the kind of mistake that ends relationships.
   Same enforcement style as the sold boundary: refused in the database, not
   hidden in the UI.
5. `crossover_failed` is a **terminal-ish state requiring an explicit
   decision** (re-submit / accept / sell as-is) — it must not sit silently,
   because a failed crossover usually means the carrying value is now wrong.

---

## 4. B3 — the discovery-plan display

> ⚠ **Pending reconciliation with `VALUATION_ENGINE.md`**, which is not yet in
> the repo. Designed here from the stated principle: *structurally unique or
> unverifiable grade ⇒ no point price.* Class letters and thresholds must be
> re-derived from that document before build.

The rule the app already follows elsewhere — *an honest "no comp at this
grade" beats a wrong-grade price* — extends naturally: **a unique asset gets a
range and a route, never a number.**

```
┌ Discovery plan ────────────────────────────────────────────────┐
│  ⓘ This asset does not receive a point price.                  │
│    Grade is unverified (ASA) and comparable sales are          │
│    structurally scarce. A single number here would be a         │
│    guess wearing a decimal point.                               │
│                                                                 │
│    FLOOR       $   720,000    strongest defensible downside     │
│                               basis: 3 PSA 7 sales, 18mo, −15%  │
│                               unverified-grader haircut         │
│    CEILING     $ 1,450,000    if it crosses PSA 8               │
│                               basis: 2 PSA 8 sales, 11mo        │
│                                                                 │
│    CHANNEL     Major auction house, catalogued sale             │
│                Why: thin bidder pool, provenance is the story,  │
│                     private sale forfeits competitive tension   │
│                                                                 │
│    DEMAND      ▁▂▄▆▆▅  6 comparable sales / 24 months           │
│    SIGNAL      last 2026-02 · $1.07M PSA 8                      │
│                                                                 │
│    NARRATIVE   The value of this card is the documentation.     │
│                A verified §1014 appraisal at $1.0M and a clean  │
│                estate chain make the basis defensible. The      │
│                open question is the holder: crossing to PSA     │
│                converts a discount into a premium, and failing  │
│                to cross costs roughly $200K of the ceiling.     │
│                                                                 │
│    ⚠ Every figure above carries its sample size. 6 sales is a   │
│      thin market; treat the range as a range.                   │
└────────────────────────────────────────────────────────────────┘
```

Design rules:
- **Floor and ceiling always show their derivation** (n, window, adjustment).
  Same discipline as `liquidity.ts`, which already carries sample size into
  every output because *"a tier from 3 comps and a tier from 300 are different
  animals."*
- The **narrative is generated, labelled as generated, and editable.** It's the
  part a human takes to an auction consignment conversation.
- This display **must not** feed `market_value`, portfolio totals, or the
  movers list as a point number. It contributes a *range*, and totals that
  include ranged assets must say so — otherwise a $1M guess silently becomes a
  reported net worth.

---

## 5. DR / backup — prerequisite for B4, not a nice-to-have

If the value of the asset lives in the documentation, **losing the
documentation is the catastrophic failure**, and it is currently undesigned.
Today the receipts bucket is a single private Supabase bucket in one project,
with no export, no verification, and no second copy.

Minimum viable, and the gate on putting the Mantle in as record #1:

1. **Nightly off-site replication** of every `card_documents` object to a
   second provider (Cloudflare R2 is already a configured service key in
   `service_config`; a personal Drive/S3 is equally fine). Write result to
   `backup_state` / `backed_up_at` per document — **checked and surfaced, never
   fire-and-forget** (prevention rule 1).
2. **Verify by hash, not by existence.** Re-read the object, compare `sha256`.
   A backup that exists but is truncated is worse than no backup, because it
   buys false confidence.
3. **A visible freshness line** on the Documents tab: *"Last off-site backup:
   <ts> ✓ 7/7 documents."* Any failure or staleness > 48h renders as a warning,
   in keeping with rule 4 — evidence status renders complete or flagged.
4. **One-click evidence packet export** (`.zip` of documents + a manifest CSV
   with hashes, dates, and what each proves). This is simultaneously the DR
   story, the insurance submission, and the CPA hand-off — one mechanism, three
   consumers.
5. **`on delete restrict`** on documents and asset records, so no ordinary
   delete path can take the evidence with it.

**Recommended posture before B4:** land items 1–4, then enter the Mantle. The
schema work and the backup work are the same week; the record should not
precede the safety net.

---

## 6. What this invalidates in existing code

| Area | Impact |
|---|---|
| `cards.status` consumers (lists, filters, movers, reports) | **Additive only** — `asset_state` is a new orthogonal column, null for inventory. Existing filters keep working. |
| Portfolio / net-worth totals | **Must change.** A ranged asset has no point value. Totals need a "+ N ranged assets" disclosure rather than silently summing a floor or a midpoint. |
| `card_sell` / `card_lot_sell` RPCs | **Guard addition** — refuse when `asset_state='pledged_as_collateral'`. |
| Basis architecture (`purchase_lot_id` / `individual_basis`) | **Unchanged and reused.** A $1M step-up is just an `individual_basis` with an unusually good paper trail; the two-source rule (lot average XOR individual basis) still holds. |
| CSV import/export column map | Needs the new tax-bucket columns; `acquisition_source` semantics narrow to *channel*. |
| Delete paths for cards | `on delete restrict` will now refuse deletion of a documented asset — needs a clear UI message pointing at archive. |

---

## 7. Build size (honest)

Estimates assume the existing patterns are reused (guarded RPC + append-only
log + `card_alerts`), and exclude the Mantle's document gathering, which is
Beau's phone calls and not on the software critical path.

| Piece | Size | Notes |
|---|---|---|
| Schema + RLS + guards + harness assertions | **6–9 h** | 4 tables/alters, 2 guarded RPCs, ~6 new harness assertions |
| Asset record UI (§1.1) + documents tab (§1.2) | **8–12 h** | Mostly forms + a private-bucket upload path that already exists |
| State machine + custody move + aging board (§1.3/1.4) | **8–12 h** | Alert wiring is the fiddly part |
| DR/backup + verified export (§5) | **10–14 h** | The hash-verify loop and the failure surfacing are the real work |
| Discovery-plan display (§4) | **6–10 h** | *Blocked* on `VALUATION_ENGINE.md`; the narrative generator is an AI call with an existing metered path |
| **Total** | **38–57 h** | Call it a solid week and a half, not a weekend |

Confidence: **moderate.** I've been wrong on estimates in this repo before, and
the DR piece in particular has a habit of growing once real failure modes show
up.

### If you only had one weekend

Cut to the two things that are expensive to retrofit and cheap to build now:

1. **The schema** (§2) — tables, the tax-bucket inheritance chain with its
   guarded reclass, and `on delete restrict`. Getting the shape right is 80% of
   the value and it's the part that hurts to change later.
2. **Documents + the backup loop** (§2.2, §5) — because it's the catastrophic
   failure mode.

Defer: the aging board, the discovery-plan display (it's blocked anyway), and
the polished asset UI. A plain form over the right schema is fine for one
record.

---

## 8. Open questions for Beau

1. **Where does the off-site backup go?** R2 (already a service key), personal
   Drive, or S3. Decides ~4h of §5.
2. **Is the Mantle's title actually held by a trust?** It changes
   `legal_title_holder` and, more importantly, who the insurance names.
3. **Do you want the crossover decision modelled as a workflow** (submit →
   result → accept/resubmit) or just as states with a note? The former is
   better if you'll do this more than once or twice.
4. `VALUATION_ENGINE.md` — needed before §4 can be finalised.

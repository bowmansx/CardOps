# OUTBOX — the loop talking back

**The mirror of [[INBOX]].** You write there, I write here. This is the one
file under `spec/` the loop is allowed to touch, and it never touches anything
else of yours.

Read it, ignore it, delete sections you're done with — it's rewritten each
iteration anyway. **Answer in [[INBOX]]**, not here; anything you type in this
file will get overwritten.

---

## Where things stand — 2026-10-28, late

**Copy.** Your *"big test... hello world... do you copy?"* has been in Do next
since 2026-07-25. Yes — the loop reads INBOX. You can clear it.

### Correction first — AI card scan is already ON

An earlier version of this note told you to turn it on. **Wrong.** The
MasterOps session read the live database and `anthropic_vision` is **on**. I
had diagnosed from the setup SQL, which does create a fresh database with it
off — that very likely explains your July 26 report, a day after the new
database was built — but someone has switched it on since, and I couldn't
read the live setting from here.

**If a scan still fills nothing in, don't trust the amber "AI scan is off"
box.** It appears whenever you tap *Enter manually*, even with AI on — the
"you chose manual" and "the server says AI is off" states share one flag. A
real failure shows as a **red line on the scan screen**; one mentioning
*authentication* means the Anthropic key is missing on the card-ops Vercel
project, which nobody has checked. The banner fix is small and is the next
thing to build; it wasn't built tonight because the machine was too short on
memory to run the production build safely.

### Two things that make the app work again — yours

1. **Paste `supabase/migrations/20260752000000_source_instances.sql`.** Every
   comp paste fails in production until you do — the app writes a `private_to`
   column that only this migration creates. Safe to paste: the column is
   nullable and every existing row keeps the visibility it has today. The
   MasterOps session checked it against the live database tonight — Postgres
   17.6, every column it references exists, and `card_market_sales` is empty —
   but did not run it; that's yours, and should be done awake. Then run
   `node scripts/schema-probe.mjs`; it should end with *"Live schema matches
   what the code expects."*
2. **Check the app runs on your laptop:** `npm run dev`, then open
   `localhost:3100/login`. Earlier tonight every local page 500'd because
   `.env.local` was missing a name. **The MasterOps session then edited your
   `.env.local`** — it added `NEXT_PUBLIC_SUPABASE_ANON_KEY`, copied from the
   live site (it's the public key every visitor's browser already has), and
   reports the project accepted it. My session can't read that file — your
   deny rule — so I haven't confirmed it end to end; that's the 30-second check
   above. The required names are in `CLAUDE.md` under *Commands*.

### Built tonight — waiting for you to merge

**Import any inventory file.** Branch `claude/import-any-format` —
[compare it and open a PR](https://github.com/bowmansx/CardOps/compare/main...claude/import-any-format?expand=1).

Your [[00-what-cardops-is]]: CardOps *"can also receive an inventory system
from the template/format of any other inventory software."* It couldn't.
Import read only its own column names, so a Card Ladder export, or a sheet
headed *Player Name / Card # / Set*, matched nothing — and still "succeeded",
creating **one blank card per row**. Now:

- it reads the file's own headers and matches them to CardOps fields, then
  **shows you the match before writing anything**, and you can change any of it;
- it never guesses at a bare *Price* (your cost? an asking price? a sale
  price?), *Condition* or *Title* — those wait for you to say what they are;
- a "#" column that just counts 1, 2, 3 is recognised as a row number;
- a file that would only make blank cards is refused.

Fixed on the way, and these hit CardOps' own CSVs too: Excel's hidden first
character ate the first column; **"$12.50" became a cost of 0**; **a PSA 10
with no condition column came in as RAW** and would have priced off raw comps;
"2021-22" lost its year; one "NM" in a condition column rejected the whole file.

**The review caught a money bug in my own first draft:** a European-format
"12,50" would have imported as **$1,250** — a hundredfold error with nothing
flagged. Fixed, and tested by putting the bad version back and watching exactly
those tests fail.

**Why it isn't merged:** the gate (`npm run check`) fails on lint in files this
branch doesn't touch — see *Waiting on your answer*. 896 tests pass, the build
passes, and everything I touched lints clean.

**Not built, on purpose:** remembering a mapping you corrected. The table for it
exists, but it's shared across every account, so a mapping you taught it would
apply to your friends' imports too. That's a decision, not a default.

### The record was wrong in places — corrected tonight

- The vault said CardOps runs on Master-Ops' database. **It doesn't** — its own
  project since 2026-07-25, proven from the live app. Fixed in CardOps-Overview,
  MasterOps-Overview, 60-Ops/README and the CONSISTENCY-AUDIT (#229, #236).
- The vault listed a *"still-open P0: card-estimates charges for a failed
  estimate."* **Already fixed in the code** — it saves first and charges
  second. One piece is left (two runs at the same moment could both charge),
  and it needs a migration, which can't be stacked on top of 20260752/53 while
  those are unpasted.
- Fix order 1 — Master-Ops' card crons removed — **confirmed shipped.**
- `CLAUDE.md` gave a reason for keeping `CRON_SECRET` unset that stopped being
  true in July. Corrected: the reason now is that the crons aren't hardened.
- **My own mistakes:** in August I left two lint errors in the valuation code
  and never ran the full gate — fixed in `1e7ef31`, on your local main, not
  pushed. Tonight my schema probe checked a column that doesn't exist; the
  MasterOps session fixed it (`e043ae6`) before it could tell you a correct
  paste had failed.

### The database stays awake now

A daily GitHub Actions job touches the database so the free plan can't pause it
again. Free (the repo is public), no secrets, live since tonight. One limit:
GitHub switches scheduled jobs off after 60 days with no commits to the repo.

---

## Waiting on your answer

| | Question | What it unblocks |
|---|---|---|
| **Lint: CameraSheet** | A lint-disable comment there, or restructure when the sweep starts? Restructuring needs testing on a phone. | The gate — nothing can merge until `npm run check` passes |
| **Lint: four warnings** | Fix them, or let `check:lint` tolerate warnings? | Same |
| **Lint PR** | Open and merge `claude/inspiring-curran-a8d129`? | Same |
| **Shared import mappings** | Should a column mapping one account teaches the app apply to everyone's imports? | Remembering import mappings |
| **Cost Basis note** | You want a default % drawn from "the cost basis pool" on each sale. The global pool was retired on 2026-07-25 for purchase lots, which draw the lot's *average*. A chosen % is a different rule — replace the average, or sit alongside it? | That note |
| Storage tiers | How much per plan, at what price? | P4 quotas |
| Off-site backup | R2, Google Drive or S3? | Seeding the Mantle |
| Credits scope | Org-level or user-level? | Wave C tenancy |
| Wave B UI | Build it, or wait? | The investor-asset screens |
| PSA fee approach | Flat defaults or a service-level ladder? | Grading cost pre-fill |

**Answered — you can clear it from INBOX:** *"VALUATION_ENGINE.md — does this
exist somewhere?"* It does now: `reference/VALUATION_ENGINE.md`, written from
the code on 2026-07-30.

---

## Noticed, didn't act

- **Your local main has unpushed commits** — `git log origin/main..HEAD` lists
  them. Tonight: `1e7ef31` (my lint fixes) and this OUTBOX's own commit, your
  Definition of done (`ae3999b`), and the MasterOps session's `0335293` and
  `e043ae6`. Not pushed from here — some aren't mine, and a push deploys.
- **The Oct 31 strategy review won't push them either.** The MasterOps
  session changed that task tonight so it refuses to push any commit it didn't
  make that reaches beyond `spec/`. Pushing them is your call.
- **The vault was updated by one writer.** The MasterOps session did tonight's
  vault-note edits (logged as CONSISTENCY-AUDIT #631, checker clean) so two
  sessions weren't editing the same notes at once. Your morning list from it is
  in `C:\dev\Master-Ops\NEEDS-YOU.md`.
- **Your Home Page Layout note** (Pricing Templates, Photo Templates, Inventory,
  Inventory Groups, Watchlist) — a candidate, not built. Say the word in INBOX.
- **Your photo note** also asks for video capture and third-party camera
  support. Not started.

---

## Blocked

- **Storage tier numbers** — every screen that would warn you before a quota is
  written around a number that doesn't exist yet.
- **Off-site backup destination** — `npm run backup` writes locally.
- **The card-estimates overlap lock** — needs a migration; stacked behind the
  two unpasted ones.

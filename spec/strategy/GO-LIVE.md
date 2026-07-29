# GO-LIVE — what becomes real when other people pay

**Today CardOps is Beau's tool, shared free with close friends.** Nothing on
this page is a problem yet. Every item here is deliberately deferred.

The point of writing them down now is that most of them are **cheap before the
first paying user and expensive after** — and a few are decisions that quietly
get made by default if nobody names them.

Beau, 2026-07-29:

> "for now, card ops is only for me... and for close friends that i will not
> charge them for.... i gave you the end goal description."
> "i don't want to start getting the commercial/enterprise items just yet but
> please do note all of the things that will eventually get that when we go
> live."

The end goal, in his words:

> "a tool in the form of an app/website that people will need to purchase
> computing power beyond their free amount for."

---

## Licences that change meaning the day money changes hands

| What | Today | On go-live |
|---|---|---|
| **PriceCharting** | Connector wired (`price-sources/pricecharting.ts`). Internal use by Beau is what the licence contemplates. | **Internal-use-only terms are breached by a commercial multi-tenant product.** Either negotiate redistribution, or the connector serves only the operator's own account and never a customer's. |
| **Scryfall** | Free, unrestricted for this use. | **Their data may not sit behind the credit meter.** MTG catalogue lookups stay free even when other things are metered. |
| **thecardapi** | Free tier. | Check the terms permit serving third parties, and whether any tier below Enterprise can backfill. |
| **PSA cert API** | Free tier, ~100/day. | Rate limit becomes a per-user problem rather than a personal one. Cache per identity forever; certs never change. |
| **Any pop-report source** | None wired. | Retention and redistribution rights are the whole feature. Ask before building on one. |

**The general rule:** a data licence written for "you, using it" is not the
same licence as "you, reselling access to it". Every source needs re-reading
against the commercial reading before the first invoice.

### Beau's model, tested against those terms  *(2026-07-29)*

> "we aren't necessarily charging for lookups but instead are charging people
> for base credits for when they use lots of data... the most being when they
> need you to do in depth analysis which isn't exactly the lookups"

**That distinction is real, and it rescues one source but not the other.**

- **Scryfall: it holds.** Their term is about paywalling *their data*. If
  catalogue lookups are free and only the reasoning on top is metered, a free
  user still sees everything Scryfall provides. **This becomes a hard design
  constraint, not a nice-to-have: catalogue lookups must never consume credits,
  including after an allowance is exhausted.** The moment "out of credits"
  hides a card's name, it is behind a paywall.
- **PriceCharting: it does not.** "Internal use only" is about WHO uses the
  data, not what it costs. A friend's screen showing a PriceCharting-derived
  value is that friend using it, free or not - the same term blocks giving it
  away. Two clean paths: **ask them** for a redistribution quote (often an
  email, not a legal project), or restrict that connector to the operator's own
  account and serve other users from sources that permit it.

Engineering judgement about how such terms usually read, not legal advice.
Read the actual agreements before going live.

---

## Things that need machinery only once there are strangers

- **DECIDED 2026-07-29 - completed SALES are public and pooled.** Beau: *"if
  someone has a sale of a card, i want that information to be public and used
  all over."* That settles the market side, which is the uncontroversial half:
  a completed sale is a public fact, and `card_market_sales` already hangs off
  the shared identity so every owner inherits it. Good, and it is the network
  effect.
- **Still per-user, and this is the half that is easy to conflate: the
  EXECUTION model.** "Does *this* seller realize above or below market, and how
  fast" is not a fact about the card - it encodes photo quality, feedback score,
  shipping speed, patience and return policy. Pooling it would render one
  prolific seller's behaviour as "the market" and hand a new seller with three
  feedback the numbers of a top-rated store. Market data pooled, execution data
  never.
- **Shared catalogue poisoning.** `card_market_sales` hangs off the shared
  identity, so one bad paste or wash sale reaches everyone. There is no
  provenance weighting, no outlier quarantine and no dispute path — and
  `card_id` is nullable `on delete set null` with no `added_by`, so deleting a
  card severs the only link to who contributed a row. **A poisoned sale can
  become permanently un-attributable.** Cheapest to fix while the only
  contributor is Beau.
- **Per-user execution model.** "Does this seller realize above or below
  market" encodes photo quality, feedback score, patience and return policy. It
  must never be pooled — a model trained mostly on one prolific seller would
  render that seller's behaviour as "the market".
- **The estimate as evidence.** Once a customer prints a value it lands in
  insurance claims, disputes and tax returns. Needs an explicit non-appraisal
  statement **on the artifact**, and every estimate stored immutably with its
  date, inputs and method.

---

## Billing, quotas and the meter

The metered model is decided — free to a level of compute and storage, pay past
it. What that still needs:

- **Storage tier numbers.** Blocked on Beau. Every screen that would warn
  someone before they hit a quota is written around a number that does not
  exist.
- **Credits scoped per-org or per-user.** Cheap to change now, expensive later.
- **A hard stop, not a soft one.** A metered product that can run up an
  unbounded bill on someone else's card is a support nightmare. The ladder's
  upper rungs cost real money per card, which makes the "**bulk floor checked
  FIRST**" rule non-negotiable — a 5,000-card collection buy must never bill
  for 5,000 lookups.
- **Payment handling.** Not built. Deliberately out of scope until it is not.

---

## Operational things that only bite with strangers

- **Free, complete data export as a stated promise.** Already ranked. For a
  one-man product against funded incumbents it is the most credible trust
  signal available, and it costs almost nothing.
- **Off-site backup.** Blocked on a destination choice. Losing a customer's
  evidence documents is unrecoverable in a way losing your own is not.
- **The audit-rule enforcement guard.** The 12 prevention rules hold today
  because they are in front of the model each session. With more hands on the
  code that stops being true.
- **Terms, privacy policy, and what happens to data on cancellation.** None
  exist. Not urgent; not skippable.

---

## What is deliberately NOT here

Anything that would change how the app is built today. The structure being laid
down now — the credit ledger, per-run cost metering, per-photo byte accounting,
RLS on every table, the identity catalogue — is already the right shape for
this. **Nothing above requires rebuilding; it requires deciding.**

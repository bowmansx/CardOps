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

---

## Things that need machinery only once there are strangers

- **Pooled outcomes.** Using one user's realized sales to tune another's
  estimates. Among friends this needs a conversation; among customers it needs
  consent, ratios rather than dollars, a minimum number of distinct
  contributors, and no per-identity statistics. **Do not retroactively pool
  data gathered under a different understanding.**
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

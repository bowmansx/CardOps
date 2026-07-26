# INBOX

The only file the loop treats as orders. Everything under **Do next** outranks
`reference/next-steps.md`.

The loop never edits this file — including never ticking things off. It tells
you what it finished; you clear your own list.

---

## Do next

<!-- Anything at all. Doesn't need to be well specified — if it's too vague to
     build you'll get a question back rather than a guess. -->

_(empty)_
big test... hello world... do you copy?
---

## Don't touch

<!-- No justification needed. "Leave the pricing page alone this week" is a
     complete instruction. -->

_(empty)_

---

## Notes for the loop

<!-- Context that isn't a task. Decisions you've made, things you tried, how
     the last box of cards felt to scan. An answer to anything in "Waiting on
     you" below goes here and unblocks that work immediately. -->

Notice the change to 00, you'll see my description of cardops which should give you an understanding of the native goal for the app. Please help me realize this with our app.

---

## Waiting on you

Genuinely blocked — the loop will skip these rather than guess. Answering any
one in **Notes** above makes it buildable on the next pass.

| | Question | What it unblocks |
|---|---|---|
| **Storage tiers** | How much storage per plan, at what price? | P4 quotas. Measurement is built; there is nothing to enforce without numbers. |
| **Off-site backup** | R2, Google Drive, or S3? | Seeding the Mantle. Losing evidence documents is the catastrophic failure for an asset whose value lives in its paperwork. |
| **Credits scope** | Org-level or user-level? | Wave C tenancy. Changes the money core — cheap now, expensive later. |
| **Wave B UI** | Build it, or wait? | The investor-asset record has had schema since 2026-07-25 and no screens. You asked to be consulted before B got built; only the schema was green-lit. |
| **VALUATION_ENGINE.md** | Does this exist somewhere? | Wave B3's discovery-plan display. The Wave A spec cited it; it has never been in this repo. |

---

## Standing answer the loop already has

Things you've decided that it does NOT need to re-ask:

- Cost basis is **optional** at intake, defaults to 0, and un-costed cards are
  flagged rather than treated as free. (2026-07-25)
- Photos upload **straight from the browser to storage**; only paths reach the
  server. (2026-07-25)
- Migrations are **pasted by hand, by you**. The loop writes them and never
  applies them, and never auto-merges a PR containing one.
- Nothing posts to real books, Zoho or eBay without you saying so **in the
  moment**.

# CardOps spec vault

**Open this folder (`C:\dev\CardOps\spec`) as an Obsidian vault.**

This is Beau's. It is where the app gets described — what it is, how each part
is meant to work, what has been decided and why. Write here freely: half
thoughts, whole sections, notes at midnight. It does not need to be tidy.

## The contract

- **The loop READS this vault every iteration. It never writes to it.**
  Nothing here gets reformatted, reorganised, tidied, or "helpfully updated".
  What you wrote stays as you wrote it.
- **[[INBOX]] outranks everything.** Whatever is under *Do next* there is the
  work, ahead of `reference/next-steps.md`.
- **Everywhere else here is the spec.** When the loop builds something, it
  reads the relevant area note first and builds what the note says — not what
  the code currently does. Where the two disagree, the note wins and the loop
  says so out loud.
- **A note that is too vague to build comes back as a question**, not a guess.
  Writing "make grading better" gets you asked what better means. That is
  working as intended.
- **The loop records what it SHIPPED in `reference/next-steps.md`**, never
  here. Your list is yours to cross off.

## How to write in it

There is no required format. Some things that help:

- **Say why, not just what.** "Cost basis is optional because I often don't
  know what I paid until the invoice arrives" is worth ten lines of spec — it
  tells the loop what to do in cases you didn't think to write down.
- **Contradict the code freely.** If a note says the opposite of what is built,
  that is a change request. That is the point.
- **Mark uncertainty.** "Not sure yet:" or "maybe:" is read as *do not build
  this yet* rather than as a requirement.
- **Link with `[[wikilinks]]`.** A link to a note that does not exist yet is
  fine — it marks something worth writing.

## What's in here

- [[ideas/README|ideas/]] — **your blank space.** Thinking out loud; the loop
  reads it for context and never builds from it.
- [[INBOX]] — what to do next. The only file the loop treats as orders.
- [[00-what-cardops-is]] — the product, in one page.
- [[10-intake]] — getting a card into the system.
- [[20-money]] — basis, sales, profit, books.
- [[30-market]] — pricing, comps, grading estimates.
- [[40-selling]] — listing, eBay, showcases.
- [[50-platform]] — auth, tenancy, credits, storage, the things underneath.
- [[90-decisions]] — the log of what was decided and why.

The area notes are seeded with **what is actually true today**, so you are
editing something real rather than a blank page. Everything in them is
current-state unless it says otherwise. Change any of it.

# What CardOps is

Inventory and books for trading cards, built for someone who actually moves
volume: photograph a card, know what it is, know what it's worth, know what it
	cost, list it, and have the money land in real books correctly. It is built for people who want a higher amount of versatility and control in market analysis, market pricing, bookeeping, automation, synchronization, and one database of their inventory to use app conections for pushing that information towards sales and bookkeeping. CardOps can also receive an inventory system from the template/format of any other inventory software and restructure the template/format to be prepared for export to any other inventory software.

Live at https://card-ops-zeta.vercel.app. Its own Supabase project
(`zgkydwvmdnnrxcacegth`) since 2026-07-25.

## Who it's for

Beau today. Other dealers later — the multi-tenancy is built (RLS everywhere,
a 158-agent audit closed the gaps) but no one else has an account yet. Every
design decision assumes more users are coming; nothing waits for them.

## The spine

A card moves through this, and everything in the app hangs off one of these
stages:

1. **[[10-intake]]** — photograph it, identify it, cost it, shelf it.
2. **[[30-market]]** — what is it worth, and what would it grade?
3. **[[40-selling]]** — list it, sell it, ship it.
4. **[[20-money]]** — what did it cost, what did it make, where does that book?

**[[50-platform]]** is what sits underneath all four: who you are, what you can
see, what you're paying for.

## What makes it different from a spreadsheet

- **The camera is the input device**, not the keyboard. A card should be booked
  by photographing it, with AI filling the rest in.
- **Basis is auditable.** Every dollar of cost traces to a purchase event or a
  named cost line. There is no "roughly what I paid" number anywhere.
- **It books itself.** Double-entry underneath, pluggable bookkeeping
  connectors on top (Zoho today). The card ledger IS the accounting record,
  not a thing you re-key into accounting later.

## Rules that outrank features

These have been earned the hard way and shouldn't be traded away for
convenience:

- **Money renders complete or flagged.** Never a number computed from a partial
  read, never $0 presented as fact.
- **Nothing money-critical or outward-facing happens without Beau saying so.**
  No cron posts to books. No automation lists on eBay.
- **Tax classification is recorded, never determined.** The app stores Beau's
  call and his stated reason with a timestamp and an append-only trail. It does
  not decide investment vs dealer vs hobby — that test is per-property and
  belongs to Beau and his CPA.
- **A photo never misrepresents a card.** Crops keep a margin, originals are
  retained, and every crop can be audited against the frame it came from.

## Open

<!-- Add anything here. Questions about what this even is are the most useful
     ones. -->

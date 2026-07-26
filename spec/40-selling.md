# Selling — listing, eBay, showcases

## eBay

Single-homed on Master-Ops until cutover: the OAuth RuName is registered against
`master-ops-iota.vercel.app`, so copying `EBAY_*` env vars to CardOps does
nothing until a CardOps redirect URI is added in eBay's developer portal. The UI
deliberately links to the Master-Ops origin.

A listing sends up to 12 photos, chosen and ordered deliberately:

- **The crop wins over the uncropped frame it came from.** The frame is kept for
  auditing an edge, not for publishing — it used to end up as the lead image,
  which meant buyers saw the table.
- **Whole card first, then detail**: front, back, slab, surface, edge, corners.
- **The cap applies AFTER ordering**, so front and back are never crowded out by
  close-ups. Losing the shot of the whole card is the one truncation that makes
  a listing worse than having no detail shots at all.
- Truncation, or a photo that couldn't be signed, comes back as a warning rather
  than a quietly shorter listing.

Settled orders write back per-order, with an audit trail.

## Selling a card

`card_sell` draws the full basis (acquisition + cost lines), records net
proceeds and profit into `card_sales`, and moves the card across the sold
boundary. Fees allocate exactly: remainders land on the last line, and per-order
fixed fees apply once per ORDER, not per line.

The sell screen says plainly when a sale was NOT recorded — a frozen button on a
money action leaves you unable to tell.

## Showcases

Public, tokenised views of a selection. Read-only; prices only if chosen.

## Open

<!-- -->

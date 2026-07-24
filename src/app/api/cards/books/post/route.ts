// Post card sales into the internal journal (Beau, 2026-07-20). A full resync:
// delete the existing card_sale entries and rebuild from current card_sales — so
// it's idempotent AND self-heals reversals (an unsold card's sale is gone, so its
// entry isn't rebuilt). Owner-only. Internal ledger only — no external side
// effects (Zoho push is a separate, later, gated step).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { cardSaleLines, linesBalance, type TaxTreatment } from "@/lib/books/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Read FIRST and bail on a read error — a null-from-error must never reach the
  // delete below, or a transient blip would silently wipe the ledger.
  //
  // Two things this has to get right (2026-07-24):
  //  1. SCOPE. card_sales has no user_id, and its SELECT policy is
  //     `owns_card(card_id) or is_owner()` — so the owner's unfiltered read
  //     returns EVERY user's sales. The cards embed is filtered by cards_own, so
  //     another user's card resolves to null and the row would post under a blank
  //     entity as 'dealer', inflating the owner's revenue. cards!inner pinned to
  //     the owner's user_id keeps this ledger to the owner's own sales.
  //  2. COMPLETENESS. `.limit(20000)` was a lie — PostgREST caps a request at
  //     1000 rows. This function DELETEs the whole card_sale slice and rebuilds
  //     from what it read, so a partial read silently destroys the rest. Page it,
  //     on a stable order, and refuse to rebuild if the ceiling is ever hit.
  const PAGE = 1000;
  const MAX_SALES = 100_000;
  type SaleRow = {
    id: string; sale_price: number; fees: number; shipping_income: number;
    shipping_cost: number; basis_drawn: number; sold_at: string | null;
    cards: { entity_id: string | null; tax_treatment: string | null } | { entity_id: string | null; tax_treatment: string | null }[] | null;
  };
  const sales: SaleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: readErr } = await supabase
      .from("card_sales")
      .select("id, sale_price, fees, shipping_income, shipping_cost, basis_drawn, sold_at, cards!inner ( user_id, entity_id, tax_treatment )")
      .eq("cards.user_id", user.id)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (readErr) return NextResponse.json({ error: `Couldn't read sales: ${readErr.message}` }, { status: 500 });
    const batch = (data ?? []) as unknown as SaleRow[];
    sales.push(...batch);
    if (batch.length < PAGE) break;
    if (sales.length >= MAX_SALES) {
      return NextResponse.json(
        { error: `Refusing to rebuild: more than ${MAX_SALES} sales. Rebuilding from a partial read would delete the rest of your ledger.` },
        { status: 507 },
      );
    }
  }

  // Build every row in memory (and prove each entry balances) BEFORE touching the
  // ledger, so we never delete unless we have the full replacement ready.
  const rows: Record<string, unknown>[] = [];
  const postedIds: string[] = [];
  let skippedUnbalanced = 0;
  for (const s of sales ?? []) {
    const card = (Array.isArray(s.cards) ? s.cards[0] : s.cards) as { entity_id: string | null; tax_treatment: string | null } | null;
    const lines = cardSaleLines(s, (card?.tax_treatment as TaxTreatment) ?? "dealer");
    if (!lines.length) continue;
    if (!linesBalance(lines)) { skippedUnbalanced++; continue; } // never write an unbalanced entry
    const date = String(s.sold_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    lines.forEach((l, i) =>
      rows.push({
        entity_id: card?.entity_id ?? null, entry_date: date, source: "card_sale", source_ref: s.id as string,
        line: i, account: l.account, debit: l.debit, credit: l.credit, memo: l.memo ?? null,
      }),
    );
    postedIds.push(s.id as string);
  }

  // Rebuild the card_sale slice: delete, then insert the prepared rows.
  const { error: delErr } = await supabase.from("journal_entries").delete().eq("source", "card_sale");
  if (delErr) return NextResponse.json({ error: `Ledger reset failed: ${delErr.message}` }, { status: 500 });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("journal_entries").insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: `Post failed (re-sync to finish): ${error.message}` }, { status: 500 });
  }

  // Flag the source rows as booked (the previously-dormant hook).
  for (let i = 0; i < postedIds.length; i += 500) {
    await supabase.from("card_sales").update({ synced_to_books: true }).in("id", postedIds.slice(i, i + 500));
  }

  return NextResponse.json({ ok: true, sales: postedIds.length, entries: rows.length, skippedUnbalanced });
}

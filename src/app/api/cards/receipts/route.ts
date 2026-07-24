// Card cost receipts + intercompany advances (Beau, 2026-07-21). Owner-only.
// Creating a receipt records it AND posts its double-entry into journal_entries
// (one balanced entry per affected entity — two for an advance). Internal ledger
// only; the card-basis (pool/individual) wiring + Zoho push are later, gated steps.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { receiptEntries, type ReceiptDisposition, type TaxTreatment } from "@/lib/books/journal";
import { coerceDate } from "@/lib/books/date";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if ((await currentRole()) !== "owner") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { supabase, userId: user.id };
}

async function entityExists(supabase: Awaited<ReturnType<typeof createClient>>, id?: string | null) {
  if (!id || !UUID.test(id)) return false;
  const { data } = await supabase.from("card_businesses").select("id").eq("id", id).maybeSingle();
  return !!data;
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  const { data } = await g.supabase!
    .from("card_receipts")
    .select("id, entity_id, receipt_date, vendor, amount, note, disposition, treatment, to_entity_id, advance_disposition, advance_treatment, posted, created_at")
    .order("receipt_date", { ascending: false })
    .limit(500);
  return NextResponse.json({ receipts: data ?? [] });
}

export async function POST(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const supabase = g.supabase!;

  const b = (await request.json().catch(() => null)) as
    | { amount?: number; entity_id?: string; disposition?: string; treatment?: string; to_entity_id?: string; advance_disposition?: string; advance_treatment?: string; vendor?: string; receipt_date?: string; note?: string; image_path?: string }
    | null;

  const amount = Number(b?.amount);
  const disposition = b?.disposition as ReceiptDisposition;
  const TREAT = ["dealer", "investment", "hobby"];
  const treatment = TREAT.includes(b?.treatment ?? "") ? b!.treatment! : "dealer";
  if (!(amount > 0)) return NextResponse.json({ error: "Amount must be greater than 0." }, { status: 400 });
  if (!["pool", "cards", "advance"].includes(disposition)) return NextResponse.json({ error: "Pick a valid disposition." }, { status: 400 });
  if (!(await entityExists(supabase, b?.entity_id))) return NextResponse.json({ error: "Pick a valid paying business." }, { status: 400 });

  let to_entity_id: string | null = null;
  let advance_disposition: string | null = null;
  let advance_treatment: string | null = null;
  if (disposition === "advance") {
    if (b?.to_entity_id === b?.entity_id) return NextResponse.json({ error: "An advance must go to a DIFFERENT business." }, { status: 400 });
    if (!(await entityExists(supabase, b?.to_entity_id))) return NextResponse.json({ error: "Pick a valid receiving business." }, { status: 400 });
    to_entity_id = b!.to_entity_id!;
    advance_disposition = b?.advance_disposition === "cards" ? "cards" : "pool";
    advance_treatment = TREAT.includes(b?.advance_treatment ?? "") ? b!.advance_treatment! : "dealer"; // the receiver's treatment
  }

  const receipt_date = coerceDate(b?.receipt_date);

  const base = {
    entity_id: b!.entity_id!, receipt_date, vendor: b?.vendor?.slice(0, 120) ?? null, amount,
    image_path: b?.image_path ?? null, note: b?.note?.slice(0, 300) ?? null,
    disposition, to_entity_id, advance_disposition, posted: false,
  };
  const SEL_FULL = "id, entity_id, receipt_date, vendor, amount, note, disposition, treatment, to_entity_id, advance_disposition, advance_treatment, posted, created_at";
  const SEL_BASE = "id, entity_id, receipt_date, vendor, amount, note, disposition, to_entity_id, advance_disposition, posted, created_at";
  let { data: row, error } = await supabase
    .from("card_receipts").insert({ ...base, treatment, advance_treatment }).select(SEL_FULL).maybeSingle();
  if (error && /treatment/i.test(error.message)) {
    // Pre-migration fallback: treatment columns not applied yet — book without them.
    ({ data: row, error } = await supabase.from("card_receipts").insert(base).select(SEL_BASE).maybeSingle());
  }
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Couldn't save the receipt." }, { status: 500 });

  // Post the double-entry (one balanced entry per entity; two for an advance).
  const entries = receiptEntries({
    amount, entity_id: b!.entity_id!, disposition, treatment: treatment as TaxTreatment,
    to_entity_id, advance_disposition: advance_disposition as "pool" | "cards" | null,
    advance_treatment: advance_treatment as TaxTreatment | null,
  });
  const jrows: Record<string, unknown>[] = [];
  for (const e of entries) {
    e.lines.forEach((l, i) =>
      jrows.push({ entity_id: e.entityId, entry_date: receipt_date, source: "receipt", source_ref: row.id, line: i, account: l.account, debit: l.debit, credit: l.credit, memo: l.memo ?? null }),
    );
  }
  if (jrows.length) {
    const { error: jErr } = await supabase.from("journal_entries").insert(jrows);
    if (jErr) {
      // Roll back the orphan receipt so we NEVER claim success without the
      // double-entry actually landing (there's no separate re-post path).
      await supabase.from("card_receipts").delete().eq("id", row.id);
      return NextResponse.json({ error: `Ledger post failed — receipt not saved: ${jErr.message}` }, { status: 500 });
    }
    await supabase.from("card_receipts").update({ posted: true }).eq("id", row.id);
  }

  return NextResponse.json({ ok: true, receipt: { ...row, posted: jrows.length > 0 } });
}

export async function DELETE(request: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const supabase = g.supabase!;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return NextResponse.json({ error: "id required." }, { status: 400 });
  // Drop the stored receipt image too (else the object is orphaned in the bucket).
  const { data: row } = await supabase.from("card_receipts").select("image_path").eq("id", id).maybeSingle();
  if (row?.image_path) await supabase.storage.from("receipts").remove([row.image_path]).catch(() => {});
  // Remove the receipt's journal entries first, then the receipt.
  await supabase.from("journal_entries").delete().eq("source", "receipt").eq("source_ref", id);
  await supabase.from("card_receipts").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}

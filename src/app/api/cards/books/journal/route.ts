// Journal export (Beau, 2026-07-21). The canonical double-entry ledger as CSV —
// the backend-AGNOSTIC bridge: import it into Zoho / QuickBooks / Xero / anything,
// or a live adapter pushes the same rows. Owner-only. CSV formula-injection guarded.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

// Neutralize spreadsheet formula injection (a leading = + - @ becomes text).
function cell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const y = Number(sp.get("year"));
  const year = Number.isFinite(y) && y >= 2000 ? y : null;

  // Paged and fail-closed. `.limit(50000)` was capped at 1000 by PostgREST, so
  // this handed back the first 1000 lines as a complete-looking CSV — HTTP 200,
  // Content-Disposition: attachment, no signal at all — and the cut could land
  // mid-transaction, since a dealer sale's two halves each balance on their own.
  // A partial financial document is worse than no document. (2026-07-24)
  const { rows, error: readErr } = await readAllSafe<Record<string, unknown>>((from, to) => {
    let q = supabase
      .from("journal_entries")
      .select("entry_date, source, source_ref, line, account, debit, credit, memo, entity_id")
      .order("entry_date", { ascending: true })
      .order("source_ref", { ascending: true })
      .order("line", { ascending: true })
      .order("id", { ascending: true }) // intercompany advances tie on all three keys above
      .range(from, to);
    if (year) q = q.gte("entry_date", `${year}-01-01`).lt("entry_date", `${year + 1}-01-01`);
    return q;
  });
  if (readErr) return NextResponse.json({ error: `Couldn't read the ledger: ${readErr}` }, { status: 500 });

  const { data: ents } = await supabase.from("card_businesses").select("id, short_code");
  const code = new Map((ents ?? []).map((e) => [e.id as string, e.short_code as string]));

  const header = ["Date", "Entity", "Source", "Ref", "Account", "Debit", "Credit", "Memo"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      cell(r.entry_date), cell(code.get(r.entity_id as string) ?? ""), cell(r.source), cell(r.source_ref),
      cell(r.account), cell(Number(r.debit ?? 0).toFixed(2)), cell(Number(r.credit ?? 0).toFixed(2)), cell(r.memo),
    ].join(","));
  }
  const csv = lines.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal${year ? `-${year}` : ""}.csv"`,
    },
  });
}

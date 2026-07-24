import { createClient } from "@/lib/supabase/server";
import { currentRole } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

// GET /api/cards/reports?year=2026 → the CPA CSV: every settled sale that
// year, joined to the card it was. Owner-only (money view).

const esc = (v: string): string => {
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if ((await currentRole()) !== "owner") return Response.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const year = url.searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(year)) return Response.json({ error: "year=YYYY required." }, { status: 400 });

  // Page past PostgREST's per-request cap so a big year is never truncated in
  // the document handed to the CPA.
  const cols = "sold_at, platform, sale_price, fees, shipping_income, shipping_cost, net_proceeds, basis_drawn, profit_loss, order_ref, cards ( sku, player, year, set_name, card_number, grader, grade )";
  const rows: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await supabase
      .from("card_sales")
      .select(cols)
      .gte("sold_at", `${year}-01-01`)
      .lt("sold_at", `${Number(year) + 1}-01-01`)
      .order("sold_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }

  const header = [
    "Date", "Card", "SKU", "Grade", "Platform", "Order ref",
    "Sale price", "Shipping collected", "Fees", "Shipping cost",
    "Net proceeds", "Basis drawn", "Profit/Loss",
  ];
  const lines = (rows ?? []).map((r) => {
    const c = (Array.isArray(r.cards) ? r.cards[0] : r.cards) as
      | { sku?: string; player?: string; year?: number; set_name?: string; card_number?: string; grader?: string; grade?: string }
      | null;
    const title = [c?.year, c?.player, c?.set_name, c?.card_number ? `#${c.card_number}` : null].filter(Boolean).join(" ");
    const grade = c?.grader ? `${c.grader} ${c.grade ?? ""}`.trim() : "Raw";
    return [
      String(r.sold_at ?? "").slice(0, 10), title, c?.sku ?? "", grade, String(r.platform ?? ""), String(r.order_ref ?? ""),
      String(r.sale_price ?? 0), String(r.shipping_income ?? 0), String(r.fees ?? 0), String(r.shipping_cost ?? 0),
      String(r.net_proceeds ?? 0), String(r.basis_drawn ?? 0), String(r.profit_loss ?? 0),
    ].map(esc).join(",");
  });
  const csv = [header.map(esc).join(","), ...lines].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cardops-sales-${year}.csv"`,
    },
  });
}

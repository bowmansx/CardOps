import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

type Sale = {
  id: string; platform: string; sale_price: number | null; net_proceeds: number | null;
  basis_drawn: number | null; profit_loss: number | null; order_ref: string | null; sold_at: string;
  cards: { sku: string; player: string | null; year: number | null; set_name: string | null } | null;
};

export default async function SalesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("card_sales")
    .select("id, platform, sale_price, net_proceeds, basis_drawn, profit_loss, order_ref, sold_at, cards(sku, player, year, set_name)")
    .order("sold_at", { ascending: false })
    .limit(1000);
  const sales = (data ?? []) as unknown as Sale[];
  const t = sales.reduce(
    (a, s) => ({
      net: a.net + Number(s.net_proceeds ?? 0),
      basis: a.basis + Number(s.basis_drawn ?? 0),
      pl: a.pl + Number(s.profit_loss ?? 0),
    }),
    { net: 0, basis: 0, pl: 0 },
  );

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sales &amp; P&amp;L</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>

        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <Stat label={`Sales · ${sales.length}`} value={money(t.net)} />
          <Stat label="Basis drawn" value={money(t.basis)} />
          <Stat label="Profit / loss" value={money(t.pl)} tone={t.pl >= 0 ? "pos" : "danger"} />
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
          {sales.length === 0 && <p className="figures px-4 py-10 text-center text-sm text-ink/40">No sales yet.</p>}
          {sales.map((s) => {
            const title = [s.cards?.year, s.cards?.player, s.cards?.set_name].filter(Boolean).join(" ") || s.cards?.sku || "card";
            const win = Number(s.profit_loss ?? 0) >= 0;
            return (
              <div key={s.id} className="flex items-center gap-3 border-b border-hairline px-3 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{title}</div>
                  <div className="figures truncate text-[11px] text-ink/50">
                    {[s.cards?.sku, s.platform, s.sold_at?.slice(0, 10), s.order_ref].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="figures text-sm font-semibold">{money(s.net_proceeds)}</div>
                  <div className={"figures text-[11px] font-semibold " + (win ? "text-pos" : "text-danger")}>{money(s.profit_loss)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const t: Record<string, string> = { pos: "text-pos", danger: "text-danger", ink: "text-ink" };
  return (
    <div className="rounded-xl border border-hairline bg-white px-3 py-3">
      <div className={"figures text-lg font-bold " + (t[tone ?? "ink"] || t.ink)}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink/50">{label}</div>
    </div>
  );
}

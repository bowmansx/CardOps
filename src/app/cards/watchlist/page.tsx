import Link from "next/link";
import { BellRing, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type Card = { player: string | null; year: number | null; set_name: string | null; market_value: number | null; manual_price: number | null; status: string | null };
type Alert = { card_id: string; kind: string | null; target_price: number | null; direction: string; threshold_pct: number | null; window_days: number | null; note: string | null; cards: Card | Card[] | null };

// Watchlist — cards you're tracking for a price. "Crossed" is computed live
// from the current value, so hits show the moment the price gets there.
export default async function WatchlistPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("card_alerts")
    .select("card_id, kind, target_price, direction, threshold_pct, window_days, note, cards ( player, year, set_name, market_value, manual_price, status )")
    .order("created_at", { ascending: false }).limit(500);
  const alerts = (data ?? []) as Alert[];

  const rows = alerts.map((a) => {
    const c = (Array.isArray(a.cards) ? a.cards[0] : a.cards) ?? null;
    const value = (c?.manual_price ?? c?.market_value ?? null) as number | null;
    const isPct = a.kind === "pct_move";
    const crossed = !isPct && value != null && a.target_price != null &&
      (a.direction === "below" ? value <= a.target_price : value >= a.target_price);
    const dist = !isPct && value != null && a.target_price ? ((value - a.target_price) / a.target_price) * 100 : null;
    return { a, c, value, isPct, crossed, dist };
  }).sort((x, y) => Number(y.crossed) - Number(x.crossed)); // hits first

  const hits = rows.filter((r) => r.crossed).length;

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              Watchlist
              {hits > 0 && <span className="figures rounded-full bg-pos/15 px-2 py-0.5 text-xs font-semibold text-pos">{hits} hit</span>}
            </h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-1 text-[11px] text-ink/45">Set a price alert from any card. Hits are computed live from current value.</p>

        {!rows.length ? (
          <div className="mt-4 rounded-xl border border-hairline bg-white p-6 text-center">
            <Bell size={22} className="mx-auto text-ink/25" />
            <p className="mt-2 text-sm text-ink/50">Nothing on your watchlist yet.</p>
            <p className="mt-1 text-xs text-ink/40">Open a card → “Set price alert”.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-white">
            {rows.map(({ a, c, value, isPct, crossed, dist }) => (
              <Link key={a.card_id} href={`/cards/${a.card_id}`}
                className={"flex items-center gap-3 border-b border-hairline px-3 py-2.5 last:border-b-0 hover:bg-paper " + (crossed ? "bg-pos/5" : "")}>
                {crossed ? <BellRing size={16} className="shrink-0 text-pos" /> : <Bell size={16} className="shrink-0 text-ink/25" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{[c?.year, c?.player, c?.set_name].filter(Boolean).join(" ") || "(card)"}</div>
                  <div className="figures text-[11px] text-ink/50">
                    {isPct
                      ? `Watch ±${a.threshold_pct}% in ${a.window_days}d · now ${money(value)}`
                      : `Target ${a.direction === "below" ? "≤" : "≥"} ${money(a.target_price)} · now ${money(value)}`}
                  </div>
                </div>
                <span className={"figures shrink-0 text-right text-xs font-bold " + (crossed ? "text-pos" : "text-ink/50")}>
                  {isPct ? `±${a.threshold_pct}%` : crossed ? "HIT" : dist == null ? "—" : `${dist > 0 ? "+" : ""}${dist.toFixed(0)}%`}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

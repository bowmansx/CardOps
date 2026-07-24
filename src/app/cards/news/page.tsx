import Link from "next/link";
import { redirect } from "next/navigation";
import { Newspaper, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";

export const dynamic = "force-dynamic";

type NewsRow = {
  id: string; subject: string; card_id: string | null; title: string; url: string; source: string | null;
  published_at: string | null; significance: number | null; direction: string | null; market_moving: boolean; summary: string | null;
};

const fmtWhen = (at: string | null) => {
  if (!at) return "";
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const DIR = {
  up: { cls: "text-pos", Icon: TrendingUp, label: "bullish" },
  down: { cls: "text-danger", Icon: TrendingDown, label: "bearish" },
  neutral: { cls: "text-ink/40", Icon: Minus, label: "neutral" },
} as const;

export default async function CardNewsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!hasCardAccess(await currentRole())) redirect("/cards");

  const { data } = await supabase
    .from("card_news")
    .select("id, subject, card_id, title, url, source, published_at, significance, direction, market_moving, summary")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = ((data ?? []) as NewsRow[]).sort(
    (a, b) => Number(b.market_moving) - Number(a.market_moving) || (b.significance ?? 0) - (a.significance ?? 0),
  );

  return (
    <main className="w-full flex-1 bg-paper text-ink" style={{ colorScheme: "dark" }}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        <header className="flex items-baseline justify-between pt-5 pb-1">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Newspaper size={22} className="text-flag" /> Card News</h1>
            <div className="mt-1 h-[3px] w-14 bg-flag" />
          </div>
          <Link href="/cards" className="text-xs text-ink/50 underline-offset-4 hover:text-ink hover:underline">← Cards</Link>
        </header>
        <p className="mt-1 text-[11px] text-ink/45">Auto-scanned for your players &amp; cards. Market-moving items rise to the top and ping you.</p>

        {!rows.length ? (
          <div className="mt-4 rounded-xl border border-hairline bg-white p-6 text-center">
            <Newspaper size={22} className="mx-auto text-ink/25" />
            <p className="mt-2 text-sm text-ink/50">No news yet — the scanner runs daily.</p>
            <p className="mt-1 text-[11px] text-ink/40">It watches the players &amp; card names in your inventory.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {rows.map((n) => {
              const dir = DIR[(n.direction as keyof typeof DIR) ?? "neutral"] ?? DIR.neutral;
              const sig = Math.round((n.significance ?? 0) * 100);
              return (
                <div key={n.id} className={"rounded-xl border bg-white p-3 " + (n.market_moving ? "border-flag/40" : "border-hairline")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-ink/40">
                        <span className="font-semibold text-ink/60">{n.subject}</span>
                        {n.source && <span>· {n.source}</span>}
                        <span>· {fmtWhen(n.published_at)}</span>
                      </div>
                      <a href={n.url} target="_blank" rel="noreferrer" className="flex items-start gap-1 text-sm font-semibold text-ink hover:text-flag">
                        {n.title} <ExternalLink size={11} className="mt-0.5 shrink-0 text-ink/30" />
                      </a>
                      {n.summary && <p className="mt-1 text-[12px] leading-snug text-ink/60">{n.summary}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={"flex items-center gap-0.5 text-[10px] font-bold " + dir.cls}><dir.Icon size={11} /> {dir.label}</span>
                      {sig > 0 && <span className="figures text-[10px] text-ink/40">{sig}%</span>}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {n.market_moving && <span className="rounded bg-flag/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-flag">market-moving</span>}
                    {n.card_id && <Link href={`/cards/${n.card_id}`} className="text-[11px] font-semibold text-flag hover:underline">View card →</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

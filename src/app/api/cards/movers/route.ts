// Top movers (Beau, 2026-07-20). Ranks the inventory by % price move over a
// window from card_price_history, and flags cards deviating from their own trend
// line. Read-only; card-access gated.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentRole, hasCardAccess } from "@/lib/cards/roles";
import { pctChangeOverWindow, trendDeviation, type PricePoint } from "@/lib/cards/movers";
import { readAllSafe } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY = 86_400_000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasCardAccess(await currentRole())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const days = Math.min(3650, Math.max(1, Math.round(Number(sp.get("days")) || 7)));
  const now = Date.now();

  const { rows: live } = await readAllSafe<{ id: string; player: string | null; year: number | null; set_name: string | null; market_value: number | null; manual_price: number | null }>(
    (from, to) => supabase
      .from("cards")
      .select("id, player, year, set_name, market_value, manual_price")
      .not("status", "in", "(archived,sold)")
      .order("id", { ascending: true })
      .range(from, to));
  const meta = new Map(live.map((c) => [c.id as string, c]));
  const curOf = (c: { market_value: number | null; manual_price: number | null }) =>
    (c.manual_price ?? c.market_value) as number | null;

  // History within a generous window so the baseline (newest point ≤ cutoff) is
  // usually present even for weekly/monthly-priced cards.
  const since = new Date(now - Math.max(days * 3, 90) * DAY).toISOString();
  // `.limit(50000)` was capped at 1000 by PostgREST: with more than 1000 history
  // points in the window, most cards had NO baseline and simply vanished from the
  // movers list. Paged, newest-first, with id as a stable tiebreaker so paging
  // can't repeat or skip a point. (2026-07-24)
  const { rows: hist } = await readAllSafe<{ card_id: string; price: number; ts: string }>(
    (from, to) => supabase
      .from("card_price_history")
      .select("id, card_id, price, ts")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to), 200_000);

  const points = new Map<string, PricePoint[]>();
  for (const h of hist) {
    const id = h.card_id as string;
    if (!meta.has(id)) continue;
    (points.get(id) ?? points.set(id, []).get(id)!).push({ price: Number(h.price), at: new Date(h.ts as string).getTime() });
  }

  const title = (c: { year: number | null; player: string | null; set_name: string | null }) =>
    [c.year, c.player, c.set_name].filter(Boolean).join(" ") || "(card)";

  const movers: { id: string; title: string; pct: number; from: number; to: number }[] = [];
  const deviations: { id: string; title: string; pct: number; expected: number; actual: number }[] = [];

  for (const [id, pts] of points) {
    const c = meta.get(id)!;
    const cur = curOf(c);
    // Append the current value as the freshest point so a just-adopted value counts.
    const series = cur != null && cur > 0 ? [...pts, { price: cur, at: now }] : pts;
    const m = pctChangeOverWindow(series, days, now);
    if (m && Math.abs(m.pct) >= 0.5) movers.push({ id, title: title(c), pct: m.pct, from: m.from, to: m.to });
    const d = trendDeviation(series, now);
    if (d && Math.abs(d.pct) >= 5) deviations.push({ id, title: title(c), pct: d.pct, expected: d.expected, actual: d.actual });
  }

  movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  deviations.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return NextResponse.json({
    window_days: days,
    movers: movers.slice(0, 100),
    deviations: deviations.slice(0, 50),
    tracked: points.size,
  });
}

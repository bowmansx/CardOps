// Card news scanner (Beau, 2026-07-20). Daily: for each card subject (player /
// card name), pull free Google News RSS, score new headlines with Haiku for
// significance + likely market direction, store them, and push the market-moving
// ones. Guarded by CRON_SECRET; AI gated by the shared anthropic_vision switch.
import { auditOrThrow } from "@/lib/audit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, HAIKU_MODEL } from "@/lib/anthropic";
import { createServiceClient } from "@/lib/supabase/service";
import { sendToAll, pushConfigured, type StoredSubscription } from "@/lib/push";
import { subjectsFromCards, googleNewsRssUrl, parseRssItems, type NewsCard } from "@/lib/cards/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUBJECT_CAP = 12;
const HEADLINES_PER_SUBJECT = 6;
const NOTIFY_MIN_SIG = 0.6;

const ScoreSchema = z.object({
  items: z.array(
    z.object({
      index: z.number(),
      significance: z.number().describe("0..1 — how much this could affect the card's market value"),
      direction: z.enum(["up", "down", "neutral"]),
      market_moving: z.boolean(),
      summary: z.string().describe("one short sentence"),
    }),
  ),
});

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set." }, { status: 503 });

  const { data: cfg } = await svc.from("service_config").select("enabled").eq("key", "anthropic_vision").maybeSingle();
  if (!cfg?.enabled) return NextResponse.json({ ok: true, skipped: "AI off" });

  // card_news is deliberately SHARED market context, so it's fine for one user's
  // cards to generate news everyone sees. What isn't fine is the subject cap
  // being filled in arbitrary order — the owner's own players could be crowded
  // out entirely by a member's inventory, on the owner's AI budget. Owner's
  // cards first, then everyone else's fill whatever cap remains.
  const SELECT = "id, player, set_name, sport_category, market_value, manual_price";
  const { data: ownerRow } = await svc.from("profiles").select("id").eq("role", "owner").limit(1).maybeSingle();
  const ownerId = (ownerRow?.id as string | undefined) ?? null;

  const { data: mine } = ownerId
    ? await svc.from("cards").select(SELECT)
        .eq("user_id", ownerId).not("status", "in", "(archived,sold)").not("player", "is", null).limit(1000)
    : { data: [] };
  const { data: theirs } = await svc.from("cards").select(SELECT)
    .not("status", "in", "(archived,sold)").not("player", "is", null)
    .neq("user_id", ownerId ?? "00000000-0000-0000-0000-000000000000")
    .limit(1000); // only SUBJECT_CAP distinct players are used; 1000 is PostgREST's real ceiling
  const cards = [...(mine ?? []), ...(theirs ?? [])];
  const subjects = subjectsFromCards(cards as NewsCard[], SUBJECT_CAP);
  if (!subjects.length) return NextResponse.json({ ok: true, subjects: 0 });

  // Known URLs (recent) so we only score/insert NEW items. This is a cheap
  // PRE-filter, not the guard — the exact `.in("url", candidates)` check below is
  // what actually prevents a re-insert, and `upsert(onConflict:url)` backs it up.
  // So a bounded recency window is correct here; it just needs to be an honest
  // one. `.limit(5000)` read as "the last 5000" but PostgREST caps a request at
  // 1000, so say 1000. (2026-07-24)
  const { data: recent } = await svc
    .from("card_news").select("url").order("created_at", { ascending: false }).limit(1000);
  const known = new Set((recent ?? []).map((r) => r.url as string));

  let inserted = 0;
  const movers: { title: string; direction: string }[] = [];

  for (const s of subjects) {
    try {
      // Time-box the external fetch so one hung subject can't eat the whole run.
      const res = await fetch(googleNewsRssUrl(s.query), {
        headers: { "User-Agent": "CardOps/1.0 (card inventory)" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const candidates = parseRssItems(xml, HEADLINES_PER_SUBJECT * 2).filter((it) => !known.has(it.url));
      if (!candidates.length) continue;
      // Precise dedup: a url can age out of the coarse `known` window — a DB
      // check on these exact urls stops re-scoring + re-pushing an old headline.
      const { data: existing } = await svc.from("card_news").select("url").in("url", candidates.map((c) => c.url));
      const have = new Set((existing ?? []).map((e) => e.url as string));
      const fresh = candidates.filter((it) => !have.has(it.url)).slice(0, HEADLINES_PER_SUBJECT);
      if (!fresh.length) continue;

      const msg = await anthropic.messages.parse({
        model: HAIKU_MODEL,
        max_tokens: 1200,
        system: [{
          type: "text",
          text: `You assess trading-card market impact. For the collectible subject "${s.subject}", score EACH headline: significance 0..1 (how much it could move the card's value — injuries, awards, bans, reprints, retirements, records move markets; routine coverage does not), a likely price direction, whether it's genuinely market-moving, and a one-sentence summary. Echo each input index.`,
          cache_control: { type: "ephemeral" },
        }],
        messages: [{ role: "user", content: fresh.map((it, i) => `${i}. ${it.title}${it.source ? ` (${it.source})` : ""}`).join("\n") }],
        output_config: { format: zodOutputFormat(ScoreSchema) },
      });
      const scores = new Map((msg.parsed_output?.items ?? []).map((x) => [x.index, x]));

      const rows = fresh.map((it, i) => {
        const sc = scores.get(i);
        const pub = it.publishedAt ? new Date(it.publishedAt) : null;
        const marketMoving = !!sc?.market_moving && (sc?.significance ?? 0) >= NOTIFY_MIN_SIG;
        if (marketMoving) movers.push({ title: it.title, direction: sc?.direction ?? "neutral" });
        return {
          subject: s.subject, card_id: s.cardId, title: it.title, url: it.url, source: it.source,
          published_at: pub && !isNaN(pub.getTime()) ? pub.toISOString() : null,
          significance: sc ? Math.max(0, Math.min(1, sc.significance)) : null,
          direction: sc?.direction ?? null, market_moving: marketMoving, summary: sc?.summary ?? null,
          notified: marketMoving, // digest below covers these
        };
      });
      const { data: ins, error } = await svc.from("card_news").upsert(rows, { onConflict: "url", ignoreDuplicates: true }).select("id");
      if (!error) { inserted += ins?.length ?? 0; rows.forEach((r) => known.add(r.url)); }
    } catch {
      // one subject failing must not abort the run
    }
  }

  // One digest push for the market-movers (owner devices).
  let pushed = 0;
  if (movers.length && pushConfigured()) {
    const { data: owners } = await svc.from("profiles").select("id").eq("role", "owner");
    const ownerIds = (owners ?? []).map((o) => o.id as string);
    const { data: subs } = ownerIds.length
      ? await svc.from("push_subscriptions").select("endpoint, keys").in("user_id", ownerIds)
      : { data: [] as StoredSubscription[] };
    const arrow = (d: string) => (d === "up" ? "↑" : d === "down" ? "↓" : "•");
    const body = movers.slice(0, 3).map((m) => `${arrow(m.direction)} ${m.title}`).join(" · ");
    await sendToAll((subs ?? []) as StoredSubscription[], {
      title: `📰 ${movers.length} market-moving card update${movers.length > 1 ? "s" : ""}`,
      body,
      url: "/cards/news",
    });
    pushed = movers.length;
  }

  await auditOrThrow(svc, {
    actor: "cron", action: "card_news", target: "card_news",
    payload: { subjects: subjects.length, inserted, movers: movers.length }, result: "ok",
  });
  return NextResponse.json({ ok: true, subjects: subjects.length, inserted, movers: movers.length, pushed });
}
